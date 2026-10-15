import { catalogName } from './catalog-browse';
import type { Line } from './domain';
import { lineShownProduct, type LineProductPriceRead } from './line-products';
import type { LocalizedName } from './shopping-profile';

/**
 * The name a screen draws for a line (velista `0144`, section 1).
 */
export interface LineName {
  /** The words to draw. */
  readonly text: string;
  /** Whether a person named the line. False draws the name of a product. */
  readonly own: boolean;
  /** The product the line shows, or null on a line with none. */
  readonly itemId: string | null;
  /** That product's name in the reader's language, or null while it is not loaded. */
  readonly productName: string | null;
  /**
   * What a name field starts with: the name for a named line, and empty for a line
   * that is not named.
   */
  readonly field: string;
  /**
   * Whether every product of the line has its name loaded. Until then the answer can
   * change: a named line whose name turns out to be a product's name stops being named.
   */
  readonly settled: boolean;
}

/** The fields of a line this answer reads. */
export type LineNameSource = Pick<
  Line,
  'content' | 'named' | 'itemIds' | 'favoriteItemId'
> &
  Partial<Pick<Line, 'preferredSupermarketId'>>;

/**
 * The one answer to "what is this line called" (velista `0144`, sections 1 and 2).
 *
 * - **A named line** draws its `content`.
 * - **A line that is not named** draws the name of the product it shows, which is
 *   `lineShownProduct` over the prices `pricesOf` answers (velista `0145`, section
 *   2). With no prices that is the favourite when the line holds it, or else its
 *   first product. While that name has not loaded it draws `content`, which is the
 *   name the product had when the line was made.
 * - **A named line whose `content` is the name of one of its products** is drawn as
 *   not named. Before backend `0207` every line made from a product took the
 *   product's name and the server marks all of them named, so this is how those
 *   lines lose a name nobody typed. It writes nothing. The comparison folds case,
 *   accents and spaces, tries every language the product has a name in, and skips a
 *   name that is empty in that language, so no product makes every line match.
 *
 * `nameOf` answers the catalog's name of a product, or null while it is not loaded.
 * `pricesOf` answers its prices, and is absent where a screen reads none.
 */
export function lineName(
  line: LineNameSource,
  nameOf: (itemId: string) => LocalizedName | null,
  locale: string,
  pricesOf: (itemId: string) => LineProductPriceRead = noPrices
): LineName {
  const itemId = shownItemId(line, pricesOf);
  if (itemId === null) {
    return {
      text: line.content,
      own: true,
      itemId: null,
      productName: null,
      field: line.content,
      settled: true,
    };
  }

  const names = line.itemIds.map((id) => nameOf(id));
  const settled = names.every((name) => name !== null);
  const shown = nameOf(itemId);
  const productName =
    shown === null ? null : nonEmpty(catalogName(shown, locale));

  const own =
    line.named &&
    !names.some((name) => name !== null && isNameOf(line.content, name));

  if (own) {
    return {
      text: line.content,
      own,
      itemId,
      productName,
      field: line.content,
      settled,
    };
  }
  return {
    text: productName ?? line.content,
    own,
    itemId,
    productName,
    field: '',
    settled,
  };
}

/**
 * What a save of a name field sends, or null when it has nothing to send (velista
 * `0144`, section 4).
 *
 * - Text gives the line that name: `{ content }`, and the server names the line.
 * - An empty field on a named line that holds a product takes the name away:
 *   `{ named: false, content }`, with the name of the product the line shows. While
 *   that name has not loaded, `{ named: false }` alone, and the server keeps the
 *   stored name (the owner's answer of 2026-10-15).
 * - Null for the text the line already has, and for an empty field on a line that
 *   has no product or no name of its own.
 */
export function lineNameChange(
  line: LineNameSource,
  name: LineName,
  typed: string
):
  | { readonly content: string }
  | { readonly named: false; readonly content?: string }
  | null {
  const text = typed.trim();
  if (text !== '') {
    return name.own && text === line.content ? null : { content: text };
  }
  if (!name.own || line.itemIds.length === 0) {
    return null;
  }
  return name.productName === null
    ? { named: false }
    : { named: false, content: name.productName };
}

/**
 * Whether a name field holds something a save may not send: empty, on a line that
 * has no product to be called by.
 */
export function lineNameRefused(line: LineNameSource, typed: string): boolean {
  return typed.trim() === '' && line.itemIds.length === 0;
}

/** The product the line shows (velista `0145`, section 2), or null. */
function shownItemId(
  line: LineNameSource,
  pricesOf: (itemId: string) => LineProductPriceRead
): string | null {
  return (
    lineShownProduct(
      {
        itemIds: line.itemIds,
        favoriteItemId: line.favoriteItemId,
        preferredSupermarketId: line.preferredSupermarketId ?? null,
      },
      pricesOf
    )?.itemId ?? null
  );
}

/** No price read: the favourite when the line holds it, else the first product. */
function noPrices(): LineProductPriceRead {
  return undefined;
}

/** Whether `content` says one of the names of a product, in any language. */
function isNameOf(content: string, name: LocalizedName): boolean {
  const folded = foldName(content);
  if (folded === '') {
    return false;
  }
  return [name.en, name.es].some((each) => {
    const other = foldName(each);
    return other !== '' && other === folded;
  });
}

/** No accents, lower case, one space between words. */
export function foldName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function nonEmpty(value: string): string | null {
  return value.trim() === '' ? null : value;
}
