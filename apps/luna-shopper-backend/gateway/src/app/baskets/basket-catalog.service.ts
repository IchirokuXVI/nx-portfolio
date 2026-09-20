import { Injectable } from '@nestjs/common';
import {
  BASKET_PATTERNS,
  ITEM_PATTERNS,
  SUPERMARKET_LOCATION_PATTERNS,
  SUPERMARKET_PATTERNS,
  type BasketPriceScopeView,
  type BasketScopeLocationView,
  type BasketSearchScope,
  type BasketView,
  type CatalogScopeView,
  type GetItemsRequest,
  type GetItemsResult,
  type ItemView,
  type ListSupermarketLocationsRequest,
  type ListSupermarketsRequest,
  type SupermarketLocationPage,
  type SupermarketPage,
} from '@portfolio/luna-shopper/contracts';
import { MAX_PAGE_SIZE } from '@portfolio/luna-shopper/platform';
import { ScopeResolutionService } from '../catalog/scope-resolution.service';
import { NatsClient } from '../messaging/nats-client';

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
    private readonly scopes: ScopeResolutionService
  ) {}

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
   * fact about any list, so no list's permissions can decide who reads them. The
   * owner and every named person are served them; a link visitor, guest or
   * registered, is served chains and scopes and never an address, which is the
   * same empty array the client already draws for a scope whose stores catalog
   * cannot place.
   */
  async scopesOf(
    products: ItemView[],
    userId: string,
    resolved: CatalogScopeView,
    servesLocations: boolean
  ): Promise<BasketPriceScopeView[]> {
    const referenced = [
      ...new Set(
        products.flatMap((product) =>
          product.offers
            ? // Every scope that quoted anything, not only the ones that quoted
              // the cheapest of something (plan 0109, section 3). A scope this
              // array skipped would reach the client as a price with no shop.
              product.offers.map((offer) => offer.priceScopeId)
            : product.bestOffer
              ? [product.bestOffer.priceScopeId]
              : []
        )
      ),
    ];
    if (referenced.length === 0) {
      return [];
    }

    try {
      // The refusals are fetched beside the chain names rather than after them:
      // neither needs the other, and a basket read is made often enough that one
      // round trip of latency is worth not spending.
      const [chains, refused] = await Promise.all([
        this.nats.send<SupermarketPage>(SUPERMARKET_PATTERNS.list, {
          userId,
          limit: MAX_PAGE_SIZE,
        } satisfies ListSupermarketsRequest),
        servesLocations
          ? this.refusalsOf(userId, resolved.profileId)
          : NO_REFUSALS,
      ]);
      const chainById = new Map(chains.items.map((c) => [c.id, c]));

      const views = await Promise.all(
        referenced.map(
          async (priceScopeId): Promise<BasketPriceScopeView | null> => {
            const scope = resolved.scopes.find(
              (s) => s.priceScopeId === priceScopeId
            );
            const chain = scope
              ? chainById.get(scope.supermarketId)
              : undefined;
            if (!scope || !chain) {
              // A scope the resolution did not name, or a chain the listing did
              // not: an entry that cannot say which chain it is would be worse
              // than none.
              return null;
            }
            // Plan 0064, section 2.1: a refused chain hides every one of its
            // shops, whatever their own rows say.
            const refusedChain = refused.supermarketIds.includes(chain.id);
            return {
              priceScopeId,
              supermarketId: chain.id,
              supermarketName: chain.name,
              locations:
                servesLocations && !refusedChain
                  ? await this.locationsOf(
                      userId,
                      chain.id,
                      priceScopeId,
                      refused.supermarketLocationIds
                    )
                  : [],
            };
          }
        )
      );
      return views.filter(
        (view): view is BasketPriceScopeView => view !== null
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
   * Every branch that cannot produce a scope set produces **null**, and the read
   * proceeds unpriced: a basket with no profile, a profile since deleted, core
   * slow, Redis down. A basket in an aisle is worth more than a price.
   */
  async resolvedScopesOf(
    basketId: string,
    participantId: string
  ): Promise<{ ownerUserId: string; view: CatalogScopeView } | null> {
    try {
      const scope = await this.nats.send<BasketSearchScope>(
        BASKET_PATTERNS.searchScope,
        { basketId, participantId }
      );
      const view = await this.describeScopes(scope);
      return view ? { ownerUserId: scope.ownerUserId, view } : null;
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
    try {
      const selection = await this.scopes.forShops(userId, { profileId });
      return {
        supermarketIds: selection.excludedSupermarketIds,
        supermarketLocationIds: selection.excludedSupermarketLocationIds,
      };
    } catch {
      return NO_REFUSALS;
    }
  }
}
