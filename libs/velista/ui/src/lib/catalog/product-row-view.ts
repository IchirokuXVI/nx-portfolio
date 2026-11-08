import {
  catalogName,
  priceWordsText,
  soldAsOf,
  type CatalogProduct,
  type PriceUnitBasis,
  type PriceWords,
  type ProductOffer,
} from '@portfolio/velista/models';
import { formatMoney } from '@portfolio/velista/platform';
import type { ProductRowChains, ProductRowView } from './product-row';
import { productSizeText } from './product-size';

/** A translator call, so this stays a plain function a spec can run. */
export type CatalogTranslate = (
  key: string,
  args?: Record<string, unknown>
) => string;

/**
 * What a card needs of a product: a browse read's {@link CatalogProduct}, or a
 * suggest read's `CatalogItem`, which also knows its pack.
 */
export type ProductRowSource = Pick<
  CatalogProduct,
  | 'id'
  | 'name'
  | 'brand'
  | 'imageUrl'
  | 'size'
  | 'unit'
  | 'approxWeight'
  | 'offer'
  | 'unitBasis'
> & {
  /** How many units the pack holds, from 2, or null. Only the suggest read has it. */
  readonly packCount?: number | null;
};

export interface ProductRowOptions {
  readonly locale: string;
  readonly translate: CatalogTranslate;
  /**
   * The chain a price scope belongs to, by name, or null when the read did not
   * resolve that scope.
   */
  readonly chainOf: (priceScopeId: string) => string | null;
  /**
   * One chain is chosen, so the chain line is left out: it would name the same
   * chain on every card (velista `0100`, section 3).
   */
  readonly chainChosen: boolean;
  /** Now, for the age of a stale price. A parameter so a spec can fix it. */
  readonly now?: Date;
  /**
   * The chain line, when the caller knows every chain's price (the search). Absent
   * builds it from the one chain of {@link ProductRowSource.offer}.
   */
  readonly chains?: ProductRowChains | null;
  /**
   * Which figure the unit price line prints. `chain`, the default, is the chain's
   * own figure under velista `0101` rule 5. `comparable` is the catalog's derived
   * pair (backend `0245`), for the catalog tab's `unitPrice` order, where that pair
   * is the number that placed the row (backend `0196`).
   */
  readonly unitPriceFigure?: 'chain' | 'comparable';
}

/** How many chain marks the chain line draws before it says `+N`. */
export const CHAIN_MARKS_SHOWN = 3;

/**
 * What one card says (velista `0162`, section 2), decided once, here, for the
 * catalog tab, Choose a product, a product page's similar products and the search.
 *
 * - The name in the reader's language, and `brand · size · pack` under it, where
 *   the size is the approximate weight of a piece whose weight varies.
 * - The chains that sell it, the cheapest named.
 * - The price at the trailing edge, with the price per litre or kilo under it when
 *   it differs, or the age of a stale one. A kilo piece draws its piece price over
 *   its price per kilo (velista `0179`).
 * - `no price` as words when there is none.
 * - The accessible name: the product, the size and the price, in that order,
 *   and for a kilo piece its price per kilo after them.
 */
export function productRowView(
  product: ProductRowSource,
  options: ProductRowOptions
): ProductRowView {
  const { locale, translate } = options;
  const name = catalogName(product.name, locale);
  const size = productSizeText(
    product.size,
    product.unit,
    locale,
    translate,
    product.approxWeight
  );
  const pack =
    product.packCount === null || product.packCount === undefined
      ? null
      : translate('list.add.card.pack', { count: product.packCount });
  const detail = joined([product.brand, size, pack]);

  const offer = product.offer;
  const priced = priceWords(offer, product, locale, translate);
  const price = priced === null ? null : priceWordsText(priced);
  const stale = priced !== null && offer?.stale === true;
  const unitPrice = stale
    ? null
    : options.unitPriceFigure === 'comparable'
      ? comparablePriceWords(offer, priced, locale, translate)
      : unitPriceWords(offer, product, locale, translate);
  // A kilo piece is named with what a kilo costs too, so a screen reader hears
  // the two numbers the card draws (velista `0179`).
  const perKilo =
    priced !== null &&
    unitPrice !== null &&
    soldAsOf(offer, product) === 'KILO_PIECE'
      ? priceWordsText(unitPrice)
      : null;

  const chain =
    price !== null && offer !== null && !options.chainChosen
      ? options.chainOf(offer.priceScopeId)
      : null;
  const chains =
    options.chains !== undefined
      ? options.chains
      : chain === null
        ? null
        : chainLine([{ id: offer?.priceScopeId ?? chain, name: chain }], {
            locale,
            translate,
          });

  // The price as the sheet of what a visit added says it: with the chain's name
  // when one is known and none is chosen.
  const spoken =
    price === null
      ? null
      : chain === null
        ? price
        : translate('catalog.row.priceAt', { price, chain });

  return {
    id: product.id,
    name,
    detail,
    caption: null,
    summary: joined([detail, spoken]),
    imageUrl: product.imageUrl,
    price: priced,
    unitPrice,
    seen: stale ? priceAgeText(offer, options.now ?? new Date(), locale) : null,
    stale,
    chains,
    label: [name, size, price ?? translate('catalog.row.noPrice'), perKilo]
      .filter((part): part is string => part !== null)
      .join(', '),
  };
}

/** One chain on a chain line, by id and name, cheapest first. */
export interface ChainLineEntry {
  readonly id: string;
  readonly name: string;
}

/**
 * The chain line: a mark for each chain (its initial) up to
 * {@link CHAIN_MARKS_SHOWN}, the first and cheapest named, and `+N` for the rest.
 * Null with no chain.
 *
 * The cheapest is the only one written out: it is the one the price belongs to, and
 * naming it is cheaper than a legend. It says where a price came from, not where to
 * go.
 */
export function chainLine(
  chains: readonly ChainLineEntry[],
  options: { readonly locale: string; readonly translate: CatalogTranslate }
): ProductRowChains | null {
  const lead = chains[0];
  if (lead === undefined) {
    return null;
  }
  return {
    lead: lead.name,
    marks: chains.slice(0, CHAIN_MARKS_SHOWN).map((chain) => ({
      id: chain.id,
      initial: initialOf(chain.name),
    })),
    more: Math.max(0, chains.length - CHAIN_MARKS_SHOWN),
    label:
      chains.length === 1
        ? options.translate('list.add.card.soldAt', { chain: lead.name })
        : options.translate('list.add.card.soldAtMany', {
            count: chains.length,
          }),
  };
}

/**
 * The plain price of an offer in the reader's money, or null for an offer with
 * none. For the rows that name no product's kind: a group's members and every
 * chain's price under an opened chain line.
 */
export function priceText(
  offer: ProductOffer | null,
  locale: string
): string | null {
  return offer === null || offer.price === null
    ? null
    : formatMoney(offer.price, offer.currency, locale);
}

/** What a price view needs of a product to know how it is priced. */
export interface PricedProduct {
  readonly unit: string | null;
  readonly size: number | null;
  readonly approxWeight: number | null;
  readonly unitBasis?: PriceUnitBasis | null;
}

/**
 * The headline price of a product (velista `0179`, section 2), or null for an
 * offer with no price.
 *
 * A product that is not known yet (null) is priced by its offer alone
 * ({@link soldAsOf}): a set piece price names a kilo piece, and every other
 * offer is drawn as a pack.
 *
 * - A kilo piece answers the server's piece price, and null when the offer has
 *   none: the row then says `no price`, because velista never derives one.
 * - A product sold by the kilo answers its price with "/ kg" as its `per`.
 * - Every other product answers its price, as a pack does.
 */
export function priceWords(
  offer: Pick<ProductOffer, 'price' | 'currency' | 'piecePrice'> | null,
  product: PricedProduct | null,
  locale: string,
  translate: CatalogTranslate
): PriceWords | null {
  if (offer === null || offer.price === null) {
    return null;
  }
  switch (soldAsOf(offer, product)) {
    case 'KILO_PIECE':
      return offer.piecePrice === null
        ? null
        : {
            amount: formatMoney(offer.piecePrice, offer.currency, locale),
            per: null,
          };
    case 'BY_THE_KILO':
      return {
        amount: formatMoney(offer.price, offer.currency, locale),
        per: translate('catalog.per.KILOGRAM'),
      };
    case 'PACK':
      return {
        amount: formatMoney(offer.price, offer.currency, locale),
        per: null,
      };
  }
}

/**
 * The price per litre or kilo under the headline, or null (velista `0101`, rule 5,
 * and `0179`, section 2).
 *
 * - A kilo piece always answers its price per kilo, also when it equals the piece
 *   price (a piece of exactly a kilo): the headline is a piece, so this line is
 *   what says the price of a kilo.
 * - A product sold by the kilo answers null: its headline already says "/ kg".
 * - Every other product answers the chain's unit price only when it says
 *   something the price does not. Compared in cents, as they are drawn: a one
 *   litre carton priced by the litre and a single unit priced by the unit would
 *   otherwise print one number twice. Null without a basis to name, rather than
 *   guessing one.
 *
 * A product that is not known yet (null) is read by its offer alone, as
 * {@link priceWords} reads it.
 */
export function unitPriceWords(
  offer: ProductOffer | null,
  product: PricedProduct | null,
  locale: string,
  translate: CatalogTranslate
): PriceWords | null {
  if (offer === null || offer.price === null) {
    return null;
  }
  switch (soldAsOf(offer, product)) {
    case 'KILO_PIECE':
      return {
        amount: formatMoney(
          offer.unitPrice ?? offer.price,
          offer.currency,
          locale
        ),
        per: translate('catalog.per.KILOGRAM'),
      };
    case 'BY_THE_KILO':
      return null;
    case 'PACK': {
      const basis = product?.unitBasis ?? null;
      if (offer.unitPrice === null || basis === null) {
        return null;
      }
      if (Math.round(offer.unitPrice * 100) === Math.round(offer.price * 100)) {
        return null;
      }
      return {
        amount: formatMoney(offer.unitPrice, offer.currency, locale),
        per: translate(`catalog.per.${basis}`),
      };
    }
  }
}

/**
 * The catalog's comparable figure with its basis ("13,42 € / kg"), or null when
 * the offer carries no pair or no price (backend `0245`). Printed as the server
 * sent it, never derived here.
 *
 * Left out only when it repeats the headline word for word, as a product sold
 * by the kilo does: its headline already is the price of a kilo.
 */
export function comparablePriceWords(
  offer: ProductOffer | null,
  headline: PriceWords | null,
  locale: string,
  translate: CatalogTranslate
): PriceWords | null {
  if (
    offer === null ||
    offer.price === null ||
    offer.comparablePrice === null ||
    offer.comparableBasis === null
  ) {
    return null;
  }
  const words: PriceWords = {
    amount: formatMoney(offer.comparablePrice, offer.currency, locale),
    per: translate(`catalog.per.${offer.comparableBasis}`),
  };
  return headline !== null &&
    headline.amount === words.amount &&
    headline.per === words.per
    ? null
    : words;
}

/**
 * How long ago a price was seen ("18 days ago"), with `Intl` and never `DatePipe`
 * (the language is runtime state), or null for a price with no date. The server
 * decides what counts as stale; this only says how old.
 */
export function priceAgeText(
  offer: ProductOffer | null,
  now: Date,
  locale: string
): string | null {
  const at = offer?.observedAt ?? null;
  if (at === null) {
    return null;
  }
  const seconds = (at.getTime() - now.getTime()) / 1000;
  const [value, unit]: [number, Intl.RelativeTimeFormatUnit] =
    Math.abs(seconds) >= 86400
      ? [Math.round(seconds / 86400), 'day']
      : Math.abs(seconds) >= 3600
        ? [Math.round(seconds / 3600), 'hour']
        : [Math.round(seconds / 60), 'minute'];
  try {
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(
      value,
      unit
    );
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

function initialOf(name: string): string {
  const first = [...name.trim()][0];
  return first === undefined ? '?' : first.toLocaleUpperCase();
}

function joined(
  parts: readonly (string | null)[],
  separator = ' · '
): string | null {
  const kept = parts.filter(
    (part): part is string => part !== null && part !== ''
  );
  return kept.length === 0 ? null : kept.join(separator);
}
