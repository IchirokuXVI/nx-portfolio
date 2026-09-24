import { Injectable, Logger } from '@nestjs/common';
import {
  ITEM_PATTERNS,
  SUPERMARKET_LOCATION_PATTERNS,
  type CatalogScopeView,
  type GetItemsRequest,
  type GetItemsResult,
  type ItemOfferView,
  type SettlePick,
  type SettlementPaid,
  type ShopAvailabilityRequest,
  type ShopAvailabilityView,
} from '@portfolio/luna-shopper/contracts';
import { ValidationException } from '@portfolio/luna-shopper/platform';
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

/**
 * How far one lookup got, read by the timeout (plan 0151, section 4).
 *
 * A mutable object rather than a value the lookup returns, because the
 * timeout answers while the lookup is still running and has to know whether
 * step 2 already passed.
 */
interface LookupProgress {
  scopeResolved: boolean;
}

/**
 * The product a settle's price is read for (plan 0151, sections 1 and 2).
 *
 * What the caller named, when it named one. Otherwise core's answer in `pick`,
 * which is the product core will record, so the price and the settlement name
 * the same thing. The gateway never works that answer out itself: core owns
 * the rule.
 *
 * **Several products and none named is refused**, and only when the caller
 * also named a scope, which is the one case a pick is asked for. A price
 * cannot be read for a product nobody named, and a settlement with a scope and
 * no product says less than the caller knows. It is a `validation_failed` on
 * `itemId` and not a code of its own: the caller fixes it by sending the field.
 */
export function pricedItemId(
  named: string | undefined,
  pick: SettlePick | undefined
): string | undefined {
  if (named !== undefined) {
    return named;
  }
  if (pick === undefined) {
    return undefined;
  }
  if (pick.optionCount > 1) {
    throw new ValidationException(
      'itemId is required to settle with a priceScopeId when there are several products to choose from',
      { messageArgs: { field: 'itemId' } }
    );
  }
  return pick.pickedItemId ?? undefined;
}

/** What the gateway needs in order to price one settle. */
export interface SettlePriceInput {
  /** Whose scopes. The basket's owner, or the caller on the list page. */
  userId: string;
  /** The profile the basket is priced with. Undefined on the list page. */
  profileId: string | undefined;
  itemId: string | undefined;
  priceScopeId: string | undefined;
  /**
   * The settle's shop: the basket's own when it has one, else the one the
   * client named (plan 0163, section 5). Its scope stack is added to the
   * owner's scopes, so a shop outside the owner's profile is priced too.
   */
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
    const progress: LookupProgress = { scopeResolved: false };
    try {
      return await timer.race(
        this.lookup(input, priceScopeId, progress),
        () => {
          this.log.debug(
            `Settle price lookup gave up after ${SETTLE_PRICE_BUDGET_MS}ms`
          );
          // The scope alone, and only once step 2 has said it is one of the
          // owner's (plan 0151, section 4; plan 0143 section 4.2 step 5). A
          // slow catalog then costs the amount and not the place. Before
          // that, the scope is only what the client said, and a scope nobody
          // checked is not written into a household's history. The lookup
          // that lost the race is left to finish and its result is dropped.
          return progress.scopeResolved
            ? {
                priceScopeId,
                supermarketLocationId: null,
                supermarketId: null,
                pricePaidCents: null,
                pricePaidCurrency: null,
              }
            : null;
        }
      );
    } finally {
      timer.stop();
    }
  }

  /** Steps 2 to 4, which share the one budget above. */
  private async lookup(
    input: SettlePriceInput,
    priceScopeId: string,
    progress: LookupProgress
  ): Promise<SettlementPaid | null> {
    // Step 2. The cached pair of round trips the basket read already made a
    // moment ago, and beside it the settle's shop with its scope stack (plan
    // 0163, section 5): the resolution is the owner's scopes **plus** that
    // stack, so a shop outside the owner's profile is priced like one inside
    // it. A scope outside both is refused by answering null rather than by an
    // error.
    //
    // The shop is asked first and awaited second, so the two round trips
    // overlap, and a scope the owner's resolution names counts as resolved the
    // moment that answer lands, as it did before there was a shop to wait for.
    const shopping = this.shopOf(input);
    const resolved = await this.resolvedScopes(input);
    if (resolved.priceScopeIds.includes(priceScopeId)) {
      progress.scopeResolved = true;
    }
    const shop = await shopping;
    const stack = shop?.location.priceScopeIds ?? [];
    if (!progress.scopeResolved && !stack.includes(priceScopeId)) {
      return null;
    }
    progress.scopeResolved = true;

    // Step 3. The shop was read beside the resolution, so only the price is
    // left, and step 4 is a question about what is already in hand.
    const offer = await this.offerOf(input.itemId, priceScopeId);
    const at = this.shopIn(shop, priceScopeId);

    const priced =
      offer && offer.price !== null && offer.currency !== null
        ? {
            // Catalog holds the price in currency units with two decimals
            // (`numeric(12,2)`), and this column is the minor unit.
            pricePaidCents: Math.round(offer.price * 100),
            pricePaidCurrency: offer.currency,
          }
        : { pricePaidCents: null, pricePaidCurrency: null };

    return {
      priceScopeId,
      supermarketLocationId: at?.location.id ?? null,
      supermarketId: at?.supermarket.id ?? null,
      ...priced,
    };
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
   * No `itemId` here is a free text line: the caller named none and core, asked
   * through {@link pricedItemId}, picked none either. Catalog is not asked, the
   * scope is kept, and the price is null: something was bought and the record
   * does not claim to know what it cost.
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
   * The settle's shop, with its scope stack and its chain, or null.
   *
   * A reader who is not served shops never records one, because what they may
   * not be told they may not write into a household's history either, so
   * catalog is not asked. Since plan 0163 that is nobody on a basket, and the
   * list page is always its own caller's.
   *
   * **It never throws.** A shop catalog cannot answer for is a shop the settle
   * does not record, and the settle still stands.
   */
  private async shopOf(
    input: SettlePriceInput
  ): Promise<ShopAvailabilityView | null> {
    if (!input.supermarketLocationId || !input.servedLocations) {
      return null;
    }
    const req: ShopAvailabilityRequest = {
      supermarketLocationId: input.supermarketLocationId,
    };
    try {
      return await this.nats.send<ShopAvailabilityView>(
        SUPERMARKET_LOCATION_PATTERNS.shopAvailability,
        req
      );
    } catch {
      return null;
    }
  }

  /**
   * The shop, confirmed to belong to the scope (step 4).
   *
   * The shop is kept when the scope is one of its stack, which is the whole of
   * what "this shop sells at this scope" means (plan 0105, section 3). A shop
   * outside the scope is a client that named two places, which is refused
   * quietly for the reason step 2 gives, and the price still stands. The chain
   * comes with it, because it is the shop's (plan 0163, section 5).
   */
  private shopIn(
    shop: ShopAvailabilityView | null,
    priceScopeId: string
  ): ShopAvailabilityView | null {
    return shop && shop.location.priceScopeIds.includes(priceScopeId)
      ? shop
      : null;
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
