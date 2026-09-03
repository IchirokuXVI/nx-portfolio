import type {
  EnumOption,
  FieldDescriptor,
  FieldName,
  ResourceRow,
} from './resource-field';

/**
 * What a resource is, in one object (plan 0004, section 1).
 *
 * Roughly fifteen entities need a list, a detail view and an edit form, and
 * written one screen at a time that is a month of nearly identical components
 * that end up disagreeing with each other about what a validation error looks
 * like. So there is one list and one form, and an entity screen is this object
 * plus whatever is genuinely peculiar to it.
 *
 * Everything the generic machinery cannot work out for itself is here, and
 * nothing else is. The one piece of real per entity judgement is
 * {@link ListPresentation.compact}: which columns are worth a phone's width.
 */

/** What a list read asks for. */
export interface ResourceQuery {
  /** The previous page's `nextCursor`. Absent for the first page. */
  readonly cursor?: string;
  readonly limit?: number;
  /** One of {@link ResourceDescriptor.sorts}, sent as `order`. */
  readonly order?: string;
  /** Filter values by query parameter name, empty ones already dropped. */
  readonly filters?: Readonly<Record<string, string>>;
}

/**
 * One page of rows.
 *
 * `nextCursor` is the **only** thing that says whether there is more. The number
 * of rows says nothing: a page can be short and not be the last one (plan 0004,
 * section 4).
 */
export interface ResourcePage<T extends ResourceRow = ResourceRow> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

/** What the form submits: field names to values, already in wire shape. */
export type ResourceInput = Record<string, unknown>;

/**
 * The four functions that list, read, create and update a resource, plus the
 * one that deletes it.
 *
 * A descriptor holds a factory for this rather than the object, so the
 * implementation can inject an `HttpClient` and the descriptor can stay a plain
 * constant declared at module scope.
 */
export interface ResourceGateway<T extends ResourceRow = ResourceRow> {
  list(query: ResourceQuery): Promise<ResourcePage<T>>;
  read(id: string): Promise<T>;
  create(input: ResourceInput): Promise<T>;
  update(id: string, input: ResourceInput): Promise<T>;
  remove(id: string): Promise<void>;
}

/**
 * Which fields are columns, and which of those survive to a phone.
 *
 * The second list is the one piece of per entity judgement the generic
 * component cannot make, which is why it is a field here rather than a CSS
 * breakpoint guess. A fifteen column table on a phone is unusable however it
 * scrolls, so below the breakpoint the list draws cards from `compact` alone.
 */
export interface ListPresentation<T extends ResourceRow = ResourceRow> {
  readonly columns: readonly FieldName<T>[];
  /** A subset of `columns`, in the order they appear on a card. */
  readonly compact: readonly FieldName<T>[];
}

/** What every filter says, whatever it is made of. */
interface FilterBase {
  /** The query parameter it sets, which is also its identity on the screen. */
  readonly param: string;
  /** A translation key. */
  readonly label: string;
  /**
   * Whether the list refuses to read anything until this is answered.
   *
   * Three of the catalog's reads begin from something rather than from
   * everything: a chain's shops are addressed under the chain, and a shop's
   * aisle positions name the shop as a required parameter. Asked without it the
   * gateway answers 400, so the honest screen is one that says which choice is
   * missing rather than one that shows an error it caused itself.
   */
  readonly required?: boolean;
  /**
   * Narrows the pickers below it, and is never sent to the gateway.
   *
   * An aisle position belongs to a shop, and a shop cannot be searched for
   * without naming its chain first, so the screen has to ask for a chain it has
   * no parameter for. The gateway validates its query with
   * `forbidNonWhitelisted`, so sending one anyway is a 400 rather than a
   * harmless extra.
   */
  readonly local?: boolean;
}

/**
 * A filter the list offers, and the query parameter it sets.
 *
 * A `reference` filter is a picker over another resource, and it is what makes
 * a parent choosable: `scopedBy` names the filter whose value narrows its
 * search, so the shop picker can search one chain's shops rather than every
 * chain's.
 */
export type FilterDescriptor =
  | ({ readonly kind: 'search' } & FilterBase)
  | ({
      readonly kind: 'enum';
      readonly options: readonly EnumOption[];
    } & FilterBase)
  | ({ readonly kind: 'boolean' } & FilterBase)
  | ({
      readonly kind: 'reference';
      /** The `name` of the resource this picker searches. */
      readonly resource: string;
      /** The `param` of the filter whose value narrows this picker. */
      readonly scopedBy?: string;
    } & FilterBase);

/**
 * The filter values the gateway is allowed to see.
 *
 * Local filters are dropped and empty ones with them, so a list never sends a
 * parameter the route does not declare and never sends one that says nothing.
 */
export function queryFilters(
  filters: readonly FilterDescriptor[],
  values: Readonly<Record<string, string>>
): Readonly<Record<string, string>> {
  const local = new Set(
    filters.filter((filter) => filter.local === true).map((f) => f.param)
  );

  return Object.fromEntries(
    Object.entries(values).filter(
      ([param, value]) => value !== '' && !local.has(param)
    )
  );
}

/** The required filters that have no answer yet. Empty means the list may read. */
export function unansweredFilters(
  filters: readonly FilterDescriptor[],
  values: Readonly<Record<string, string>>
): readonly FilterDescriptor[] {
  return filters.filter(
    (filter) => filter.required === true && (values[filter.param] ?? '') === ''
  );
}

/**
 * Something this resource can do that create, edit and delete do not cover.
 *
 * Aborting a harvest run and rejecting a discovered place are the shapes this
 * exists for. It is here rather than in `0006` so that those screens are a
 * descriptor rather than a component.
 */
export interface NamedAction<T extends ResourceRow = ResourceRow> {
  readonly name: string;
  /** A translation key. */
  readonly label: string;
  /** Whether the operator is asked first. */
  readonly confirm?: boolean;
  /**
   * Whether this row can have it done to it right now.
   *
   * A method rather than a property holding a function, and the difference is
   * load bearing. Under `strictFunctionTypes` a property's parameter is checked
   * contravariantly, which would stop a descriptor for a concrete row type from
   * being held anywhere that expects a descriptor for any row, and the registry
   * that resolves reference fields is exactly such a place.
   */
  available?(row: T): boolean;
  /**
   * Do it, and answer when it is done.
   *
   * The gateway is handed in rather than injected, because a descriptor is a
   * constant declared at module scope and there is no injection context there.
   * The screen that runs the action already holds one, and it is the same
   * gateway the list reads through, so an action cannot quietly talk to a
   * different backend from the rows it is changing.
   */
  run(row: T, gateway: ResourceGateway<T>): Promise<void>;
}

/** What an operator may do to this resource. */
export interface ResourceActions<T extends ResourceRow = ResourceRow> {
  readonly create?: boolean;
  readonly edit?: boolean;
  readonly delete?: boolean;
  readonly named?: readonly NamedAction<T>[];
}

export interface ResourceDescriptor<T extends ResourceRow = ResourceRow> {
  /** The stable key a reference field points at, and the translation prefix. */
  readonly name: string;
  /** The route segment, under the app's root. */
  readonly segment: string;
  /** Translation keys for one row and for many. */
  readonly labels: { readonly one: string; readonly many: string };
  /** The property holding the row's id. `id` unless stated. */
  readonly idField?: FieldName<T>;
  /**
   * What a row is addressed by, when that is not one property.
   *
   * The catalog has two resources the gateway offers no member route for: a
   * price and an aisle position are both written with a `PUT` naming their
   * natural key, and neither can be read back by the `id` it answers with.
   * Addressing them by that key is what lets them use the same list, the same
   * form and the same URL shape as everything else, rather than each growing a
   * screen because the backend spells identity differently.
   *
   * It is what the row's URL segment holds, so it has to survive one:
   * `encodeURIComponent` runs over the whole of it, and the gateway that made
   * it is the gateway that takes it apart.
   */
  identify?(row: T): string;
  /**
   * What to call one row, in a heading, a picker and a confirmation.
   *
   * A function rather than a field name, because a name is usually localized
   * text and choosing which locale to show is a decision the descriptor makes
   * once instead of every screen making it again.
   */
  title(row: T): string;
  readonly fields: readonly FieldDescriptor<T>[];
  readonly list: ListPresentation<T>;
  readonly filters?: readonly FilterDescriptor[];
  /** The orders the backend accepts, sent as `order`. Absent means none. */
  readonly sorts?: readonly EnumOption[];
  readonly actions?: ResourceActions<T>;
  /** Called in an injection context, so the gateway can inject what it needs. */
  gateway(): ResourceGateway<T>;
}

/**
 * A descriptor for whatever row shape, which is what a registry can hold.
 *
 * The generic form cannot be assigned to this one, and that is a property of
 * TypeScript rather than a mistake. A field name is `Extract<keyof T, string>`,
 * and `keyof T` makes `T` **contravariant**: a descriptor for a known row is
 * therefore not a descriptor for any row, however much it looks like one.
 */
export type AnyResourceDescriptor = ResourceDescriptor<ResourceRow>;

/**
 * A descriptor, checked against its row type and then erased.
 *
 * The check is the point. Writing the descriptor as `ResourceDescriptor<T>`
 * means a column, a field or a compact entry naming a property the row does not
 * have is a compile error, which is the mistake most available while writing
 * fifteen of these.
 *
 * The erasure is one cast, here, so it is not written fifteen times at fifteen
 * call sites where it would eventually be written wrong. It is safe in the
 * direction that matters: every field name really is a string, and the generic
 * screens only ever read a row by name.
 */
export function defineResource<T extends ResourceRow>(
  descriptor: ResourceDescriptor<T>
): AnyResourceDescriptor {
  return descriptor as unknown as AnyResourceDescriptor;
}

/** The property holding a row's id. */
export function idFieldOf<T extends ResourceRow>(
  descriptor: ResourceDescriptor<T>
): string {
  return descriptor.idField ?? 'id';
}

/**
 * One row's id, as a string. Empty when the row carries none.
 *
 * `identify` wins where a descriptor states one, because a resource with a
 * natural key has no single property that addresses it.
 */
export function idOf<T extends ResourceRow>(
  descriptor: ResourceDescriptor<T>,
  row: T
): string {
  if (descriptor.identify !== undefined) {
    return descriptor.identify(row);
  }
  const value = row[idFieldOf(descriptor)];
  return typeof value === 'string' ? value : '';
}

/**
 * The separator between the parts of a natural key.
 *
 * A tilde, because it is unreserved in a URL and therefore survives a path
 * segment untouched, and because no uuid contains one, so taking a key apart
 * again cannot go wrong.
 */
const KEY_SEPARATOR = '~';

/**
 * Several properties of a row as the one string that addresses it.
 *
 * Two of the catalog's resources have no id the gateway will answer to: a price
 * is written with a `PUT` naming `(itemId, priceScopeId)` and an aisle position
 * with one naming `(itemId, supermarketLocationId)`. This is what their rows are
 * addressed by, in a URL and in a list.
 */
export function naturalKey(
  row: ResourceRow,
  fields: readonly string[]
): string {
  return fields.map((field) => String(row[field] ?? '')).join(KEY_SEPARATOR);
}

/** A natural key, back as the filters that find the row it names. */
export function fromNaturalKey(
  id: string,
  fields: readonly string[]
): Readonly<Record<string, string>> {
  const parts = id.split(KEY_SEPARATOR);
  return Object.fromEntries(
    fields.map((field, index) => [field, parts[index] ?? ''])
  );
}

/** The field with this name, or `undefined`. */
export function fieldOf<T extends ResourceRow>(
  descriptor: ResourceDescriptor<T>,
  name: string
): FieldDescriptor<T> | undefined {
  return descriptor.fields.find((field) => field.name === name);
}
