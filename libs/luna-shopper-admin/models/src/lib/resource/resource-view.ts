import { localizedListToText, localizedTextValue } from './localized-text';
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
      const text = localizedTextValue(
        field.entries === 'list' ? localizedListToText(value) : value,
        options.contentLocales
      );
      return text === '' ? EMPTY : { text };
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

    // A uuid, drawn as a uuid. Resolving it to the target's name costs a request
    // per row per column, which a list cannot afford; the picker in the form is
    // where a reference is shown by name (plan 0004, section 6).
    case 'reference':
      return { text: String(value) };
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
