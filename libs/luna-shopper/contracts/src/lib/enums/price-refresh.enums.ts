/**
 * A shopper refreshes the price of one product (harvester plan 0216). Enums
 * per the project rule: their string values are the wire format and must stay
 * stable.
 */

/**
 * What a refresh found (section 4), and `FRESH` for a request that started
 * nothing.
 *
 * **It names what the fetch found, not what the shopper sees.** `DONE` means
 * the source answered a price and the write went through. The price a shopper
 * sees is still decided on read (plan 0080), so a refresh under a protected
 * `ADMIN` row changes nothing that the shopper sees, and that is correct.
 */
export enum PriceRefreshStatus {
  /**
   * The price at the fetch scope was read less than the product window ago, so
   * nothing was claimed and nothing was fetched. A status of the view only,
   * never of a stored row.
   */
  FRESH = 'FRESH',
  /** The fetch runs in the background. The client polls the status route. */
  PENDING = 'PENDING',
  /** The source answered a price, and the ingest write went through. */
  DONE = 'DONE',
  /**
   * The source does not stock the product at the fetch scope (a 404). Nothing
   * is written, availability included: the next walk decides that.
   */
  NOT_STOCKED = 'NOT_STOCKED',
  /** The fetch did not finish, timed out, or answered something unreadable. */
  FAILED = 'FAILED',
  /** The chain refused the request (a 403). Refreshes of it wait a while. */
  BLOCKED = 'BLOCKED',
}

/**
 * Why a product at a scope cannot be refreshed (section 7.1, steps 1 to 6).
 *
 * The client reads this and decides the words. Steps 1 to 5 travel as
 * `details.reason` of a 409 `price_not_refreshable`. `FRESH` is never a
 * refusal of a request, which answers 201 with a `FRESH` view; it is the reason
 * a status read gives for "nothing to do yet".
 */
export enum PriceRefreshRefusal {
  /** `HARVEST_ENABLED` or `HARVEST_REFRESH_ENABLED` is false on this cluster. */
  REFRESH_OFF = 'REFRESH_OFF',
  /** The harvester never priced this product at this scope. */
  NOT_HARVESTED = 'NOT_HARVESTED',
  /**
   * More than one active row of the chain is bound to the product at this
   * scope, so a walk settles between them and one fetch cannot.
   */
  AMBIGUOUS = 'AMBIGUOUS',
  /** The chain has no source row, or its row is switched off. */
  SOURCE_OFF = 'SOURCE_OFF',
  /** The chain's adapter cannot fetch one product alone. */
  NO_SINGLE_FETCH = 'NO_SINGLE_FETCH',
  /** The chain's newest finished walk was stopped because it kept refusing. */
  CHAIN_REFUSING = 'CHAIN_REFUSING',
  /** The price was read within the product window. */
  FRESH = 'FRESH',
}
