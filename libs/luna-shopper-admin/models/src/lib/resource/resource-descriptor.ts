import type { Type } from '@angular/core';
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

/** A filter the list offers, and the query parameter it sets. */
export type FilterDescriptor =
  | {
      readonly kind: 'search';
      readonly param: string;
      readonly label: string;
    }
  | {
      readonly kind: 'enum';
      readonly param: string;
      readonly label: string;
      readonly options: readonly EnumOption[];
    }
  | {
      readonly kind: 'boolean';
      readonly param: string;
      readonly label: string;
    }
  /**
   * A day, sent as an ISO 8601 instant.
   *
   * The gateway's bounds are timestamps and the control is a date, so the
   * conversion happens once in the filter rather than in each descriptor that
   * wants to ask "created between". `edge` says which end of the day to send:
   * a lower bound starts at midnight and an upper bound ends at the next one.
   */
  | {
      readonly kind: 'date';
      readonly param: string;
      readonly label: string;
      readonly edge: 'start' | 'end';
    }
  /**
   * Another resource, chosen by name (plan 0004, section 6).
   *
   * The same control the form uses for a reference field, for the same reason:
   * "zones belonging to this person" is a question an operator asks by name,
   * and a filter that demanded a pasted uuid would be a filter nobody uses.
   */
  | {
      readonly kind: 'reference';
      readonly param: string;
      readonly label: string;
      /** The `name` of the resource being pointed at. */
      readonly resource: string;
    };

/**
 * Something this resource can do that create, edit and delete do not cover.
 *
 * Aborting a harvest run and rejecting a discovered place are the shapes this
 * exists for. It is here rather than in `0006` so that those screens are a
 * descriptor rather than a component.
 */
/**
 * What to ask before a named action runs.
 *
 * Three keys rather than a boolean, because a generic question is the wrong
 * question. Every action in `0007` is destructive or hard to reverse and
 * several are irreversible, and the confirmation has to name the specific thing
 * being acted on and say what goes with it: deleting an account says whose, and
 * says that the zones they own go too.
 *
 * The body is translated with the row's title as `name`, so one key per action
 * says the whole sentence.
 */
export interface ActionConfirmation {
  readonly heading: string;
  readonly body: string;
  /** What the button that goes through with it says. */
  readonly confirm: string;
}

export interface NamedAction<T extends ResourceRow = ResourceRow> {
  readonly name: string;
  /** A translation key. */
  readonly label: string;
  /** What to ask first. Absent means the action runs on the first click. */
  readonly confirm?: ActionConfirmation;
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
  run(row: T): Promise<void>;
}

/** What an operator may do to this resource. */
export interface ResourceActions<T extends ResourceRow = ResourceRow> {
  readonly create?: boolean;
  readonly edit?: boolean;
  readonly delete?: boolean;
  /**
   * The resource's named actions, built in an injection context.
   *
   * A factory rather than an array, for the same reason {@link
   * ResourceDescriptor.gateway} is one: an action calls a service, the
   * descriptor is a constant declared at module scope, and `inject` only works
   * where Angular is running. Everything about an action except what it *does*
   * is still static, so a screen can list them without running anything.
   */
  named?(): readonly NamedAction<T>[];
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
   * What to call one row, in a heading, a picker and a confirmation.
   *
   * A function rather than a field name, because a name is usually localized
   * text and choosing which locale to show is a decision the descriptor makes
   * once instead of every screen making it again.
   */
  title(row: T): string;
  readonly fields: readonly FieldDescriptor<T>[];
  readonly list: ListPresentation<T>;
  /**
   * A translation key for a sentence above the list.
   *
   * For a screen whose shape needs explaining rather than a screen that is
   * short of a feature. The admin table is the case it exists for: an operator
   * looking for the button that adds one finds a sentence naming the server
   * command instead of an empty toolbar (plan 0007, section 2).
   */
  readonly note?: string;
  readonly filters?: readonly FilterDescriptor[];
  /** The orders the backend accepts, sent as `order`. Absent means none. */
  readonly sorts?: readonly EnumOption[];
  readonly actions?: ResourceActions<T>;
  /**
   * The component that draws one row, when the generic form cannot.
   *
   * The generic form is the detail view for anything whose rows are flat, which
   * is every catalog resource: it draws the fields it cannot change beside the
   * ones it can. It is not the detail view for a zone, whose interesting
   * content is its membership and its lists, or for a list, whose content is
   * its lines. Those get a component, named here, and the route factory mounts
   * it at `:id` instead.
   *
   * Absent, with no edit either, means the resource has no detail screen at all
   * and its rows do not open. That is the admin table (plan 0007, section 2).
   */
  readonly detail?: Type<unknown>;
  /** Called in an injection context, so the gateway can inject what it needs. */
  gateway(): ResourceGateway<T>;
}

/**
 * Whether one row of this resource can be opened.
 *
 * The route factory and the list read the same answer, so a row that opens
 * always has somewhere to go and a row with nowhere to go is not a button.
 */
export function hasDetailScreen<T extends ResourceRow>(
  descriptor: ResourceDescriptor<T>
): boolean {
  return descriptor.detail !== undefined || descriptor.actions?.edit === true;
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

/** One row's id, as a string. Empty when the row carries none. */
export function idOf<T extends ResourceRow>(
  descriptor: ResourceDescriptor<T>,
  row: T
): string {
  const value = row[idFieldOf(descriptor)];
  return typeof value === 'string' ? value : '';
}

/** The field with this name, or `undefined`. */
export function fieldOf<T extends ResourceRow>(
  descriptor: ResourceDescriptor<T>,
  name: string
): FieldDescriptor<T> | undefined {
  return descriptor.fields.find((field) => field.name === name);
}
