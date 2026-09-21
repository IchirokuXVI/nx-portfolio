import { Injectable, Logger } from '@nestjs/common';
import {
  ITEM_PATTERNS,
  SUPERMARKET_LOCATION_PATTERNS,
  type CatalogScopeView,
  type GetItemsRequest,
  type GetItemsResult,
  type ItemOfferView,
  type ListSupermarketLocationsRequest,
  type SettlementPaid,
  type SupermarketLocationPage,
} from '@portfolio/luna-shopper/contracts';
import { MAX_PAGE_SIZE } from '@portfolio/luna-shopper/platform';
import { ScopeResolutionService } from '../catalog/scope-resolution.service';
import { NatsClient } from '../messaging/nats-client';

/**
 * Everything this service is allowed to spend, in milliseconds (plan 0143,
 * section 4.5).
 *
 * It is one budget for the whole lookup rather than one per round trip, because
 * what must not happen is a settle held up, and a settle does not care which of
 * three calls was slow. Nest's NATS client has **no timeout of its own** and
 * waits for ever, so this is a `Promise.race` against a timer and not a client
 * option.
 */
export const SETTLE_PRICE_BUDGET_MS = 750;

/** Nothing resolved, so no scope the client can name is one of the owner's. */
const NO_SCOPES: CatalogScopeView = {
  priceScopeIds: [],
  scopes: [],
  coverage: [],
  approximate: false,
  profileId: null,
  explicit: false,
};

/** What the gateway needs in order to price one settle. */
export interface SettlePriceInput {
  /** Whose scopes. The basket's owner, or the caller on the list page. */
  userId: string;
  /** The profile the basket is priced with. Undefined on the list page. */
  profileId: string | undefined;
  itemId: string | undefined;
  priceScopeId: string | undefined;
  supermarketLocationId: string | undefined;
  /** Plan 0136's one condition for serving `locations` to this reader. */
  servedLocations: boolean;
}

/**
 * What a settle cost, read by the gateway and never sent by a client (plan
 * 0143, section 4.2).
 *
 * ## Why the gateway reads it
 *
 * The actor at the shelf can be a guest, and a guest writing money into a
 * household's history is exactly the write plan 0130 section 5 exists to
 * refuse. So the client names a **place** and this reads the **price**, as the
 * basket's owner and at the basket's scopes, which is how the basket screen was
 * already priced (plan 0066, sections 3 to 5). "The scope is the run's and never
 * the reader's."
 *
 * ## A price never fails a settle, and never delays one past its budget
 *
 * Every way of not knowing a price ends in nulls and a settlement that was
 * written. There is no branch here that throws, no branch that returns a
 * rejected promise, and no path that can outlast {@link
 * SETTLE_PRICE_BUDGET_MS}. A refusal is answered with **null** and never with
 * an error, for one reason worth stating: the profile can have changed between
 * the read that drew the screen and the tap, and the shopper can neither see
 * that nor fix it.
 *
 * Slowness is logged at `debug` and never at `warn`. A slow catalog is
 * catalog's alarm to raise, and a settle that quietly recorded no price is
 * working exactly as designed.
 */
@Injectable()
export class SettlePriceService {
  private readonly log = new Logger(SettlePriceService.name);

  constructor(
    private readonly nats: NatsClient,
    private readonly scopes: ScopeResolutionService
  ) {}

  /**
   * The four values a settle records, or null when it records nothing.
   *
   * Null is an ordinary settle. It is the answer for a client that showed no
   * price, for a scope the owner's profile does not resolve to, and for a
   * catalog that could not be reached before step 2 finished.
   */
  async read(input: SettlePriceInput): Promise<SettlementPaid | null> {
    const { priceScopeId } = input;
    // Nothing is recorded, and catalog is never asked. A client that drew no
    // price has nothing to tell us about where it came from.
    if (!priceScopeId) {
      return null;
    }

    const timer = new Budget(SETTLE_PRICE_BUDGET_MS);
    try {
      return await timer.race(this.lookup(input, priceScopeId), () => {
        this.log.debug(
          `Settle price lookup gave up after ${SETTLE_PRICE_BUDGET_MS}ms`
        );
        // The scope alone. It is what the client said and it needed no round
        // trip to believe, so a slow catalog costs the amount and not the
        // place. The lookup that lost the race is left to finish and its
        // result is dropped.
        return {
          priceScopeId,
          supermarketLocationId: null,
          pricePaidCents: null,
          pricePaidCurrency: null,
        };
      });
    } finally {
      timer.stop();
    }
  }

  /** Steps 2 to 4, which share the one budget above. */
  private async lookup(
    input: SettlePriceInput,
    priceScopeId: string
  ): Promise<SettlementPaid | null> {
    // Step 2. The cached pair of round trips the basket read already made a
    // moment ago. A scope outside the resolution is refused by answering null
    // rather than by an error.
    const resolved = await this.resolvedScopes(input);
    if (!resolved.priceScopeIds.includes(priceScopeId)) {
      return null;
    }

    // Steps 3 and 4 in parallel: neither needs the other, and a settle is made
    // standing in a shop.
    const [offer, shop] = await Promise.all([
      this.offerOf(input.itemId, priceScopeId),
      this.shopIn(
        input,
        priceScopeId,
        resolved.scopes.find((scope) => scope.priceScopeId === priceScopeId)
          ?.supermarketId
      ),
    ]);

    const priced =
      offer && offer.price !== null && offer.currency !== null
        ? {
            // Catalog holds the price in currency units with two decimals
            // (`numeric(12,2)`), and this column is the minor unit.
            pricePaidCents: Math.round(offer.price * 100),
            pricePaidCurrency: offer.currency,
          }
        : { pricePaidCents: null, pricePaidCurrency: null };

    return { priceScopeId, supermarketLocationId: shop, ...priced };
  }

  /**
   * The scopes this basket is priced at, as its **owner**.
   *
   * `describe` and not `forRead`, which is the same cached pair of round trips:
   * it is the call the basket read makes, so a settle a moment after a read
   * costs a Redis hit rather than two NATS calls.
   */
  private async resolvedScopes(
    input: SettlePriceInput
  ): Promise<CatalogScopeView> {
    try {
      return await this.scopes.describe(input.userId, {
        profileId: input.profileId,
      });
    } catch {
      // A profile emptied or deleted since, or a catalog that did not answer.
      // No scope resolves, so nothing is recorded.
      return NO_SCOPES;
    }
  }

  /**
   * One product's price at one scope (step 3).
   *
   * **A `stale` offer is recorded.** It is the number the screen showed, which
   * is the whole definition of the column: this records what was paid as far as
   * anybody knew at the shelf, not what the newest crawl says.
   *
   * No `itemId` is a free text line, or a shopper who did not say which product
   * they took. Catalog is not asked, the scope is kept, and the price is null:
   * something was bought and the record does not claim to know what it cost.
   */
  private async offerOf(
    itemId: string | undefined,
    priceScopeId: string
  ): Promise<ItemOfferView | null> {
    if (!itemId) {
      return null;
    }
    const req: GetItemsRequest = {
      ids: [itemId],
      priceScopeIds: [priceScopeId],
      // Every scope's offer rather than the cheapest of them (plan 0109): one
      // scope was asked for, so this is that scope's own price and not a price
      // some other warehouse happened to beat it with.
      offers: 'all',
    };
    try {
      const found = await this.nats.send<GetItemsResult>(
        ITEM_PATTERNS.getMany,
        req
      );
      const product = found.items.find((item) => item.id === itemId);
      return (
        product?.offers?.find((offer) => offer.priceScopeId === priceScopeId) ??
        null
      );
    } catch {
      return null;
    }
  }

  /**
   * The shop, confirmed to belong to the scope (step 4).
   *
   * Two things make it null, and neither is an error. A reader who is not
   * served shops never records one, because what they may not be told they may
   * not write into a household's history either; and a shop outside the scope
   * is a client that named two places, which is refused quietly for the reason
   * step 2 gives.
   *
   * It is the read `locationsOf` already makes, narrowed to the one scope, so
   * catalog answers from the same index the pick sheet used.
   */
  private async shopIn(
    input: SettlePriceInput,
    priceScopeId: string,
    supermarketId: string | undefined
  ): Promise<string | null> {
    const wanted = input.supermarketLocationId;
    // A scope the resolution named but could not place has no chain to list
    // the shops of, which is the same nothing every other branch answers.
    if (!wanted || !input.servedLocations || !supermarketId) {
      return null;
    }
    const req: ListSupermarketLocationsRequest = {
      userId: input.userId,
      supermarketId,
      priceScopeId,
      limit: MAX_PAGE_SIZE,
    };
    try {
      const page = await this.nats.send<SupermarketLocationPage>(
        SUPERMARKET_LOCATION_PATTERNS.list,
        req
      );
      return page.items.some((location) => location.id === wanted)
        ? wanted
        : null;
    } catch {
      return null;
    }
  }
}

/**
 * One deadline, shared by every call under it.
 *
 * A class rather than a bare `Promise.race`, so the timer is **cleared** on the
 * ordinary path. An uncleared `setTimeout` keeps the event loop alive, which
 * turns a fast settle into a process that will not exit and a test suite that
 * hangs after its last assertion.
 */
class Budget {
  private handle: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly ms: number) {}

  race<T>(work: Promise<T>, onTimeout: () => T): Promise<T> {
    return Promise.race([
      work,
      new Promise<T>((resolve) => {
        this.handle = setTimeout(() => resolve(onTimeout()), this.ms);
      }),
    ]);
  }

  stop(): void {
    if (this.handle !== undefined) {
      clearTimeout(this.handle);
      this.handle = undefined;
    }
  }
}
