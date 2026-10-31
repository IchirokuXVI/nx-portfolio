import type { PreviewLineVm } from '@portfolio/velista/models';

/** One invented row of the landing card, before it is translated and formatted. */
export interface PreviewSampleLine {
  /** Names the two keys of the row: `home.preview.line.<key>.content` and `.detail`. */
  readonly key: string;
  /** The price of one, in euros. */
  readonly price: number;
  readonly quantity: number;
  readonly indicator: PreviewLineVm['indicator'];
  readonly givesWay: PreviewLineVm['givesWay'];
}

/**
 * The four rows of the landing card (velista 0175, target 4), in the order they are
 * drawn: Milk, bought and at zero; Eggs; Bananas; Olive oil, not in the shop.
 *
 * Bananas gives way first and Eggs second. Milk and Olive oil always stay, because a
 * line at zero that somebody bought and a line still wanted that the shop did not have
 * are the two states that explain the product (D3).
 */
export const PREVIEW_SAMPLE: readonly PreviewSampleLine[] = [
  {
    key: 'milk',
    price: 0.94,
    quantity: 0,
    indicator: 'bought',
    givesWay: null,
  },
  { key: 'eggs', price: 2.35, quantity: 1, indicator: null, givesWay: 2 },
  { key: 'bananas', price: 1.79, quantity: 2, indicator: null, givesWay: 1 },
  // Still wanted, and the shop had none. Not having found something is not the same as
  // no longer needing it, which is why the number is untouched.
  {
    key: 'oil',
    price: 8.95,
    quantity: 1,
    indicator: 'notAvailable',
    givesWay: null,
  },
];

/** What the progress line says for one number of drawn rows, before formatting. */
export interface PreviewTally {
  readonly givenWay: number;
  readonly rows: number;
  readonly pending: number;
  /** The estimated cost of the pending rows, in euros. */
  readonly total: number;
  readonly settledShare: number;
}

/**
 * The progress line for each step the rows can give way to: none, the first, then the
 * second as well (velista 0175, target 6). Each describes **the rows drawn at that
 * step**, never a hidden one, so with two rows left the card says "1 of 2".
 *
 * A row is settled when it was bought; the one the shop did not have is still pending.
 */
export function previewTallies(
  lines: readonly PreviewSampleLine[]
): readonly PreviewTally[] {
  const steps = Math.max(0, ...lines.map((line) => line.givesWay ?? 0));

  return Array.from({ length: steps + 1 }, (_, givenWay) => {
    const drawn = lines.filter(
      (line) => line.givesWay === null || line.givesWay > givenWay
    );
    const pending = drawn.filter((line) => line.indicator !== 'bought');
    const total = pending.reduce(
      (sum, line) => sum + line.price * line.quantity,
      0
    );

    return {
      givenWay,
      rows: drawn.length,
      pending: pending.length,
      // Rounded to the cent, so a sum of floats never prints a stray digit.
      total: Math.round(total * 100) / 100,
      settledShare:
        drawn.length === 0 ? 0 : (drawn.length - pending.length) / drawn.length,
    };
  });
}
