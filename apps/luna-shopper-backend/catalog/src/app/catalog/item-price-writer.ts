import {
  PriceSourceKind,
  type ItemPriceBatchEntry,
  type ItemPriceOverrides,
} from '@portfolio/luna-shopper/contracts';
import { ValidationException } from '@portfolio/luna-shopper/platform';
import type { EntityManager } from 'typeorm';
import {
  ItemPrice,
  ItemPriceDetailsRow,
  PricePolicy,
  PriceScope,
} from '../entities';
import {
  ADMIN_PROTECTION_DAYS,
  AUTOMATED_KINDS,
  narrowestEligiblePerKind,
  toNumber,
  type PolicyRow,
  type PriceRow,
} from './effective-price';
import {
  currentPriceRows,
  lessSpecificScopesOf,
} from './effective-price.service';

export interface ItemPriceWrite {
  scope: PriceScope;
  sourceKind: PriceSourceKind;
  /** The run writing, or null for a person and for the reference seed. */
  sourceRunId: string | null;
  /**
   * The scope every entry was read at, when the run is copying it to
   * {@link scope} (plan 0118, section 5). Absent and null both mean the prices
   * were read at this scope.
   */
  copiedFromScopeId?: string | null;
  entries: readonly ItemPriceBatchEntry[];
  now: Date;
}

export interface ItemPriceWriteOutcome {
  /** New rows, saved. */
  inserted: ItemPrice[];
  /** Current rows whose `lastObservedAt` moved, saved. */
  confirmed: ItemPrice[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Insert on change (plan 0080, section 2.1), for one kind at one scope.
 *
 * A write reads the current row of its (item, scope, kind). Equal on every
 * value: `lastObservedAt` moves forward, if the offered date is later, and
 * nothing else happens. Different, or no current row: a new row is inserted
 * with `observedAt = lastObservedAt`. The old row is left exactly as it was.
 *
 * An `ADMIN` insert records what it is overriding (section 4.2): one entry per
 * automated kind with a current row for this key, at this scope or at the
 * chain's NATIONAL one, and `protectedUntil` seven days out. The snapshot is
 * taken here and nowhere else, so a caller cannot supply one.
 *
 * A plain function over the caller's `EntityManager`, for the reason the
 * recompute is one: it runs inside the caller's transaction, and the reference
 * seed calls it with a manager and no service.
 */
export async function writeItemPrices(
  manager: EntityManager,
  write: ItemPriceWrite
): Promise<ItemPriceWriteOutcome> {
  const outcome: ItemPriceWriteOutcome = { inserted: [], confirmed: [] };
  if (write.entries.length === 0) {
    return outcome;
  }
  if (
    write.sourceRunId !== null &&
    !AUTOMATED_KINDS.includes(write.sourceKind)
  ) {
    // Backlog 0001, section 2.3: no adapter may write a user kind, and a
    // person's kind is not a run's either.
    throw new ValidationException(
      `A harvest run may write official kinds only, not ${write.sourceKind}`
    );
  }

  const itemIds = [...new Set(write.entries.map((entry) => entry.itemId))];
  // The scope written to and everything it falls through to: the ADMIN
  // snapshot below records what every source said at the moment it was taken,
  // and a source that spoke one tier up is one of them (plan 0105, section 4).
  const inherited = await lessSpecificScopesOf(manager, write.scope);
  const scopeIds = [write.scope.id, ...inherited.map((row) => row.id)];
  const current = await currentPriceRows(manager, itemIds, scopeIds);
  const scopePriorities = new Map<string, number>([
    [write.scope.id, write.scope.priority],
    ...inherited.map((row): [string, number] => [row.id, row.priority]),
  ]);
  /** Read once, and only by an ADMIN write, which is the one that snapshots. */
  let policies: PolicyRow[] | undefined;

  /** The current row of this kind at this scope, per item. */
  const currentByItem = new Map<string, ItemPrice>();
  /** Every current row for the key, for the ADMIN snapshot. */
  const candidatesByItem = new Map<string, ItemPrice[]>();
  for (const row of current) {
    const held = candidatesByItem.get(row.itemId) ?? [];
    held.push(row);
    candidatesByItem.set(row.itemId, held);
    if (
      row.priceScopeId === write.scope.id &&
      row.sourceKind === write.sourceKind
    ) {
      currentByItem.set(row.itemId, row);
    }
  }

  const copiedFromScopeId = write.copiedFromScopeId ?? null;
  const toInsert: ItemPrice[] = [];
  const toConfirm: ItemPrice[] = [];
  /** The detail row each insert carries, by the price row it belongs to. */
  const detailsFor = new Map<
    ItemPrice,
    NonNullable<ItemPriceBatchEntry['details']>
  >();
  for (const entry of write.entries) {
    const values = normalize(entry, write.now);
    const held = currentByItem.get(entry.itemId);
    // A copy is its own statement (plan 0118, section 5.2): the same number read
    // at another scope does not confirm a row read here, or the other way
    // round, because the provenance would then stay wrong for as long as the
    // price does not change.
    if (
      held &&
      sameValues(held, values) &&
      (held.copiedFromScopeId ?? null) === copiedFromScopeId
    ) {
      if (values.observedAt.getTime() > held.lastObservedAt.getTime()) {
        held.lastObservedAt = values.observedAt;
        held.lastObservedRunId = write.sourceRunId;
        toConfirm.push(held);
      }
      continue;
    }
    const row = manager.create(ItemPrice, {
      itemId: entry.itemId,
      priceScopeId: write.scope.id,
      sourceKind: write.sourceKind,
      price: values.price,
      currency: values.currency,
      unitPrice: values.unitPrice,
      unitPriceLabel: values.unitPriceLabel,
      observedAt: values.observedAt,
      lastObservedAt: values.observedAt,
      validFrom: values.validFrom,
      validUntil: values.validUntil,
      sourceRunId: write.sourceRunId,
      lastObservedRunId: write.sourceRunId,
      copiedFromScopeId,
      overrides: null,
      protectedUntil: null,
    });
    if (write.sourceKind === PriceSourceKind.ADMIN) {
      policies ??= await manager.find(PricePolicy);
      row.overrides = snapshotOf(candidatesByItem.get(entry.itemId) ?? [], {
        priceScopeId: write.scope.id,
        scopePriorities,
        policies,
        now: write.now,
      });
      row.protectedUntil = new Date(
        values.observedAt.getTime() + ADMIN_PROTECTION_DAYS * DAY_MS
      );
    }
    toInsert.push(row);
    // The leaflet tile behind this number, when a leaflet import is writing
    // (plan 0081, section 6.4). It belongs to the row, so a confirmation
    // carries none: nothing new was said and no row was inserted.
    if (entry.details) {
      detailsFor.set(row, entry.details);
    }
    // A second entry for the same item in one batch compares against the
    // first, as it would against a committed row.
    currentByItem.set(entry.itemId, row);
  }

  if (toInsert.length > 0) {
    // Chunked so one run's batch does not build a single statement large
    // enough to be refused by the driver.
    await manager.save(ItemPrice, toInsert, { chunk: 200 });
  }
  if (toConfirm.length > 0) {
    await manager.save(ItemPrice, toConfirm, { chunk: 200 });
  }
  if (detailsFor.size > 0) {
    // After the prices, because the row is keyed by the id the save assigned.
    await manager.save(
      ItemPriceDetailsRow,
      [...detailsFor].map(([row, details]) =>
        manager.create(ItemPriceDetailsRow, {
          itemPriceId: row.id,
          offerId: details.offerId ?? null,
          page: details.page ?? null,
          rawText: details.rawText ?? null,
          promotion: details.promotion ?? null,
          loyalty: details.loyalty ?? null,
        })
      ),
      { chunk: 200 }
    );
  }
  outcome.inserted = toInsert;
  outcome.confirmed = toConfirm;
  return outcome;
}

interface NormalizedValues {
  price: number | null;
  currency: string | null;
  unitPrice: number | null;
  unitPriceLabel: string | null;
  observedAt: Date;
  validFrom: Date | null;
  validUntil: Date | null;
}

/** The entry's values with every absence made a null, and its dates parsed. */
function normalize(entry: ItemPriceBatchEntry, now: Date): NormalizedValues {
  const validFrom = parseDate(entry.validFrom, 'validFrom');
  const validUntil = parseDate(entry.validUntil, 'validUntil');
  if (validFrom && validUntil && validUntil.getTime() <= validFrom.getTime()) {
    throw new ValidationException('validUntil must be after validFrom', {
      details: { validUntil: 'must be after validFrom' },
    });
  }
  return {
    price: entry.price ?? null,
    currency: entry.currency ?? null,
    unitPrice: entry.unitPrice ?? null,
    unitPriceLabel: entry.unitPriceLabel ?? null,
    observedAt: parseDate(entry.observedAt, 'observedAt') ?? now,
    validFrom,
    validUntil,
  };
}

function parseDate(
  value: string | null | undefined,
  field: string
): Date | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationException(`${field} is not a date`, {
      details: { [field]: 'must be an ISO 8601 instant' },
    });
  }
  return parsed;
}

/** Equal on every value the write names. `lastObservedAt` and the run are not values. */
function sameValues(held: ItemPrice, values: NormalizedValues): boolean {
  return (
    toNumber(held.price) === values.price &&
    (held.currency ?? null) === values.currency &&
    toNumber(held.unitPrice) === values.unitPrice &&
    (held.unitPriceLabel ?? null) === values.unitPriceLabel &&
    sameInstant(held.validFrom, values.validFrom) &&
    sameInstant(held.validUntil, values.validUntil)
  );
}

function sameInstant(a: Date | null, b: Date | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return a.getTime() === b.getTime();
}

/**
 * Section 4.2: one entry per automated kind, taken from the narrowest
 * **eligible** row of that kind across the stack (plan 0117, section 4).
 *
 * The same set the resolution disputes an `ADMIN` row with, from the same
 * function, so what a correction records is exactly what a later read compares
 * it to. The stack is ranked by scope priority, never by the order the rows
 * came back in.
 */
export function snapshotOf(
  candidates: readonly PriceRow[],
  stack: {
    priceScopeId: string;
    scopePriorities: ReadonlyMap<string, number>;
    policies: readonly PolicyRow[];
    now: Date;
  }
): ItemPriceOverrides {
  const overrides: ItemPriceOverrides = {};
  const chosen = narrowestEligiblePerKind(
    candidates.filter((row) => AUTOMATED_KINDS.includes(row.sourceKind)),
    stack.priceScopeId,
    stack.policies,
    stack.now,
    stack.scopePriorities
  );
  for (const row of chosen) {
    overrides[row.sourceKind] = {
      price: toNumber(row.price),
      unitPrice: toNumber(row.unitPrice),
    };
  }
  return overrides;
}
