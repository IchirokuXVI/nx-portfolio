import { UnitOfMeasure } from '@portfolio/luna-shopper/contracts';

/**
 * The printed size split into a number and a unit (plan 0089, section 6).
 *
 * **It is its own file because the strings are irregular.** `500 g`, `6x200ml`,
 * `Aprox. 950g` and `Paquete` all appear in one week's assortment. `Paquete` is
 * a word and not a size, so it parses to null rather than to one, and the
 * printed string is kept on the observation as `sizeFormat` so that nothing is
 * lost when the parse gives up.
 */

/** What a token may mean, and what it is worth in the value this returns. */
interface UnitToken {
  unit: UnitOfMeasure;
  /** What one of the printed unit is worth in {@link unit}. `cl` is 10 `ml`. */
  factor: number;
}

const UNITS: Record<string, UnitToken> = {
  g: { unit: UnitOfMeasure.GRAM, factor: 1 },
  gr: { unit: UnitOfMeasure.GRAM, factor: 1 },
  grs: { unit: UnitOfMeasure.GRAM, factor: 1 },
  gramos: { unit: UnitOfMeasure.GRAM, factor: 1 },
  kg: { unit: UnitOfMeasure.KILOGRAM, factor: 1 },
  kgs: { unit: UnitOfMeasure.KILOGRAM, factor: 1 },
  kilo: { unit: UnitOfMeasure.KILOGRAM, factor: 1 },
  kilos: { unit: UnitOfMeasure.KILOGRAM, factor: 1 },
  ml: { unit: UnitOfMeasure.MILLILITER, factor: 1 },
  // Centilitres are millilitres times ten, which is a conversion and not a
  // guess: `33cl` is 330 ml on the same bottle, in a unit the enum holds.
  cl: { unit: UnitOfMeasure.MILLILITER, factor: 10 },
  l: { unit: UnitOfMeasure.LITER, factor: 1 },
  litro: { unit: UnitOfMeasure.LITER, factor: 1 },
  litros: { unit: UnitOfMeasure.LITER, factor: 1 },
  ud: { unit: UnitOfMeasure.UNIT, factor: 1 },
  uds: { unit: UnitOfMeasure.UNIT, factor: 1 },
  unidad: { unit: UnitOfMeasure.UNIT, factor: 1 },
  unidades: { unit: UnitOfMeasure.UNIT, factor: 1 },
  piezas: { unit: UnitOfMeasure.UNIT, factor: 1 },
};

/**
 * `6x200ml`, `500 g`, `1,5 l`, `4x 300 g`, `350 / g`. One optional multiplier,
 * one number, one unit, with the separators the chain actually prints.
 *
 * Anchored at both ends, so a string that carries anything else does not parse.
 * That is the point: an unrecognised string is a missing size, which is honest,
 * and a partial read of one is a wrong size, which is not. It is also what
 * makes a printed **range** parse to nothing: `Aprox. 0,8-1,2kg` states two
 * numbers, and neither of them is the size of the pack.
 */
const PRINTED_SIZE =
  /^(?:(\d+)\s*[x×]\s*)?(\d+(?:[.,]\d+)?)\s*\/?\s*([A-Za-zÀ-ÿ]{1,8})\.?$/;

/** A unit with no number in front of it: `Ud` is one of that unit. */
const BARE_UNIT = /^([A-Za-zÀ-ÿ]{1,8})\.?$/;

/** Prefixes the chain puts in front of a weight it does not promise exactly. */
const APPROXIMATE = /^(?:aprox\.?|approx\.?|ca\.?|env\.?)\s*/i;

export interface LidlSize {
  /** What one pack holds, in {@link unit}. `6x200ml` is 1200 millilitres. */
  unitSize: number;
  unit: UnitOfMeasure;
  /** How many the printed size multiplies, and 1 when it multiplies nothing. */
  count: number;
  /** `Aprox. 950g`: the chain sells by weight and does not promise the number. */
  approximate: boolean;
}

/**
 * The printed size, or null when the string states none.
 *
 * A multipack is stated as one pack: `6x200ml` holds 1200 millilitres, because
 * that is what the price on it buys. The multiplier is kept in {@link
 * LidlSize.count} so nothing about the string is thrown away.
 */
export function parseSize(printed: string | null | undefined): LidlSize | null {
  if (!printed) {
    return null;
  }
  const trimmed = printed.replace(/\s+/g, ' ').trim();
  const approximate = APPROXIMATE.test(trimmed);
  const stated = trimmed.replace(APPROXIMATE, '');

  const bare = BARE_UNIT.exec(stated);
  if (bare) {
    // `Ud` on its own means one of that unit, which is a size. `Paquete` is
    // also a word on its own and is not in the table, so it still reads as no
    // size at all, which is what section 6 asks for.
    const token = UNITS[bare[1].toLowerCase()];
    return token
      ? { unitSize: token.factor, unit: token.unit, count: 1, approximate }
      : null;
  }

  const match = PRINTED_SIZE.exec(stated);
  if (!match) {
    return null;
  }
  const token = UNITS[match[3].toLowerCase()];
  if (!token) {
    return null;
  }
  const count = match[1] === undefined ? 1 : Number(match[1]);
  const each = Number(match[2].replace(',', '.'));
  if (!Number.isFinite(count) || !Number.isFinite(each) || count < 1) {
    return null;
  }
  return {
    // Rounded to four decimals, which is what the column stores. Multiplying a
    // decimal by a count is where a float would otherwise print 1200.0000001.
    unitSize: round(count * each * token.factor),
    unit: token.unit,
    count,
    approximate,
  };
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
