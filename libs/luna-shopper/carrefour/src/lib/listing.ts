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

import {
  measuresContent,
  packCountOf,
  sourceSizeOf,
  UnitOfMeasure,
  type SourceSize,
  type SourceSizeUnit,
} from '@portfolio/luna-shopper/contracts';
import { priceToCents, unitPriceLabel } from './price';
import type { CarrefourCard, CarrefourProduct } from './types';

/**
 * The units a trailing size may end in, and the family each belongs to.
 *
 * The family is what the card's `measure_unit` is checked against. A `factor`
 * is what one of the unit is in the family's own base unit, and only a weight
 * and a count carry one, because only they are written in that base unit.
 *
 * **A closed list on purpose**, as DEZA's is. The alternative, "a number
 * followed by any short word", reads a till key number or a flavour as a size.
 */
interface CardUnit {
  base: string;
  factor?: number;
}

const UNITS: Readonly<Record<string, CardUnit>> = {
  // Volume. No factor: a volume is written in the unit the name printed, and
  // the one table that converts it is the shared one in contracts, so `cl` is
  // ten millilitres there and nowhere else (plan 0177).
  l: { base: 'l' },
  lt: { base: 'l' },
  litro: { base: 'l' },
  litros: { base: 'l' },
  dl: { base: 'l' },
  cl: { base: 'l' },
  ml: { base: 'l' },
  cc: { base: 'l' },
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
  // Length. No factor: a length is a dimension and states no size at all, so
  // there is nothing to convert (plan 0183).
  m: { base: 'm' },
  cm: { base: 'm' },
  mm: { base: 'm' },
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
  /**
   * The size as a number in {@link sizeUnit}, or null. A length is null too:
   * it is a dimension and not a size (plan 0183).
   */
  unitSize: number | null;
  /**
   * The catalog unit {@link unitSize} is in (plan 0177). A weight is in
   * `KILOGRAM` and a count in `UNIT`, the unit the card measures in. A volume
   * is in the unit the name printed: `LITER` for litres, and `MILLILITER` for
   * `ml`, `cc`, `cl` and `dl`, because the catalog holds no centilitre. Null
   * when there is no size.
   */
  sizeUnit: SourceSizeUnit | null;
  /** How many units the pack holds, or null (plan 0162). See {@link packCountIn}. */
  packCount: number | null;
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
    return unsized(trimmed);
  }

  const unit = UNITS[match[6].toLowerCase()];
  const expected = MEASURE_BASE[(measureUnit ?? '').trim().toLowerCase()];
  // The check the plan asks for. An unknown word is not a unit, and a unit from
  // another family is a coincidence: `Café molido 500 g` is a size when the
  // card measures in `kg` and a misread when it measures in `ud`.
  if (!unit || (expected && unit.base !== expected)) {
    return unsized(trimmed);
  }

  const start = match.index + match[1].length;
  const name = trimmed.slice(0, start).trim();
  // A name that is nothing but a size keeps the whole name: an empty name is
  // not a product, and the key it would build joins nothing.
  if (!name) {
    return unsized(trimmed);
  }

  // Either shape of the pack phrase states the count, and only one of them
  // matched, so the first that is set is the one this name used.
  //
  // A length is a dimension and not a size (plan 0183): `30 m.` is how long
  // the roll is, and the catalog has no unit to hold it in. The printed text
  // still moves across, because it is half of the row's key.
  const size = statedSize(
    unit,
    match[6],
    quantityOf(match[3] ?? match[4], match[5])
  );
  return {
    name,
    // Verbatim, trailing full stop and all, because that is what the chain
    // printed and the matcher is the thing allowed to normalize it.
    sizeFormat: trimmed.slice(start).trim(),
    unitSize: size.unitSize,
    sizeUnit: size.sizeUnit,
    packCount: packCountIn(match[3] ?? match[4], match[5], match[6]),
  };
}

/**
 * The number a size states and the catalog unit it is in (plan 0177).
 *
 * **A volume is written in the unit the name printed**, through the one
 * conversion every adapter shares: `1,5 l.` is 1.5 `LITER`, `200 ml` is 200
 * `MILLILITER`, and `33 cl.` is 330 `MILLILITER`, because the catalog holds no
 * centilitre. It used to be 0.33 `LITER`, the same bottle in a unit no other
 * source writes it in.
 *
 * A weight and a count stay in the unit the card measures in: `500 g` is 0.5
 * `KILOGRAM`.
 *
 * **The check against `measure_unit` is about the family and not the number**,
 * so it does not move: {@link splitCardName} has already refused a word from
 * another family before this runs. Comparing a volume with the card's price
 * per litre is still one step, because `sizeUnit` says which of the two units
 * the number is in.
 */
function statedSize(
  unit: CardUnit,
  word: string,
  quantity: number | null
): SourceSize {
  const none: SourceSize = { unitSize: null, sizeUnit: null };
  if (quantity === null || BASE_UNIT[unit.base] === undefined) {
    return none;
  }
  if (unit.base === 'l') {
    const size = sourceSizeOf(quantity, word);
    return size.sizeUnit === null ? none : size;
  }
  if (unit.factor === undefined) {
    return none;
  }
  // Four decimals is what `source_catalog_entries.unitSize` stores, so rounding
  // here is the same rounding the column would do, done where it can be read.
  return {
    unitSize: Math.round(quantity * unit.factor * 10000) / 10000,
    sizeUnit: BASE_UNIT[unit.base],
  };
}

/** A name that states no size keeps the whole of itself. */
function unsized(name: string): SplitCardName {
  return {
    name,
    sizeFormat: null,
    unitSize: null,
    sizeUnit: null,
    packCount: null,
  };
}

/**
 * The catalog unit each family's base is (plan 0177). Metres have none, so a
 * length states no size at all (plan 0183).
 */
const BASE_UNIT: Readonly<Record<string, SourceSizeUnit>> = {
  l: UnitOfMeasure.LITER,
  kg: UnitOfMeasure.KILOGRAM,
  ud: UnitOfMeasure.UNIT,
};

/** One count times one quantity, `3x200` or `4 x 1,5`, and nothing else. */
const COUNT_TIMES_QUANTITY = /^(\d+)\s*x\s*\d+(?:[.,]\d+)?$/i;

/**
 * How many units the pack holds (plan 0162, section 1).
 *
 * Two places state it, and both are parts of the size this file already
 * splits off: the count of the pack phrase, `pack de 9 unidades de 1 l.` or
 * `4 sobres de 100 g.`, and the `N` of a quantity printed as `NxQ`, `3x200 ml`.
 * A name that states both is null, because the chain then prints a pack of
 * packs and neither number alone is the count. A bonus pack, `28+16 lavados`,
 * is null too: it is a sum and not a count. Proved by the names in
 * `listing.spec.ts`, which are real names from the crawl.
 *
 * **The `N` of `NxQ` is a count only when the unit measures what is inside**
 * (plan 0183): a weight, a volume or a count. `6x33 cl` is six cans. `140x200
 * cm` is the two sides of one sheet, so a length states no pack. The pack
 * phrase is not touched by that: `pack de 2 rollos de 30 m.` names two rolls
 * in words.
 */
function packCountIn(
  phraseCount: string | undefined,
  quantity: string,
  word: string
): number | null {
  const multiplied = measuresContent(word)
    ? COUNT_TIMES_QUANTITY.exec(quantity.trim())
    : null;
  if (phraseCount !== undefined) {
    return multiplied ? null : packCountOf(phraseCount);
  }
  return multiplied ? packCountOf(multiplied[1]) : null;
}

/**
 * The quantity as a number in the unit the name printed, or null when it
 * cannot be stated without inventing.
 *
 * A plain quantity is read, and a pack multiplies its count by it. A quantity
 * joined by `x` or `+` is **not**: `3x187` is three of something and `28+16`
 * is a bonus pack, the chain prints both for the same field, and guessing which
 * arithmetic it meant writes a number nobody checked.
 */
function quantityOf(
  packCount: string | undefined,
  quantity: string
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
  return pack * value;
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
    sizeUnit: split.sizeUnit,
    packCount: split.packCount,
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
