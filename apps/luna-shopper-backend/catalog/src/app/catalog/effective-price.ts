import {
  PriceShownBecause,
  PriceSourceKind,
  type ItemPriceOverrides,
} from '@portfolio/luna-shopper/contracts';

/**
 * The part of an `item_prices` row the resolution reads. A structural type
 * rather than the entity, so the table driven spec and the migration test can
 * build rows without a database.
 */
export interface PriceRow {
  id: string;
  priceScopeId: string;
  sourceKind: PriceSourceKind;
  price: number | string | null;
  unitPrice: number | string | null;
  lastObservedAt: Date;
  validFrom: Date | null;
  validUntil: Date | null;
  overrides: ItemPriceOverrides | null;
  protectedUntil: Date | null;
}

/** The part of a `price_policies` row the resolution reads. */
export interface PolicyRow {
  sourceKind: PriceSourceKind;
  priority: number;
  maxAgeDays: number | null;
  enabled: boolean;
}

export interface EffectivePriceInput {
  /**
   * Current rows of the product across the shop's stack: the scope being
   * computed and every scope it falls through to (plan 0080, section 6; plan
   * 0105, section 4). "Current" is the newest `observedAt` per (scope, kind),
   * and the caller's `DISTINCT ON` is what makes that true.
   *
   * The caller may hand over every current row, or only the ones that can
   * matter (plan 0117, section 5): the narrowest eligible row per kind, or,
   * when there is none, the newest enabled row for the stale tier. Both give
   * the same answer, because every step below keeps a row it was handed only
   * if the step would have kept it from the full set.
   */
  rows: readonly PriceRow[];
  /** The scope being computed. The most specific of the set, by construction. */
  priceScopeId: string;
  /**
   * Each scope id in {@link rows} against its `priority`: lower is more
   * specific (plan 0105, section 2.1).
   *
   * Optional, and absent means the two tier rule this generalized: the scope
   * being computed beats every other row, which is what "this scope, else the
   * chain's NATIONAL" was. With one fallback tier the two rules agree exactly,
   * so a caller with nothing to rank need not build the map.
   */
  scopePriorities?: ReadonlyMap<string, number>;
  policies: readonly PolicyRow[];
  now: Date;
  /**
   * The earliest `validFrom` still ahead among enabled current rows the caller
   * did **not** hand over, because a row that is not valid yet is filtered out
   * of {@link rows} by a caller that filters in SQL (plan 0117, section 6).
   * Absent when {@link rows} holds every current row, which is what the pure
   * specs pass.
   */
  nextValidFrom?: Date | null;
}

export interface EffectivePrice {
  /** The row section 4 chose, or null when there is no row at all. */
  row: PriceRow | null;
  /** True when `row` came from the stale tier of section 5. */
  stale: boolean;
  /**
   * Which step below chose `row` (plan 0160). Null exactly when `row` is.
   * Read from the same comparisons that chose it, never worked out again.
   */
  shownBecause: PriceShownBecause | null;
  /** The earliest instant at which this answer changes with no write. Null when it never does. */
  nextBoundaryAt: Date | null;
}

/** The kinds an automated source writes, and therefore the kinds an `ADMIN` row overrides. */
export const AUTOMATED_KINDS: readonly PriceSourceKind[] = [
  PriceSourceKind.OFFICIAL_API,
  PriceSourceKind.OFFICIAL_WEB,
  PriceSourceKind.OFFICIAL_LEAFLET,
];

/** How long an `ADMIN` row is protected against a repeated automated value. */
export const ADMIN_PROTECTION_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Which price a shopper sees (plan 0080, section 4), as a pure function of
 * stored rows, the policy and the clock. Nothing is decided at write time and
 * remembered, which is what lets undo, replay and reimport touch only their own
 * rows.
 *
 * The order is plan 0117, section 2, and it matters:
 *
 * 1. The rows are already current per (scope, kind), so an older row never
 *    stands in for a newer one that is not valid yet.
 * 2. Keep the eligible rows: the kind is enabled, `now` is inside the window
 *    where one is set, and the age is within `maxAgeDays` where one is set.
 * 3. Per kind, the narrowest eligible scope wins (plan 0105, section 4). **Only
 *    among prices valid now**: a warehouse walked once months ago does not
 *    hide the region price written this morning. Per product, not per scope.
 * 4. A protected `ADMIN` row disputed by one of those rows is dropped (section
 *    4.2). An expired automated row has said nothing new and disputes nothing.
 * 5. Take the highest priority. A protected and undisputed `ADMIN` row ranks
 *    above every priority in the table. Ties go to the newest `lastObservedAt`.
 * 6. Nothing eligible: the newest enabled row of the stack, flagged stale
 *    (section 5). An expired leaflet is included; a disabled kind is not.
 */
export function resolveEffectivePrice(
  input: EffectivePriceInput
): EffectivePrice {
  const policies = new Map(input.policies.map((p) => [p.sourceKind, p]));
  const now = input.now.getTime();
  const chosen = narrowestEligiblePerKind(
    input.rows,
    input.priceScopeId,
    input.policies,
    input.now,
    input.scopePriorities
  );

  // An ADMIN row inside its window and disputed is not eligible: a source that
  // said something new displaces it at once. Past the window it competes at
  // its policy priority like any other row.
  const survivors = chosen.filter(
    (row) => !(isProtected(row, now) && isDisputed(row, chosen))
  );

  const nextBoundaryAt = boundaryOf(
    chosen,
    input.rows,
    policies,
    now,
    input.nextValidFrom ?? null
  );

  if (survivors.length > 0) {
    const rank = (row: PriceRow): number =>
      isProtected(row, now)
        ? Number.NEGATIVE_INFINITY
        : (policies.get(row.sourceKind)?.priority ?? Number.POSITIVE_INFINITY);
    const [best, runnerUp] = [...survivors].sort(
      (a, b) =>
        rank(a) - rank(b) ||
        b.lastObservedAt.getTime() - a.lastObservedAt.getTime()
    );
    const shownBecause = isProtected(best, now)
      ? PriceShownBecause.PROTECTED_ADMIN
      : runnerUp === undefined
        ? PriceShownBecause.ONLY_ROW
        : rank(best) < rank(runnerUp)
          ? PriceShownBecause.POLICY_PRIORITY
          : PriceShownBecause.NEWEST;
    return { row: best, stale: false, shownBecause, nextBoundaryAt };
  }

  // Newest first, and on a tie the narrower scope, so the stale answer does not
  // depend on the order the rows arrived in.
  const narrower = narrownessOf(input.priceScopeId, input.scopePriorities);
  const enabled = input.rows.filter(
    (row) => policies.get(row.sourceKind)?.enabled === true
  );
  const [newest] = [...enabled].sort(
    (a, b) =>
      b.lastObservedAt.getTime() - a.lastObservedAt.getTime() || narrower(a, b)
  );
  if (newest === undefined) {
    return { row: null, stale: false, shownBecause: null, nextBoundaryAt };
  }
  return {
    row: newest,
    stale: true,
    shownBecause:
      enabled.length === 1
        ? PriceShownBecause.ONLY_ROW
        : PriceShownBecause.NEWEST,
    nextBoundaryAt,
  };
}

/**
 * Steps 2 and 3 of plan 0117, section 2: the narrowest row of each kind among
 * the rows valid now.
 *
 * Exported because the price writer takes an `ADMIN` row's snapshot from this
 * same set (section 4), so what a correction records and what later disputes
 * it are one function. The SQL in `effective-price.service.ts` computes the same
 * set, and `effective-price.spec.ts` pins the rule it follows.
 */
export function narrowestEligiblePerKind(
  rows: readonly PriceRow[],
  priceScopeId: string,
  policies: readonly PolicyRow[],
  now: Date,
  scopePriorities?: ReadonlyMap<string, number>
): PriceRow[] {
  const byKind = new Map(policies.map((p) => [p.sourceKind, p]));
  return narrowestPerKind(
    rows.filter((row) => isEligible(row, byKind.get(row.sourceKind), now)),
    priceScopeId,
    scopePriorities
  );
}

/**
 * Whether a row may be shown as it is now: its kind is enabled, `now` is inside
 * its window, and it is younger than its kind's max age.
 *
 * The age test is strict at the boundary, like `validUntil`: at
 * `lastObservedAt + maxAgeDays` the row is expired, so the instant the sweep
 * is woken for is an instant the answer really changes at.
 */
export function isEligible(
  row: PriceRow,
  policy: PolicyRow | undefined,
  now: Date
): boolean {
  if (!policy || !policy.enabled) {
    return false;
  }
  const at = now.getTime();
  if (row.validFrom && row.validFrom.getTime() > at) {
    return false;
  }
  if (row.validUntil && row.validUntil.getTime() <= at) {
    return false;
  }
  const expiry = ageExpiryOf(row, policy);
  return expiry === null || expiry > at;
}

/**
 * The protection test of section 4.2, inverted: does any automated kind
 * disagree with what this `ADMIN` row recorded?
 *
 * The rows compared against are the narrowest **eligible** row of each kind
 * (plan 0117, section 4): a source that has not spoken within its max age has
 * said nothing new, so it cannot displace a hand correction.
 *
 * A kind with a row and no entry disagrees the moment it appears: a source
 * reporting for the first time is new information by construction. A kind
 * whose row differs from its entry disagrees. A kind in the snapshot with no
 * row any more is ignored.
 */
export function isDisputed(
  admin: PriceRow,
  candidates: readonly PriceRow[]
): boolean {
  const overrides = admin.overrides ?? {};
  for (const row of candidates) {
    if (!AUTOMATED_KINDS.includes(row.sourceKind)) {
      continue;
    }
    const recorded = overrides[row.sourceKind];
    if (!recorded) {
      return true;
    }
    if (
      toNumber(recorded.price) !== toNumber(row.price) ||
      toNumber(recorded.unitPrice) !== toNumber(row.unitPrice)
    ) {
      return true;
    }
  }
  return false;
}

/** Whether an `ADMIN` row is still inside its protection window. */
function isProtected(row: PriceRow, now: number): boolean {
  return (
    row.sourceKind === PriceSourceKind.ADMIN &&
    row.protectedUntil !== null &&
    row.protectedUntil.getTime() > now
  );
}

/**
 * Section 6, widened by plan 0105 section 4: several rows of one kind, one per
 * scope of the shop's stack, and the most specific wins.
 *
 * **Within a shop, specific beats cheap.** A national fallback that happens to
 * undercut the regional price the shop actually charges must not be chosen
 * here: the shopper would be quoted a number no till will ring up. Cheapest
 * still decides *between* shops, which is a different question asked later
 * (section 4, D4).
 *
 * Ties are possible, because two scopes may sit at one priority. The scope
 * being computed wins one, and after that the newer observation does, so the
 * answer is stable rather than dependent on row order.
 */
export function narrowestPerKind(
  rows: readonly PriceRow[],
  priceScopeId: string,
  scopePriorities?: ReadonlyMap<string, number>
): PriceRow[] {
  const narrower = narrownessOf(priceScopeId, scopePriorities);
  const byKind = new Map<PriceSourceKind, PriceRow>();
  for (const row of rows) {
    const held = byKind.get(row.sourceKind);
    if (!held || beats(row, held)) {
      byKind.set(row.sourceKind, row);
    }
  }
  return [...byKind.values()];

  function beats(row: PriceRow, held: PriceRow): boolean {
    const order = narrower(row, held);
    if (order !== 0) {
      return order < 0;
    }
    return row.lastObservedAt.getTime() > held.lastObservedAt.getTime();
  }
}

/**
 * A comparator by scope alone: negative when `a` sits at a more specific scope
 * than `b`. The lower priority first, then the scope being computed.
 */
function narrownessOf(
  priceScopeId: string,
  scopePriorities?: ReadonlyMap<string, number>
): (a: PriceRow, b: PriceRow) => number {
  const priorityOf = (row: PriceRow): number => {
    const stated = scopePriorities?.get(row.priceScopeId);
    if (stated !== undefined) {
      return stated;
    }
    // No map, or a scope the caller did not rank: the two tier rule.
    return row.priceScopeId === priceScopeId
      ? Number.NEGATIVE_INFINITY
      : Number.POSITIVE_INFINITY;
  };
  return (a, b) => {
    // Compared and not subtracted: the fallback ranks are infinities, and
    // `Infinity - Infinity` is NaN, which reads as "not equal" and then loses
    // every comparison, so two unranked rows would never reach the tie breaks.
    const mine = priorityOf(a);
    const theirs = priorityOf(b);
    if (mine !== theirs) {
      return mine < theirs ? -1 : 1;
    }
    const aHere = a.priceScopeId === priceScopeId;
    const bHere = b.priceScopeId === priceScopeId;
    if (aHere === bHere) {
      return 0;
    }
    return aHere ? -1 : 1;
  };
}

/** `lastObservedAt + maxAgeDays` in epoch milliseconds, or null when the kind never ages. */
function ageExpiryOf(row: PriceRow, policy: PolicyRow): number | null {
  return policy.maxAgeDays === null
    ? null
    : row.lastObservedAt.getTime() + policy.maxAgeDays * DAY_MS;
}

/**
 * The earliest instant the answer can change at without a write (plan 0117,
 * section 6):
 *
 * - each chosen row's expiry, its `validUntil` or `lastObservedAt + maxAgeDays`,
 *   because when it expires the next scope of its kind answers.
 * - a chosen `ADMIN` row's `protectedUntil`, disputed or not, because either
 *   way its rank changes then.
 * - the earliest `validFrom` still ahead among the enabled current rows,
 *   because a row that becomes valid can win.
 *
 * A wider eligible row that was not chosen cannot change the answer by
 * expiring, and a narrower row that already expired cannot come back without a
 * write, which recomputes the key anyway. The stale tier chooses nothing, so it
 * carries only the `validFrom` term.
 */
function boundaryOf(
  chosen: readonly PriceRow[],
  rows: readonly PriceRow[],
  policies: ReadonlyMap<PriceSourceKind, PolicyRow>,
  now: number,
  nextValidFrom: Date | null
): Date | null {
  let earliest: number | null = null;
  const consider = (time: number | null) => {
    if (time !== null && time > now && (earliest === null || time < earliest)) {
      earliest = time;
    }
  };
  for (const row of chosen) {
    const policy = policies.get(row.sourceKind);
    if (!policy) {
      continue;
    }
    consider(row.validUntil?.getTime() ?? null);
    consider(ageExpiryOf(row, policy));
    if (row.sourceKind === PriceSourceKind.ADMIN) {
      consider(row.protectedUntil?.getTime() ?? null);
    }
  }
  for (const row of rows) {
    if (policies.get(row.sourceKind)?.enabled === true) {
      consider(row.validFrom?.getTime() ?? null);
    }
  }
  consider(nextValidFrom?.getTime() ?? null);
  return earliest === null ? null : new Date(earliest);
}

/** Postgres `numeric` arrives as a string; a snapshot holds a number. One shape for the comparison. */
export function toNumber(
  value: number | string | null | undefined
): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  return Number(value);
}
