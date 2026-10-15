import type { GroupMembersScope } from '@portfolio/velista/data-access';
import {
  isCrossedOutRow,
  type BasketAddress,
  type BasketListRef,
  type BasketPriceScope,
  type BasketProduct,
  type BasketRow,
  type CatalogItem,
  type ProductOffer,
} from '@portfolio/velista/models';
import { sheetSegments } from '@portfolio/velista/platform';
import { basketPath } from '../basket-paths';

/**
 * Where a basket prices a group's members: the basket's own scopes, sorted so the
 * same basket always asks the same question. Empty when the basket has none, and
 * then the server prices at the caller's profile.
 */
export function basketGroupScope(
  scopes: ReadonlyMap<string, BasketPriceScope> | undefined
): GroupMembersScope {
  return { priceScopeIds: [...(scopes?.keys() ?? [])].sort() };
}

/** What decides whether a reader may change the product of a row's lines. */
export interface ChangeReader {
  readonly guest: boolean;
  /** The trip is over. */
  readonly finished: boolean;
  /** The covered lists this reader was served, by id. */
  readonly lists: ReadonlyMap<string, BasketListRef>;
}

/**
 * The lines of a row whose product the reader may change (velista `0140`, section
 * 1): the entries Change is drawn on.
 *
 * None for a guest, a finished trip, a row with no product, or a row crossed out
 * (velista `0142`). Of the rest, an entry the reader may edit (`canWrite`) on a
 * list they were served, which is not itself crossed out as bought elsewhere.
 */
export function changeableLineIds(
  row: BasketRow,
  reader: ChangeReader
): readonly string[] {
  if (
    reader.guest ||
    reader.finished ||
    row.productId === null ||
    isCrossedOutRow(row)
  ) {
    return [];
  }
  return row.entries
    .filter(
      (entry) =>
        entry.canWrite &&
        entry.listId !== null &&
        reader.lists.has(entry.listId) &&
        entry.state !== 'BOUGHT_ELSEWHERE'
    )
    .map((entry) => entry.lineId);
}

/**
 * The change sheet's URL (velista `0140`, section 2): one line, or every line the
 * reader may change when `lineId` is null. Addressed by the row key, beside the
 * settle sheet, so it follows the row as the settle sheet does.
 */
export function changeSheetPath(
  locale: string,
  basePath: string,
  address: BasketAddress | null,
  rowKey: string,
  lineId: string | null
): string {
  const about =
    lineId === null
      ? sheetSegments('rows', rowKey, 'change')
      : sheetSegments('rows', rowKey, 'change', lineId);
  return `${basketPath(locale, basePath, address)}/${about.join('/')}`;
}

/**
 * The price scopes the sheet prices its products at: the scopes of the shop the
 * basket is read at, when it is read at one, else every scope of the basket.
 * Sorted, so the same sheet always asks the same question.
 *
 * A scope names the shops it prices. A shop no scope of the basket names is
 * priced at every scope, which is what the basket does for it too.
 */
export function changePriceScopes(
  scopes: ReadonlyMap<string, BasketPriceScope> | undefined,
  shopId: string | null
): readonly string[] {
  const all = [...(scopes?.values() ?? [])];
  const atShop =
    shopId === null ? [] : all.filter((scope) => scopeHasShop(scope, shopId));
  return (atShop.length > 0 ? atShop : all)
    .map((scope) => scope.priceScopeId)
    .sort();
}

/**
 * The chain of the shop the basket is read at, or null: the catalog that chooses
 * opens on it (velista `0140`, section 3).
 */
export function chainOfShop(
  scopes: ReadonlyMap<string, BasketPriceScope> | undefined,
  shopId: string | null
): string | null {
  if (shopId === null) {
    return null;
  }
  const scope = [...(scopes?.values() ?? [])].find((held) =>
    scopeHasShop(held, shopId)
  );
  return scope?.supermarketId ?? null;
}

function scopeHasShop(scope: BasketPriceScope, shopId: string): boolean {
  return scope.locations.some((location) => location.id === shopId);
}

/**
 * A product chosen on the change sheet, as a basket row draws one (velista `0140`,
 * section 4).
 *
 * For a choice held on the device: the read of the basket names the product of
 * every row and nothing else, so a line moved to a product no row draws would be
 * drawn without a name or a price until its first buy. The price is the one the
 * sheet showed, as the basket's offer and, at a shop, as what that shop charges.
 */
export function basketProductOf(
  item: CatalogItem,
  offer: ProductOffer | null,
  atShop: boolean
): BasketProduct {
  return {
    id: item.id,
    name: item.name,
    brand: item.brand,
    imageUrl: item.imageUrl,
    productGroupId: item.productGroupId,
    size: item.size,
    unit: item.unit,
    offer,
    offers: offer === null ? [] : [offer],
    atShop: atShop
      ? {
          priceScopeId: offer?.price == null ? null : offer.priceScopeId,
          price: offer?.price ?? null,
          currency: offer?.price == null ? null : offer.currency,
          available: null,
        }
      : null,
    categories: item.categories,
    sectionIds: null,
  };
}
