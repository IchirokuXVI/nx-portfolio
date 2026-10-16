import {
  cheapestOf,
  type BasketRulePrice,
} from '@portfolio/luna-shopper/basket-rules';
import type {
  BasketLinePick,
  BasketPriceChoice,
  ItemOfferView,
  ItemView,
} from '@portfolio/luna-shopper/contracts';

/**
 * The cheapest product of each line that needs a price to know its product
 * (plan 0201, section 1, step 3).
 *
 * A pure function over what core and catalog answered, so the rule is tested
 * without a broker. Core never sees a price: the gateway chooses the product
 * here and hands core an item id.
 *
 * ## Which prices count
 *
 * `countedScopeIds` is the caller's decision. With a shop of the read it is the
 * quoted scope of that shop alone, so a product with no price there is not a
 * candidate. With no shop it is every scope the owner's profile resolves to.
 * An offer at any other scope is ignored, even when catalog answered it.
 *
 * ## One comparison of prices
 *
 * The comparison is `cheapestOf` of the basket rules, and no other. Every
 * offer that counts goes to it in one list for each line: the products in the
 * order the line holds them, and the offers of a product in the order catalog
 * answered them. The cheapest offer of the list is the cheapest offer of its
 * product, so no price is compared here. A tie keeps the product that the line
 * holds first.
 *
 * A line with no priced product gets no pick, and core then counts it as its
 * first product.
 */
export function picksOf(
  lines: readonly BasketPriceChoice[],
  items: readonly ItemView[],
  countedScopeIds: readonly string[]
): BasketLinePick[] {
  const counted = new Set(countedScopeIds);
  const byId = new Map(items.map((item) => [item.id, item]));
  const picks: BasketLinePick[] = [];
  for (const line of lines) {
    const prices: BasketRulePrice[] = [];
    for (const itemId of line.itemIds) {
      const item = byId.get(itemId);
      if (!item) {
        // A product catalog no longer names is not a candidate.
        continue;
      }
      for (const offer of offersOf(item)) {
        if (counted.has(offer.priceScopeId)) {
          prices.push({
            itemId,
            price: offer.price,
            unitPrice: offer.unitPrice,
          });
        }
      }
    }
    const itemId = cheapestOf(prices);
    if (itemId !== null) {
      picks.push({ lineId: line.lineId, itemId });
    }
  }
  return picks;
}

/**
 * Every offer catalog answered for a product. A read that asked for the
 * cheapest alone carries `bestOffer` and no `offers`, so that one offer is the
 * list.
 */
function offersOf(item: ItemView): readonly ItemOfferView[] {
  return item.offers ?? (item.bestOffer ? [item.bestOffer] : []);
}
