import {
  catalogName,
  type CatalogProduct,
  type PriceUnitBasis,
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
  'id' | 'name' | 'brand' | 'imageUrl' | 'size' | 'unit' | 'offer' | 'unitBasis'
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
}

/** How many chain marks the chain line draws before it says `+N`. */
export const CHAIN_MARKS_SHOWN = 3;

/**
 * What one card says (velista `0162`, section 2), decided once, here, for the
 * catalog tab, Choose a product, a product page's similar products and the search.
 *
 * - The name in the reader's language, and `brand · size · pack` under it.
 * - The chains that sell it, the cheapest named.
 * - The price at the trailing edge, with the price per litre or kilo under it when
 *   it differs, or the age of a stale one.
 * - `no price` as words when there is none.
 * - The accessible name: the product, the size and the price, in that order.
 */
export function productRowView(
  product: ProductRowSource,
  options: ProductRowOptions
): ProductRowView {
  const { locale, translate } = options;
  const name = catalogName(product.name, locale);
  const size = productSizeText(product.size, product.unit, locale, translate);
  const pack =
    product.packCount === null || product.packCount === undefined
      ? null
      : translate('list.add.card.pack', { count: product.packCount });
  const detail = joined([product.brand, size, pack]);

  const offer = product.offer;
  const price = priceText(offer, locale);
  const stale = price !== null && offer?.stale === true;

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
  const priceWords =
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
    summary: joined([detail, priceWords]),
    imageUrl: product.imageUrl,
    price,
    unitPrice: stale
      ? null
      : unitPriceText(offer, product.unitBasis, locale, translate),
    seen: stale ? priceAgeText(offer, options.now ?? new Date(), locale) : null,
    stale,
    chains,
    label: [name, size, price ?? translate('catalog.row.noPrice')]
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

/** A price in the reader's money, or null for an offer with none. */
export function priceText(
  offer: ProductOffer | null,
  locale: string
): string | null {
  return offer === null || offer.price === null
    ? null
    : formatMoney(offer.price, offer.currency, locale);
}

/**
 * The price per litre or kilo, only when it says something the price does not
 * (velista `0101`, rule 5).
 *
 * Compared in cents, as they are drawn: a one litre carton priced by the litre
 * and a single unit priced by the unit would otherwise print one number twice.
 * Null without a basis to name, rather than guessing one.
 */
export function unitPriceText(
  offer: ProductOffer | null,
  unitBasis: PriceUnitBasis | null,
  locale: string,
  translate: CatalogTranslate
): string | null {
  if (
    offer === null ||
    offer.price === null ||
    offer.unitPrice === null ||
    unitBasis === null
  ) {
    return null;
  }
  if (Math.round(offer.unitPrice * 100) === Math.round(offer.price * 100)) {
    return null;
  }
  return translate(`catalog.unit.${unitBasis}`, {
    price: formatMoney(offer.unitPrice, offer.currency, locale),
  });
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
