import { Logger } from '@nestjs/common';

/**
 * What an adapter library answers for the photo of one product (plan 0198,
 * section 2). Each of the five libraries exports this shape from its own
 * `photoAddressRead`, and they share no code, so it is stated here once for
 * the runners.
 */
export interface PhotoRead {
  /** The one address the chain prints, on its own host, or null. */
  url: string | null;
  /** What the source printed when an address was printed and refused. */
  refused: string | null;
}

/** How many refusals are logged one by one before only every hundredth is. */
const LOGGED_ONE_BY_ONE = 10;

const logger = new Logger('PhotoAddress');
let refusals = 0;

/**
 * The photo address of a product, as an observation states it.
 *
 * **An address outside the chain's own host list is dropped with a warning.**
 * The list is a constant of the adapter library. This is what stops a changed
 * page from making a shopper's browser load an arbitrary host. The warning
 * names the product, so a person can see that a chain moved its photos.
 *
 * A chain that moves its photos to a new host makes one refusal for each
 * product of a walk, so after the first few only every hundredth is logged.
 *
 * Nothing here opens the address. It is a string.
 */
export function photoOf(read: PhotoRead, externalId: string): string | null {
  if (read.refused !== null) {
    refusals += 1;
    if (refusals <= LOGGED_ONE_BY_ONE || refusals % 100 === 0) {
      logger.warn(
        `Product ${externalId}: the photo address ` +
          `"${read.refused.slice(0, 200)}" is not an https address on a host ` +
          'of its chain, so it was dropped and the row states no photo ' +
          `(${refusals} dropped since this process started).`
      );
    }
  }
  return read.url;
}
