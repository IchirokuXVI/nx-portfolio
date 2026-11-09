import {
  lineAmountOf,
  priceOfOne,
  type LineAmountProduct,
  type LineUnit,
  type ProductKind,
} from '@portfolio/luna-shopper/contracts';

/**
 * The rules that turn the entries of a basket row into its state, its numbers
 * and the progress of the basket (plan 0204, section 4).
 *
 * **One rule, two callers.** Core calls these on every read and on every patch
 * it publishes. Velista calls them to rebuild a row after it applied a patch,
 * so the two cannot disagree about what a row reads as.
 *
 * ## Framework free, by hard constraint
 *
 * No Nest, no TypeORM, no Angular and no `process`. An Angular build compiles
 * this file under a configuration that has no node types. Every type here is
 * declared here, and each caller maps its own rows and models into them.
 *
 * **One import from the contracts library, of plain values** (plan 0246,
 * section 4.3): `lineAmountOf` and `priceOfOne`, the two pure functions of the
 * amount of a line, and the three plain types they take. They are browser
 * reachable as the rest of `units/` is, and a second copy of the table here
 * would be the one copy of the two that drifts.
 *
 * ## No clock
 *
 * Whether a skip or a close still holds is a boolean that the database decided
 * (`skipped`, `closed`). These functions order two acts by `at` and compare
 * nothing with the present, so two readers with two clocks agree.
 */

/**
 * The states of a row or of an entry, by the table of plan 0130, section 4,
 * and `BOUGHT_ELSEWHERE` of plan 0203, section 3.
 */
export const BASKET_RULE_STATES = {
  WANTED: 'WANTED',
  PARTLY: 'PARTLY',
  DONE: 'DONE',
  BOUGHT_ELSEWHERE: 'BOUGHT_ELSEWHERE',
  NOT_AVAILABLE: 'NOT_AVAILABLE',
  SKIPPED: 'SKIPPED',
  REMOVED: 'REMOVED',
} as const;

export type BasketRuleState =
  (typeof BASKET_RULE_STATES)[keyof typeof BASKET_RULE_STATES];

/** What {@link BasketRuleAct.outcome} says for a skip, which is no settlement. */
export const BASKET_RULE_ACT_SKIPPED = 'SKIPPED';

/**
 * The newest standing act of one basket on one line.
 *
 * `outcome` is a plain string on purpose. The one thing these rules ask of it
 * is whether the act was a skip, and each caller holds its own enum.
 */
export interface BasketRuleAct {
  participantId: string | null;
  /** An ISO 8601 instant in UTC, as `Date.prototype.toISOString` writes it. */
  at: string;
  outcome: string;
}

/** One line of a row, as one basket reads it. */
export interface BasketRuleEntry {
  /** What the list still asks for. */
  left: number;
  /** What this basket bought, in scope. */
  bought: number;
  /** What another basket, or none, bought lately. */
  boughtElsewhere: number;
  /** A standing skip of this basket, inside its window. */
  skipped: boolean;
  /** The newest standing act is "they had none", and it still holds. */
  closed: boolean;
  act: BasketRuleAct | null;
}

/** The numbers of a row, and the newest act over its entries. */
export interface BasketRuleNumbers {
  left: number;
  bought: number;
  /** `bought + left`. */
  asked: number;
  boughtElsewhere: number;
  act: BasketRuleAct | null;
}

/** The numbers a basket card draws (plan 0130, section 4). */
export interface BasketRuleProgress {
  done: number;
  unavailable: number;
  total: number;
  pending: number;
}

/**
 * The state of a row from its entries (plan 0130, section 4).
 *
 * The same rule answers for one entry, asked of a group of one.
 *
 * The order is the order of the table:
 *
 * 1. **`SKIPPED`**: something is left, and every entry that still asks for
 *    something is skipped. One entry that is not skipped makes the row wanted
 *    again, because new demand is a reason to look at the row again. An entry at
 *    zero is not asked: nothing is left of it to skip.
 * 2. **`NOT_AVAILABLE`**: something is left, and the newest purchase or close
 *    over the row is a close that still holds. Tested before `DONE` and guarded
 *    on `left`, so a demand taken to zero after a close does not leave a row
 *    that says the shop had none of a thing nobody asks for.
 * 3. **`DONE`**: nothing is left, and this basket bought some of it. Another
 *    basket can have bought the rest: a row that asked for 3 and bought 2 here
 *    is done, and it reads "2 of 2" because `asked` is `bought + left`.
 * 4. **`BOUGHT_ELSEWHERE`**: nothing is left, this basket bought none of it,
 *    and somebody else bought some lately (plan 0203, which reversed plan
 *    0188). A row of several lines has it only when nothing is left on any of
 *    them and this basket bought none of them, which is what the sums say.
 * 5. **`PARTLY`**: something is left and this basket bought some.
 * 6. **`WANTED`** otherwise.
 *
 * `REMOVED` is never an answer here. A removed row has no entries.
 */
export function rowStateOf(
  entries: readonly BasketRuleEntry[]
): BasketRuleState {
  const { left, bought, boughtElsewhere } = sumsOf(entries);

  if (left > 0) {
    const asking = entries.filter((entry) => entry.left > 0);
    if (asking.every((entry) => entry.skipped)) {
      return BASKET_RULE_STATES.SKIPPED;
    }
    if (newestSettled(entries)?.closed) {
      return BASKET_RULE_STATES.NOT_AVAILABLE;
    }
    return bought > 0 ? BASKET_RULE_STATES.PARTLY : BASKET_RULE_STATES.WANTED;
  }

  if (bought > 0) {
    return BASKET_RULE_STATES.DONE;
  }
  return boughtElsewhere > 0
    ? BASKET_RULE_STATES.BOUGHT_ELSEWHERE
    : BASKET_RULE_STATES.WANTED;
}

/**
 * The numbers of a row as sums, and the newest act over its entries.
 *
 * `boughtElsewhere` is in neither `bought` nor `asked`: those units were never
 * this basket's to buy (plan 0188). It is a number that no count uses (plan
 * 0203, section 3).
 */
export function rowNumbersOf(
  entries: readonly BasketRuleEntry[]
): BasketRuleNumbers {
  const { left, bought, boughtElsewhere } = sumsOf(entries);
  let act: BasketRuleAct | null = null;
  for (const entry of entries) {
    if (entry.act && (!act || isNewer(entry.act, act))) {
      act = entry.act;
    }
  }
  return { left, bought, asked: bought + left, boughtElsewhere, act };
}

/**
 * The progress of a basket from the states of its rows.
 *
 * A `REMOVED` row counts for nothing, and neither does a `BOUGHT_ELSEWHERE`
 * row: a buy made outside a basket counts toward no number of it (plan 0203,
 * section 4). A `SKIPPED` row is pending: it is neither done nor unavailable,
 * and somebody still has to decide about it.
 */
export function progressOf(
  rows: readonly { state: string }[]
): BasketRuleProgress {
  const counted = rows.filter(
    (row) =>
      row.state !== BASKET_RULE_STATES.REMOVED &&
      row.state !== BASKET_RULE_STATES.BOUGHT_ELSEWHERE
  );
  const done = counted.filter(
    (row) => row.state === BASKET_RULE_STATES.DONE
  ).length;
  const unavailable = counted.filter(
    (row) => row.state === BASKET_RULE_STATES.NOT_AVAILABLE
  ).length;
  return {
    done,
    unavailable,
    total: counted.length,
    pending: counted.length - done - unavailable,
  };
}

/** What the product of a line is decided from (plan 0201, section 1). */
export interface BasketRuleLine {
  /** The products of the line, in the order the line holds them. */
  itemIds: readonly string[];
  /** The favourite of the line, or null. */
  favoriteItemId: string | null;
  /**
   * The product of the latest standing buy of the line through this basket in
   * its trip, or null. It does not have to be a product of the line.
   */
  tripItemId: string | null;
}

/**
 * The one product a line counts as in a basket, or null (plan 0201, section
 * 1). The first of these that applies:
 *
 * 1. **The product of its latest buy in this trip.** A change "for this trip
 *    only" holds from the first buy until the trip ends, so this product can
 *    be one the line does not hold.
 * 2. **Its favourite**, when the favourite is one of its products. The
 *    favourite wins also when the shop of the read does not sell it.
 * 3. **`pick`**, the cheapest of its products, which only a caller that reads
 *    prices can name. A pick that is not a product of the line is ignored.
 * 4. **Its first product.**
 * 5. **Nothing**, for a line with no products.
 *
 * A caller with no prices passes no pick, and the line falls to step 4.
 */
export function lineProductOf(
  line: BasketRuleLine,
  pick?: string | null
): string | null {
  if (line.tripItemId) {
    return line.tripItemId;
  }
  if (line.favoriteItemId && line.itemIds.includes(line.favoriteItemId)) {
    return line.favoriteItemId;
  }
  if (pick && line.itemIds.includes(pick)) {
    return pick;
  }
  return line.itemIds[0] ?? null;
}

/**
 * Whether a line reaches step 3 of {@link lineProductOf}, so that its product
 * depends on a price: two or more products, no favourite among them, and no
 * buy in this trip.
 */
export function needsPriceChoice(line: BasketRuleLine): boolean {
  if (line.tripItemId || line.itemIds.length < 2) {
    return false;
  }
  return !(line.favoriteItemId && line.itemIds.includes(line.favoriteItemId));
}

/**
 * One product with the figures of one offer at the scopes that count, for
 * {@link cheapestOf} (plan 0246, section 4.3): how it is sold, its size
 * fields, and its two prices in euros.
 */
export interface BasketRulePrice {
  itemId: string;
  kind: ProductKind;
  /** The unit the product was created in, which says what its size is in. */
  defaultUnit: LineAmountProduct['defaultUnit'];
  unitSize: number | null;
  approxWeight: number | null;
  /** The price of one of what the row names, or null. */
  price: number | null;
  /** The price of one piece of a kilo piece, or null (plan 0244). */
  piecePrice: number | null;
}

/** What a line asks for, as {@link cheapestOf} orders its products by. */
export interface BasketRuleAmount {
  unit: LineUnit;
  /** In {@link unit}, an integer. Zero is a line that asks for nothing now. */
  quantity: number;
}

/**
 * The cheapest of these products for this line, or null when none can serve
 * it (plan 0201, section 1, step 3; plan 0246, section 4.3).
 *
 * **The cost of the line's amount decides, and the price of one is what each
 * product shows** (owner, W3). The candidates are the products that can serve
 * the line's unit at all: `lineAmountOf(max(quantity, 1), …)` is not null. A
 * loose product cannot serve a count line and a counted pack cannot serve a
 * weight line, and a missing figure is a missing amount. They are ordered by
 * `lineAmountOf(quantity, …).cents` when the line has an amount, and by
 * `priceOfOne` when it is at zero. So a pick can change when the amount does,
 * which is right: 500 g of bananas is cheapest loose, and a whole melon is
 * cheapest as the piece.
 *
 * `unitPrice` and the comparable price of plan 0245 are not read: they answer
 * which kilo is cheapest, and W3 asks what this line costs with each product.
 *
 * A tie keeps the order of the input, which is the order the line holds its
 * products in. The caller decides which prices count: with a shop, only the
 * prices of that shop.
 */
export function cheapestOf(
  prices: readonly BasketRulePrice[],
  line: BasketRuleAmount
): string | null {
  let best: { itemId: string; cost: number } | null = null;
  for (const candidate of prices) {
    const cost = costOf(candidate, line);
    if (cost === null) {
      continue;
    }
    // Strictly cheaper, so an equal cost keeps the product that came first.
    if (best === null || cost < best.cost) {
      best = { itemId: candidate.itemId, cost };
    }
  }
  return best?.itemId ?? null;
}

/** What {@link cheapestOf} orders a candidate by, or null for none. */
function costOf(
  candidate: BasketRulePrice,
  line: BasketRuleAmount
): number | null {
  const product: LineAmountProduct = {
    kind: candidate.kind,
    defaultUnit: candidate.defaultUnit,
    unitSize: candidate.unitSize,
    approxWeight: candidate.approxWeight,
  };
  const offer = { price: candidate.price, piecePrice: candidate.piecePrice };
  const serves = lineAmountOf(
    Math.max(line.quantity, 1),
    line.unit,
    product,
    offer
  );
  if (serves === null) {
    return null;
  }
  if (line.quantity > 0) {
    return (
      lineAmountOf(line.quantity, line.unit, product, offer)?.cents ?? null
    );
  }
  return priceOfOne(product, offer);
}

function sumsOf(entries: readonly BasketRuleEntry[]): {
  left: number;
  bought: number;
  boughtElsewhere: number;
} {
  let left = 0;
  let bought = 0;
  let boughtElsewhere = 0;
  for (const entry of entries) {
    left += entry.left;
    bought += entry.bought;
    boughtElsewhere += entry.boughtElsewhere;
  }
  return { left, bought, boughtElsewhere };
}

/**
 * The entry that holds the newest purchase or close of the row, or null.
 *
 * An entry whose newest act is a skip is not asked. A skip ends a close that
 * came before it on the same line (plan 0137, section 3.2), so that entry has
 * no close left to state.
 */
function newestSettled(
  entries: readonly BasketRuleEntry[]
): BasketRuleEntry | null {
  let newest: BasketRuleEntry | null = null;
  for (const entry of entries) {
    if (!entry.act || entry.act.outcome === BASKET_RULE_ACT_SKIPPED) {
      continue;
    }
    if (!newest?.act || entry.act.at >= newest.act.at) {
      newest = entry;
    }
  }
  return newest;
}

/**
 * Whether `act` is newer than `held`.
 *
 * At the same instant a purchase or a close wins over a skip, which is the
 * order the read always had: a skip names a row only when it is strictly later.
 */
function isNewer(act: BasketRuleAct, held: BasketRuleAct): boolean {
  if (act.at !== held.at) {
    return act.at > held.at;
  }
  return (
    held.outcome === BASKET_RULE_ACT_SKIPPED &&
    act.outcome !== BASKET_RULE_ACT_SKIPPED
  );
}
