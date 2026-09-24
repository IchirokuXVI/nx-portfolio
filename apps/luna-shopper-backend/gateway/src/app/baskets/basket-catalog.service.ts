import { Injectable } from '@nestjs/common';
import {
  BASKET_PATTERNS,
  ITEM_PATTERNS,
  SUPERMARKET_LOCATION_PATTERNS,
  type BasketPriceScopeView,
  type BasketResult,
  type BasketScopeLocationView,
  type BasketSearchScope,
  type BasketView,
  type CatalogScopeView,
  type CatalogSuggestResponse,
  type GetItemsRequest,
  type GetItemsResult,
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
import {
  atShopOf,
  quotedScopeOf,
  toBasketShopView,
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
 * has none. A row's options are catalog products and never zone data (plan 0051,
 * section 6.1), so a guest is entitled to the names; carrying them here is how
 * they get them without a second public catalog surface, and it makes the whole
 * screen one request rather than one plus a fan out over every option.
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
    locationId: string | undefined
  ): Promise<BasketResult> {
    const own = basket.supermarketLocationId ?? null;
    if (own && locationId && locationId !== own) {
      throw new BasketShopLockedException(
        'This basket was started at another shop'
      );
    }
    const shopId = own ?? locationId ?? null;
    const itemIds = [...new Set(basket.rows.flatMap((row) => row.optionIds))];

    const [owner, shop] = await Promise.all([
      this.ownerScopeOf(basket.id, participantId),
      shopId ? this.shopAt(shopId, itemIds) : Promise.resolve(null),
    ]);
    const resolved = owner?.view;
    const quoted = shop ? quotedScopeOf(shop) : null;
    const priceScopeIds = [
      ...new Set([
        ...(resolved?.priceScopeIds ?? []),
        ...(quoted ? [quoted] : []),
      ]),
    ];
    const products = await this.productsOf(basket, priceScopeIds);

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
   * The products every row names, in one catalog round trip, priced at the
   * basket's scopes when there are any.
   */
  async productsOf(
    basket: BasketView,
    priceScopeIds: string[] | undefined
  ): Promise<ItemView[]> {
    const ids = [...new Set(basket.rows.flatMap((row) => row.optionIds))];
    if (ids.length === 0) {
      return [];
    }

    const req: GetItemsRequest =
      priceScopeIds && priceScopeIds.length > 0
        ? // Plan 0109, section 3: every scope's offer rather than the cheapest
          // alone, so the screen can answer "what does this shop charge" as well
          // as "what will this cost".
          { ids, priceScopeIds, offers: 'all' }
        : { ids };
    try {
      const found = await this.nats.send<GetItemsResult>(
        ITEM_PATTERNS.getMany,
        req
      );
      return found.items;
    } catch {
      return [];
    }
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
    try {
      const scope = await this.nats.send<BasketSearchScope>(
        BASKET_PATTERNS.searchScope,
        { basketId, participantId }
      );
      return { scope, view: await this.describeScopes(scope) };
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
    return page.items
      .filter((location) => !refused.has(location.id))
      .map((location) => ({
        supermarketLocationId: location.id,
        label: location.label,
        address: location.address,
        city: location.city,
        postalCode: location.postalCode,
      }));
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

/** The refusals of a selection, or none when it could not be read. */
function refusalsFrom(selection: ShopperSelection | null): ShopRefusalIds {
  return selection
    ? {
        supermarketIds: selection.excludedSupermarketIds,
        supermarketLocationIds: selection.excludedSupermarketLocationIds,
      }
    : NO_REFUSALS;
}
