/**
 * How a reference field finds the thing it points at (plan 0004, section 6).
 *
 * Many fields are a uuid pointing at another resource: `supermarketId`,
 * `priceScopeId`, `productGroupId`, `itemId`. A raw uuid input is unusable, so
 * the control searches the target resource and shows its rows by name.
 *
 * An interface rather than a service, because the thing that can answer it knows
 * about every descriptor in the app, and the control that needs it lives in a
 * library that must not. The app composes one and hands it down.
 */

import type {
  ReferenceScope,
  ResourceRow,
} from '@portfolio/luna-shopper-admin/models';

/**
 * Declared in `models` since admin plan 0028, because a field descriptor names
 * it, and exported from here as well for everything that already imports it
 * beside the lookup.
 */
export type { ReferenceScope };

/** One row of the resource being pointed at, as the picker shows it. */
export interface ReferenceOption {
  readonly id: string;
  readonly title: string;
  /**
   * The row itself, when the lookup read one.
   *
   * A `references` field asks its descriptor whether a target is locked, and
   * that is a question about the target's own columns (admin plan 0028,
   * section 4.1). Optional, because a search result is only ever drawn by name.
   */
  readonly row?: ResourceRow;
}

export interface ReferenceLookup {
  /**
   * Rows of `resource` matching what the operator typed, within `scope`.
   *
   * An empty term is a request for the first page rather than for nothing: a
   * picker that shows an empty list until something is typed hides the answer
   * from an operator who does not know what the options are called.
   *
   * `scope` sits **beside** the term rather than replacing it. The two answer
   * different questions: the scope says which collection is being read at all,
   * and the term narrows it.
   *
   * **A term that is a record ID is not a search** (admin plan 0051). It asks
   * for the one row of `resource` with that ID, within `scope`, and the answer
   * holds that row or nothing. Whether a term is one is a question about the
   * resource too: see {@link recordIdFor}.
   */
  search(
    resource: string,
    term: string,
    scope?: ReferenceScope
  ): Promise<readonly ReferenceOption[]>;

  /**
   * The row an id names, for a field that arrived already filled in.
   *
   * `null` when there is no such row. That is a real state rather than an
   * error: a reference can outlive what it points at, and the picker says so
   * instead of drawing a blank box.
   */
  resolve(resource: string, id: string): Promise<ReferenceOption | null>;

  /**
   * The translation key of what one row of `resource` is called ("product"),
   * or `null`.
   *
   * For the one sentence that names the table: "No product has this ID."
   * Optional, because a lookup that cannot say gets a sentence without the
   * noun, which is still true.
   */
  nounOf?(resource: string): string | null;

  /**
   * The ID a term is **on `resource`**, or `null` when {@link search} reads
   * the term as text there.
   *
   * The picker asks this to know which question it asked. A resource with no
   * read by ID (the price scopes) searches a pasted uuid as words, and so
   * does a resource the lookup does not know, so the picker must not choose
   * a row for it and must not say "No price scope has this ID.".
   *
   * Optional. A lookup without it reads every term shaped like an ID as one,
   * which is `recordIdIn` of the models library.
   */
  recordIdFor?(resource: string, term: string): string | null;
}
