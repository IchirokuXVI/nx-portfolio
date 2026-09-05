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

/** One row of the resource being pointed at, as the picker shows it. */
export interface ReferenceOption {
  readonly id: string;
  readonly title: string;
}

/**
 * Values the picker's own screen fixes, by query parameter name.
 *
 * Not everything a picker offers can be listed from nothing. A chain's shops
 * are read at `/supermarkets/{id}/locations`, so a picker over them answers an
 * empty page until the chain is named, and the chain is a fact about the screen
 * rather than something the operator types (admin plan 0011, section 4).
 */
export type ReferenceScope = Readonly<Record<string, string>>;

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
}
