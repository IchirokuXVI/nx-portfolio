/**
 * A listing page's cards, read into the rows a run writes (plan 0090, sections
 * 6 and 12).
 *
 * Two things happen here and both have a rule behind them.
 *
 * **The size comes out of the name.** Carrefour prints it inside the name,
 * `Agua mineral Bezoya 1,5 l.`, and the catalog's own merge rules say a product
 * name holds neither the brand nor the size. So the trailing size is split off
 * and stored verbatim beside the name, exactly as the DEZA adapter does (plan
 * 0085, section 7), and for the same reason: a leaflet states the name and the
 * format in two fields, so a crawl that left them joined could never meet one.
 *
 * **The split is checked and not guessed.** The card states `measure_unit`, so
 * the unit read out of the name has to belong to the same family as the unit
 * the chain says the comparison price is per. A name whose trailing word fails
 * that check states no size and keeps its whole name, which is the honest
 * answer: a missing size is a weaker key, an invented one is a wrong key.
 */

import { priceToCents, unitPriceLabel } from './price';
import type { CarrefourCard, CarrefourProduct } from './types';

/**
 * The units a trailing size may end in, and what one of them is in the family's
 * own base unit.
 *
 * **A closed list on purpose**, as DEZA's is. The alternative, "a number
 * followed by any short word", reads a till key number or a flavour as a size.
 */
const UNITS: Readonly<Record<string, { base: string; factor: number }>> = {
  // Volume, in litres.
  l: { base: 'l', factor: 1 },
  lt: { base: 'l', factor: 1 },
  litro: { base: 'l', factor: 1 },
  litros: { base: 'l', factor: 1 },
  dl: { base: 'l', factor: 0.1 },
  cl: { base: 'l', factor: 0.01 },
  ml: { base: 'l', factor: 0.001 },
  cc: { base: 'l', factor: 0.001 },
  // Weight, in kilograms.
  kg: { base: 'kg', factor: 1 },
  kgs: { base: 'kg', factor: 1 },
  kilo: { base: 'kg', factor: 1 },
  kilos: { base: 'kg', factor: 1 },
  g: { base: 'kg', factor: 0.001 },
  gr: { base: 'kg', factor: 0.001 },
  grs: { base: 'kg', factor: 0.001 },
  gramos: { base: 'kg', factor: 0.001 },
  mg: { base: 'kg', factor: 0.000001 },
  // Count, in units. The chain counts a household product in what it holds, so
  // `lavados` and `rollos` are units here exactly as `ud` is, and the card
  // measuring in `ud` is what says so.
  ud: { base: 'ud', factor: 1 },
  uds: { base: 'ud', factor: 1 },
  unidad: { base: 'ud', factor: 1 },
  unidades: { base: 'ud', factor: 1 },
  lavado: { base: 'ud', factor: 1 },
  lavados: { base: 'ud', factor: 1 },
  rollo: { base: 'ud', factor: 1 },
  rollos: { base: 'ud', factor: 1 },
  sobre: { base: 'ud', factor: 1 },
  sobres: { base: 'ud', factor: 1 },
  bolsa: { base: 'ud', factor: 1 },
  bolsas: { base: 'ud', factor: 1 },
  capsula: { base: 'ud', factor: 1 },
  capsulas: { base: 'ud', factor: 1 },
  cápsula: { base: 'ud', factor: 1 },
  cápsulas: { base: 'ud', factor: 1 },
  dosis: { base: 'ud', factor: 1 },
  pastilla: { base: 'ud', factor: 1 },
  pastillas: { base: 'ud', factor: 1 },
  racion: { base: 'ud', factor: 1 },
  raciones: { base: 'ud', factor: 1 },
  // Length, in metres.
  m: { base: 'm', factor: 1 },
  cm: { base: 'm', factor: 0.01 },
  mm: { base: 'm', factor: 0.001 },
};

/** A quantity: one number, or several joined by `x` or `+`. */
const QUANTITY = String.raw`\d+(?:[.,]\d+)?(?:\s*[x+]\s*\d+(?:[.,]\d+)?)*`;

/**
 * What the chain calls the thing it packs a product in.
 *
 * **A closed list, like the units.** The phrase this appears in is `<count>
 * <container> de <size>`, and accepting any word there would eat the last word
 * of a product name whenever the name happened to end in `de`.
 */
const CONTAINER = String.raw`(?:caja|cajas|lata|latas|bote|botes|botella|botellas|brick|bricks|estuche|estuches|tarrina|tarrinas|bandeja|bandejas|bolsa|bolsas|sobre|sobres|unidad|unidades|ud|uds|pieza|piezas|base|bases|pack|packs|vaso|vasos|tarro|tarros|barra|barras|rollo|rollos|blister|blisters)`;

/**
 * How the chain writes a multi pack inside the name.
 *
 * It is part of the size and not part of the name, so the whole phrase moves
 * across. Splitting it in the middle would leave `Leche entera CARREFOUR pack
 * de 9 unidades de` as a product name, and a broken name is worse than a
 * missing size: the name is the key a product with no EAN is matched on.
 *
 * **Measured against the whole crawl, not guessed.** The first full run left
 * 421 of 15,444 names ending in a dangling `de`, because only `pack de N
 * unidades de` was accepted. The chain also writes `pack de 8 latas de`, `pack
 * 6 unidades de`, `pack 6 de`, `caja de` and `4 sobres de`, so there are two
 * shapes here: after the word `pack` the counted noun can be anything, and
 * without it the noun has to be one the chain packs things in.
 */
const PACK = String.raw`(?:(?:pack\s+(?:de\s+)?(\d+)(?:\s+[A-Za-zÀ-ÿ]{2,12})?|(\d+)?\s*${CONTAINER})\s+de\s+)?`;

/**
 * An optional pack phrase, a quantity, one word, and an optional `aprox`.
 *
 * `aprox` is the chain saying the weight varies, which 503 names do. It belongs
 * with the size it qualifies rather than left on the end of a product name.
 */
const TRAILING_SIZE = new RegExp(
  String.raw`(^|\s)(${PACK}(${QUANTITY})\s*([A-Za-zÀ-ſ]{1,10})\.?(?:\s+aprox)?)\.*\s*$`,
  'i'
);

/** What `measure_unit` means in the {@link UNITS} families. */
const MEASURE_BASE: Readonly<Record<string, string>> = {
  l: 'l',
  kg: 'kg',
  ud: 'ud',
  m: 'm',
};

export interface SplitCardName {
  /** The name with its trailing size removed. Never empty. */
  name: string;
  /** The trailing size, exactly as printed, or null. */
  sizeFormat: string | null;
  /** The size as a number in the card's `measure_unit`, or null. */
  unitSize: number | null;
}

/**
 * Split `Agua mineral Bezoya 1,5 l.` into `Agua mineral Bezoya` and `1,5 l.`.
 *
 * Only the **last** size is taken, because that is where the chain puts the one
 * that describes the package.
 *
 * **`sell_pack_unit` is deliberately not read here.** It is how many the
 * shopper has to buy at once, six bottles of water, and it is not part of one
 * product's size: the card that says `1,5 l.` with `sell_pack_unit` 6 prices
 * one bottle, and folding the six in would make every unit price six times
 * wrong.
 */
export function splitCardName(
  printed: string,
  measureUnit: string | null | undefined
): SplitCardName {
  const trimmed = printed.replace(/\s+/g, ' ').trim();
  const match = TRAILING_SIZE.exec(trimmed);
  if (!match) {
    return { name: trimmed, sizeFormat: null, unitSize: null };
  }

  const unit = UNITS[match[6].toLowerCase()];
  const expected = MEASURE_BASE[(measureUnit ?? '').trim().toLowerCase()];
  // The check the plan asks for. An unknown word is not a unit, and a unit from
  // another family is a coincidence: `Café molido 500 g` is a size when the
  // card measures in `kg` and a misread when it measures in `ud`.
  if (!unit || (expected && unit.base !== expected)) {
    return { name: trimmed, sizeFormat: null, unitSize: null };
  }

  const start = match.index + match[1].length;
  const name = trimmed.slice(0, start).trim();
  // A name that is nothing but a size keeps the whole name: an empty name is
  // not a product, and the key it would build joins nothing.
  if (!name) {
    return { name: trimmed, sizeFormat: null, unitSize: null };
  }

  return {
    name,
    // Verbatim, trailing full stop and all, because that is what the chain
    // printed and the matcher is the thing allowed to normalize it.
    sizeFormat: trimmed.slice(start).trim(),
    // Either shape of the pack phrase states the count, and only one of them
    // matched, so the first that is set is the one this name used.
    unitSize: sizeAsNumber(match[3] ?? match[4], match[5], unit.factor),
  };
}

/**
 * The size as a number, or null when it cannot be stated without inventing.
 *
 * A plain quantity converts, and a pack multiplies its count by it. A quantity
 * joined by `x` or `+` does **not**: `3x187` is three of something and `28+16`
 * is a bonus pack, the chain prints both for the same field, and guessing which
 * arithmetic it meant writes a number nobody checked.
 */
function sizeAsNumber(
  packCount: string | undefined,
  quantity: string,
  factor: number
): number | null {
  if (/[x+]/i.test(quantity)) {
    return null;
  }
  const value = Number(quantity.replace(',', '.'));
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  const pack = packCount ? Number(packCount) : 1;
  if (!Number.isFinite(pack) || pack <= 0) {
    return null;
  }
  // Four decimals is what `source_catalog_entries.unitSize` stores, so rounding
  // here is the same rounding the column would do, done where it can be read.
  return Math.round(pack * value * factor * 10000) / 10000;
}

/**
 * One card, read.
 *
 * `app_price` was equal to `price` on every card measured, and this reads
 * `price` regardless: it is the figure the storefront shows a web shopper, so
 * it is the one a web shopper is charged (plan 0090, section 6).
 */
export function readCard(
  card: CarrefourCard,
  categoryPath: string[]
): CarrefourProduct {
  const measureUnit = card.measure_unit?.trim() || null;
  const split = splitCardName(card.name, measureUnit);
  return {
    externalId: card.product_id,
    skuId: card.sku_id ?? null,
    name: split.name,
    sizeFormat: split.sizeFormat,
    unitSize: split.unitSize,
    brand: card.brand?.trim() || null,
    priceCents: priceToCents(card.price),
    unitPriceCents: priceToCents(card.price_per_unit),
    unitPriceLabel: unitPriceLabel(measureUnit),
    measureUnit,
    path: card.url ?? null,
    categoryPath,
  };
}

/** Every card of one page, read. */
export function readCards(
  cards: readonly CarrefourCard[],
  categoryPath: string[]
): CarrefourProduct[] {
  return cards.map((card) => readCard(card, categoryPath));
}
