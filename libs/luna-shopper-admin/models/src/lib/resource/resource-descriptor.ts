import type { Signal, Type } from '@angular/core';
import type { InfoContent } from './info-content';
import type { RecordBlock } from './record-block';
import type {
  EnumOption,
  FieldDescriptor,
  FieldMessage,
  FieldName,
  FilterValue,
  ResourceRow,
} from './resource-field';
import type { ResourceRowView } from './resource-view';

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
  /**
   * Filter values by query parameter name, empty ones already dropped. A list
   * is sent as one parameter per entry.
   */
  readonly filters?: Readonly<Record<string, FilterValue>>;
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
  /**
   * One row, by its address.
   *
   * `shown` is what the list around the read is narrowed by, and it is passed
   * only when a list reads a row in place of a page (admin plan 0051). It
   * narrows nothing. It is for a gateway whose list adds columns from a
   * filter: the product list shows the price at a chosen scope, and a product
   * found by its ID has to carry that price too.
   */
  read(id: string, shown?: ResourceQuery['filters']): Promise<T>;
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
  /**
   * What one row says when the list is a narrow column beside the open row
   * (admin plan 0042). Absent means the row's title alone.
   */
  readonly brief?: BriefPresentation<T>;
}

/**
 * One row of a list drawn as a column: a heading, one line under it, and a
 * number at the end.
 *
 * A chain's shops are 340 px wide beside the shop that is open, which is no
 * room for a table and too many rows for cards with a label on every value.
 * So the descriptor names the few values that tell one row from the next.
 */
export interface BriefPresentation<T extends ResourceRow = ResourceRow> {
  /**
   * The first line, when it is not the row's title. A shop's title carries its
   * city for a picker, and the column writes the city on the second line.
   *
   * A method for the reason {@link ResourceDescriptor.rowId} is one.
   */
  heading?(row: T, locales: readonly string[]): string;
  /** The fields of the second line, in order, drawn without their labels. */
  readonly line?: readonly FieldName<T>[];
  /**
   * The second line as one sentence, in place of {@link line} (admin plan
   * 0045).
   *
   * For a row whose values need words around them: "Owner marta. Members 4,
   * lists 3" says who and how many, and "marta 4 3" says nothing. A message
   * and not a string, because a pure function cannot translate.
   */
  sentence?(row: T): FieldMessage;
  /** A count at the end of the row, such as the shops a chain holds. */
  readonly trailing?: FieldName<T>;
}

/** A short state of one row, drawn as a label beside its name. */
export interface RowState {
  /** A translation key. */
  readonly label: string;
  /**
   * What to put into the label, for a state that carries a number (admin plan
   * 0045): "2 requests" on a zone.
   */
  readonly args?: Readonly<Record<string, string | number>>;
  /**
   * `good` is the accent wash, `waiting` is the amber one that means a person
   * must decide, and `neutral` is grey.
   */
  readonly tone: 'good' | 'neutral' | 'waiting';
}

/**
 * The row above this resource, when it lives under one (admin plan 0042).
 *
 * A chain's shops are read at `/supermarkets/{id}/locations`, so the list
 * cannot be read without a chain. That chain used to be a filter the operator
 * had to pick before the list said anything. It is the address now: the screen
 * sits at `/chains/{chainId}/shops`, and the list reads the chain from there.
 */
export interface ResourceParent {
  /** The `name` of the resource the parent row belongs to. */
  readonly resource: string;
  /** The route parameter that holds the parent row's id. */
  readonly param: string;
  /**
   * The filter or path parameter the id feeds on a list, and the field it
   * fills on a new row.
   */
  readonly filter: string;
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
      /**
       * Whether the column may point at nothing (plan 0012, section 2).
       *
       * When it may, the picker offers "none" beside the rows it finds, and
       * choosing it sends {@link REFERENCE_NONE} on this same parameter: the
       * products in no group, the zones nobody owns. Declared per filter rather
       * than assumed, because offering it on a column that is never null would
       * be a choice whose only answer is an empty list, and because the gateway
       * route has to accept the literal before the screen may send it.
       */
      readonly nullable?: boolean;
      /**
       * Whether the list starts with "Any", the choice that clears the filter
       * (admin plan 0050, section 2).
       *
       * True when left out. It is not {@link nullable}: "Any" takes the filter
       * away and every row comes back, and "none" keeps the filter and asks
       * for the rows that point at nothing. `false` is for a filter a screen
       * cannot be read without.
       */
      readonly emptyOption?: boolean;
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
  /**
   * Whether the action destroys (admin plan 0052, section 2.2). It is then
   * drawn last, under a line, in red.
   */
  readonly danger?: true;
  /**
   * What the page does when the action went through. `'reload'` reads the
   * record again and is the default. `'leave'` goes to the list, for an action
   * after which the record is gone.
   */
  readonly after?: 'reload' | 'leave';
  run(row: T): Promise<void>;
}

/**
 * Something done to several ticked rows at once (admin plan 0035, section 2).
 *
 * **A panel, not a function**, because a bulk write here always has a review
 * step before it: the list draws a tick box per row, and the action's button
 * opens its panel with the ticked rows. The panel asks what it needs, shows
 * what will change, and is the only thing that sends. A tick alone sends
 * nothing.
 *
 * The panel is created with the inputs {@link BulkPanelInputs} names.
 */
export interface BulkAction {
  readonly name: string;
  /** A translation key, for the button that opens the panel. */
  readonly label: string;
  readonly panel: Type<unknown>;
}

/** What the list hands a bulk action's panel. */
export interface BulkPanelInputs {
  /** The ticked rows, as the list drew them. */
  readonly rows: readonly ResourceRowView[];
  /**
   * Close the panel. `true` when something was written, and the list then
   * clears its ticks and reads the page again.
   */
  readonly finish: (changed: boolean) => void;
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
  /**
   * What can be done to several ticked rows at once. Absent means the list
   * draws no tick boxes.
   */
  readonly bulk?: readonly BulkAction[];
}

/**
 * A refusal that names a row, so the screen it refused can offer to open it.
 *
 * A handful of backend exceptions publish a fact in `details` because the
 * client's next act is impossible without it: a `brand_key_taken` names the
 * brand already holding the key, and a `brand_link_too_deep` names the brand
 * that breaks the one level rule. Without a link, the form says what is wrong
 * and leaves the operator to find the row it is talking about by hand.
 *
 * Declared per resource rather than known by the form, because which codes a
 * resource can be refused with, and what their details mean, is the resource's
 * own business. The form resolves this against the registry, so the link is
 * built where a resource is mounted rather than where it is declared.
 */
export interface ErrorLink {
  /**
   * The `details` key the refusal publishes the row's id under.
   *
   * Absent means the row the refused act was about. A category that still
   * holds products is refused with no details at all (admin plan 0036),
   * because the category is the one the operator asked to delete and the
   * screen already holds its id.
   */
  readonly detail?: string;
  /** The `name` of the resource the link opens. */
  readonly resource: string;
  /**
   * A filter of that resource's list to open instead of one of its rows.
   *
   * The id goes out as this query parameter, so the link opens the list
   * narrowed to it: a category in use links to its products, which are the
   * rows the operator has to move before the delete can succeed.
   */
  readonly filter?: string;
  /**
   * A translation key for the link's own words.
   *
   * Absent means `resource.error.openRow`, which says the least a link can say.
   * A resource that knows what it is pointing at should name its own key: "Open
   * that brand" reads as an offer, and the generic sentence reads as a hedge.
   */
  readonly label?: string;
}

/**
 * One of those links, resolved: where it goes, and what it says.
 *
 * Built by the page and handed to the form, because only the page can ask the
 * registry where a resource is mounted and the form must not.
 */
export interface ErrorLinkTarget {
  readonly commands: readonly string[];
  /** The list's filter, for a link that opens a narrowed list. */
  readonly queryParams?: Readonly<Record<string, string>>;
  readonly labelKey: string;
}

export interface ResourceDescriptor<T extends ResourceRow = ResourceRow> {
  /** The stable key a reference field points at, and the translation prefix. */
  readonly name: string;
  /** The route segment, under the app's root. */
  readonly segment: string;
  /**
   * Translation keys for one row and for many, and for the button that adds
   * one where "New" says too little ("Add a shop").
   */
  readonly labels: {
    readonly one: string;
    readonly many: string;
    readonly create?: string;
    /**
     * What one row is called in the middle of a sentence, where `one` is
     * written as a heading ("Brand"). "No brand has this ID." reads it through
     * {@link nounKeyOf}. Absent means `one` already reads that way.
     */
    readonly noun?: string;
  };
  /** The property holding the row's id. `id` unless stated. */
  readonly idField?: FieldName<T>;
  /**
   * `false` where the gateway has no route that reads one row by its ID.
   *
   * A typed ID is then left as text (admin plan 0051). Such a resource is
   * read by walking its collection, and the walk stops after a bound, so
   * "no row has this ID" would be a guess there and not an answer.
   */
  readonly readById?: false;
  /**
   * Whether a row read by its ID belongs to what a screen fixed, for the
   * parts of a scope that are no column of the row (admin plan 0051).
   *
   * A list is narrowed by its route, and a read by ID is narrowed by nothing.
   * `rowWithin` holds the row against every scope value that is a column. A
   * category has no `kind`: "root" and "leaf" are what the list route works
   * out from the parent, so only the resource can say whether a row it was
   * handed is one. Without this, a pasted ID chose a root in a picker of
   * leaves, and the save was refused.
   *
   * Absent means every part of every scope is a column. A row this answers
   * `false` for reads as not found.
   *
   * A method for the reason {@link rowId} is one.
   */
  within?(row: T, scope: Readonly<Record<string, FilterValue>>): boolean;
  /**
   * The address one row has, when no single property is one.
   *
   * A price is keyed on `(itemId, priceScopeId)` and a location item on
   * `(itemId, supermarketLocationId)`, and the gateway has no route that reads
   * either by its own uuid: the only way back to one row is to name the pair it
   * is keyed on. So the pair is what the URL carries and what the gateway is
   * asked for, and the row's own `id` stays what a delete quotes.
   *
   * A method rather than a property holding a function, for the reason
   * {@link NamedAction.available} is one: `keyof T` makes `T` contravariant, and
   * a descriptor for a concrete row has to stay assignable to a descriptor for
   * any row.
   */
  rowId?(row: T): string;
  /**
   * What to call one row, in a heading, a picker and a confirmation.
   *
   * A function rather than a field name, because a name is usually localized
   * text and choosing which locale to show is a decision the descriptor makes
   * once instead of every screen making it again.
   *
   * `locales` is the operator's reading order, chosen one first (admin plan
   * 0026, section 5). **Not an injected service**: descriptors are module level
   * constants built at import time, so there is no injector to read from, and
   * every caller (a confirmation, a form heading, a picker) already has the
   * order in hand. Most implementations return a plain field and ignore it.
   */
  title(row: T, locales: readonly string[]): string;
  readonly fields: readonly FieldDescriptor<T>[];
  readonly list: ListPresentation<T>;
  /**
   * What the info button on the list says (admin plan 0041, section 3).
   *
   * How to use the screen: what a row is, what the main action does, where the
   * result goes. It replaced a paragraph above the list, which an operator read
   * once and scrolled past every day after.
   */
  readonly info?: InfoContent;
  /**
   * A translation key for one line on the **form**, beside a warning mark.
   *
   * For an effect that is large or cannot be taken back, which is why it stays
   * on the screen and is not behind the info button: it must be seen before the
   * action. Every write to a zone, a membership, a list or a line is seen at
   * once by the people in the zone (plan 0009, section 7), and saving a price
   * rule works out every shown price again. The alternative was a confirmation
   * on every edit, which is a click people stop reading.
   */
  readonly caution?: string;
  /**
   * Sentences the list has to say **right now**, as translation keys.
   *
   * {@link info} is what a resource always says, so it is a constant. This is
   * what one says sometimes, so it is a signal and it is built in an injection
   * context the way {@link gateway} is: a resource that only has something to
   * say when a service answered a certain way has to read that service.
   *
   * Admin plan 0021 is what it exists for, and it needs two of them on one
   * screen. A cluster with `HARVEST_ENABLED` false queues postal codes that
   * nothing ever drains, and an operator watching a row sit at `QUEUED` for a
   * week deserves to be told why. A decoration that comes from a second service
   * can fail on its own, and a blank column with no sentence beside it reads as
   * "nobody is waiting" rather than "we could not find out".
   *
   * Empty is the ordinary case, and a resource that never has anything extra to
   * say declares none of this.
   */
  notices?(): Signal<readonly string[]>;
  /**
   * Refusals that name a row of another resource, by error code.
   *
   * The form draws the sentence for the code and a link to the row beside it
   * (see {@link ErrorLink}). A code that is not named here draws its sentence
   * alone, which is every code on every resource today but two.
   */
  readonly errorLinks?: Readonly<Record<string, ErrorLink>>;
  /**
   * Refusals that are about one field, by error code, and the field they are
   * drawn under.
   *
   * A code the server enforces on a value the form holds reads best beside
   * that value: a third level of the category tree is a fact about the parent
   * picked, so it is said under the parent rather than at the foot of the form
   * (admin plan 0036). A code named here is not also drawn as the banner.
   */
  readonly errorFields?: Readonly<Record<string, FieldName<T>>>;
  readonly filters?: readonly FilterDescriptor[];
  /**
   * The row this resource lives under, read from the address (admin plan
   * 0042). See {@link ResourceParent}.
   *
   * The list sends the parent's id on every read and offers no control for
   * it, a new row is created under it, and the registry builds the resource's
   * address below the parent row's own.
   */
  readonly parent?: ResourceParent;
  /**
   * The states of one row, built in an injection context.
   *
   * A factory for the reason {@link ResourceActions.named} is one: a state can
   * depend on something outside the row. Whether a price scope is its chain's
   * default is a fact about the chain. The function it answers runs while the
   * rows are drawn, so a signal read inside it keeps the states current.
   */
  rowStates?(): (row: T) => readonly RowState[];
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
  /**
   * The component that creates and changes one row, when the generic form
   * cannot.
   *
   * There is one of these, and the plan that asks for it says why: a price is
   * the screen where a well meaning generic form creates wrong data. A price
   * belongs to a **scope** and not to a shop, so the form has to name the scope,
   * state its kind and say how many shops share it, and none of that is a field
   * of the row being edited (plan 0005, section 2).
   *
   * It replaces the generic form at `new` and at `:id`, so create and edit stay
   * one act with one component. {@link detail} still wins at `:id` where a
   * resource named both, since a row that is read rather than changed is a
   * different screen from the one that changes it.
   */
  readonly editor?: Type<unknown>;
  /**
   * What the record page draws for one row, and in which order (admin plan
   * 0052, section 2.3).
   *
   * Absent means one section with every field in the order of {@link fields}.
   * `recordLayout` is the one reader of the block.
   */
  readonly record?: RecordBlock<T>;
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
  return (
    descriptor.detail !== undefined ||
    descriptor.editor !== undefined ||
    descriptor.actions?.edit === true
  );
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

/** The key of what one row is called inside a sentence. */
export function nounKeyOf(
  descriptor: Pick<AnyResourceDescriptor, 'labels'>
): string {
  return descriptor.labels.noun ?? descriptor.labels.one;
}

/** The property holding a row's id. */
export function idFieldOf<T extends ResourceRow>(
  descriptor: ResourceDescriptor<T>
): string {
  return descriptor.idField ?? 'id';
}

/**
 * One row's address, as a string. Empty when the row carries none.
 *
 * {@link ResourceDescriptor.rowId} first, because a resource that states one has
 * no single property holding its identity, and reading `id` there would give the
 * URL a value no route can look up again.
 */
export function idOf<T extends ResourceRow>(
  descriptor: ResourceDescriptor<T>,
  row: T
): string {
  if (descriptor.rowId !== undefined) {
    return descriptor.rowId(row);
  }
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
