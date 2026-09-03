/**
 * What one field of a resource is (plan 0004, section 1).
 *
 * A type, a keyed label, whether it is required, whether it is editable, and
 * its validation. The list reads these to draw a column and the form reads them
 * to draw a control, so a rule stated once here is obeyed by both and by every
 * entity that arrives after this one.
 */

/** Anything the generic machinery can read a field off. */
export type ResourceRow = Record<string, unknown>;

/** A field name that really exists on the row. */
export type FieldName<T extends ResourceRow> = Extract<keyof T, string>;

/** One choice, with a keyed label. */
export interface EnumOption {
  readonly value: string;
  readonly label: string;
}

/**
 * Something to say about a field, either as a key or as words.
 *
 * Two shapes because the two sources are genuinely different. A rule this app
 * enforces is a key with arguments, translated where it is shown. A rule the
 * **server** enforced arrives already translated into the request's locale
 * (`ProblemDetails.errors`), and re-keying it would mean this app owning a copy
 * of every validation message the backend has.
 *
 * Keys carry their arguments rather than an interpolated string, because the
 * testing translator does not interpolate and a spec has to be able to assert on
 * what was said rather than on what it rendered to.
 */
export type FieldMessage =
  | {
      readonly kind: 'key';
      readonly key: string;
      readonly args?: Readonly<Record<string, string | number>>;
    }
  | { readonly kind: 'text'; readonly text: string };

/** A keyed message, said shortly. */
export function fieldMessage(
  key: string,
  args?: Readonly<Record<string, string | number>>
): FieldMessage {
  return args === undefined ? { kind: 'key', key } : { kind: 'key', key, args };
}

interface FieldBase<T extends ResourceRow> {
  /** The property this field reads and writes. */
  readonly name: FieldName<T>;
  /** A translation key. */
  readonly label: string;
  /** A translation key for the line under the control, when one helps. */
  readonly help?: string;
  /** Refused when empty. */
  readonly required?: boolean;
  /**
   * Whether nothing is an allowed answer, and an ordinary one.
   *
   * It decides what an emptied field submits: `null` when the column is
   * nullable, and nothing at all when it is not, so clearing an optional field
   * that has no null is left out of the request rather than sent as `''`.
   *
   * `productGroupId` being null is the resting state of a freshly harvested
   * product rather than a missing value, so a nullable field offers a way to
   * clear it and says nothing about it being empty.
   */
  readonly nullable?: boolean;
  /**
   * Whether the form may change it. Defaults to true.
   *
   * A field that is not editable still renders, as text: an id and a created
   * date are the two things an operator most often needs to copy, and a form
   * that hides everything it cannot change is a worse detail view than a table
   * row.
   */
  readonly editable?: boolean;
}

/** A single line, or a paragraph. */
export interface TextField<T extends ResourceRow> extends FieldBase<T> {
  readonly kind: 'text';
  readonly multiline?: boolean;
  readonly maxLength?: number;
  /** `url` renders a link in the list and validates the shape in the form. */
  readonly format?: 'plain' | 'url';
}

/** A count or a measure. Not money, which is its own kind for a reason. */
export interface NumberField<T extends ResourceRow> extends FieldBase<T> {
  readonly kind: 'number';
  readonly min?: number;
  readonly max?: number;
  readonly integer?: boolean;
}

/** A `numeric` column, carried as a string end to end. */
export interface MoneyField<T extends ResourceRow> extends FieldBase<T> {
  readonly kind: 'money';
  /** The column's scale: 2 for `price`, 4 for `unitPrice`. */
  readonly decimals: number;
}

export interface BooleanField<T extends ResourceRow> extends FieldBase<T> {
  readonly kind: 'boolean';
}

export interface EnumField<T extends ResourceRow> extends FieldBase<T> {
  readonly kind: 'enum';
  readonly options: readonly EnumOption[];
}

/**
 * A uuid pointing at another resource (plan 0004, section 6).
 *
 * `resource` names the descriptor whose rows this one points at, so the picker
 * can search that resource and show its rows by name. A raw uuid input is
 * unusable, and this is the field that says so.
 */
export interface ReferenceField<T extends ResourceRow> extends FieldBase<T> {
  readonly kind: 'reference';
  /** The `name` of the resource being pointed at. */
  readonly resource: string;
}

/** A `jsonb` column with one string per locale. */
export interface LocalizedTextField<
  T extends ResourceRow,
> extends FieldBase<T> {
  readonly kind: 'localized-text';
  /** The locales the form renders an input for. */
  readonly locales: readonly string[];
  readonly maxLength?: number;
}

/** A timestamp, formatted with `Intl` and never with `DatePipe`. */
export interface DateField<T extends ResourceRow> extends FieldBase<T> {
  readonly kind: 'date';
  /** Whether the time of day is part of the answer. */
  readonly time?: boolean;
}

export type FieldDescriptor<T extends ResourceRow = ResourceRow> =
  | TextField<T>
  | NumberField<T>
  | MoneyField<T>
  | BooleanField<T>
  | EnumField<T>
  | ReferenceField<T>
  | LocalizedTextField<T>
  | DateField<T>;

/** Whether the form may change this field. Absent means yes. */
export function isEditable<T extends ResourceRow>(
  field: FieldDescriptor<T>
): boolean {
  return field.editable !== false;
}
