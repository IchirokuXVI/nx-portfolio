import type { PreviewLineVm } from '@portfolio/velista/models';

/** One invented row of the landing card, before it is translated and formatted. */
export interface PreviewSampleLine {
  /** Names the two keys of the row: `home.preview.line.<key>.content` and `.detail`. */
  readonly key: string;
  /** The file name of the row's photo under the card's assets. */
  readonly image: string;
  /** The price of one, in euros. */
  readonly price: number;
  readonly quantity: number;
  readonly indicator: PreviewLineVm['indicator'];
  readonly givesWay: PreviewLineVm['givesWay'];
}

/**
 * The five rows of the landing card (velista 0175, target 4), in the order they are
 * drawn, which is also their priority: Olive oil, 1 pending; Bananas, bought and at
 * zero; Gachas, 2 pending; Ham, not in the shop; Cheese, 1 pending. The owner set these
 * states and prices on 2026-11-03.
 *
 * The rows give way from the end: Cheese is drawn only on a card with room for five,
 * then Ham goes, then Gachas. Olive oil and Bananas always stay, so the smallest card
 * still shows one line wanted and one line bought.
 *
 * The photos are the owner's, with no brand visible (O1). Each `image` is a file under
 * `libs/velista/ui/assets/landing`, served at `landing/` beside the document.
 */
export const PREVIEW_SAMPLE: readonly PreviewSampleLine[] = [
  {
    key: 'oil',
    image: 'oil.webp',
    price: 9.95,
    quantity: 1,
    indicator: null,
    givesWay: null,
  },
  {
    key: 'bananas',
    image: 'bananas.webp',
    price: 2.29,
    quantity: 0,
    indicator: 'bought',
    givesWay: null,
  },
  {
    key: 'gachas',
    image: 'gachas.webp',
    price: 3.2,
    quantity: 2,
    indicator: null,
    givesWay: 3,
  },
  // Still wanted, and the shop had none. Not having found something is not the same as
  // no longer needing it, which is why the number is untouched.
  {
    key: 'ham',
    image: 'ham.webp',
    price: 6.49,
    quantity: 1,
    indicator: 'notAvailable',
    givesWay: 2,
  },
  {
    key: 'cheese',
    image: 'cheese.webp',
    price: 7.49,
    quantity: 1,
    indicator: null,
    givesWay: 1,
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
 * The progress line for each step the rows can give way to: none, the first, then each
 * next one as well (velista 0175, target 6). Each describes **the rows drawn at that
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
