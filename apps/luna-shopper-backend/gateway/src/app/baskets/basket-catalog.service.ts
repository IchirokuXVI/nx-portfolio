import { Injectable } from '@nestjs/common';
import {
  BASKET_PATTERNS,
  ITEM_LOOKUP_LIMITS,
  ITEM_PATTERNS,
  SECTION_PATTERNS,
  SUPERMARKET_LOCATION_PATTERNS,
  type BasketLinePick,
  type BasketPriceChoice,
  type BasketPriceChoicesView,
  type BasketPriceScopeView,
  type BasketResult,
  type BasketScopeLocationView,
  type BasketSearchScope,
  type BasketView,
  type CatalogScopeView,
  type CatalogSuggestResponse,
  type GetBasketPriceChoicesRequest,
  type GetBasketRequest,
  type GetItemsRequest,
  type GetItemsResult,
  type GetLiveBasketRequest,
  type ItemSectionsAtLocationRequest,
  type ItemSectionsAtLocationView,
  type ItemView,
  type ListSupermarketLocationsRequest,
  type ShopAvailabilityRequest,
  type ShopAvailabilityView,
  type SupermarketLocationPage,
} from '@portfolio/luna-shopper/contracts';
import {
  BasketShopLockedException,
  MAX_PAGE_SIZE,
} from '@portfolio/luna-shopper/platform';
import {
  CatalogSuggestService,
  productScopeIds,
  type SuggestInput,
} from '../catalog/catalog-suggest.service';
import {
  ScopeResolutionService,
  type ShopperSelection,
} from '../catalog/scope-resolution.service';
import { NatsClient } from '../messaging/nats-client';
import { picksOf } from './basket-picks';
import {
  atShopOf,
  quotedScopeOf,
  toBasketShopView,
  toScopeLocationView,
  withShopInScopes,
} from './basket-shop';

/** What the run's profile refuses: chains, and individual shops (plan 0064). */
interface ShopRefusalIds {
  supermarketIds: readonly string[];
  supermarketLocationIds: readonly string[];
}

const NO_REFUSALS: ShopRefusalIds = {
  supermarketIds: [],
  supermarketLocationIds: [],
};

/**
 * What the gateway priced before it read the rows (plan 0201, section 1).
 *
 * The picks go to core on the read. The rest goes to {@link
 * BasketCatalogService.compose}, so that the composition asks nothing a
 * second time: not the resolution of the owner's profile, and not a product
 * that was already read at the same scopes.
 */
export interface BasketReadPrices {
  /** The cheapest product of each line that has one priced product or more. */
  picks: BasketLinePick[];
  /** What the owner's profile resolved to, or undefined when it did not. */
  resolved: CatalogScopeView | undefined;
  /** The scopes {@link items} were priced at. */
  priceScopeIds: string[];
  /** Every product of the priced lines, with the offer of every scope. */
  items: ItemView[];
}

/**
 * The rows of a basket as core answered them, and what the gateway learned to
 * ask for them (plan 0205, section 3).
 *
 * The rows read answers `basket` and stops. The full read hands the other two
 * to {@link BasketCatalogService.compose}, so nothing is asked a second time.
 */
export interface BasketRowsRead {
  basket: BasketView;
  /**
   * What core answered `basket.searchScope` with: null when that failed, and
   * undefined when the read did not need to ask.
   */
  searchScope: BasketSearchScope | null | undefined;
  /** What was priced before the rows, or null when nothing was. */
  prices: BasketReadPrices | null;
}

/**
 * The catalog half of a basket, composed at the gateway (plan 0066).
 *
 * Core holds the basket and references products by an opaque `itemId`; catalog
 * holds the products; neither can answer a basket screen alone. This is the
 * composition, moved out of the participant controller by plan 0136 with nothing
 * about it changed except where it reads the rows from.
 *
 * ## Why the names travel with the basket
 *
 * Every catalog route needs an account token and the reader may be a guest who
 * has none. A row's product is a catalog product and never zone data (plan 0051,
 * section 6.1), so a guest is entitled to the names; carrying them here is how
 * they get them without a second public catalog surface, and it makes the whole
 * screen one request rather than one plus a fan out over every row.
 *
 * ## The gateway chooses the cheapest product
 *
 * A row is a product since plan 0201, and a line with several products and no
 * favourite counts as the cheapest of them. Core never sees a price, so the
 * read asks core which lines need one, prices them here ({@link pricesFor}),
 * and hands core an item id for each on the read of the rows.
 *
 * ## It fails empty, never loudly
 *
 * A catalog that is unreachable costs the captions and not the screen: the rows,
 * their quantities and what is left are the basket, and a shopper standing in an
 * aisle is better served by a list with unnamed picks than by an error page.
 * Failing to price is not failing to read either: no scopes means no prices, and
 * nothing on this path may turn a missing price into a failed screen.
 */
@Injectable()
export class BasketCatalogService {
  constructor(
    private readonly nats: NatsClient,
    // The run's profile turned into scope ids, through the same resolver and the
    // same Redis cache an account holder's own search uses.
    private readonly scopes: ScopeResolutionService,
    // Plan 0161: the dropdown, and the one helper that names a scope's chain
    // for this read and for the dropdown alike.
    private readonly suggestions: CatalogSuggestService
  ) {}

  /** The composer's dropdown, priced at the basket's own scopes. */
  suggest(input: SuggestInput): Promise<CatalogSuggestResponse> {
    return this.suggestions.suggest(input);
  }

  /**
   * Core's basket, with the catalog half added: the products, the scopes that
   * price them, and what the read's shop says (plan 0066; plan 0163).
   *
   * ## The shop of a read
   *
   * In order: the basket's own shop, else `locationId`, else none (plan 0163,
   * section 2). With none, the read is exactly the read before that plan. A
   * basket started at a shop refuses a different `locationId` with
   * `basket_shop_locked`, because answering at the basket's own shop is not
   * what the caller asked.
   *
   * With a shop, catalog is asked once for the shop's scope stack and for the
   * stored availability of the basket's products there. The shop's quoted
   * scope is added to the scopes the read prices at, so a shop outside the
   * owner's postal codes is priced correctly. Nothing about the owner's profile
   * is checked for that, as the user decided on 2026-09-24.
   */
  async compose(
    basket: BasketView,
    participantId: string,
    locationId: string | undefined,
    /**
     * What core answered `basket.searchScope` with, when the caller already
     * asked it (plan 0165): null when that failed, and absent to have it asked
     * here. The read at a shop asks it first, to learn the basket's own shop
     * before the rows, and a second ask would be the same round trip twice.
     */
    searchScope?: BasketSearchScope | null,
    /**
     * What {@link pricesFor} read before the rows (plan 0201), or null when it
     * priced nothing. Its resolution and its products are reused here.
     */
    prices?: BasketReadPrices | null
  ): Promise<BasketResult> {
    const own = basket.supermarketLocationId ?? null;
    if (own && locationId && locationId !== own) {
      throw new BasketShopLockedException(
        'This basket was started at another shop'
      );
    }
    const shopId = own ?? locationId ?? null;
    const itemIds = productIdsOf(basket);

    const [owner, shop, sections] = await Promise.all([
      searchScope === undefined
        ? this.ownerScopeOf(basket.id, participantId)
        : prices && searchScope
          ? // The pricing before the rows already resolved the profile.
            { scope: searchScope, view: prices.resolved }
          : this.ownerScopeFrom(searchScope),
      shopId ? this.shopAt(shopId, itemIds) : Promise.resolve(null),
      // Plan 0167: which of the shop's sections each product is in. Beside the
      // shop rather than after it, because neither needs the other.
      shopId ? this.sectionsAt(shopId, itemIds) : Promise.resolve(null),
    ]);
    const resolved = owner?.view;
    const priceScopeIds = scopesOfRead(
      resolved,
      shop ? quotedScopeOf(shop) : null
    );
    const products = await this.productsOf(basket, priceScopeIds, prices);

    // The profile's postal codes and refusals, read once for both halves that
    // need them: the refusals trim the shops a scope lists, and the codes say
    // whether the basket's own shop is in the profile (section 3).
    const profileId = owner?.scope.profileId ?? null;
    const selection =
      owner !== null &&
      profileId !== null &&
      (basket.servesLocations || (own !== null && shop !== null))
        ? await this.selectionOf(owner.scope.ownerUserId, profileId)
        : null;

    const described =
      owner && resolved
        ? await this.scopesOf(
            products,
            owner.scope.ownerUserId,
            resolved,
            basket.servesLocations,
            selection
          )
        : [];

    return {
      ...basket,
      products: products.map((product) => ({
        ...product,
        atShop: shop ? atShopOf(product, shop) : null,
        // Absent, never empty, when the rule could not be read: an empty list
        // is an answer ("no section holds it") and a failure is not one.
        ...(sections ? { sectionIds: sections.get(product.id) ?? [] } : {}),
      })),
      shop:
        own && shop
          ? toBasketShopView(shop, selection?.postalCodes ?? [])
          : null,
      scopes: shop
        ? withShopInScopes(described, shop, basket.servesLocations)
        : described,
    };
  }

  /**
   * The rows of a basket as one participant reads them, and what was learned
   * on the way (plan 0201, section 1; plan 0205, section 3).
   *
   * The first half of the full read, and the whole of the rows read. In order:
   * the shop of the read beside the lines that need a price, then the prices
   * of those lines, then core's read of the rows with a pick for each.
   *
   * A basket started at another shop refuses `locationId` with
   * `basket_shop_locked`, before anything is priced.
   */
  async rowsOf(
    basketId: string,
    participantId: string,
    locationId: string | undefined
  ): Promise<BasketRowsRead> {
    // Beside each other, because neither needs the other. A basket started at
    // another shop is refused by the first, before anything is priced.
    const [{ searchScope, supermarketId, shopId, shop }, choices] =
      await Promise.all([
        this.readShopOf(basketId, participantId, locationId),
        this.priceChoicesOf(basketId, participantId),
      ]);
    const prices = await this.pricesFor(
      choices?.lines ?? [],
      searchScope,
      shopId,
      shop
    );
    const req: GetBasketRequest = {
      basketId,
      participantId,
      ...(supermarketId ? { supermarketId } : {}),
      ...picksOn(prices),
    };
    const basket = await this.nats.send<BasketView>(BASKET_PATTERNS.get, req);
    // Asked of core's own view too, so the lock holds when the question about
    // the shop above failed. The composition asks it the same way, and the
    // rows read has no composition to ask it.
    const own = basket.supermarketLocationId ?? null;
    if (own && locationId && locationId !== own) {
      throw new BasketShopLockedException(
        'This basket was started at another shop'
      );
    }
    return { basket, searchScope, prices };
  }

  /**
   * The same for the permanent basket of an account, which core creates the
   * first time it is asked (plan 0136, section 4).
   *
   * `locationId` is the shop the device chose, which is the only way the shop
   * of a `LIVE` basket reaches the server (plan 0163; velista 0091, section
   * 7). The permanent basket never has one of its own, so it is never locked.
   */
  async liveRowsOf(
    userId: string,
    locationId: string | undefined
  ): Promise<BasketRowsRead> {
    // Beside each other, because neither needs the other. The shop gives its
    // chain, so each row says whether it is usually bought there (plan 0165).
    // The other question creates the basket and answers the lines whose
    // product only a price can choose (plan 0201, section 1).
    const [shop, choices] = await Promise.all([
      locationId ? this.shopAt(locationId, []) : null,
      this.livePriceChoicesOf(userId),
    ]);
    // Asked here only when a line needs a price, because the scopes that
    // count are the owner's. Otherwise the composition asks it, as it always
    // did, and the rows read does not ask it at all.
    const searchScope =
      choices && choices.lines.length > 0
        ? await this.searchScopeOf(choices.basketId, choices.participantId)
        : undefined;
    const prices =
      choices && searchScope !== undefined
        ? await this.pricesFor(choices.lines, searchScope, locationId, shop)
        : null;
    const supermarketId = shop?.supermarket.id;
    const req: GetLiveBasketRequest = {
      userId,
      ...(supermarketId ? { supermarketId } : {}),
      ...picksOn(prices),
    };
    const basket = await this.nats.send<BasketView>(BASKET_PATTERNS.live, req);
    return { basket, searchScope, prices };
  }

  /**
   * The read's shop and its chain, learned **before** core is asked for the
   * rows (plan 0165).
   *
   * Core counts where each line was bought at the read's chain, and core
   * cannot ask catalog which chain a shop belongs to, so the gateway says it on
   * the request. The shop is the basket's own if it has one, else `locationId`,
   * else none, which is the order {@link compose} reads it in. The basket's own
   * shop comes from `basket.searchScope`, the question the composition asks
   * anyway, so its answer is handed back for {@link compose} to reuse.
   *
   * A basket started at another shop refuses `locationId` here, before the
   * rows are read, with the same `basket_shop_locked` the composition answers.
   *
   * **It never throws otherwise.** A chain catalog cannot name costs the read
   * its `usual` half and nothing else: every row then carries null.
   *
   * The shop itself is handed back too (plan 0201). Its quoted scope is the
   * one scope whose prices count when the read chooses the cheapest product of
   * a line, and asking catalog for the shop again would be the same round trip
   * twice.
   */
  async readShopOf(
    basketId: string,
    participantId: string,
    locationId: string | undefined
  ): Promise<{
    searchScope: BasketSearchScope | null;
    supermarketId: string | undefined;
    /** The shop of the read, or undefined when it has none. */
    shopId: string | undefined;
    /** That shop as catalog named it, or null. */
    shop: ShopAvailabilityView | null;
  }> {
    const searchScope = await this.searchScopeOf(basketId, participantId);
    const own = searchScope?.supermarketLocationId ?? null;
    if (own && locationId && locationId !== own) {
      throw new BasketShopLockedException(
        'This basket was started at another shop'
      );
    }
    const shopId = own ?? locationId;
    // The shop alone, with no products, which is the smallest question
    // `shopAvailability` answers.
    const shop = shopId ? await this.shopAt(shopId, []) : null;
    return {
      searchScope,
      supermarketId: shop?.supermarket.id,
      shopId,
      shop,
    };
  }

  /**
   * The lines of a basket that need a price to know their product (plan 0201,
   * section 1), or null when core could not say.
   *
   * **It never throws.** Null costs the read its picks and nothing else: every
   * such line then counts as its first product.
   */
  async priceChoicesOf(
    basketId: string,
    participantId: string
  ): Promise<BasketPriceChoicesView | null> {
    const req: GetBasketPriceChoicesRequest = { basketId, participantId };
    try {
      return await this.nats.send<BasketPriceChoicesView>(
        BASKET_PATTERNS.priceChoices,
        req
      );
    } catch {
      return null;
    }
  }

  /**
   * The same question for the permanent basket of an account, which core
   * creates the first time it is asked. The answer names the basket and the
   * reader, which the live read learns here and nowhere earlier.
   *
   * **It never throws**, like {@link priceChoicesOf}.
   */
  async livePriceChoicesOf(
    userId: string
  ): Promise<BasketPriceChoicesView | null> {
    try {
      return await this.nats.send<BasketPriceChoicesView>(
        BASKET_PATTERNS.livePriceChoices,
        { userId }
      );
    } catch {
      return null;
    }
  }

  /**
   * The cheapest product of each line that needs a price, read before the rows
   * (plan 0201, section 1, step 3). Null when nothing was priced.
   *
   * ## Which prices count
   *
   * With a shop of the read, only the prices at the quoted scope of that shop.
   * A product with no price there is not a candidate, and a shop catalog could
   * not name counts no price at all. With no shop, the scopes the owner's
   * profile resolves to.
   *
   * ## What is asked
   *
   * One `item.getMany` over the distinct products of the lines, in batches
   * under its limit. It asks for the scopes and the offers that {@link compose}
   * asks for, so the composition reuses these products and asks catalog only
   * for the ones it lacks.
   *
   * **It fails empty, never loudly.** No scopes, a catalog that cannot answer,
   * or a profile that no longer resolves all answer null. Core then reads the
   * basket with no picks, and each such line counts as its first product.
   */
  async pricesFor(
    lines: readonly BasketPriceChoice[],
    searchScope: BasketSearchScope | null,
    shopId: string | undefined,
    shop: ShopAvailabilityView | null
  ): Promise<BasketReadPrices | null> {
    if (lines.length === 0) {
      return null;
    }
    const resolved = searchScope
      ? await this.describeScopes(searchScope)
      : undefined;
    const quoted = shop ? quotedScopeOf(shop) : null;
    const counted = shopId
      ? quoted
        ? [quoted]
        : []
      : (resolved?.priceScopeIds ?? []);
    if (counted.length === 0) {
      return null;
    }
    const priceScopeIds = scopesOfRead(resolved, quoted);
    const ids = [...new Set(lines.flatMap((line) => line.itemIds))];
    try {
      const items = await this.itemsOf(ids, priceScopeIds);
      return {
        picks: picksOf(lines, items, counted),
        resolved,
        priceScopeIds,
        items,
      };
    } catch {
      return null;
    }
  }

  /**
   * One shop and the stored availability of these products there (plan 0163,
   * section 2), or null.
   *
   * **It never throws.** A shop catalog cannot name this time costs the read
   * its shop half, and the rows and their prices still come back: the read
   * fails empty, like every other catalog half of it.
   */
  async shopAt(
    supermarketLocationId: string,
    itemIds: readonly string[]
  ): Promise<ShopAvailabilityView | null> {
    const req: ShopAvailabilityRequest = {
      supermarketLocationId,
      itemIds: [...itemIds],
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
   * Which of the shop's sections each product is in, by the rule of plan 0167
   * section 3, keyed by product id; or null.
   *
   * **One call per read, never one per product**: catalog answers every
   * product in one statement. A basket with no products asks nothing.
   *
   * **It never throws**, like {@link shopAt}. A rule catalog cannot answer this
   * time costs the read its sections and nothing else: every product then
   * carries no `sectionIds` at all, which a client draws under the product's
   * own categories, exactly as it draws a shop that has no sections.
   */
  async sectionsAt(
    supermarketLocationId: string,
    itemIds: readonly string[]
  ): Promise<Map<string, string[]> | null> {
    if (itemIds.length === 0) {
      return new Map();
    }
    const req: ItemSectionsAtLocationRequest = {
      supermarketLocationId,
      itemIds: [...itemIds],
    };
    try {
      const answer = await this.nats.send<ItemSectionsAtLocationView>(
        SECTION_PATTERNS.itemsAtLocation,
        req
      );
      return new Map(
        answer.items.map((entry) => [entry.itemId, entry.sectionIds])
      );
    } catch {
      return null;
    }
  }

  /**
   * The product of every row, and nothing else (plan 0201, section 3), priced
   * at the basket's scopes when there are any. In the order of the rows.
   *
   * A product {@link pricesFor} already read at the same scopes is reused, and
   * catalog is asked only for the others. When that pricing chose every
   * product the rows name, catalog is not asked at all.
   *
   * **It never throws.** A catalog that cannot answer costs the read the
   * products it did not already hold.
   */
  async productsOf(
    basket: BasketView,
    priceScopeIds: string[] | undefined,
    prices?: BasketReadPrices | null
  ): Promise<ItemView[]> {
    const ids = productIdsOf(basket);
    if (ids.length === 0) {
      return [];
    }

    const scopes = priceScopeIds ?? [];
    const byId = new Map<string, ItemView>();
    // Reused only when the scopes are the same ones. A product priced at
    // other scopes carries other offers, and is read again.
    if (prices && sameScopes(prices.priceScopeIds, scopes)) {
      for (const item of prices.items) {
        byId.set(item.id, item);
      }
    }
    const missing = ids.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      try {
        for (const item of await this.itemsOf(missing, scopes)) {
          byId.set(item.id, item);
        }
      } catch {
        // The products already held are still drawn.
      }
    }
    return ids.flatMap((id) => {
      const item = byId.get(id);
      return item ? [item] : [];
    });
  }

  /**
   * Several products by id, priced at these scopes when there are any.
   *
   * In batches of {@link ITEM_LOOKUP_LIMITS.maxIds}, asked together. **It
   * throws when one batch fails**, and each caller decides what that costs.
   */
  private async itemsOf(
    ids: readonly string[],
    priceScopeIds: readonly string[]
  ): Promise<ItemView[]> {
    const batches: string[][] = [];
    for (let at = 0; at < ids.length; at += ITEM_LOOKUP_LIMITS.maxIds) {
      batches.push(ids.slice(at, at + ITEM_LOOKUP_LIMITS.maxIds));
    }
    const found = await Promise.all(
      batches.map((batch) => {
        const req: GetItemsRequest =
          priceScopeIds.length > 0
            ? // Plan 0109, section 3: every scope's offer rather than the
              // cheapest alone, so the screen can answer "what does this shop
              // charge" as well as "what will this cost".
              { ids: batch, priceScopeIds: [...priceScopeIds], offers: 'all' }
            : { ids: batch };
        return this.nats.send<GetItemsResult>(ITEM_PATTERNS.getMany, req);
      })
    );
    return found.flatMap((result) => result.items);
  }

  /**
   * What each scope an offer names **is**: the chain for everybody, and the
   * shops only for a reader the basket says may have them.
   *
   * ## The shops are the owner's geography
   *
   * "Cheapest at Mercadona" is what a shopper needs in order to act, and they
   * are standing in the shop. A street address tells somebody who found a
   * forwarded link which neighbourhood the owner lives in, which is the kind of
   * disclosure plan 0051 spent a whole plan refusing to make by accident.
   *
   * The flag is **`BasketView.servesLocations`** since plan 0136, and it is not
   * the per list rule beside it: the shops are the owner's profile rather than a
   * fact about any list, so no list's permissions can decide who reads them.
   * Since plan 0163 core answers it true for every participant, a link visitor
   * included, so that a guest picks the shop they stand in from the owner's
   * list; the cost of that is written where core decides it. The gateway still
   * obeys the flag, so narrowing the rule again is a change in one place.
   */
  async scopesOf(
    products: ItemView[],
    userId: string,
    resolved: CatalogScopeView,
    servesLocations: boolean,
    /**
     * The profile's postal codes and refusals when the caller already read
     * them, null when they could not be read, and undefined to read them here.
     */
    selection?: ShopperSelection | null
  ): Promise<BasketPriceScopeView[]> {
    // Every scope that quoted anything, not only the ones that quoted the
    // cheapest of something (plan 0109, section 3).
    const referenced = productScopeIds(products);
    if (referenced.length === 0) {
      return [];
    }

    try {
      // The refusals are fetched beside the chain names rather than after them:
      // neither needs the other, and a basket read is made often enough that one
      // round trip of latency is worth not spending. The chains are named by
      // the helper the dropdown uses (plan 0161, section 3): it leaves out a
      // scope it cannot name, and answers none when the listing fails.
      const [chains, refused] = await Promise.all([
        this.suggestions.chainsOf(userId, referenced, resolved),
        !servesLocations
          ? NO_REFUSALS
          : selection === undefined
            ? this.refusalsOf(userId, resolved.profileId)
            : refusalsFrom(selection),
      ]);

      return await Promise.all(
        chains.map(async (chain): Promise<BasketPriceScopeView> => {
          // Plan 0064, section 2.1: a refused chain hides every one of its
          // shops, whatever their own rows say.
          const refusedChain = refused.supermarketIds.includes(
            chain.supermarketId
          );
          return {
            ...chain,
            locations:
              servesLocations && !refusedChain
                ? await this.locationsOf(
                    userId,
                    chain.supermarketId,
                    chain.priceScopeId,
                    refused.supermarketLocationIds
                  )
                : [],
          };
        })
      );
    } catch {
      return [];
    }
  }

  /**
   * The scopes this basket is priced at, and whose they are.
   *
   * **The scope is the basket's and never the reader's.** Core is asked what the
   * basket is priced against and the answer names the owner and a profile; the
   * participant is used only to authorize that question. A registered
   * participant's own profile is refused as firmly as a guest's absent one:
   * pricing somebody else's basket against your own shops answers a question
   * nobody asked, and quietly tells the owner's guests where the guest shops.
   *
   * Every branch that cannot produce a scope set leaves `view` undefined, and
   * the read proceeds unpriced: a basket with no profile, a profile since
   * deleted, Redis down. Core not answering at all is null. A basket in an
   * aisle is worth more than a price.
   *
   * The answer also carries the basket's own shop (plan 0163), which the read
   * takes from core's view of the basket instead, so that the lock holds even
   * when this question fails.
   */
  private async ownerScopeOf(
    basketId: string,
    participantId: string
  ): Promise<{
    scope: BasketSearchScope;
    view: CatalogScopeView | undefined;
  } | null> {
    return this.ownerScopeFrom(
      await this.searchScopeOf(basketId, participantId)
    );
  }

  /** The same answer, from a `basket.searchScope` already asked. */
  private async ownerScopeFrom(scope: BasketSearchScope | null): Promise<{
    scope: BasketSearchScope;
    view: CatalogScopeView | undefined;
  } | null> {
    return scope ? { scope, view: await this.describeScopes(scope) } : null;
  }

  /** Core's `basket.searchScope`, or null when core could not answer it. */
  async searchScopeOf(
    basketId: string,
    participantId: string
  ): Promise<BasketSearchScope | null> {
    try {
      return await this.nats.send<BasketSearchScope>(
        BASKET_PATTERNS.searchScope,
        { basketId, participantId }
      );
    } catch {
      return null;
    }
  }

  /**
   * The resolution a basket's reads are priced at, or none.
   *
   * **Undefined rather than an empty array**, which the reads no longer
   * distinguish: both answer products carrying no prices. It is kept because it
   * says what happened rather than what it costs, and because a dropdown that
   * names the right thing without a price beats one that will not open.
   */
  async describeScopes(
    scope: BasketSearchScope
  ): Promise<CatalogScopeView | undefined> {
    if (!scope.profileId) {
      return undefined;
    }
    try {
      // `describe` rather than `forRead`: the same cached pair of round trips,
      // and the whole view carries which chain each scope belongs to, which is
      // what naming a price's place needs without a third catalog call.
      return await this.scopes.describe(scope.ownerUserId, {
        profileId: scope.profileId,
      });
    } catch {
      // A profile emptied or deleted since, which the shopper in the aisle can
      // neither see nor fix. It fails empty, never loudly.
      return undefined;
    }
  }

  /**
   * The shops of one scope, kept to what the pick sheet draws.
   *
   * **Filtered here rather than by catalog.** `supermarketLocation.list` applies
   * no refusals on purpose (plan 0068): it is the owner's read of one chain, and
   * the reads that are a shopper's read of their neighbourhood are the ones that
   * take them. This composition is the shopper's.
   */
  private async locationsOf(
    userId: string,
    supermarketId: string,
    priceScopeId: string,
    excludedLocationIds: readonly string[]
  ): Promise<BasketScopeLocationView[]> {
    const req: ListSupermarketLocationsRequest = {
      userId,
      supermarketId,
      priceScopeId,
      limit: MAX_PAGE_SIZE,
    };
    const page = await this.nats.send<SupermarketLocationPage>(
      SUPERMARKET_LOCATION_PATTERNS.list,
      req
    );
    const refused = new Set(excludedLocationIds);
    // The same shape the read's own shop is drawn in, section names included
    // (plan 0170): catalog answers the page with them.
    return page.items
      .filter((location) => !refused.has(location.id))
      .map(toScopeLocationView);
  }

  /**
   * What the basket's profile refuses, for the shops half of the answer.
   *
   * **It never throws.** A refusal that cannot be read is a preference that
   * cannot be applied, and a preference is not the privacy boundary here:
   * `servesLocations` already decided whether this reader may see any shop at
   * all. So core being slow costs an excluded shop staying on the list for a
   * minute, rather than costing a shopper in an aisle the only address they were
   * given.
   */
  private async refusalsOf(
    userId: string,
    profileId: string | null
  ): Promise<ShopRefusalIds> {
    if (!profileId) {
      return NO_REFUSALS;
    }
    return refusalsFrom(await this.selectionOf(userId, profileId));
  }

  /**
   * The basket profile's postal codes and refusals, or null when they cannot
   * be read. It never throws, for the reason {@link refusalsOf} gives.
   */
  private async selectionOf(
    userId: string,
    profileId: string
  ): Promise<ShopperSelection | null> {
    try {
      return await this.scopes.forShops(userId, { profileId });
    } catch {
      return null;
    }
  }
}

/**
 * The picks a read of the rows carries, when the pricing chose any.
 *
 * Absent rather than empty when nothing was priced, so a basket with no line
 * that needs a price sends core the request it always sent.
 */
function picksOn(prices: BasketReadPrices | null): {
  picks?: BasketLinePick[];
} {
  return prices && prices.picks.length > 0 ? { picks: prices.picks } : {};
}

/**
 * The product of every row, each one time, in the order of the rows (plan
 * 0201, section 3). A row whose lines hold no product names none.
 */
function productIdsOf(basket: BasketView): string[] {
  return [
    ...new Set(
      basket.rows.flatMap((row) => (row.productId ? [row.productId] : []))
    ),
  ];
}

/**
 * The scopes a read prices at: what the owner's profile resolves to, and the
 * quoted scope of the read's shop when it has one (plan 0163, section 2).
 */
function scopesOfRead(
  resolved: CatalogScopeView | undefined,
  quoted: string | null
): string[] {
  return [
    ...new Set([
      ...(resolved?.priceScopeIds ?? []),
      ...(quoted ? [quoted] : []),
    ]),
  ];
}

/** Whether two lists name the same scopes, in any order. */
function sameScopes(a: readonly string[], b: readonly string[]): boolean {
  const held = new Set(a);
  return a.length === b.length && b.every((id) => held.has(id));
}

/** The refusals of a selection, or none when it could not be read. */
function refusalsFrom(selection: ShopperSelection | null): ShopRefusalIds {
  return selection
    ? {
        supermarketIds: selection.excludedSupermarketIds,
        supermarketLocationIds: selection.excludedSupermarketLocationIds,
      }
    : NO_REFUSALS;
}
