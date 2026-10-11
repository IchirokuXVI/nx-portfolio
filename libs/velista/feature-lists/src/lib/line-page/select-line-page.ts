import {
  catalogName,
  favoriteFirst,
  lineProductPrices,
  type AlsoOnVm,
  type CatalogItem,
  type Line,
  type LinePageVm,
  type LineProductCardVm,
  type LineProductPrice,
  type LineProductPriceRead,
  type ShoppingListSummary,
} from '@portfolio/velista/models';
import { formatMoney } from '@portfolio/velista/platform';
import { productDetailText } from '@portfolio/velista/ui';

/**
 * What the line page draws (velista plan `0135`, section 2).
 *
 * Pure, and free of Angular: the page reads the stores and hands their answers
 * in, with the translator as a function, because a selector holds no translator.
 *
 * Three absences are rules here and not gaps:
 *
 * - **No cards on a line of free text**, and then no supermarket row either. The
 *   supermarket prices the products, and there is none to price.
 * - **`alsoOn` is null until something answered it** (velista plan 0047, section 5).
 *   "Nobody asked" and "no other list has this" are opposite answers.
 * - **A price that was not read is `loading`, never "no price".** The card draws a
 *   bone, because saying a product has no price before anybody looked is a guess.
 */
export interface LinePageInput {
  readonly line: Line | undefined;
  readonly list: ShoppingListSummary | undefined;
  readonly zoneName: string | null;
  /** The catalog's record of a product, or null while it has not answered. */
  readonly itemNameOf: (itemId: string) => CatalogItem | null;
  readonly namesUnavailable: boolean;
  /** A member's name in this group, or null for somebody it cannot name. */
  readonly nameOf: (userId: string) => string | null;
  readonly callerUserId: string | null;
  readonly locale: string;
  /** The prices of one product near the reader. See {@link LineProductPriceRead}. */
  readonly priceOf: (itemId: string) => LineProductPriceRead;
  /** The name of a supermarket, in any language it has, or null if nobody can name it. */
  readonly supermarketNameOf: (supermarketId: string) => string | null;
  readonly alsoOn: AlsoOnVm | null;
  readonly commentCount: number | null;
  /** Whether this caller may change the products, the favourite and the supermarket. */
  readonly canEdit: boolean;
  /** Whether this caller may move the number. `DECIDE`. */
  readonly canStep: boolean;
  /** The translator, already bound to {@link locale}. */
  readonly translate: (key: string, args?: Record<string, unknown>) => string;
}

export function selectLinePage(input: LinePageInput): LinePageVm | null {
  const { line } = input;
  if (line === undefined) {
    return null;
  }

  const order = favoriteFirst(line.itemIds, line.favoriteItemId);
  const prices = lineProductPrices(
    order,
    input.priceOf,
    line.preferredSupermarketId
  );

  const cards = order.map((itemId, index) =>
    cardOf(itemId, prices[index], line, input)
  );

  return {
    lineId: line.id,
    content: line.content,
    quantity: line.quantity,
    listName: input.list?.name ?? null,
    zoneName: input.zoneName,
    addedBy: addedByOf(line.createdByUserId, input),
    canStep: input.canStep,
    cards,
    namesUnavailable: input.namesUnavailable && line.itemIds.length > 0,
    supermarket:
      line.itemIds.length === 0
        ? null
        : {
            name: supermarketLabel(line.preferredSupermarketId, input),
            canChange: input.canEdit,
          },
    boughtCount: line.boughtCount,
    commentCount: input.commentCount,
    alsoOn: input.alsoOn,
    canEdit: input.canEdit,
  };
}

/**
 * The supermarket of a line as a word: its name, the word for one nobody can
 * name, or null for "Any".
 */
export function supermarketLabel(
  supermarketId: string | null,
  input: Pick<LinePageInput, 'supermarketNameOf' | 'translate'>
): string | null {
  if (supermarketId === null) {
    return null;
  }
  return (
    input.supermarketNameOf(supermarketId) ??
    input.translate('list.supermarket.other')
  );
}

function cardOf(
  itemId: string,
  price: LineProductPrice,
  line: Line,
  input: LinePageInput
): LineProductCardVm {
  const item = input.itemNameOf(itemId);
  const offer = price.offer;

  return {
    itemId,
    name: item === null ? null : catalogName(item.name, input.locale),
    detail:
      item === null
        ? null
        : productDetailText(item, input.locale, input.translate),
    imageUrl: item?.imageUrl ?? null,
    priceKind: price.kind,
    price:
      offer !== null && offer.price !== null
        ? formatMoney(offer.price, offer.currency, input.locale)
        : null,
    caption: captionOf(price, item, line.preferredSupermarketId !== null, input),
    cheapest: price.cheapest,
    favorite: line.favoriteItemId === itemId,
  };
}

/**
 * The line under the price: "Mercadona · 5,38 € / L".
 *
 * With a supermarket chosen for the line the chain is left out, because every
 * card would repeat the name the row under the cards already says.
 */
function captionOf(
  price: LineProductPrice,
  item: CatalogItem | null,
  chosen: boolean,
  input: Pick<LinePageInput, 'locale' | 'translate'>
): string | null {
  const offer = price.offer;
  if (offer === null) {
    return null;
  }

  const basis = item?.unitBasis ?? null;
  const unit =
    offer.unitPrice !== null && basis !== null
      ? input.translate(`catalog.unit.${basis}`, {
          price: formatMoney(offer.unitPrice, offer.currency, input.locale),
        })
      : null;
  const chain =
    chosen || price.chain === null
      ? null
      : catalogName(price.chain, input.locale);

  const parts = [chain, unit].filter(
    (part): part is string => part !== null && part !== ''
  );
  return parts.length === 0 ? null : parts.join(' · ');
}

/**
 * What to call the person who put this line on the list (velista plan 0066,
 * section 4).
 *
 * The reader gets their own word. An id the group resolves gets that name. An id
 * it does not, and the empty string a line older than the field carries, both
 * get "somebody": an author who left the group and a line from a server that
 * predates the field are owed the same sentence.
 */
function addedByOf(
  createdByUserId: string,
  input: Pick<LinePageInput, 'callerUserId' | 'nameOf' | 'translate'>
): string {
  if (createdByUserId === '') {
    return input.translate('list.page.someone');
  }
  if (createdByUserId === input.callerUserId) {
    return input.translate('list.page.you');
  }
  return input.nameOf(createdByUserId) ?? input.translate('list.page.someone');
}
