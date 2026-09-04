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
   *
   * **`'create'` means settable once and fixed afterwards**, which is a real
   * shape rather than a convenience. Three catalog resources have it, and in
   * each the gateway says so itself: `CreateSupermarketLocationDto` takes the
   * chain and `UpdateSupermarketLocationDto` does not, `CreatePriceScopeDto`
   * takes it and `UpdatePriceScopeDto` does not, and a price is **keyed** on
   * `(itemId, priceScopeId)` so changing either would write a second row rather
   * than move this one. A form offering a control the server ignores is worse
   * than one that does not: the operator types a value, sees the form succeed,
   * and finds nothing changed.
   */
  readonly editable?: boolean | 'create';
  /**
   * Where this field's displayed value comes from, when it is not the property.
   *
   * For **display only**, and allowed only on a field the form cannot change.
   * The form still writes `name`, so a field that reads from somewhere else and
   * is also editable would submit one thing and show another.
   *
   * It exists for a shape the gateway really answers with: a zone row carries
   * `ownerName` from a second call to auth, and that name is null whenever the
   * id resolved to nobody. The rule there is that the screen renders the id and
   * the listing still succeeds (plan 0074, section 3), which is one expression
   * here rather than a special case in the list.
   *
   * A method rather than a property holding a function, for the reason
   * {@link NamedAction.available} is one: under `strictFunctionTypes` a
   * property's parameter is checked contravariantly, and a descriptor for a
   * concrete row has to remain assignable to a descriptor for any row.
   */
  read?(row: T): unknown;
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

/** A `numeric` column, carried as a string for as long as this app can manage. */
export interface MoneyField<T extends ResourceRow> extends FieldBase<T> {
  readonly kind: 'money';
  /** The column's scale: 2 for `price`, 4 for `unitPrice`. */
  readonly decimals: number;
  /**
   * What the wire carries, which is not always what the column holds.
   *
   * `numeric` arrives as a string and should leave as one, and that is the
   * default. But `UpsertSupermarketItemDto` validates `price` and `unitPrice`
   * with `@IsNumber()`, so the one route that writes a price refuses the string
   * the column stores. Stating it here keeps the digits as text through the
   * control, the validation and the rounding rules, and converts once at the
   * last moment rather than making the whole app carry floats for one DTO.
   */
  readonly wire?: 'string' | 'number';
}

export interface BooleanField<T extends ResourceRow> extends FieldBase<T> {
  readonly kind: 'boolean';
  /**
   * What a create starts from, when the column's own default is not `false`.
   *
   * Only a boolean needs this, and the reason is that only a boolean has no
   * empty. A text field left alone is left out of the request and the column
   * keeps its default; a checkbox left alone submits `false`, which is a real
   * value and overrides it. `SupermarketItem.available` defaults to true, so a
   * price created through an unticked box would be a price on a product the
   * screen had just declared unsold.
   *
   * Ignored for a nullable boolean, which starts at null because null is what
   * its three answers call "not decided".
   */
  readonly initial?: boolean;
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
  /**
   * Whether the column holds a **list** of strings per locale rather than one.
   *
   * `ProductGroup.synonyms` is the one, and it is worth having rather than
   * leaving uneditable: a group's synonyms are what let a shopper's word reach
   * its members, so a screen that could create a group but not say what it is
   * called would leave the interesting half of the resource unreachable.
   *
   * One entry per line, because a line break is the one separator a synonym
   * cannot contain. A comma can, and guessing which commas separate and which
   * belong is how a list quietly loses an entry.
   */
  readonly list?: boolean;
}

/** A timestamp, formatted with `Intl` and never with `DatePipe`. */
export interface DateField<T extends ResourceRow> extends FieldBase<T> {
  readonly kind: 'date';
  /** Whether the time of day is part of the answer. */
  readonly time?: boolean;
}

/**
 * A `jsonb` column this app knows nothing about the shape of (plan 0009,
 * section 3.1).
 *
 * A zone's `config` is the one, and it is the reason this kind exists rather
 * than a `text` field holding JSON. `UpdateAdminZoneDto.config` is validated
 * with `@IsObject()`, so the column takes an object and a string is refused.
 * The control still holds text, because that is what a textarea holds and
 * because half typed JSON has to survive under the operator's cursor; the parse
 * happens once, on the way out, after validation has agreed it reads.
 *
 * **It is replaced whole rather than merged**, which is what `zone.update` does
 * for a zone's own owner. So the form opens with the whole object printed out,
 * and what is submitted is the whole object as edited.
 */
export interface JsonField<T extends ResourceRow> extends FieldBase<T> {
  readonly kind: 'json';
}

export type FieldDescriptor<T extends ResourceRow = ResourceRow> =
  | TextField<T>
  | NumberField<T>
  | MoneyField<T>
  | BooleanField<T>
  | EnumField<T>
  | ReferenceField<T>
  | LocalizedTextField<T>
  | DateField<T>
  | JsonField<T>;

/**
 * Whether the form is creating a row or changing one.
 *
 * Here rather than beside the draft, because {@link isEditable} needs it and a
 * field's own rules are the deeper of the two.
 */
export type FormMode = 'create' | 'edit';

/**
 * Whether the form may change this field, in this mode. Absent means yes.
 *
 * The mode is not optional, and that is deliberate. A field that is settable
 * only at creation is invisible to a caller that forgets to say which screen it
 * is asking about, and the failure would be an ignored control rather than an
 * error.
 */
export function isEditable<T extends ResourceRow>(
  field: FieldDescriptor<T>,
  mode: FormMode
): boolean {
  if (field.editable === 'create') {
    return mode === 'create';
  }
  return field.editable !== false;
}
