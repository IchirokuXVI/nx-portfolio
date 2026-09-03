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

export interface ReferenceLookup {
  /**
   * Rows of `resource` matching what the operator typed.
   *
   * An empty term is a request for the first page rather than for nothing: a
   * picker that shows an empty list until something is typed hides the answer
   * from an operator who does not know what the options are called.
   */
  search(resource: string, term: string): Promise<readonly ReferenceOption[]>;

  /**
   * The row an id names, for a field that arrived already filled in.
   *
   * `null` when there is no such row. That is a real state rather than an
   * error: a reference can outlive what it points at, and the picker says so
   * instead of drawing a blank box.
   */
  resolve(resource: string, id: string): Promise<ReferenceOption | null>;
}
