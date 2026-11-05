import {
  SourceProbeRecorder,
  belowFloor,
  hasText,
  isPositive,
  mostRowsCarry,
  type SourceProbeResult,
} from '@portfolio/luna-shopper/contracts';
import { CarrefourClient, DEFAULT_SEED_PATH } from './carrefour.client';
import { readCards } from './listing';
import {
  CARREFOUR_ORIGIN,
  type CarrefourProduct,
  type CarrefourSession,
} from './types';

/** The first level of the tree, which any listing names: about a dozen. */
const FIRST_LEVEL_FLOOR = 5;

/** What {@link probeCarrefour} takes: the seams its client takes. */
export interface CarrefourProbeOptions {
  userAgent: string;
  /** From the source row's `config.baseUrl`, as a run reads it. */
  baseUrl?: string;
  /** From `config.seedPath`. The walk's own seed when absent. */
  seedPath?: string;
  /** From `config.delayMs`. Never under the client's own 2000 ms floor. */
  delayMs?: number;
  /** The run's token bucket at the row's rate. */
  acquire?: () => Promise<void>;
  signal?: AbortSignal;
  /** A spec's fake browser. Headless Chromium through Playwright otherwise. */
  openSession?: () => Promise<CarrefourSession>;
  blockAssets?: boolean;
  sleepImpl?: (ms: number) => Promise<void>;
  /** The clock a step's duration is read from. */
  now?: () => number;
}

/**
 * Two pages of Carrefour (plan 0219, sections 3.2 and 3.5): the seed listing,
 * which names the first level of the tree as well, and the product page of
 * its first card.
 *
 * One client and one browser, closed in a `finally` as the walk closes its
 * own, also when a step throws and also when no page was ever opened. A launch
 * that fails or a deadline that passes is `CarrefourBrowserError`, which the
 * harvester reads as our fault and not as a redesign.
 *
 * A 403 or a 429 on the first page is one refusal, so the client throws
 * `CarrefourHttpError` with its status and the probe stops there.
 *
 * **What the client hides.** A page that answers neither 200 nor a refusal
 * comes back as no page state, a 5xx included, so such a step reports a
 * problem and not a status.
 */
export async function probeCarrefour(
  options: CarrefourProbeOptions
): Promise<SourceProbeResult> {
  const client = new CarrefourClient({
    userAgent: options.userAgent,
    baseUrl: options.baseUrl,
    delayMs: options.delayMs,
    acquire: options.acquire,
    signal: options.signal,
    openSession: options.openSession,
    blockAssets: options.blockAssets,
    sleepImpl: options.sleepImpl,
  });
  const base = (options.baseUrl ?? CARREFOUR_ORIGIN).replace(/\/+$/, '');
  const seedPath = options.seedPath ?? DEFAULT_SEED_PATH;
  const probe = new SourceProbeRecorder(options.now);

  try {
    let cards: CarrefourProduct[] = [];
    const listing = await probe.step(
      'listing',
      `${base}${seedPath}`,
      () => client.readListing(seedPath),
      (value) => {
        if (value === null) {
          return { problems: ['the seed listing answered no page state'] };
        }
        cards = readCards(value.cards, []);
        return {
          problems: [
            ...belowFloor(
              value.firstLevelCategories.length,
              FIRST_LEVEL_FLOOR,
              'first level categories'
            ),
            ...mostRowsCarry(cards, {
              externalId: (card) => hasText(card.externalId),
              name: (card) => hasText(card.name),
              path: (card) => hasText(card.path),
              'priceCents above zero': (card) => isPositive(card.priceCents),
            }),
          ],
          sample: {
            firstLevel: value.firstLevelCategories.length,
            cards: cards.length,
            totalResults: value.totalResults,
            firstName: cards[0]?.name ?? null,
            firstPriceCents: cards[0]?.priceCents ?? null,
          },
        };
      }
    );
    const card = listing ? cards.find((each) => hasText(each.path)) : undefined;
    if (!card?.path) {
      return probe.result(client.loads);
    }

    const path = card.path;
    await probe.step(
      'product',
      path.startsWith('http') ? path : `${base}${path}`,
      () => client.readDetail(path),
      (detail) => {
        if (detail === null) {
          return { problems: ['the product page answered no product'] };
        }
        const problems: string[] = [];
        if (detail.externalId !== card.externalId) {
          problems.push(
            `the product page named ${detail.externalId || 'no product'}, not ${card.externalId}`
          );
        }
        if (!hasText(detail.ean)) {
          problems.push('the product page carried no ean');
        }
        return {
          problems,
          sample: { id: detail.externalId, ean: detail.ean },
        };
      }
    );
    return probe.result(client.loads);
  } finally {
    // A failed close loses nothing the probe read, and a probe never throws.
    await client.close().catch(() => undefined);
  }
}
