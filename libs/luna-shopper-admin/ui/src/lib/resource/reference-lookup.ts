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
 * Filter values that narrow a search, by query parameter name.
 *
 * A shop cannot be searched for on its own: the route that lists shops is
 * addressed under a chain, so the picker has to say which chain before it can
 * ask anything at all. This is how the screen tells it.
 */
export type ReferenceContext = Readonly<Record<string, string>>;

export interface ReferenceLookup {
  /**
   * Rows of `resource` matching what the operator typed, within `context`.
   *
   * An empty term is a request for the first page rather than for nothing: a
   * picker that shows an empty list until something is typed hides the answer
   * from an operator who does not know what the options are called.
   *
   * A `context` that does not answer everything the target resource requires
   * gets an empty list rather than a failure. The screen has already disabled
   * the control and said what is missing, and a request that could only be a
   * 400 is not worth sending to find that out again.
   */
  search(
    resource: string,
    term: string,
    context?: ReferenceContext
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
