import type { ScopeMarkView } from './info-content';
import {
  localizedTextValue,
  toLocalizedLines,
  toLocalizedText,
} from './localized-text';
import type {
  FieldCheck,
  FieldDescriptor,
  ResourceRow,
} from './resource-field';
import {
  EMPTY_VALUE_KEY,
  toCell,
  type RenderOptions,
  type ResourceCell,
} from './resource-view';

/**
 * One field of one row, as the record page reads it (admin plan 0052, section
 * 2.4).
 *
 * A table cell is one line of text, and a page has room to say more: a line
 * for each language, a picture, a name for each of several references. So the
 * page has its own shape for a value, and {@link toRecordValue} is the one
 * place that decides it. No component decides for itself what an empty value
 * is: it is `none`, for every kind.
 */
export type RecordValue = BareValue & {
  readonly scope?: ScopeMarkView;
  readonly check?: FieldCheck;
};

/** The value alone, before the mark and the state a field puts beside it. */
type BareValue =
  | { readonly kind: 'none' }
  | { readonly kind: 'text'; readonly text: string; readonly mono?: true }
  | {
      /** A value that is a word and not data: yes, no, the label of a choice. */
      readonly kind: 'word';
      readonly key: string;
      readonly args?: Readonly<Record<string, string | number>>;
    }
  | {
      readonly kind: 'link';
      readonly text: string;
      readonly href: string;
      /** A translation key for the words of the link, in place of `text`. */
      readonly label?: string;
    }
  | { readonly kind: 'image'; readonly src: string }
  | {
      readonly kind: 'lines';
      /** One for each locale of the field. `null` is a language with no words. */
      readonly lines: readonly {
        readonly locale: string;
        readonly text: string | null;
      }[];
    }
  | {
      readonly kind: 'reference';
      readonly resource: string;
      readonly id: string;
      /** `null` when the row carries no name and the page must resolve one. */
      readonly name: string | null;
    }
  | {
      readonly kind: 'references';
      readonly resource: string;
      readonly ids: readonly string[];
      readonly ordered: boolean;
    }
  | { readonly kind: 'json'; readonly text: string };

const NONE: BareValue = { kind: 'none' };

/** One field of one row, as a value the page reads. */
export function toRecordValue<T extends ResourceRow>(
  field: FieldDescriptor<T>,
  row: T,
  options: RenderOptions
): RecordValue {
  const value = bareValue(field, row, options);
  const scope = field.scope?.(row);
  const check = field.check?.(row) ?? null;

  return {
    ...value,
    ...(scope === undefined ? {} : { scope }),
    ...(check === null ? {} : { check }),
  };
}

function bareValue<T extends ResourceRow>(
  field: FieldDescriptor<T>,
  row: T,
  options: RenderOptions
): BareValue {
  // `read` before the property, as `toCell` does and for its reason.
  const value = field.read === undefined ? row[field.name] : field.read(row);

  switch (field.kind) {
    case 'localized-text': {
      if (!isLocalized(value)) {
        // Whatever `read` answered that is not one text for each language: a
        // sentence, or a plain string.
        return fromCell(toCell(field, row, options));
      }
      // A list holds several entries for each language. They read on one
      // line, because a line of the value is a language.
      const text =
        field.list === true
          ? Object.fromEntries(
              Object.entries(toLocalizedLines(value, field.locales)).map(
                ([locale, lines]) => [locale, lines.split('\n').join(', ')]
              )
            )
          : toLocalizedText(value);
      const lines = field.locales.map((locale) => {
        const words = (text[locale] ?? '').trim();
        return { locale, text: words === '' ? null : words };
      });
      return lines.every((line) => line.text === null)
        ? NONE
        : { kind: 'lines', lines };
    }

    case 'text': {
      if (typeof value !== 'string' || value === '') {
        return fromCell(toCell(field, row, options));
      }
      switch (field.format) {
        case 'url':
          return field.linkLabel === undefined
            ? { kind: 'link', text: value, href: value }
            : {
                kind: 'link',
                text: value,
                href: value,
                label: field.linkLabel,
              };
        case 'image':
          return { kind: 'image', src: value };
        case 'code':
          return { kind: 'text', text: value, mono: true };
        default:
          return { kind: 'text', text: value };
      }
    }

    case 'reference': {
      if (typeof value !== 'string' || value === '') {
        return NONE;
      }
      return {
        kind: 'reference',
        resource: field.resource,
        id: value,
        name: nameOn(field.nameFrom, row, options),
      };
    }

    case 'references': {
      const ids = Array.isArray(value)
        ? value.filter(
            (id): id is string => typeof id === 'string' && id !== ''
          )
        : [];
      return ids.length === 0
        ? NONE
        : {
            kind: 'references',
            resource: field.resource,
            ids,
            ordered: field.ordered === true,
          };
    }

    // Printed across several lines, where a cell prints it on one. Nothing is
    // known about the shape, so the honest value is the object itself.
    case 'json': {
      if (value === null || value === undefined || value === '') {
        return NONE;
      }
      const text = JSON.stringify(value, null, 2);
      return text === undefined || text === '{}'
        ? NONE
        : { kind: 'json', text };
    }

    // A number, an amount of money, a date, a choice and a yes or no read
    // exactly as the list reads them, so the formats are written once.
    default:
      return fromCell(toCell(field, row, options));
  }
}

/** A cell of the list, as a value of the page. */
function fromCell(cell: ResourceCell): BareValue {
  if (cell.key === EMPTY_VALUE_KEY || (cell.key !== undefined && cell.flag)) {
    return NONE;
  }
  if (cell.key !== undefined) {
    return cell.args === undefined
      ? { kind: 'word', key: cell.key }
      : { kind: 'word', key: cell.key, args: cell.args };
  }
  return cell.text === '' ? NONE : { kind: 'text', text: cell.text };
}

/** Whether a value is one object keyed by locale, which is what the column holds. */
function isLocalized(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { kind?: unknown }).kind !== 'key'
  );
}

/** The name a read joined onto the row, or `null` when it carries none. */
function nameOn<T extends ResourceRow>(
  property: string | undefined,
  row: T,
  options: RenderOptions
): string | null {
  if (property === undefined) {
    return null;
  }
  const name = row[property];
  const text =
    typeof name === 'string'
      ? name
      : localizedTextValue(name, options.contentLocales);
  return text === '' ? null : text;
}
