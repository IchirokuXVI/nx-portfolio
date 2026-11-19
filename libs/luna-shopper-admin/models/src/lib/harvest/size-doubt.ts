/**
 * A source row whose size its own price and comparison price disprove
 * (backend plan 0249), as this app reads it (admin plan 0072).
 *
 * **Both sizes in the row's own unit.** The doubt arrives in a base unit
 * (grams, millilitres or units) for the whole pack, and the row states its size
 * in `sizeUnit`. A litre row that states 1 and implies 0.1 is drawn as 1 and
 * 0.1 litres, as the refusal of PR #942 writes it: printed in millilitres, the
 * 100 a person reads off it would be a hundred litres if typed back as the
 * size.
 *
 * Mapped from `unknown` (rule D4), and `null` for anything that cannot be drawn
 * honestly: no doubt, a doubt with a figure missing, or a doubt whose base unit
 * is not the dimension of the row's unit.
 */
export interface SizeDoubt {
  /** The size the row states, for the whole pack, in {@link unit}. */
  readonly stated: number;
  /** The size its prices imply, for the whole pack, in {@link unit}. */
  readonly implied: number;
  /** The row's own unit, in which both sizes are written. */
  readonly unit: SizeDoubtUnit;
  /** Implied divided by stated. The check agrees from 0.85 to 1.18. */
  readonly ratio: number;
  /** The price label whose dimension is the row's, as printed, or `null`. */
  readonly label: string | null;
  /** The run that recorded the doubt. */
  readonly runId: string;
  /**
   * A whole number of packs the ratio is close to, or `null`. A guess and
   * labelled as one: on Mercadona's walk 14 of 32 doubts met the rule, nail
   * polishes among them (PR #942).
   */
  readonly packGuess: number | null;
}

/** The units a row states its size in. */
export type SizeDoubtUnit =
  | 'GRAM'
  | 'KILOGRAM'
  | 'MILLILITER'
  | 'LITER'
  | 'UNIT';

/** What one of each unit is in its base unit, and which base unit that is. */
const BASE: Readonly<
  Record<SizeDoubtUnit, { readonly base: string; readonly factor: number }>
> = {
  GRAM: { base: 'GRAM', factor: 1 },
  KILOGRAM: { base: 'GRAM', factor: 1000 },
  MILLILITER: { base: 'MILLILITER', factor: 1 },
  LITER: { base: 'MILLILITER', factor: 1000 },
  UNIT: { base: 'UNIT', factor: 1 },
};

/*
 * The pack rule of the harvester's `packCountNear` (backend plan 0249,
 * section 2): within 2% of a whole number from 2 to 48, on a row that states
 * no pack count.
 */
const PACK_ROOM = 0.02;
const PACK_MIN = 2;
const PACK_MAX = 48;

/**
 * The doubt of one source row, read off the whole row: the doubt itself and
 * the row's `unitSize`, `sizeUnit` and `packCount`, which the sizes are
 * written in and the pack guess depends on.
 */
export function toSizeDoubt(row: unknown): SizeDoubt | null {
  const entry = asRecord(row);
  const doubt = asRecord(entry?.['sizeDoubt']);
  if (entry === null || doubt === null) {
    return null;
  }

  const implied = asNumber(doubt['implied']);
  const ratio = asNumber(doubt['ratio']);
  const runId = doubt['runId'];
  const stated = asNumber(entry['unitSize']);
  if (
    implied === null ||
    implied < 0 ||
    ratio === null ||
    ratio <= 0 ||
    stated === null ||
    stated <= 0 ||
    typeof runId !== 'string' ||
    runId === ''
  ) {
    return null;
  }

  const unit = rowUnit(entry['sizeUnit'], doubt['unit']);
  if (unit === null) {
    return null;
  }

  const label = doubt['label'];
  return {
    stated,
    implied: round(implied / BASE[unit].factor),
    unit,
    ratio,
    label: typeof label === 'string' && label.trim() !== '' ? label : null,
    runId,
    packGuess: hasPack(entry['packCount']) ? null : packGuessOf(ratio),
  };
}

/**
 * A whole number of packs from 2 to 48 that the ratio is within 2% of, or
 * `null`: 6.01 is 6, and 6.2 is nothing.
 */
function packGuessOf(ratio: number): number | null {
  if (!Number.isFinite(ratio)) {
    return null;
  }
  const whole = Math.round(ratio);
  if (whole < PACK_MIN || whole > PACK_MAX) {
    return null;
  }
  return Math.abs(ratio - whole) <= whole * PACK_ROOM ? whole : null;
}

/**
 * The row's unit, or the doubt's base unit for a row that states none, which
 * is what the harvester falls back to. `null` when the doubt's base unit is not
 * the row's dimension, since the two figures would not be one size.
 */
function rowUnit(sizeUnit: unknown, doubtUnit: unknown): SizeDoubtUnit | null {
  const unit = isUnit(sizeUnit)
    ? sizeUnit
    : isUnit(doubtUnit) && BASE[doubtUnit].factor === 1
      ? doubtUnit
      : null;
  if (unit === null) {
    return null;
  }
  return isUnit(doubtUnit) && BASE[doubtUnit].base === BASE[unit].base
    ? unit
    : null;
}

function isUnit(value: unknown): value is SizeDoubtUnit {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(BASE, value)
  );
}

/** A pack count the row states, which the harvester reads as no guess at all. */
function hasPack(value: unknown): boolean {
  return value !== null && value !== undefined;
}

/** Seven places, as the harvester's refusal rounds the implied size. */
function round(value: number): number {
  return Math.round(value * 10_000_000) / 10_000_000;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
