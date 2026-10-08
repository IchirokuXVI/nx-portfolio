import type { CatalogBrowseContext } from './catalog-browse';
import type { LocalizedName } from './shopping-profile';

/**
 * One step of a price: it holds from `at` until the next point (velista `0134`,
 * section 6; backend `0196`, section 2). A null price means nothing was shown.
 */
export interface PricePoint {
  readonly at: Date;
  readonly price: number | null;
  readonly unitPrice: number | null;
}

/** What one price scope showed over the range that was read. */
export interface ScopePriceSeries {
  readonly priceScopeId: string;
  readonly supermarketId: string;
  /** Oldest first. The first point is at the start of the range. */
  readonly points: readonly PricePoint[];
}

/** The price history of one product (`GET /v1/catalog/items/:id/price-history`). */
export interface ProductPriceHistory {
  readonly from: Date;
  readonly to: Date;
  readonly series: readonly ScopePriceSeries[];
}

/** How far back the chart looks. It opens on `quarter`. */
export type PriceHistoryRange = 'month' | 'quarter' | 'year';

export const PRICE_HISTORY_RANGES: readonly PriceHistoryRange[] = [
  'month',
  'quarter',
  'year',
];

export const PRICE_HISTORY_DEFAULT_RANGE: PriceHistoryRange = 'quarter';

const DAY_MS = 24 * 60 * 60 * 1000;

const RANGE_DAYS: Record<PriceHistoryRange, number> = {
  month: 30,
  quarter: 91,
  year: 365,
};

/** The longest range, which is what one read asks for. The others are cut from it. */
export const PRICE_HISTORY_READ_DAYS = RANGE_DAYS.year;

/** How many lines the chart draws at most, which is how many colours it has. */
export const PRICE_HISTORY_MAX_CHAINS = 5;

/** One step of a chain's line, with the time as a number for the scale. */
export interface ChainPriceStep {
  readonly at: number;
  readonly price: number | null;
}

/** One chain's line. */
export interface ChainPriceHistory {
  readonly supermarketId: string;
  readonly chain: LocalizedName;
  /**
   * Which of the chart's colours this chain wears, from zero. It belongs to the
   * chain: hiding another chain or changing the range does not move it.
   */
  readonly slot: number;
  /** Oldest first. */
  readonly steps: readonly ChainPriceStep[];
}

/**
 * The history as one line for each chain of the shopping profile.
 *
 * - **A chain is one line, at its lowest price.** A profile can resolve to several
 *   scopes of one chain, and the price table names the chain once at its cheapest
 *   scope. The line agrees with the table: at each moment it is the lowest price
 *   any of the chain's scopes showed.
 * - A chain with no price anywhere in the read has no line.
 * - **More than five chains draw the five with the lowest price today.** A chain
 *   with no price today goes after every chain with one.
 * - **The colour follows the chain.** The slots are given in the order of the
 *   chain ids, which no press on the page changes.
 *
 * The lines come back cheapest today first, which is the order of the table above
 * the chart.
 */
export function chainPriceHistories(
  history: ProductPriceHistory,
  context: CatalogBrowseContext
): readonly ChainPriceHistory[] {
  const byChain = new Map<string, ScopePriceSeries[]>();
  for (const series of history.series) {
    const held = byChain.get(series.supermarketId);
    if (held === undefined) {
      byChain.set(series.supermarketId, [series]);
    } else {
      held.push(series);
    }
  }

  const lines: { id: string; chain: LocalizedName; steps: ChainPriceStep[] }[] =
    [];
  for (const [supermarketId, scopes] of byChain) {
    const chain =
      context.chains.find((held) => held.supermarketId === supermarketId)
        ?.name ?? context.chainNames.get(supermarketId);
    const steps = lowestSteps(scopes);
    // A chain nobody can name is skipped, as the price table skips it.
    if (chain !== undefined && steps.some((step) => step.price !== null)) {
      lines.push({ id: supermarketId, chain, steps });
    }
  }

  const today = (steps: readonly ChainPriceStep[]): number =>
    steps[steps.length - 1]?.price ?? Number.POSITIVE_INFINITY;
  const kept = lines
    .sort(
      (left, right) =>
        today(left.steps) - today(right.steps) ||
        left.id.localeCompare(right.id)
    )
    .slice(0, PRICE_HISTORY_MAX_CHAINS);

  const slots = kept.map((line) => line.id).sort();
  return kept.map((line) => ({
    supermarketId: line.id,
    chain: line.chain,
    slot: slots.indexOf(line.id),
    steps: line.steps,
  }));
}

/** The lowest price among several scopes, as steps, with equal neighbours merged. */
function lowestSteps(scopes: readonly ScopePriceSeries[]): ChainPriceStep[] {
  const instants = [
    ...new Set(
      scopes.flatMap((scope) => scope.points.map((point) => point.at.getTime()))
    ),
  ].sort((left, right) => left - right);

  const steps: ChainPriceStep[] = [];
  for (const at of instants) {
    let lowest: number | null = null;
    for (const scope of scopes) {
      const price = priceAt(
        scope.points.map((point) => ({
          at: point.at.getTime(),
          price: point.price,
        })),
        at
      );
      if (price !== null && (lowest === null || price < lowest)) {
        lowest = price;
      }
    }
    const last = steps[steps.length - 1];
    if (last === undefined || last.price !== lowest) {
      steps.push({ at, price: lowest });
    }
  }
  return steps;
}

/** What a line showed at one moment: the last step that is not after it. */
export function priceAt(
  steps: readonly ChainPriceStep[],
  at: number
): number | null {
  let price: number | null = null;
  for (const step of steps) {
    if (step.at > at) {
      break;
    }
    price = step.price;
  }
  return price;
}

/** The start of a range that ends at `to`. */
export function priceHistoryStart(range: PriceHistoryRange, to: Date): Date {
  return new Date(to.getTime() - RANGE_DAYS[range] * DAY_MS);
}

/**
 * A line cut to a window: its first step is at `from` with the price in force
 * then, and no step is after `to`.
 */
export function stepsWithin(
  steps: readonly ChainPriceStep[],
  from: number,
  to: number
): readonly ChainPriceStep[] {
  const inside = steps.filter((step) => step.at > from && step.at <= to);
  const opening = priceAt(steps, from);
  const cut: ChainPriceStep[] = [{ at: from, price: opening }];
  for (const step of inside) {
    if (step.price !== cut[cut.length - 1].price) {
      cut.push(step);
    }
  }
  return cut;
}

/**
 * How many prices a window holds over all its lines. Under two, the page says one
 * sentence and draws no chart (section 6): one flat price is not a movement.
 */
export function pricesWithin(
  lines: readonly (readonly ChainPriceStep[])[]
): number {
  return lines.reduce(
    (count, steps) =>
      count + steps.filter((step) => step.price !== null).length,
    0
  );
}

/** The price axis: its ends and its grid lines, lowest first. */
export interface PriceScale {
  readonly min: number;
  readonly max: number;
  readonly ticks: readonly number[];
}

const NICE_STEPS = [
  0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200,
  250, 500, 1000,
];

/** How many spaces the axis has between its grid lines. */
const SCALE_INTERVALS = 3;

/**
 * An axis of four grid lines on round prices that holds every value.
 *
 * It does not start at zero. The chart is about a price moving by cents, and an
 * axis from zero would draw every chain as one flat line at the top.
 */
export function priceScale(values: readonly number[]): PriceScale {
  const low = values.length === 0 ? 0 : Math.min(...values);
  const high = values.length === 0 ? 1 : Math.max(...values);

  for (const step of NICE_STEPS) {
    const min = Math.floor(round(low / step)) * step;
    const max = min + SCALE_INTERVALS * step;
    if (max >= high && max > min) {
      return {
        min: round(min),
        max: round(max),
        ticks: Array.from({ length: SCALE_INTERVALS + 1 }, (_, index) =>
          round(min + index * step)
        ),
      };
    }
  }
  return { min: low, max: high, ticks: [low, high] };
}

/** Binary fractions make 0.1 * 3 a long number. Prices have at most four decimals. */
function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/**
 * The path of one line: flat until the price changes, then straight up or down to
 * the new price. A price holds until it changes, so the line is steps and never a
 * slope. Where nothing was shown the pen lifts.
 *
 * `x` and `y` place a time and a price. `to` is where the last step ends.
 */
export function steppedPath(
  steps: readonly ChainPriceStep[],
  to: number,
  x: (at: number) => number,
  y: (price: number) => number
): string {
  const parts: string[] = [];
  let drawing = false;

  steps.forEach((step, index) => {
    const end = steps[index + 1]?.at ?? to;
    if (step.price === null) {
      drawing = false;
      return;
    }
    const level = fixed(y(step.price));
    parts.push(drawing ? `V${level}` : `M${fixed(x(step.at))} ${level}`);
    parts.push(`H${fixed(x(end))}`);
    drawing = true;
  });

  return parts.join('');
}

function fixed(value: number): string {
  return String(Math.round(value * 10) / 10);
}
