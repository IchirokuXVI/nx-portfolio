import {
  cheapestOf,
  type BasketRulePrice,
} from '@portfolio/luna-shopper/basket-rules';
import {
  productKindOf,
  type BasketLinePick,
  type BasketPriceChoice,
  type ItemOfferView,
  type ItemView,
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
 * Since plan 0246 each offer goes with how its product is sold and its size,
 * and the line goes with its unit and its amount: the cheapest is the cost of
 * that amount with each product (owner, W3), and a product that cannot serve
 * the unit is not a candidate.
 *
 * ## A product in stock first (plan 0220, section 15.5)
 *
 * The comparison runs twice at most. First over the offers that no chain
 * marks out of stock (`outOfStockAt` null), and only when none of those is
 * priced, over every offer. So a line picks the cheapest product in stock
 * before a cheaper one out of stock, and a line whose products are all out of
 * stock still picks the cheapest. A line with a favourite never reaches here:
 * core asks only for the lines that have none.
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
    const inStock: BasketRulePrice[] = [];
    for (const itemId of line.itemIds) {
      const item = byId.get(itemId);
      if (!item) {
        // A product catalog no longer names is not a candidate.
        continue;
      }
      const sizing = {
        defaultUnit: item.defaultUnit,
        unitSize: item.unitSize ?? null,
        approxWeight: item.approxWeight ?? null,
      };
      const kind = productKindOf(sizing);
      for (const offer of offersOf(item)) {
        if (counted.has(offer.priceScopeId)) {
          const price: BasketRulePrice = {
            itemId,
            kind,
            ...sizing,
            price: offer.price,
            piecePrice: offer.piecePrice ?? null,
          };
          prices.push(price);
          // Absent is a catalog from before the field, which said nothing.
          if (!offer.outOfStockAt) {
            inStock.push(price);
          }
        }
      }
    }
    // A core older than plan 0246 sends no unit, and its lines count pieces.
    const amount = { unit: line.unit ?? 'UNIT', quantity: line.quantity ?? 1 };
    const itemId = cheapestOf(inStock, amount) ?? cheapestOf(prices, amount);
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
