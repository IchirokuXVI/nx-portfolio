import type { ProductOffer } from './domain';
import { cheaperInGroup, compareGroupOffers } from './product-group';

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
 *    velista `0137`: the price for each kilo or litre, then the price, then the
 *    ones with no price. Two at one price keep the order they were given in,
 *    which is the order of the lines and then of the groups.
 * 4. The products the shop of the read does not sell, last, in the same order.
 *
 * "Cheaper option" is the comparison of the cheaper mark of the row
 * (`cheaperInGroup`): the price for each kilo or litre when both have one, else
 * the price, strictly lower.
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

  const chosenPrice =
    input.chosenId === null ? null : input.priceOf(input.chosenId);
  const chosenOffer = chosenPrice?.kind === 'priced' ? chosenPrice.offer : null;

  const choices = ordered.map((itemId): ProductChoice => {
    const price = input.priceOf(itemId);
    const offer = price.kind === 'priced' ? price.offer : null;
    const chosenNow = itemId === input.chosenId;
    return {
      itemId,
      chosenNow,
      notSold: price.kind === 'notSold',
      offer,
      cheaper:
        !chosenNow &&
        offer !== null &&
        input.chosenId !== null &&
        cheaperInGroup(input.chosenId, chosenOffer, [{ id: itemId, offer }]),
    };
  });

  const rest = choices.slice(head);
  // `sort` is stable, so a tie keeps the order the products were given in.
  const sold = rest
    .filter((choice) => !choice.notSold)
    .sort((a, b) => compareGroupOffers(a.offer, b.offer));
  const notSold = rest
    .filter((choice) => choice.notSold)
    .sort((a, b) => compareGroupOffers(a.offer, b.offer));

  return [...choices.slice(0, head), ...sold, ...notSold];
}
