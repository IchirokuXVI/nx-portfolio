import { UnitOfMeasure } from '../enums/catalog.enums';

/**
 * The unit a source's `unitSize` is in (plan 0177).
 *
 * A source row carries a size as a number and the text the chain printed. The
 * text cannot say which unit the number is in, because the sources disagree
 * about it: one converts `75cl` to 750 and another keeps `6x33cl` at 198. The
 * adapter is the only place that knows, so the adapter states it, and this is
 * the vocabulary it states it in.
 *
 * `PACK` is left out on purpose. A pack is not a unit a size is measured in:
 * how many a pack holds is `packCount` (plan 0162).
 */
export const SOURCE_SIZE_UNITS = [
  UnitOfMeasure.GRAM,
  UnitOfMeasure.KILOGRAM,
  UnitOfMeasure.MILLILITER,
  UnitOfMeasure.LITER,
  UnitOfMeasure.UNIT,
] as const;

export type SourceSizeUnit = (typeof SOURCE_SIZE_UNITS)[number];

/** A printed unit word as a catalog unit, and what one of it is worth there. */
export interface PrintedSizeUnit {
  unit: SourceSizeUnit;
  /** What one of the printed unit is worth in {@link unit}. `cl` is 10 `ml`. */
  factor: number;
}

const GRAM: PrintedSizeUnit = { unit: UnitOfMeasure.GRAM, factor: 1 };
const KILOGRAM: PrintedSizeUnit = { unit: UnitOfMeasure.KILOGRAM, factor: 1 };
const MILLILITER: PrintedSizeUnit = {
  unit: UnitOfMeasure.MILLILITER,
  factor: 1,
};
const LITER: PrintedSizeUnit = { unit: UnitOfMeasure.LITER, factor: 1 };
const UNIT: PrintedSizeUnit = { unit: UnitOfMeasure.UNIT, factor: 1 };

/**
 * The unit words the chains print, lower cased.
 *
 * **Centilitres are written as millilitres.** The catalog holds no centilitre,
 * and `33 cl` is 330 ml on the same bottle, which is a conversion and not a
 * guess. The same goes for `dl`, `cc` and `mg`.
 *
 * **A length is not here.** `m`, `cm` and `mm` have no catalog unit, so a size
 * printed in one states no unit, and a reader that needs one falls back to the
 * printed text. The words a chain counts a household product in (`lavados`,
 * `rollos`, `cápsulas`) are counts, as the Carrefour reader already treats
 * them.
 */
const PRINTED_SIZE_UNITS: Readonly<Record<string, PrintedSizeUnit>> = {
  g: GRAM,
  gr: GRAM,
  grs: GRAM,
  gramos: GRAM,
  mg: { unit: UnitOfMeasure.GRAM, factor: 0.001 },
  k: KILOGRAM,
  kg: KILOGRAM,
  kgs: KILOGRAM,
  kilo: KILOGRAM,
  kilos: KILOGRAM,
  ml: MILLILITER,
  cc: MILLILITER,
  cl: { unit: UnitOfMeasure.MILLILITER, factor: 10 },
  dl: { unit: UnitOfMeasure.MILLILITER, factor: 100 },
  l: LITER,
  lt: LITER,
  ltr: LITER,
  litro: LITER,
  litros: LITER,
  u: UNIT,
  ud: UNIT,
  uds: UNIT,
  unid: UNIT,
  unids: UNIT,
  unidad: UNIT,
  unidades: UNIT,
  pieza: UNIT,
  piezas: UNIT,
  docena: { unit: UnitOfMeasure.UNIT, factor: 12 },
  lavado: UNIT,
  lavados: UNIT,
  dosis: UNIT,
  capsula: UNIT,
  capsulas: UNIT,
  cápsula: UNIT,
  cápsulas: UNIT,
  sobre: UNIT,
  sobres: UNIT,
  rollo: UNIT,
  rollos: UNIT,
  bolsa: UNIT,
  bolsas: UNIT,
  pastilla: UNIT,
  pastillas: UNIT,
  hoja: UNIT,
  hojas: UNIT,
  plato: UNIT,
  platos: UNIT,
  racion: UNIT,
  raciones: UNIT,
  servicio: UNIT,
  servicios: UNIT,
};

/**
 * The catalog unit a printed unit word names, or null for a word that names
 * none.
 *
 * A catalog unit written out (`MILLILITER`) is read as itself, which is how a
 * document a person or a tool wrote states one.
 */
export function printedSizeUnit(
  word: string | null | undefined
): PrintedSizeUnit | null {
  const text = (word ?? '').trim();
  if (text === '') {
    return null;
  }
  const named = sourceSizeUnitOf(text.toUpperCase());
  if (named) {
    return { unit: named, factor: 1 };
  }
  return PRINTED_SIZE_UNITS[text.toLowerCase().replace(/\.$/, '')] ?? null;
}

/** The value as a {@link SourceSizeUnit}, or null when it is not one. */
export function sourceSizeUnitOf(value: unknown): SourceSizeUnit | null {
  return (SOURCE_SIZE_UNITS as readonly unknown[]).includes(value)
    ? (value as SourceSizeUnit)
    : null;
}

/** A size a source stated, as the number and the unit the number is in. */
export interface SourceSize {
  unitSize: number | null;
  sizeUnit: SourceSizeUnit | null;
}

/**
 * A printed amount and its printed unit word, as a source size.
 *
 * The one place the conversion happens, so every adapter writes a size the
 * same way: `33` and `cl` is 330 `MILLILITER`, `1,5` and `l` is 1.5 `LITER`.
 * A word that names no catalog unit keeps the number as it was printed and
 * states no unit. Rounded to four decimals, which is what the column stores.
 */
export function sourceSizeOf(
  amount: number | null | undefined,
  word: string | null | undefined
): SourceSize {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) {
    return { unitSize: null, sizeUnit: null };
  }
  const printed = printedSizeUnit(word);
  if (!printed) {
    return { unitSize: round(amount), sizeUnit: null };
  }
  return { unitSize: round(amount * printed.factor), sizeUnit: printed.unit };
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
