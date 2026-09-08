import { localizedTextValue, missingLocales } from './localized-text';
import { formatMoney } from './money';
import { idOf, type ResourceDescriptor } from './resource-descriptor';
import type { FieldDescriptor, ResourceRow } from './resource-field';

/**
 * A row, formatted into the strings a list draws.
 *
 * Formatting happens here rather than in a template, for the reason velista
 * formats dates in its selectors: `Intl` is the only thing in this workspace
 * allowed to turn a date into words, `DatePipe` is not, and a pure function is
 * the only place a spec can assert on the result without rendering anything.
 */

/** One table cell, or one line of a card. */
export interface ResourceCell {
  /** Already formatted. Empty when {@link key} carries the whole answer. */
  readonly text: string;
  /**
   * A translation key to render instead of {@link text}.
   *
   * The values that are words rather than data: yes, no, and nothing at all. A
   * pure function cannot translate, and hard coding "Yes" here would be the one
   * untranslated string in the app.
   */
  readonly key?: string;
  /** Where a `url` field points, so the list can draw a link. */
  readonly href?: string;
  /**
   * The content locales a localized text has no words in (plan 0079).
   *
   * The cell shows the fallback, so a Spanish only name reads as its Spanish
   * name in an English table; this is what marks it as one still waiting for
   * an English one, which is the flag plan 0038 section 11 asked for.
   */
  readonly missing?: readonly string[];
  /**
   * What a reference cell points at (admin plan 0023, section 2.1).
   *
   * Emitted for every reference field with an id, unconditionally: the id is
   * on the row, so the cell always knows what it points at even when it cannot
   * yet say what that is called. It carries no router commands, because
   * {@link toCell} lives in `models` and must not know the route table; the
   * list page derives {@link link} from the resource registry.
   */
  readonly reference?: { readonly resource: string; readonly id: string };
  /**
   * Router commands to the target's own screen, or absent.
   *
   * Filled by the **page**, never here: the registry knows where a resource is
   * mounted and whether it has a detail screen, and this module knows neither.
   * A name without a link is still an answer; a link to a 404 is not.
   */
  readonly link?: readonly string[];
}

/** A row, ready to render. */
export interface ResourceRowView<T extends ResourceRow = ResourceRow> {
  readonly id: string;
  /** What the descriptor calls this row. */
  readonly title: string;
  /** By field name. Only the fields the presentation asked for. */
  readonly cells: Readonly<Record<string, ResourceCell>>;
  /** The row itself, for a named action that needs it. */
  readonly row: T;
}

/** How to render values: which language, and which content locales to prefer. */
export interface RenderOptions {
  /** The interface locale, which decides number and date shapes. */
  readonly locale: string;
  /** The content locales to prefer, in order, for localized text. */
  readonly contentLocales: readonly string[];
}

export const EMPTY_VALUE_KEY = 'resource.value.none';
export const TRUE_VALUE_KEY = 'resource.value.yes';
export const FALSE_VALUE_KEY = 'resource.value.no';

const EMPTY: ResourceCell = { text: '', key: EMPTY_VALUE_KEY };

/** One field of one row, as a cell. */
export function toCell<T extends ResourceRow>(
  field: FieldDescriptor<T>,
  row: T,
  options: RenderOptions
): ResourceCell {
  // `read` before the property, so a field that says where its displayed value
  // comes from is obeyed. It is display only and never editable, so nothing the
  // form writes can disagree with what this shows.
  const value = field.read === undefined ? row[field.name] : field.read(row);

  if (field.kind === 'boolean') {
    // Before the null check: a boolean that is missing is not the same claim as
    // a boolean that is false, and only one of them is worth drawing as a word.
    return typeof value === 'boolean'
      ? { text: '', key: value ? TRUE_VALUE_KEY : FALSE_VALUE_KEY }
      : EMPTY;
  }

  if (value === null || value === undefined || value === '') {
    return EMPTY;
  }

  switch (field.kind) {
    case 'localized-text': {
      const text = localizedTextValue(value, options.contentLocales);
      if (text === '') {
        return EMPTY;
      }
      const missing = missingLocales(value, options.contentLocales);
      return missing.length === 0 ? { text } : { text, missing };
    }

    case 'money': {
      const text = formatMoney(value, field.decimals, options.locale);
      return text === '' ? EMPTY : { text };
    }

    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        ? { text: new Intl.NumberFormat(options.locale).format(value) }
        : EMPTY;

    case 'date':
      return formatDate(value, options.locale, field.time === true);

    case 'enum': {
      const option = field.options.find((entry) => entry.value === value);
      // The label is a key, so it goes in `key`. A value the descriptor does
      // not list falls through to its raw text rather than vanishing: an enum
      // the backend widened should be visible as something an operator can
      // report, not as an empty cell.
      return option === undefined
        ? { text: String(value) }
        : { text: '', key: option.label };
    }

    case 'text':
      return field.format === 'url' && typeof value === 'string'
        ? { text: value, href: value }
        : { text: String(value) };

    // The target's name where the field says how to get one, and the id
    // otherwise (admin plan 0023). `reference` rides along either way, so the
    // page can derive a link; the id stays the fallback for a name that has
    // not arrived yet and for a reference whose target is gone. Staying pure
    // and synchronous is why the lookup route overlays names outside this
    // function rather than teaching it to wait.
    case 'reference': {
      const id = String(value);
      const reference = { resource: field.resource, id };
      if (field.nameFrom !== undefined) {
        const name = row[field.nameFrom];
        const text = localizedTextValue(name, options.contentLocales);
        if (text !== '') {
          const missing = missingLocales(name, options.contentLocales);
          return missing.length === 0
            ? { text, reference }
            : { text, missing, reference };
        }
      }
      return { text: id, reference };
    }

    // Printed rather than described. There is nothing this app knows about the
    // shape, so the only honest cell is the value itself, on one line: a cell
    // is a table cell, and the form is where it is read across several.
    case 'json': {
      const text = JSON.stringify(value);
      return text === undefined || text === '{}' ? EMPTY : { text };
    }
  }
}

/** A timestamp as words, with `Intl` and never with `DatePipe`. */
function formatDate(
  value: unknown,
  locale: string,
  withTime: boolean
): ResourceCell {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return EMPTY;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return EMPTY;
  }

  const format = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    ...(withTime ? { timeStyle: 'short' } : {}),
  });

  return { text: format.format(date) };
}

/**
 * A row, as the list renders it.
 *
 * Only the fields the presentation names get a cell. A descriptor that lists a
 * column with no matching field is a mistake worth failing on rather than
 * skipping, so the cell is absent and `resource-descriptor.spec.ts` is what
 * catches it.
 */
export function toRowView<T extends ResourceRow>(
  descriptor: ResourceDescriptor<T>,
  row: T,
  options: RenderOptions
): ResourceRowView<T> {
  const cells: Record<string, ResourceCell> = {};

  for (const name of descriptor.list.columns) {
    const field = descriptor.fields.find((entry) => entry.name === name);
    if (field !== undefined) {
      cells[name] = toCell(field, row, options);
    }
  }

  return {
    id: idOf(descriptor, row),
    title: descriptor.title(row),
    cells,
    row,
  };
}
