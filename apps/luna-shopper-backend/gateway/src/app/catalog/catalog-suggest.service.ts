import { Injectable } from '@nestjs/common';
import {
  ITEM_PATTERNS,
  PRODUCT_GROUP_MEMBERS_MAX,
  SUPERMARKET_PATTERNS,
  type CatalogScopeView,
  type CatalogSuggestion,
  type CatalogSuggestResponse,
  type ItemPage,
  type ItemView,
  type ListSupermarketsRequest,
  type PriceScopeChainView,
  type ProductGroupOfferPage,
  type SearchItemsRequest,
  type SearchOffersRequest,
  type SupermarketPage,
} from '@portfolio/luna-shopper/contracts';
import { MAX_PAGE_SIZE } from '@portfolio/luna-shopper/platform';
import { NatsClient } from '../messaging/nats-client';

/** What a suggest route knows before it asks catalog anything. */
export interface SuggestInput {
  /** Whose catalog read this is: the caller, or a basket's owner. */
  userId: string;
  query?: string;
  limit?: number;
  /** The resolution the reads are priced at. Absent answers unpriced. */
  resolved?: CatalogScopeView;
}

/**
 * The composer's dropdown, and the chains its prices are quoted from (plans
 * 0048 section 3, and 0161).
 *
 * Both suggest routes answer through this, the account holder's and the
 * basket's, so the two cannot ask catalog for different things or name one
 * scope differently. The basket read names its scopes through
 * {@link chainsOf} as well, and adds the shops on top.
 */
@Injectable()
export class CatalogSuggestService {
  constructor(private readonly nats: NatsClient) {}

  /**
   * The whole dropdown, in the order it is to be drawn.
   *
   * The two reads run in parallel and neither is allowed to take the other
   * down: a failure on one side answers with what the other found, because a
   * dropdown that shows fewer suggestions is a worse dropdown and a dropdown
   * that shows an error is a broken composer. Naming the chains follows the
   * same rule.
   */
  async suggest(input: SuggestInput): Promise<CatalogSuggestResponse> {
    const common = {
      userId: input.userId,
      query: input.query,
      priceScopeIds: input.resolved?.priceScopeIds,
      limit: input.limit,
      // Plan 0161: every scope's price, so the card can list one per chain.
      offers: 'all' as const,
    };
    const [groups, items] = await Promise.all([
      this.nats
        .send<ProductGroupOfferPage>(ITEM_PATTERNS.searchOffers, {
          ...common,
          members: PRODUCT_GROUP_MEMBERS_MAX,
        } satisfies SearchOffersRequest)
        .catch(
          () => ({ items: [], nextCursor: null }) as ProductGroupOfferPage
        ),
      this.nats
        .send<ItemPage>(
          ITEM_PATTERNS.search,
          common satisfies SearchItemsRequest
        )
        .catch(() => ({ items: [], nextCursor: null }) as ItemPage),
    ]);

    const suggestions: CatalogSuggestion[] = [
      ...groups.items.map((group) => ({
        kind: 'group' as const,
        group,
        item: null,
      })),
      ...items.items.map((item) => ({
        kind: 'item' as const,
        group: null,
        item,
      })),
    ];
    return {
      suggestions,
      scopes: input.resolved
        ? await this.chainsOf(
            input.userId,
            suggestionScopeIds(suggestions),
            input.resolved
          )
        : [],
    };
  }

  /**
   * Which chain each of these scopes belongs to, in the order given.
   *
   * **A scope it cannot name is left out, never guessed**: one the resolution
   * did not describe, which is every scope when the caller named them outright,
   * and one whose chain the listing did not return. The offer that quoted it
   * still reaches the client, which draws it without a chain.
   *
   * **It never throws.** A chain listing that fails answers an empty array,
   * because naming a price's place is worth less than the price.
   */
  async chainsOf(
    userId: string,
    priceScopeIds: readonly string[],
    resolved: CatalogScopeView
  ): Promise<PriceScopeChainView[]> {
    if (priceScopeIds.length === 0 || resolved.scopes.length === 0) {
      // Nothing to name, or nothing to name it with: a caller who named scope
      // ids outright is described with no scopes at all.
      return [];
    }
    let chains: SupermarketPage;
    try {
      chains = await this.nats.send<SupermarketPage>(
        SUPERMARKET_PATTERNS.list,
        { userId, limit: MAX_PAGE_SIZE } satisfies ListSupermarketsRequest
      );
    } catch {
      return [];
    }
    const chainById = new Map(chains.items.map((c) => [c.id, c]));
    const views: PriceScopeChainView[] = [];
    for (const priceScopeId of priceScopeIds) {
      const scope = resolved.scopes.find(
        (s) => s.priceScopeId === priceScopeId
      );
      const chain = scope ? chainById.get(scope.supermarketId) : undefined;
      if (scope && chain) {
        views.push({
          priceScopeId,
          supermarketId: chain.id,
          supermarketName: chain.name,
        });
      }
    }
    return views;
  }
}

/**
 * Every scope id an offer on these products names, once each, in the order
 * they first appear: every entry of `offers`, or `bestOffer` where there is no
 * `offers`. A scope this skipped would reach the client as a price with no
 * chain (plan 0109, section 3).
 */
export function productScopeIds(products: readonly ItemView[]): string[] {
  return [
    ...new Set(
      products.flatMap((product) =>
        product.offers
          ? product.offers.map((offer) => offer.priceScopeId)
          : product.bestOffer
            ? [product.bestOffer.priceScopeId]
            : []
      )
    ),
  ];
}

/**
 * Every scope id an offer anywhere on a dropdown names (plan 0161, section 3):
 * each item's offers, each group's own offer, its cheapest member's offers and
 * each member's best offer.
 */
export function suggestionScopeIds(
  suggestions: readonly CatalogSuggestion[]
): string[] {
  const products: ItemView[] = [];
  const groupOffers: string[] = [];
  for (const suggestion of suggestions) {
    if (suggestion.item) {
      products.push(suggestion.item);
    }
    if (suggestion.group) {
      if (suggestion.group.offer) {
        groupOffers.push(suggestion.group.offer.priceScopeId);
      }
      if (suggestion.group.cheapestItem) {
        products.push(suggestion.group.cheapestItem);
      }
      products.push(...(suggestion.group.members ?? []));
    }
  }
  return [...new Set([...groupOffers, ...productScopeIds(products)])];
}
