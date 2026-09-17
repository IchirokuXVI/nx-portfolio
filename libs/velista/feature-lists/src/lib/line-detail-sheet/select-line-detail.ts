import {
  ESTIMATE_MIN_PURCHASES,
  ESTIMATE_ROUGH_TO,
  inLocale,
  PURCHASE_MERGE_MS,
  toSettlementRow,
  type CatalogItem,
  type ConsumptionEstimateVm,
  type Line,
  type LineDetailVm,
  type LineIndicator,
  type LineSettlement,
} from '@portfolio/velista/models';

/**
 * Re-exported so the two screens in this library keep importing it from here.
 *
 * It **moved to `models`** with velista plan 0049 section 1.1, because the basket's own
 * settlement history draws the same row and reaching into this library for it would be
 * a feature library depending on a feature library. Nothing about the row changed.
 */
export { toSettlementRow };

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
  /**
   * Resolves a product id to what the catalog calls it, or null while unknown.
   *
   * The catalog, through `ItemNames`, and **never a fixture**. It was
   * `catalogItemById` from `catalog-memory.ts` until velista plan 0047 section 1: a
   * hand written set of a few Spanish products that every id missed against a real
   * catalog, so this screen told the reader their line had no products when it had
   * some. The rule that broke is worth stating rather than only fixing: a `*Memory`
   * module is imported by its own token binding and by specs, never by a feature
   * library.
   */
  readonly itemNameOf: (itemId: string) => CatalogItem | null;
  /**
   * Whether the name lookup failed, as opposed to answering with nothing.
   *
   * The two are different sentences and neither may be drawn as the other (section
   * 1.2). A failure is a fact about the request; an empty set is a fact about the
   * line.
   */
  readonly namesUnavailable: boolean;
  /** Who is out buying this, already resolved to a name, or null. */
  readonly claimedBy: string | null;
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
    namesUnavailable: input.namesUnavailable && line.itemIds.length > 0,
    lastPurchase: rows.find((row) => row.outcome === 'BOUGHT') ?? null,
    estimate: estimateFrom(purchases),
    // Nothing to ask on a free text line, and nothing to ask on a line with one
    // product: those two are the same answer here (section 5.2).
    choices: chips.length > 1 ? chips : [],
    preselectedItemId: preselectedFrom(line, purchases),
    canSettle: input.canSettle,
    indicators: input.indicators,
    claimedBy: input.claimedBy,
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
    // A product that cannot be named falls back to the **count**, never to the name
    // phrase with an empty name (section 1.2). It reaches this either because the
    // lookup failed or because the catalog no longer has that product, and the reader
    // is owed the same sentence in both cases: there is one product here and we cannot
    // tell you what it is called. Which of the two it was is the failure line's to say.
    return only === null
      ? {
          productsKey: 'list.detail.products.unnamed',
          productsArgs: { count: 1 },
        }
      : {
          productsKey: 'list.detail.products.one',
          productsArgs: { name: inLocale(only.name, input.locale) },
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
 *
 * **Purchases are merged first** (velista `0089`, section 4). One trip writes several
 * settlements for one line seconds apart, one per origin and one per partial settle, and
 * read as they are they put gaps of zero into the median. So they are folded as backend
 * `0123` section 3 step 1 folds them, and the floor, the count and the rough range all
 * count merged purchases. Without the fold the sheet said "every 3 days" of a line the
 * list calls "every 7 days".
 */
export function estimateFrom(
  purchases: readonly LineSettlement[]
): ConsumptionEstimateVm | null {
  const times = mergedPurchaseTimes(purchases);
  if (times.length < ESTIMATE_MIN_PURCHASES) {
    return null;
  }

  // Oldest first after the fold, so the gaps come out positive without a second sort.
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i += 1) {
    gaps.push((times[i] - times[i - 1]) / 86_400_000);
  }

  gaps.sort((a, b) => a - b);
  const middle = Math.floor(gaps.length / 2);
  const median =
    gaps.length % 2 === 0
      ? (gaps[middle - 1] + gaps[middle]) / 2
      : gaps[middle];

  return {
    medianDays: Math.max(1, Math.round(median)),
    fromPurchases: times.length,
    // Three to six say "every few weeks"; seven and up give the days (velista plan
    // 0047, section 5). Decided here rather than in each template, so the sheet and the
    // page cannot hedge differently about the same history.
    rough: times.length <= ESTIMATE_ROUGH_TO,
  };
}

/**
 * One time per merged purchase, oldest first.
 *
 * Sorted, then every purchase closer than {@link PURCHASE_MERGE_MS} to **the one before
 * it** joins that one, which keeps the first time of the run. The one before it and not
 * the first of the run, so a slow partial settle that writes a row every few hours stays
 * one purchase, exactly as `mergePurchases` in core decides it.
 */
function mergedPurchaseTimes(purchases: readonly LineSettlement[]): number[] {
  const sorted = purchases
    .map((purchase) => purchase.settledAt.getTime())
    .sort((a, b) => a - b);

  const merged: number[] = [];
  let previous: number | null = null;
  for (const at of sorted) {
    if (previous === null || at - previous >= PURCHASE_MERGE_MS) {
      merged.push(at);
    }
    previous = at;
  }
  return merged;
}
