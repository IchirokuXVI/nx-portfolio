import type { ProductOffer } from './domain';
import {
  lineAmount,
  lineAmountProductOf,
  type LineAmount,
} from './line-amount';
import {
  cheaperForLineInGroup,
  lineMemberCost,
  type LineAsk,
  type LineMember,
} from './line-products';
import { servesLineUnit, type LineUnitProductRead } from './line-unit';

/**
 * What the change sheet knows about the price of one product it offers (velista
 * `0140`, section 2).
 *
 * - `loading`: not read yet.
 * - `priced`: an offer at the scopes the basket is read at. Its price can still be
 *   null, for a scope that stocks the product with no price.
 * - `noPrice`: nothing at those scopes, or the read failed.
 * - `notSold`: the shop the basket is read at does not sell it. Only with a shop.
 */
export type ProductChoicePrice =
  | { readonly kind: 'loading' }
  | { readonly kind: 'priced'; readonly offer: ProductOffer }
  | { readonly kind: 'noPrice' }
  | { readonly kind: 'notSold' };

/** What {@link productChoices} is asked. */
export interface ProductChoicesInput {
  /** The product the row draws now, or null for a row with none. */
  readonly chosenId: string | null;
  /** The products of each line the change is for, in the order each holds them. */
  readonly lineItemIds: readonly (readonly string[])[];
  /** The members of the groups of those products. */
  readonly memberIds: readonly string[];
  /** A product chosen from the catalog, drawn second. Null for none. */
  readonly pickedId: string | null;
  readonly priceOf: (itemId: string) => ProductChoicePrice;
  /**
   * What the row asks for (velista `0183`): its amount and the unit it counts
   * in, which decide the order and the cheaper mark.
   */
  readonly line: LineAsk;
  /** The size fields of a product, `undefined` while its record is not read. */
  readonly productOf: (itemId: string) => LineUnitProductRead;
}

/** One radio row of the change sheet. */
export interface ProductChoice {
  readonly itemId: string;
  /** The product the row draws now: "Chosen now". */
  readonly chosenNow: boolean;
  /** The shop of the read does not sell it: "Not sold here". */
  readonly notSold: boolean;
  /** The price the row draws, or null for none. */
  readonly offer: ProductOffer | null;
  /** It costs less than the product chosen now: "cheaper option". */
  readonly cheaper: boolean;
  /**
   * Whether it can serve the row's unit (velista `0183`), null while its record
   * is not read. One that cannot is offered still, last, and marked.
   */
  readonly serves: boolean | null;
  /** What the row's amount costs with it, or null for none and at 0. */
  readonly amount: LineAmount | null;
}

/**
 * The products the change sheet offers, as one list (velista `0140`, section 2).
 *
 * The owner merged the products of a line and the similar products: "The user
 * only needs to know those are other products he can choose quickly." So there
 * are no headings, and every product is offered once.
 *
 * 1. The product chosen now.
 * 2. A product just chosen from the catalog, so that it is in sight when the
 *    sheet comes back with it chosen.
 * 3. The products of every line and the members of their groups, in the order of
 *    the line page (velista `0183`, W3): the cost of the row's amount among the
 *    ones that can serve its unit, cheapest first, then the ones with no price
 *    for it. Two at one cost keep the order they were given in, which is the
 *    order of the lines and then of the groups.
 * 4. The products that cannot serve the row's unit at all, kept and marked: the
 *    shopper may have reasons, and choosing one is allowed.
 * 5. The products the shop of the read does not sell, last, in the same order.
 *
 * "Cheaper option" is the comparison of the cheaper mark of the row
 * (`cheaperForLineInGroup`): the cost of the row's amount, strictly lower, among
 * the products that can serve its unit.
 */
export function productChoices(
  input: ProductChoicesInput
): readonly ProductChoice[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const take = (itemId: string | null) => {
    if (itemId !== null && itemId !== '' && !seen.has(itemId)) {
      seen.add(itemId);
      ordered.push(itemId);
    }
  };

  take(input.chosenId);
  take(input.pickedId);
  const head = ordered.length;
  for (const itemIds of input.lineItemIds) {
    itemIds.forEach(take);
  }
  input.memberIds.forEach(take);

  const memberOf = (itemId: string): LineMember => {
    const price = input.priceOf(itemId);
    return {
      product: input.productOf(itemId) ?? null,
      offer: price.kind === 'priced' ? price.offer : null,
    };
  };
  const chosen = input.chosenId === null ? null : memberOf(input.chosenId);

  const costs = new Map<string, number | null>();
  const choices = ordered.map((itemId): ProductChoice => {
    const price = input.priceOf(itemId);
    const offer = price.kind === 'priced' ? price.offer : null;
    const chosenNow = itemId === input.chosenId;
    const member = memberOf(itemId);
    const cost = lineMemberCost(input.line, member);
    costs.set(itemId, cost);
    return {
      itemId,
      chosenNow,
      notSold: price.kind === 'notSold',
      offer,
      cheaper:
        !chosenNow &&
        chosen !== null &&
        input.chosenId !== null &&
        cheaperForLineInGroup(input.line, input.chosenId, chosen, [
          { id: itemId, ...member },
        ]),
      serves:
        member.product === null
          ? null
          : servesLineUnit(member.product, input.line.unit),
      amount:
        cost === null || input.line.quantity <= 0 || member.product === null
          ? null
          : lineAmount(
              input.line.quantity,
              input.line.unit,
              lineAmountProductOf(member.product),
              member.offer ?? { price: null, piecePrice: null }
            ),
    };
  });

  const rest = choices.slice(head);
  const costOf = (choice: ProductChoice) => costs.get(choice.itemId) ?? null;
  // One order for both groups: the costed ones cheapest first, then the ones
  // that can serve the unit with no cost, then the ones that cannot serve it.
  // `sort` is stable, so a tie keeps the order the products were given in.
  const byLineCost = (group: readonly ProductChoice[]) => [
    ...group
      .filter((choice) => costOf(choice) !== null)
      .sort((a, b) => (costOf(a) ?? 0) - (costOf(b) ?? 0)),
    ...group.filter(
      (choice) => costOf(choice) === null && choice.serves !== false
    ),
    ...group.filter(
      (choice) => costOf(choice) === null && choice.serves === false
    ),
  ];

  return [
    ...choices.slice(0, head),
    ...byLineCost(rest.filter((choice) => !choice.notSold)),
    ...byLineCost(rest.filter((choice) => choice.notSold)),
  ];
}
