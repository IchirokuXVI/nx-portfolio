import {
  ESTIMATE_MIN_PURCHASES,
  inLocale,
  type CatalogItem,
  type ConsumptionEstimateVm,
  type Line,
  type LineDetailVm,
  type LineIndicator,
  type LineSettlement,
  type SettlementRowVm,
} from '@portfolio/velista/models';

/**
 * What the detail sheet draws, as a pure function (velista plan 0043, section 5.1).
 *
 * The same division `selectListState` makes one screen up: the container reads the
 * stores and this decides what the screen says, so the two things worth testing here,
 * the estimate and the preselected product, are testable without a fixture, a socket
 * or a clock.
 */
export interface LineDetailInput {
  readonly line: Line | undefined;
  /**
   * This line's own history, newest first, or **undefined when it has not been read**.
   *
   * The distinction decides what the sheet draws: undefined is a skeleton, and an empty
   * array is a line nothing has ever happened to. Collapsing them would make every
   * line look freshly loaded forever.
   */
  readonly settlements: readonly LineSettlement[] | undefined;
  /** Resolves a product id to what the catalog calls it, or null while unknown. */
  readonly itemNameOf: (itemId: string) => CatalogItem | null;
  /** Resolves a user id to a name in this zone, or null. */
  readonly nameOf: (userId: string) => string | null;
  readonly callerUserId: string | null;
  readonly locale: string;
  /** Whether this caller may record a purchase at all. `DECIDE`. */
  readonly canSettle: boolean;
  readonly indicators: readonly LineIndicator[];
  readonly busy: boolean;
}

export function selectLineDetail(input: LineDetailInput): LineDetailVm | null {
  const { line } = input;
  if (line === undefined) {
    return null;
  }

  const rows = (input.settlements ?? []).map((settlement) =>
    toSettlementRow(settlement, input, null)
  );
  const purchases = (input.settlements ?? []).filter(
    (settlement) => settlement.outcome === 'BOUGHT'
  );

  const chips = line.itemIds.map((itemId) => {
    const item = input.itemNameOf(itemId);
    return {
      itemId,
      name: item === null ? null : inLocale(item.name, input.locale),
      brand: item?.brand ?? null,
      removable: !input.busy,
    };
  });

  return {
    lineId: line.id,
    content: line.content,
    quantity: line.quantity,
    ...productsPhrase(line, input, purchases),
    lastPurchase: rows.find((row) => row.outcome === 'BOUGHT') ?? null,
    estimate: estimateFrom(purchases),
    // Nothing to ask on a free text line, and nothing to ask on a line with one
    // product: those two are the same answer here (section 5.2).
    choices: chips.length > 1 ? chips : [],
    preselectedItemId: preselectedFrom(line, purchases),
    canSettle: input.canSettle,
    indicators: input.indicators,
    busy: input.busy,
  };
}

/**
 * What the line stands for, in one phrase.
 *
 * A key and its arguments rather than an assembled string, because "3 products" and
 * "not linked to a product" are different sentences in every language and neither of
 * them is a name.
 */
function productsPhrase(
  line: Line,
  input: LineDetailInput,
  purchases: readonly LineSettlement[]
): { productsKey: string; productsArgs: Record<string, string | number> } {
  if (line.itemIds.length === 0) {
    return { productsKey: 'list.detail.products.none', productsArgs: {} };
  }

  const lastBoughtId = purchases.find((row) => row.itemId !== null)?.itemId;
  const named =
    lastBoughtId === null || lastBoughtId === undefined
      ? null
      : input.itemNameOf(lastBoughtId);

  if (line.itemIds.length === 1) {
    const only = input.itemNameOf(line.itemIds[0]);
    return {
      productsKey: 'list.detail.products.one',
      productsArgs: {
        name: only === null ? '' : inLocale(only.name, input.locale),
      },
    };
  }

  // With several, the count is the useful thing, and the one last bought is what turns
  // it from a number into a reminder of which the household actually gets.
  return named === null
    ? {
        productsKey: 'list.detail.products.many',
        productsArgs: { count: line.itemIds.length },
      }
    : {
        productsKey: 'list.detail.products.lastBought',
        productsArgs: {
          count: line.itemIds.length,
          name: inLocale(named.name, input.locale),
        },
      };
}

/**
 * Which product the "I bought this" step arrives on: the last one bought, else the
 * first (backend plan 0047, section 3.2).
 *
 * The last one bought, because a household that has bought the same brand four times
 * is going to buy it a fifth, and making them pick it again every time is the kind of
 * friction that stops a history being recorded at all. Filtered against the line's
 * **current** set, since a settlement keeps the product it recorded even after the set
 * it came from has changed.
 */
function preselectedFrom(
  line: Line,
  purchases: readonly LineSettlement[]
): string | null {
  if (line.itemIds.length === 0) {
    return null;
  }

  const lastBought = purchases.find(
    (row) => row.itemId !== null && line.itemIds.includes(row.itemId)
  );
  return lastBought?.itemId ?? line.itemIds[0];
}

/**
 * How often the household gets through this, or **null**.
 *
 * Null below {@link ESTIMATE_MIN_PURCHASES}, which is section 6.3 of backend plan 0047
 * and the one rule here worth stating twice: two purchases define exactly one interval,
 * which is a coincidence rather than a rate. The whole value of this number is that
 * somebody trusts it enough not to check the cupboard, so a confident wrong date is
 * worse than an empty field.
 *
 * The **median** interval and never the mean, because one stock up trip distorts a mean
 * permanently and moves a median by one position.
 */
export function estimateFrom(
  purchases: readonly LineSettlement[]
): ConsumptionEstimateVm | null {
  if (purchases.length < ESTIMATE_MIN_PURCHASES) {
    return null;
  }

  // Newest first on the way in, so the gaps come out positive without a sort.
  const gaps: number[] = [];
  for (let i = 0; i < purchases.length - 1; i += 1) {
    const days =
      (purchases[i].settledAt.getTime() - purchases[i + 1].settledAt.getTime()) /
      86_400_000;
    gaps.push(days);
  }

  gaps.sort((a, b) => a - b);
  const middle = Math.floor(gaps.length / 2);
  const median =
    gaps.length % 2 === 0 ? (gaps[middle - 1] + gaps[middle]) / 2 : gaps[middle];

  return {
    medianDays: Math.max(1, Math.round(median)),
    fromPurchases: purchases.length,
  };
}

/**
 * One settlement, ready to draw.
 *
 * `who` collapses three cases into what a person reads: the reader, somebody named, or
 * nobody. The last covers a settlement with no user at all, which is a guest settling
 * from a shared basket (backend plan 0051), and a name that simply would not resolve.
 * Both draw the neutral phrase, because an id is not a person to somebody reading their
 * own buy history.
 */
export function toSettlementRow(
  settlement: LineSettlement,
  input: {
    nameOf: (userId: string) => string | null;
    callerUserId: string | null;
  },
  listName: string | null
): SettlementRowVm {
  const mine =
    settlement.settledByUserId !== null &&
    settlement.settledByUserId === input.callerUserId;

  return {
    id: settlement.id,
    outcome: settlement.outcome,
    quantity: settlement.quantity,
    who: mine
      ? null
      : settlement.settledByUserId === null
        ? null
        : input.nameOf(settlement.settledByUserId),
    mine,
    at: settlement.settledAt,
    listName,
  };
}
