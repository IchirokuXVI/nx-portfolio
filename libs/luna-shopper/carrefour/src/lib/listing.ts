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
 * the unit read out of the name has to be one the chain could have meant for
 * the unit the comparison price is per. A name whose trailing word fails that
 * check states no size and keeps its whole name, which is the honest answer: a
 * missing size is a weaker key, an invented one is a wrong key. See
 * {@link ACCEPTED_FAMILIES} for which pairs pass (plan 0250, section 2.3).
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
 *
 * **A third shape has no `de` at all** (plan 0250, section 2.2): `pack 28 latas
 * 33 cl.`. 193 names of the crawl of 2026-11-06 kept `pack 28 latas` in the
 * name and read one can. Without the `de` the noun is what ends the phrase, so
 * it has to be one of {@link CONTAINER}, as in the second shape.
 *
 * **The third shape never opens a name.** It matches only after a word, the
 * `(?<=\S\s)` in front of it. `Pack 6 latas 33 cl.` would otherwise move the
 * whole name across, leave it empty, and lose the size with it. Read without
 * the shape, it keeps what it read before plan 0250: name `Pack 6 latas`, one
 * can of 330 ml.
 *
 * The three counts are named groups because only one of them is set: `pack`
 * counts the first shape, `box` the second and `bare` the third.
 */
const PACK = String.raw`(?:(?:pack\s+(?:de\s+)?(?<pack>\d+)(?:\s+[A-Za-zÀ-ÿ]{2,12})?|(?<box>\d+)?\s*${CONTAINER})\s+de\s+|(?<=\S\s)pack\s+(?<bare>\d+)\s+${CONTAINER}\s+)?`;

/**
 * An optional pack phrase, a quantity, one word, and an optional `aprox`.
 *
 * `aprox` is the chain saying the weight varies, which 503 names do. It belongs
 * with the size it qualifies rather than left on the end of a product name.
 */
const TRAILING_SIZE = new RegExp(
  String.raw`(?<lead>^|\s)(?<size>${PACK}(?<quantity>${QUANTITY})\s*(?<word>[A-Za-zÀ-ſ]{1,10})\.?(?:\s+aprox)?)\.*\s*$`,
  'i'
);

/** What `measure_unit` means in the {@link UNITS} families. */
const MEASURE_BASE: Readonly<Record<string, string>> = {
  l: 'l',
  kg: 'kg',
  ud: 'ud',
  m: 'm',
};

/**
 * The families of a trailing word a card is read with, by the family of its
 * `measure_unit` (plan 0250, section 2.3).
 *
 * Its own family always passes. Two more pairs do, each a decision of the
 * owner on the crawl of 2026-11-06:
 *
 * - **A weight or a volume on a card priced per unit** (D2). `Vino tinto 75
 *   cl.` priced in `€/ud` is one bottle of 75 cl, and 901 rows of that crawl
 *   were bottles, jars and tins priced per piece that lost their size to the
 *   check. The misread the check was written for, a weight that is not the
 *   content of the unit, is what plan 0249 catches by comparing the size with
 *   the price per unit.
 * - **A volume on a card priced per kilogram** (D1). 82 rows, mostly ice
 *   cream, print the `ml` the tub holds and compare per kilogram. The volume
 *   is what the tub holds, and the comparison price stays verbatim beside it.
 *
 * Every other pair is still refused: a weight on a card priced per litre, a
 * count on a card priced per kilogram, anything on a card priced per metre.
 */
const ACCEPTED_FAMILIES: Readonly<Record<string, readonly string[]>> = {
  l: ['l'],
  kg: ['kg', 'l'],
  ud: ['ud', 'kg', 'l'],
  m: ['m'],
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
   * The catalog unit {@link unitSize} is in (plan 0177). It is the family of
   * the trailing word, whatever the card measures in: a weight is in
   * `KILOGRAM` and a count in `UNIT`, so `500 g` on a card priced per unit is
   * 0.5 `KILOGRAM`. A volume is in the unit the name printed: `LITER` for litres, and
   * `MILLILITER` for `ml`, `cc`, `cl` and `dl`, because the catalog holds
   * no centilitre. Null when there is no size.
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

  const groups = match.groups as unknown as TrailingSizeGroups;
  const unit = UNITS[groups.word.toLowerCase()];
  const expected = MEASURE_BASE[(measureUnit ?? '').trim().toLowerCase()];
  // The check plan 0090 asks for. An unknown word is not a unit, and a unit
  // from a family the card cannot mean is a coincidence: `500 g` is a misread
  // on a card priced per litre (plan 0250, section 2.3).
  if (!unit || (expected && !ACCEPTED_FAMILIES[expected].includes(unit.base))) {
    return unsized(trimmed);
  }

  let start = match.index + groups.lead.length;
  // A number before a container is a count only within the bounds of a count
  // (plan 0250, section 2.1). `Polvorones de almendra artesanos 1880 estuche
  // de 310 g.` printed its brand there, and multiplying by it wrote 582.8 kg.
  // A number that is no count stays in the name, and the container phrase
  // moves across whole, so the name never ends in a dangling `de`.
  let box = groups.box;
  if (box !== undefined && !isCount(box)) {
    start += /^\d+\s*/.exec(trimmed.slice(start))?.[0].length ?? 0;
    box = undefined;
  }
  // At most one of the three shapes matched, so this is the count it stated.
  const phraseCount = groups.pack ?? box ?? groups.bare;
  const name = trimmed.slice(0, start).trim();
  // A name that is nothing but a size keeps the whole name: an empty name is
  // not a product, and the key it would build joins nothing.
  if (!name) {
    return unsized(trimmed);
  }

  // A length is a dimension and not a size (plan 0183): `30 m.` is how long
  // the roll is, and the catalog has no unit to hold it in. The printed text
  // still moves across, because it is half of the row's key.
  const size = statedSize(
    unit,
    groups.word,
    quantityOf(phraseCount, groups.quantity)
  );
  return {
    name,
    // Verbatim, trailing full stop and all, because that is what the chain
    // printed and the matcher is the thing allowed to normalize it.
    sizeFormat: trimmed.slice(start).trim(),
    unitSize: size.unitSize,
    sizeUnit: size.sizeUnit,
    packCount: packCountIn(phraseCount, groups.quantity, groups.word),
  };
}

/** The named groups of {@link TRAILING_SIZE}. */
interface TrailingSizeGroups {
  lead: string;
  size: string;
  pack?: string;
  box?: string;
  bare?: string;
  quantity: string;
  word: string;
}

/**
 * Whether a number printed as a count may be multiplied into a size (plan
 * 0250, section 2.1): any count {@link packCountOf} accepts, and 1, which
 * multiplies to the same size and is printed as `pack de 1 unidades de`.
 */
function isCount(printed: string): boolean {
  return printed.trim() === '1' || packCountOf(printed) !== null;
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
 * A weight is in `KILOGRAM` and a count in `UNIT`, whatever the card measures
 * in: `500 g` is 0.5 `KILOGRAM`, also on a card priced per unit.
 *
 * **The check against `measure_unit` is about the family and not the number**,
 * so it does not move: {@link splitCardName} has already refused a word from a
 * family the card cannot mean before this runs. `sizeUnit` says which unit the
 * number is in, so a size and a comparison price of different families stay
 * two readable facts rather than one wrong one.
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
 * A plain quantity is read, and a pack multiplies its count by it, when the
 * count is within the bounds of {@link packCountOf} (plan 0250, section 2.1):
 * a number outside them is not a count, and the size it would multiply into
 * is not stated. A quantity joined by `x` or `+` is **not**: `3x187` is
 * three of something and `28+16` is a bonus pack, the chain prints both for
 * the same field, and guessing which arithmetic it meant writes a number
 * nobody checked.
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
  if (packCount !== undefined && !isCount(packCount)) {
    return null;
  }
  const pack = packCount ? Number(packCount) : 1;
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
    images: card.images ?? null,
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
