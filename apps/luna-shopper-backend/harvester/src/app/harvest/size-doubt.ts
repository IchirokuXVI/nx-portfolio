import { toBaseUnit } from '@portfolio/luna-shopper/contracts';
import type { SourceCatalogEntry } from '../entities';
import { SiblingEntryIndex } from './matching';
import { checkSize, type SizeCheckInput, type SizeVerdict } from './size-check';
import type { SourceEntryFields } from './source-snapshot';

/**
 * What the ingest does with a row's size doubt (plan 0249, section 3), read
 * from what the row holds once the observation is written.
 *
 * - A verdict that disagrees records the doubt.
 * - `clear` removes it: the size agreed, or the row holds no size now, or a
 *   size other than the one the doubt was about.
 * - `leave` changes nothing: the observation gave nothing to judge by and
 *   the size did not move, or it does not write the row's size at all (a
 *   leaflet over a row a walk owns, plan 0190).
 */
export type SizeDoubtDecision = SizeVerdict | 'clear' | 'leave';

/** One doubted row, as the run's report names it (plan 0249, section 3). */
export interface SizeDoubtExample {
  entryId: string;
  externalId: string;
  name: string;
  /** The stated size in base units, for the whole pack. */
  stated: number;
  /** The size the price and comparison price imply, in the same unit. */
  implied: number;
  /** `GRAM`, `MILLILITER` or `UNIT`. */
  unit: string;
  ratio: number;
  label: string;
  /** The whole number the ratio is close to, on a row that states no count. */
  probablePackCount: number | null;
}

/** Whether a row carries a doubt about its size. */
export function hasSizeDoubt(
  row: Pick<SourceCatalogEntry, 'sizeDoubtImplied'>
): boolean {
  return row.sizeDoubtImplied !== null && row.sizeDoubtImplied !== undefined;
}

/**
 * The decision for a full observation. `fields` is what the row will hold
 * when the observation writes its source group; `held` is the row it lands
 * on, or undefined for a new one.
 *
 * A source that never reads a count or a weight leaves the stored one alone
 * (`packCount` and `approxWeight` absent), so the stored one is read.
 */
export function sizeDoubtOfFields(
  fields: SourceEntryFields,
  held: SourceCatalogEntry | undefined,
  writesSize: boolean,
  prices: SizeCheckInput['prices']
): SizeDoubtDecision {
  if (!writesSize) {
    return 'leave';
  }
  return decide(
    {
      unitSize: fields.unitSize,
      sizeUnit: fields.sizeUnit,
      soldByWeight: fields.soldByWeight,
      approxWeight:
        fields.approxWeight !== undefined
          ? fields.approxWeight
          : (held?.approxWeight ?? null),
      packCount:
        fields.packCount !== undefined
          ? fields.packCount
          : (held?.packCount ?? null),
      prices,
    },
    held
  );
}

/**
 * The decision for a partial observation (plan 0119): it states no size, so
 * the row's stored size is checked against the prices the listing read. The
 * flag and the weight it carries move with it, as `see` writes them.
 */
export function sizeDoubtOfPartial(
  held: SourceCatalogEntry,
  observation: {
    soldByWeight?: boolean;
    approxWeight?: number | null;
    prices: SizeCheckInput['prices'];
  }
): SizeDoubtDecision {
  const soldByWeight =
    observation.soldByWeight === undefined
      ? held.soldByWeight === true
      : observation.soldByWeight;
  const approxWeight =
    observation.approxWeight !== undefined
      ? observation.approxWeight
      : held.approxWeight;
  const sized =
    !soldByWeight && (approxWeight === null || approxWeight === undefined);
  return decide(
    {
      unitSize: sized ? held.unitSize : null,
      sizeUnit: sized ? held.sizeUnit : null,
      soldByWeight,
      approxWeight,
      packCount: held.packCount,
      prices: observation.prices,
    },
    held
  );
}

function decide(
  input: SizeCheckInput,
  held: SourceCatalogEntry | undefined
): SizeDoubtDecision {
  const verdict = checkSize(input);
  if (verdict !== null) {
    return verdict.agrees ? 'clear' : verdict;
  }
  if (held === undefined || !hasSizeDoubt(held)) {
    return 'leave';
  }
  // Nothing to judge by. The doubt stays only while the row holds the size
  // it was about.
  const before = baseSize(held.unitSize, held.sizeUnit);
  const after = baseSize(input.unitSize, input.sizeUnit);
  return after === null || after !== before ? 'clear' : 'leave';
}

function baseSize(
  unitSize: number | string | null,
  sizeUnit: SourceCatalogEntry['sizeUnit']
): string | null {
  if (unitSize === null || unitSize === undefined || sizeUnit === null) {
    return null;
  }
  const base = toBaseUnit(Number(unitSize), sizeUnit);
  return base.unitSize === null ? null : `${base.unitSize}|${base.unit}`;
}

/**
 * Write a decision onto the row, before the caller saves it. Answers whether
 * the row's doubt changed, which is when the sibling index must forget or
 * learn it.
 *
 * The stated size, price, comparison price and label are not touched: a
 * doubt is evidence, never a correction (plan 0249, constraints).
 */
export function applySizeDoubt(
  row: SourceCatalogEntry,
  decision: SizeDoubtDecision,
  runId: string
): boolean {
  if (decision === 'leave') {
    return false;
  }
  const doubted = hasSizeDoubt(row);
  if (decision === 'clear') {
    row.sizeDoubtImplied = null;
    row.sizeDoubtRatio = null;
    row.sizeDoubtRunId = null;
    return doubted;
  }
  row.sizeDoubtImplied = decision.implied;
  row.sizeDoubtRatio = decision.ratio;
  row.sizeDoubtRunId = runId;
  return !doubted;
}

/** The example a report names for a doubted row. */
export function sizeDoubtExample(
  row: Pick<SourceCatalogEntry, 'id' | 'externalId' | 'name' | 'sizeUnit'>,
  verdict: SizeVerdict
): SizeDoubtExample {
  return {
    entryId: row.id,
    externalId: row.externalId,
    name: row.name,
    stated: verdict.stated,
    implied: verdict.implied,
    unit: row.sizeUnit === null ? '' : toBaseUnit(1, row.sizeUnit).unit,
    ratio: verdict.ratio,
    label: verdict.label,
    probablePackCount: verdict.probablePackCount,
  };
}

/**
 * Rung 4's index with the doubted rows left out (plan 0249, section 3).
 *
 * Rung 4's key holds the size, so a row whose size its own price disproves
 * proposes nothing and is proposed by nothing. `matching.ts` stays as it is:
 * this holds every row the session knows and answers from an inner index of
 * the undoubted ones, rebuilt only after a row's doubt changed
 * ({@link refresh}). A walk changes a few dozen doubts at most, and only on
 * the first walk after the doubt appears.
 *
 * **Every query method of {@link SiblingEntryIndex} must be delegated here.**
 * The base class is constructed empty, so a method this class does not
 * override answers from nothing.
 */
export class UndoubtedSiblingIndex extends SiblingEntryIndex {
  private readonly all: SourceCatalogEntry[] = [];
  private inner = new SiblingEntryIndex([]);
  private stale = false;

  constructor(rows: Iterable<SourceCatalogEntry>) {
    super([]);
    for (const row of rows) {
      this.add(row);
    }
  }

  override add(row: SourceCatalogEntry): void {
    this.all.push(row);
    if (!this.stale && !hasSizeDoubt(row)) {
      this.inner.add(row);
    }
  }

  /** A row's doubt changed: the next query rebuilds the inner index. */
  refresh(): void {
    this.stale = true;
  }

  override match(
    ...args: Parameters<SiblingEntryIndex['match']>
  ): ReturnType<SiblingEntryIndex['match']> {
    return this.current().match(...args);
  }

  override matchAnyOrder(
    ...args: Parameters<SiblingEntryIndex['matchAnyOrder']>
  ): ReturnType<SiblingEntryIndex['matchAnyOrder']> {
    return this.current().matchAnyOrder(...args);
  }

  override rejectedAnyOrder(
    ...args: Parameters<SiblingEntryIndex['rejectedAnyOrder']>
  ): ReturnType<SiblingEntryIndex['rejectedAnyOrder']> {
    return this.current().rejectedAnyOrder(...args);
  }

  private current(): SiblingEntryIndex {
    if (this.stale) {
      this.inner = new SiblingEntryIndex(
        this.all.filter((row) => !hasSizeDoubt(row))
      );
      this.stale = false;
    }
    return this.inner;
  }
}
