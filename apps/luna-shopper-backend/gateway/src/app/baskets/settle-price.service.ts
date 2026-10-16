import { Injectable, Logger } from '@nestjs/common';
import {
  ITEM_PATTERNS,
  SUPERMARKET_LOCATION_PATTERNS,
  type BasketScopePrice,
  type CatalogScopeView,
  type GetItemsRequest,
  type GetItemsResult,
  type ItemSnapshot,
  type ItemView,
  type SettlePick,
  type SettlementPaid,
  type ShopAvailabilityRequest,
  type ShopAvailabilityView,
} from '@portfolio/luna-shopper/contracts';
import { ValidationException } from '@portfolio/luna-shopper/platform';
import { ScopeResolutionService } from '../catalog/scope-resolution.service';
import { NatsClient } from '../messaging/nats-client';
import { atShopOf, quotedScopeOf } from './basket-shop';

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

/** Nothing resolved, so the owner has no scope to find a cheapest price in. */
const NO_SCOPES: CatalogScopeView = {
  priceScopeIds: [],
  scopes: [],
  coverage: [],
  approximate: false,
  profileId: null,
  explicit: false,
};

/**
 * The product a settle is priced and named for (plan 0151; plan 0202).
 *
 * What the caller named, when it named one. Otherwise core's answer in `pick`,
 * which is the product core will record, so the price, the name and the
 * settlement are about the same thing. The gateway never works that answer out
 * itself: core owns the rule.
 *
 * **Several products and none named is no product, and never a refusal.** The
 * settle then records none, so there is nothing to price. Until plan 0202 that
 * case was refused when the caller also named a scope, on the ground that a
 * scope says the caller saw a price for one product. No caller's scope is read
 * any more, so nothing says that. A basket never reaches the case at all since
 * plan 0201: its lines agree on one product or record none.
 */
export function pricedItemId(
  named: string | undefined,
  pick: SettlePick | undefined
): string | undefined {
  if (named !== undefined) {
    return named;
  }
  if (pick === undefined || pick.optionCount > 1) {
    return undefined;
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
  /**
   * The settle's shop: the basket's own when it has one, else the one the
   * client named (plan 0163, section 5). A shop outside the owner's profile is
   * priced like one inside it.
   */
  supermarketLocationId: string | undefined;
  /** Plan 0136's one condition for serving `locations` to this reader. */
  servedLocations: boolean;
}

/** What one settle records beyond what the client said (plan 0202). */
export interface SettleChoice {
  /** The price and where it was read, or null when nothing was chosen. */
  paid: SettlementPaid | null;
  /** What the product is called, or null when catalog did not say. */
  itemSnapshot: ItemSnapshot | null;
}

/** Nothing known, which is an ordinary settle. */
const NOTHING: SettleChoice = { paid: null, itemSnapshot: null };

/** What a change of product needs priced (plan 0202, section 3). */
export interface RewritePriceInput extends SettlePriceInput {
  itemId: string;
  /** The scopes the buys of the trip were priced at, as core answered them. */
  priceScopeIds: readonly string[];
  /** At least one of those buys recorded no scope. */
  unscoped: boolean;
}

/** What a change of product hands core beside the product. */
export interface RewriteChoice extends SettleChoice {
  /** What one unit of the product costs at each scope that prices it. */
  prices: BasketScopePrice[];
}

/** No buy to rewrite, or a catalog that did not answer. */
const NOTHING_TO_REWRITE: RewriteChoice = { ...NOTHING, prices: [] };

/**
 * What a settle cost and what its product was called, read by the gateway and
 * never sent by a client (plan 0143, section 4.2; plan 0202, sections 1 and 2).
 *
 * ## Why the gateway reads it
 *
 * The actor at the shelf can be a guest, and a guest writing money into a
 * household's history is exactly the write plan 0130 section 5 exists to
 * refuse. So the client names a **shop or none**, and this chooses the
 * **price**, as the basket's owner. "The scope is the run's and never the
 * reader's."
 *
 * ## The price it chooses (plan 0202, section 2)
 *
 * - **With a shop**: the price at the quoted scope of that shop, which is the
 *   price the basket shows there. The settle records that scope, the shop and
 *   its chain. A shop that has no price for the product records nothing, as
 *   before that plan: a shop is never stored without the scope a price was read
 *   at.
 * - **With no shop**: the cheapest offer across the owner's resolved scopes.
 *   The settle records that price and its scope, and **no shop and no chain**.
 *   The scope of the cheapest price is not where the person stood.
 *
 * Until plan 0202 the client sent the scope of the price it had drawn, and a
 * client that drew none recorded none. The scope a client sends is no longer
 * read.
 *
 * ## The name
 *
 * The same catalog read answers what the product is called. It is handed to
 * core beside the price, and it is there also when the product has no price
 * anywhere.
 *
 * ## It never fails a settle, and never delays one past its budget
 *
 * Every way of not knowing ends in nulls and a settlement that was written. No
 * read here throws or returns a rejected promise, and no path can outlast
 * {@link SETTLE_PRICE_BUDGET_MS}. The one refusal is {@link refuseUnknownItem},
 * which is about the product and not its price.
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
   * The price and the name one settle records.
   *
   * With no product there is nothing to price and nothing to name, so catalog
   * is not asked: that is a free text line, and a line with several products
   * of which the caller named none.
   */
  async choose(input: SettlePriceInput): Promise<SettleChoice> {
    const { itemId } = input;
    if (!itemId) {
      return NOTHING;
    }
    const timer = new Budget(SETTLE_PRICE_BUDGET_MS);
    try {
      return await timer.race(this.lookup({ ...input, itemId }), () => {
        this.log.debug(
          `Settle price lookup gave up after ${SETTLE_PRICE_BUDGET_MS}ms`
        );
        // The lookup that lost the race is left to finish and its result is
        // dropped. The buy is written with no price and no name.
        return NOTHING;
      });
    } finally {
      timer.stop();
    }
  }

  /**
   * What a change of product records on the buys it rewrites (plan 0202,
   * section 3).
   *
   * A rewritten buy keeps the place of the buy it replaces, so the product is
   * priced at each scope those buys recorded: one catalog read for all of
   * them. A buy that recorded no scope is priced as a settle is, by
   * {@link choose}'s own rule, at the basket's shop or at the cheapest.
   *
   * With no buy to rewrite catalog is not asked. One budget covers everything,
   * and a catalog that does not answer inside it rewrites the buys with no
   * price and no name: the product of a buy is still corrected.
   */
  async chooseForRewrite(input: RewritePriceInput): Promise<RewriteChoice> {
    const scopes = [...new Set(input.priceScopeIds)];
    if (scopes.length === 0 && !input.unscoped) {
      return NOTHING_TO_REWRITE;
    }
    const timer = new Budget(SETTLE_PRICE_BUDGET_MS);
    try {
      return await timer.race(this.lookupForRewrite(input, scopes), () => {
        this.log.debug(
          `Rewrite price lookup gave up after ${SETTLE_PRICE_BUDGET_MS}ms`
        );
        return NOTHING_TO_REWRITE;
      });
    } finally {
      timer.stop();
    }
  }

  /**
   * Refuse a settle whose `itemId` catalog does not know (plan 0201, section
   * 4, and point 3 of its review).
   *
   * The product of a settle can be one that is on none of its lines, so core
   * cannot check the id, and catalog is the one service that can. This is the
   * one method here that throws, and it throws for one answer alone:
   * **catalog answered, and the product is not in the answer.** That is a
   * `validation_failed` on `itemId`.
   *
   * A catalog that fails, or that does not answer inside {@link
   * SETTLE_PRICE_BUDGET_MS}, refuses nothing and the settle proceeds. Unknown
   * and slow must not look the same: somebody at a shelf with a slow catalog
   * still bought the thing.
   *
   * The change of product of plan 0202 asks the same question of its `itemId`,
   * with the same answer.
   *
   * No scopes are asked for, so catalog reads no price for it.
   */
  async refuseUnknownItem(itemId: string): Promise<void> {
    const timer = new Budget(SETTLE_PRICE_BUDGET_MS);
    let known: boolean | null;
    try {
      known = await timer.race(this.knows(itemId), () => {
        this.log.debug(
          `Settle product check gave up after ${SETTLE_PRICE_BUDGET_MS}ms`
        );
        return null;
      });
    } finally {
      timer.stop();
    }
    if (known === false) {
      throw new ValidationException('itemId names no product', {
        messageArgs: { field: 'itemId' },
      });
    }
  }

  /** Whether catalog names this product, or null when it could not say. */
  private async knows(itemId: string): Promise<boolean | null> {
    const req: GetItemsRequest = { ids: [itemId] };
    try {
      const found = await this.nats.send<GetItemsResult>(
        ITEM_PATTERNS.getMany,
        req
      );
      return found.items.some((item) => item.id === itemId);
    } catch {
      return null;
    }
  }

  /** {@link choose}'s lookup, under its budget. */
  private lookup(
    input: SettlePriceInput & { itemId: string }
  ): Promise<SettleChoice> {
    return input.supermarketLocationId
      ? this.lookupAtShop(input)
      : this.lookupCheapest(input);
  }

  /**
   * A buy at a shop: the price the basket shows there.
   *
   * The shop is read first, because its quoted scope is what the product is
   * priced at. {@link atShopOf} is the rule of the basket read, so the price a
   * settle records is the price the row drew.
   *
   * A shop catalog cannot name, a reader who is not served shops, and a shop
   * that has no price for the product all record **no price and no shop**.
   * The cheapest price of the owner's scopes is not used in its place: it is
   * not the price of that shop (plan 0201, decision 21, for the same reason).
   * The name of the product is still read.
   */
  private async lookupAtShop(
    input: SettlePriceInput & { itemId: string }
  ): Promise<SettleChoice> {
    const shop = await this.shopOf(input);
    const quoted = shop === null ? null : quotedScopeOf(shop);
    const product = await this.productAt(
      input.itemId,
      quoted === null ? [] : [quoted],
      'all'
    );
    if (!product) {
      return NOTHING;
    }
    const itemSnapshot = snapshotOf(product);
    const at = shop === null ? null : atShopOf(product, shop);
    if (
      shop === null ||
      at === null ||
      at.priceScopeId === null ||
      at.price === null ||
      at.currency === null
    ) {
      this.log.debug('Settle shop not recorded: no price for the product there');
      return { paid: null, itemSnapshot };
    }
    return {
      paid: {
        priceScopeId: at.priceScopeId,
        supermarketLocationId: shop.location.id,
        supermarketId: shop.supermarket.id,
        // Catalog holds the price in currency units with two decimals
        // (`numeric(12,2)`), and this column is the minor unit.
        pricePaidCents: Math.round(at.price * 100),
        pricePaidCurrency: at.currency,
      },
      itemSnapshot,
    };
  }

  /**
   * A buy with no shop: the cheapest offer across the owner's scopes (plan
   * 0202, section 2).
   *
   * `offers: 'best'` is catalog's own answer to "the cheapest across these
   * scopes", so no price is compared here. **A `stale` offer is recorded**: it
   * is the number the screen showed, and the column records what was paid as
   * far as anybody knew at the shelf.
   *
   * The shop and the chain are null. A buy with no shop names no place, so it
   * counts for no chain in "usual" (plan 0165).
   */
  private async lookupCheapest(
    input: SettlePriceInput & { itemId: string }
  ): Promise<SettleChoice> {
    const resolved = await this.resolvedScopes(input);
    const product = await this.productAt(
      input.itemId,
      resolved.priceScopeIds,
      'best'
    );
    if (!product) {
      return NOTHING;
    }
    const best = product.bestOffer ?? null;
    return {
      paid:
        best && best.price !== null && best.currency !== null
          ? {
              priceScopeId: best.priceScopeId,
              supermarketLocationId: null,
              supermarketId: null,
              pricePaidCents: Math.round(best.price * 100),
              pricePaidCurrency: best.currency,
            }
          : null,
      itemSnapshot: snapshotOf(product),
    };
  }

  /** {@link chooseForRewrite}'s lookup, under its budget. */
  private async lookupForRewrite(
    input: RewritePriceInput,
    scopes: readonly string[]
  ): Promise<RewriteChoice> {
    // Beside each other, because neither needs the other.
    const [product, unscoped] = await Promise.all([
      scopes.length > 0 ? this.productAt(input.itemId, scopes, 'all') : null,
      input.unscoped ? this.lookup(input) : null,
    ]);
    const asked = new Set(scopes);
    const prices: BasketScopePrice[] = [];
    for (const offer of product?.offers ?? []) {
      if (
        asked.has(offer.priceScopeId) &&
        offer.price !== null &&
        offer.currency !== null
      ) {
        prices.push({
          priceScopeId: offer.priceScopeId,
          pricePaidCents: Math.round(offer.price * 100),
          pricePaidCurrency: offer.currency,
        });
      }
    }
    return {
      prices,
      paid: unscoped?.paid ?? null,
      itemSnapshot: product
        ? snapshotOf(product)
        : (unscoped?.itemSnapshot ?? null),
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
      // No scope resolves, so no price is found and the name still is.
      return NO_SCOPES;
    }
  }

  /**
   * One product, priced at these scopes, or null when catalog does not answer
   * or does not know it.
   *
   * With no scope the product is read with no price: the read is then for its
   * name alone.
   */
  private async productAt(
    itemId: string,
    priceScopeIds: readonly string[],
    offers: 'best' | 'all'
  ): Promise<ItemView | null> {
    const req: GetItemsRequest = {
      ids: [itemId],
      ...(priceScopeIds.length > 0
        ? { priceScopeIds: [...priceScopeIds], offers }
        : {}),
    };
    try {
      const found = await this.nats.send<GetItemsResult>(
        ITEM_PATTERNS.getMany,
        req
      );
      return found.items.find((item) => item.id === itemId) ?? null;
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
}

/**
 * What a product is called, as a buy copies it (plan 0202, section 1).
 *
 * Five fields of the view, under the names the view uses, and the whole
 * localized name: a buy has no reader yet, and whoever reads the history later
 * chooses the locale. Nothing else of the product is copied.
 */
export function snapshotOf(product: ItemView): ItemSnapshot {
  return {
    name: { ...product.name },
    brand: product.brand ?? null,
    unitSize: product.unitSize ?? null,
    packCount: product.packCount ?? null,
    defaultUnit: product.defaultUnit,
  };
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
