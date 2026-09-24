import {
  inLocale,
  type CatalogItem,
  type CatalogSuggestion,
  type ChainPrice,
  type ProductOffer,
  type UnitOfMeasure,
} from '@portfolio/velista/models';
import { formatMoney } from '@portfolio/velista/platform';

/** A translator call, so this stays a plain function a spec can run. */
export type SuggestionTranslate = (
  key: string,
  args?: Record<string, unknown>
) => string;

export interface SuggestionCardOptions {
  readonly locale: string;
  readonly translate: SuggestionTranslate;
  /** Now, for the age of a stale price. A parameter so a spec can fix it. */
  readonly now: Date;
}

/** One chain's mark on the collapsed row: its initial, in the app's own colours. */
export interface ChainMarkView {
  readonly id: string;
  readonly initial: string;
}

/** The collapsed chain row: who sells it, the cheapest named first. */
export interface ChainRowView {
  /** The cheapest chain's name, the only one written out (rule 6 of `0101`). */
  readonly lead: string;
  /** At most three marks, the lead's first. */
  readonly marks: readonly ChainMarkView[];
  /** How many chains the marks leave out, drawn as `+2`, or zero. */
  readonly more: number;
  /** "Sold at Mercadona. Show every shop price", for the button. */
  readonly label: string;
}

/** One chain's price once the row is opened (the `Expanded` artboard). */
export interface ShopPriceView {
  readonly id: string;
  readonly name: string;
  /** Null for a chain that carries the product with no price on it. */
  readonly price: string | null;
  /** "seen 12 days ago" when the server marked this price stale, else null. */
  readonly note: string | null;
  /** The cheapest, which carries the number at the top of the card. */
  readonly best: boolean;
}

/** One product inside an opened group (the `Group` artboard). */
export interface GroupMemberView {
  readonly id: string;
  readonly name: string;
  readonly brand: string | null;
  readonly price: string | null;
}

/**
 * What one card says (velista `0101`), decided once, here.
 *
 * Pure, and the reason it is: every rule the canvas settles about what a card
 * reads is in this function, so a spec can run each of them without a DOM, and
 * the template only places what this decided.
 */
export interface SuggestionCardView {
  /** Stable across keystrokes for the same product, so an opened card stays open. */
  readonly key: string;
  readonly suggestion: CatalogSuggestion;
  readonly group: boolean;
  readonly name: string;
  /** "Pack 6", or null for a product that is not a pack (backend `0162`). */
  readonly pack: string | null;
  /** The item's price, or a group's labelled floor, "from 0,89 €". */
  readonly price: string | null;
  /** Quoted because nothing better exists: drawn muted, with a clock. */
  readonly stale: boolean;
  /** "Hacendado · 1 L" for an item, "One line, cheapest of 6 at the shop" for a group. */
  readonly meta: string | null;
  /**
   * The second line's trailing figure: how long ago a stale price was seen, or
   * the price per unit when it **differs** from the price (rule 5). Null
   * otherwise, so a one litre carton priced by the litre prints one number.
   */
  readonly aside: string | null;
  /** Null for a group, and for a product no chain could be named for. */
  readonly chains: ChainRowView | null;
  /** Every chain's price, cheapest first. Empty when {@link chains} is null. */
  readonly shops: readonly ShopPriceView[];
  /** A group's cheapest five, and nothing on an item. */
  readonly members: readonly GroupMemberView[];
  /** "6 products", the reveal's own words, or null for an item. */
  readonly reveal: string | null;
  /** "and 1 more" under the five, or null when the five are all of them. */
  readonly membersMore: string | null;
  /** The product the "Details" link opens, or null for a group. */
  readonly productId: string | null;
  /** The add button's accessible name: the product, its brand and its size. */
  readonly pickLabel: string;
  /** Whether the card has a foot row at all (rule: no price, no foot). */
  readonly foot: boolean;
}

/** How many chain marks the collapsed row draws before it says `+N`. */
export const CHAIN_MARKS_SHOWN = 3;

export function suggestionCardView(
  suggestion: CatalogSuggestion,
  options: SuggestionCardOptions
): SuggestionCardView {
  return suggestion.kind === 'group'
    ? groupView(suggestion, options)
    : itemView(suggestion, suggestion.item, options);
}

function itemView(
  suggestion: CatalogSuggestion,
  item: CatalogItem,
  options: SuggestionCardOptions
): SuggestionCardView {
  const { locale, translate } = options;
  const name = inLocale(item.name, locale);
  const size = sizeText(item.size, item.unit, options);
  const meta = joined([item.brand, size]);
  const offer = item.offer;
  const price = priceText(offer, locale);
  const stale = price !== null && offer?.stale === true;
  const pack =
    item.packCount === null
      ? null
      : translate('list.add.card.pack', { count: item.packCount });

  const chains = chainRow(item.chainPrices, options);

  return {
    key: `item:${item.id}`,
    suggestion,
    group: false,
    name,
    pack,
    price,
    stale,
    meta,
    aside: stale ? seenText(offer, options) : unitPriceText(item, locale, translate),
    chains,
    shops:
      chains === null
        ? []
        : item.chainPrices.map((row, index) => shopView(row, index, options)),
    members: [],
    reveal: null,
    membersMore: null,
    productId: item.id,
    pickLabel: translate('list.add.card.add', {
      name: joined([name, item.brand, pack, size], ', ') ?? name,
    }),
    // A product with no price anywhere says nothing about price and draws no
    // foot, so the card falls back to the height of its own photograph (`Edge`).
    foot: price !== null || chains !== null,
  };
}

function groupView(
  suggestion: Extract<CatalogSuggestion, { kind: 'group' }>,
  options: SuggestionCardOptions
): SuggestionCardView {
  const { locale, translate } = options;
  const name = inLocale(suggestion.group.name, locale);
  const count = suggestion.itemIds.length;
  const floor = priceText(suggestion.offer, locale);
  const members = suggestion.members.map((member) => ({
    id: member.id,
    name: inLocale(member.name, locale),
    brand: member.brand,
    price: priceText(member.offer, locale),
  }));
  const rest = count - members.length;

  return {
    key: `group:${suggestion.group.id}`,
    suggestion,
    group: true,
    name,
    pack: null,
    // Labelled, because it is the cheapest of several and not the price of a
    // thing (rule 4). "from 0,89 €".
    price:
      floor === null ? null : translate('list.add.card.from', { price: floor }),
    stale: floor !== null && suggestion.offer?.stale === true,
    meta: count > 0 ? translate('list.add.card.groupLine', { count }) : null,
    aside: null,
    chains: null,
    shops: [],
    members,
    reveal:
      members.length > 0
        ? translate('list.add.card.groupProducts', { count })
        : null,
    membersMore:
      rest > 0 && members.length > 0
        ? translate('list.add.card.groupMore', { count: rest })
        : null,
    productId: null,
    pickLabel: translate('list.add.card.add', { name }),
    foot: members.length > 0,
  };
}

/**
 * The collapsed chain row, or null when no chain could be named.
 *
 * Only the cheapest is written out (rule 6). It is the one the price above it
 * belongs to, and naming it is cheaper than a legend. It is where a price came
 * from, not advice about where to go (`0063` section 6.5's second reason).
 */
function chainRow(
  prices: readonly ChainPrice[],
  options: SuggestionCardOptions
): ChainRowView | null {
  const lead = prices[0];
  if (lead === undefined) {
    return null;
  }

  const leadName = inLocale(lead.chain.name, options.locale);
  return {
    lead: leadName,
    marks: prices.slice(0, CHAIN_MARKS_SHOWN).map((row) => ({
      id: row.chain.id,
      initial: initialOf(inLocale(row.chain.name, options.locale)),
    })),
    more: Math.max(0, prices.length - CHAIN_MARKS_SHOWN),
    label:
      prices.length === 1
        ? options.translate('list.add.card.soldAt', { chain: leadName })
        : options.translate('list.add.card.soldAtMany', {
            count: prices.length,
          }),
  };
}

function shopView(
  row: ChainPrice,
  index: number,
  options: SuggestionCardOptions
): ShopPriceView {
  return {
    id: row.chain.id,
    name: inLocale(row.chain.name, options.locale),
    price: priceText(row.offer, options.locale),
    note: row.offer.stale ? seenText(row.offer, options) : null,
    // The mapper sorted them, so the first is the cheapest whenever it has a price.
    best: index === 0 && row.offer.price !== null,
  };
}

function priceText(offer: ProductOffer | null, locale: string): string | null {
  return offer === null || offer.price === null
    ? null
    : formatMoney(offer.price, offer.currency, locale);
}

/**
 * The price per unit, only when it says something the price does not (rule 5).
 *
 * Compared in cents, as they are drawn: a one litre carton priced by the litre
 * and a single unit priced by the unit would otherwise print one number twice.
 */
function unitPriceText(
  item: CatalogItem,
  locale: string,
  translate: SuggestionTranslate
): string | null {
  const offer = item.offer;
  if (
    offer === null ||
    offer.price === null ||
    offer.unitPrice === null ||
    item.unitBasis === null
  ) {
    return null;
  }
  if (Math.round(offer.unitPrice * 100) === Math.round(offer.price * 100)) {
    return null;
  }
  return translate(`catalog.unit.${item.unitBasis}`, {
    price: formatMoney(offer.unitPrice, offer.currency, locale),
  });
}

/**
 * "seen 12 days ago", with `Intl` and never `DatePipe` (the language is runtime
 * state). The server decides what counts as stale; this only says how old.
 */
function seenText(
  offer: ProductOffer | null,
  options: SuggestionCardOptions
): string | null {
  const at = offer?.observedAt ?? null;
  if (at === null) {
    return null;
  }
  const seconds = (at.getTime() - options.now.getTime()) / 1000;
  const [value, unit]: [number, Intl.RelativeTimeFormatUnit] =
    Math.abs(seconds) >= 86400
      ? [Math.round(seconds / 86400), 'day']
      : Math.abs(seconds) >= 3600
        ? [Math.round(seconds / 3600), 'hour']
        : [Math.round(seconds / 60), 'minute'];
  let when: string;
  try {
    when = new Intl.RelativeTimeFormat(options.locale, {
      numeric: 'auto',
    }).format(value, unit);
  } catch {
    when = at.toISOString().slice(0, 10);
  }
  return options.translate('list.add.card.seen', { when });
}

/**
 * How big the packet is, or null when there is nothing worth saying: the rule
 * `SuggestionList.sizeOf` states at length, where a count of one is what every
 * product is and says nothing.
 */
function sizeText(
  size: number | null,
  unit: UnitOfMeasure,
  options: SuggestionCardOptions
): string | null {
  if (size === null || size <= 0) {
    return null;
  }
  if ((unit === 'UNIT' || unit === 'PACK') && size < 2) {
    return null;
  }

  let number: string;
  try {
    number = new Intl.NumberFormat(options.locale, {
      maximumFractionDigits: 3,
    }).format(size);
  } catch {
    number = String(size);
  }
  return options.translate(`list.add.size.${unit}`, { size: number });
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
