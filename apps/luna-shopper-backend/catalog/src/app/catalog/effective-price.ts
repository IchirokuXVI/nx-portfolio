import {
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
   * The current row per kind at the scope being computed **and** at the chain's
   * NATIONAL scope (plan 0080, section 6). "Current" is the newest `observedAt`
   * per (scope, kind); the caller's `DISTINCT ON` is what makes that true.
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
}

export interface EffectivePrice {
  /** The row section 4 chose, or null when there is no row at all. */
  row: PriceRow | null;
  /** True when `row` came from the stale tier of section 5. */
  stale: boolean;
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
 * 1. Per kind, the more specific scope wins: a regional leaflet at a warehouse
 *    scope beats the national one for that kind, in that warehouse (section 6),
 *    and with three tiers it is the lowest `priority` that has a row of that
 *    kind (plan 0105, section 4). **Per product, not per scope**: a region that
 *    prices 400 of a chain's 4,000 products answers for those 400, and the
 *    other 3,600 fall through to national.
 * 2. Filter to eligible rows: the kind is enabled, `now` is inside the window
 *    where one is set, the age is within `maxAgeDays` where one is set, and an
 *    `ADMIN` row passes its protection test or is past it (section 4.2).
 * 3. Take the highest priority. A protected and undisputed `ADMIN` row ranks
 *    above every priority in the table.
 * 4. Break ties by the most recent `lastObservedAt`.
 * 5. Nothing eligible: the newest enabled row of any kind, flagged stale
 *    (section 5). An expired leaflet is included; a disabled kind is not.
 */
export function resolveEffectivePrice(
  input: EffectivePriceInput
): EffectivePrice {
  const policies = new Map(input.policies.map((p) => [p.sourceKind, p]));
  const candidates = narrowestPerKind(
    input.rows,
    input.priceScopeId,
    input.scopePriorities
  );
  const enabled = candidates.filter(
    (row) => policies.get(row.sourceKind)?.enabled === true
  );
  const now = input.now.getTime();

  const disputed = (row: PriceRow) => isDisputed(row, candidates);
  const eligible = enabled.filter((row) => {
    const policy = policies.get(row.sourceKind);
    if (!policy) {
      return false;
    }
    if (row.validFrom && row.validFrom.getTime() > now) {
      return false;
    }
    if (row.validUntil && row.validUntil.getTime() <= now) {
      return false;
    }
    if (
      policy.maxAgeDays !== null &&
      now - row.lastObservedAt.getTime() > policy.maxAgeDays * DAY_MS
    ) {
      return false;
    }
    // An ADMIN row inside its window and disputed is not eligible: a source
    // that said something new displaces it at once. Past the window it
    // competes at its policy priority like any other row.
    if (isProtected(row, now) && disputed(row)) {
      return false;
    }
    return true;
  });

  const nextBoundaryAt = boundaryOf(candidates, policies, now);

  if (eligible.length > 0) {
    const rank = (row: PriceRow): number =>
      isProtected(row, now)
        ? Number.NEGATIVE_INFINITY
        : (policies.get(row.sourceKind)?.priority ?? Number.POSITIVE_INFINITY);
    const [best] = [...eligible].sort(
      (a, b) =>
        rank(a) - rank(b) ||
        b.lastObservedAt.getTime() - a.lastObservedAt.getTime()
    );
    return { row: best, stale: false, nextBoundaryAt };
  }

  const [newest] = [...enabled].sort(
    (a, b) => b.lastObservedAt.getTime() - a.lastObservedAt.getTime()
  );
  return { row: newest ?? null, stale: newest !== undefined, nextBoundaryAt };
}

/**
 * The protection test of section 4.2, inverted: does any automated kind
 * disagree with what this `ADMIN` row recorded?
 *
 * A kind with a current row and no entry disagrees the moment it appears: a
 * source reporting for the first time is new information by construction. A
 * kind whose current row differs from its entry disagrees. A kind in the
 * snapshot with no current row any more is ignored.
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

  const byKind = new Map<PriceSourceKind, PriceRow>();
  for (const row of rows) {
    const held = byKind.get(row.sourceKind);
    if (!held || beats(row, held)) {
      byKind.set(row.sourceKind, row);
    }
  }
  return [...byKind.values()];

  function beats(row: PriceRow, held: PriceRow): boolean {
    // Compared and not subtracted: the fallback ranks are infinities, and
    // `Infinity - Infinity` is NaN, which reads as "not equal" and then loses
    // every comparison, so two unranked rows would never reach the tie breaks.
    const mine = priorityOf(row);
    const theirs = priorityOf(held);
    if (mine !== theirs) {
      return mine < theirs;
    }
    if (
      (row.priceScopeId === priceScopeId) !==
      (held.priceScopeId === priceScopeId)
    ) {
      return row.priceScopeId === priceScopeId;
    }
    return row.lastObservedAt.getTime() > held.lastObservedAt.getTime();
  }
}

/**
 * The minimum, over the rows looked at, of the four instants the answer can
 * change at without a write (section 7): a `validFrom` still ahead, a
 * `validUntil` not yet reached, an `ADMIN` row's `protectedUntil`, and
 * `lastObservedAt + maxAgeDays` for a kind with a max age. The fourth is the
 * one a plan that counted three would forget, and forgetting it shows a seven
 * day old crawl price as eligible forever.
 */
function boundaryOf(
  rows: readonly PriceRow[],
  policies: ReadonlyMap<PriceSourceKind, PolicyRow>,
  now: number
): Date | null {
  let earliest: number | null = null;
  const consider = (at: Date | null) => {
    if (at === null) {
      return;
    }
    const time = at.getTime();
    if (time > now && (earliest === null || time < earliest)) {
      earliest = time;
    }
  };
  for (const row of rows) {
    const policy = policies.get(row.sourceKind);
    if (!policy || !policy.enabled) {
      continue;
    }
    consider(row.validFrom);
    consider(row.validUntil);
    if (row.sourceKind === PriceSourceKind.ADMIN) {
      consider(row.protectedUntil);
    }
    if (policy.maxAgeDays !== null) {
      consider(
        new Date(row.lastObservedAt.getTime() + policy.maxAgeDays * DAY_MS)
      );
    }
  }
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
