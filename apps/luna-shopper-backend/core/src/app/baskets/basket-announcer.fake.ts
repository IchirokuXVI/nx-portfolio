import type { BasketAnnouncer } from './basket-announcer.service';
import type { CoveringBasket } from './basket-coverage.sql';

/** One recorded call of {@link BasketAnnouncer.linesChanged}. */
export interface AnnouncedLines {
  listId: string;
  lineIds: readonly string[];
}

/** One recorded call of {@link BasketAnnouncer.linesMoved}. */
export interface AnnouncedMove extends AnnouncedLines {
  marksMoved: boolean;
  /** The basket the write was made through, which is not told (plan 0203). */
  throughBasketId: string | null;
}

/** One recorded call of {@link BasketAnnouncer.basketMoved}. */
export interface AnnouncedBasket {
  basketId: string;
  lineIds: readonly string[];
}

/**
 * A {@link BasketAnnouncer} that records what it was told and reaches nothing.
 *
 * Plan 0139 gave nine services a dependency on the announcer, and every spec of
 * those services builds them positionally. One fake here rather than one per
 * spec, so a tenth method added later is added once.
 *
 * **No `jest.fn` anywhere in it**, which is the one constraint a file here has:
 * `*.fake.ts` is not excluded from `tsconfig.app.json`, so the production build
 * compiles it and `jest` is not a name it knows. Every sibling fake records into
 * arrays for the same reason, and a spec reads {@link FakeBasketAnnouncer.calls}
 * rather than asserting on a spy.
 */
export interface FakeBasketAnnouncer extends BasketAnnouncer {
  /** Everything it was told, in the order it was told, per method. */
  calls: {
    linesChanged: AnnouncedLines[];
    /** The writes that only moved numbers, one entry per list (plan 0204). */
    linesMoved: AnnouncedMove[];
    basketMoved: AnnouncedBasket[];
    coverageMoved: string[];
    openBaskets: string[];
    coverageMovedTo: (readonly CoveringBasket[])[];
  };
  /** Forget every call, for a spec that counts what one write announced. */
  reset(): void;
}

/** One fake, fresh per spec. `openBaskets` answers no baskets. */
export function fakeBasketAnnouncer(): FakeBasketAnnouncer {
  const calls: FakeBasketAnnouncer['calls'] = {
    linesChanged: [],
    linesMoved: [],
    basketMoved: [],
    coverageMoved: [],
    openBaskets: [],
    coverageMovedTo: [],
  };

  const fake = {
    calls,
    reset() {
      for (const list of Object.values(calls)) {
        list.length = 0;
      }
    },
    async linesChanged(listId: string, lineIds: readonly string[]) {
      calls.linesChanged.push({ listId, lineIds: [...lineIds] });
    },
    async linesChangedAcross(
      entries: readonly { listId: string; lineId: string }[]
    ) {
      for (const [listId, lineIds] of byList(entries)) {
        calls.linesChanged.push({ listId, lineIds });
      }
    },
    async linesMoved(
      listId: string,
      lineIds: readonly string[],
      marksMoved = false,
      throughBasketId: string | null = null
    ) {
      calls.linesMoved.push({
        listId,
        lineIds: [...lineIds],
        marksMoved,
        throughBasketId,
      });
    },
    async linesMovedAcross(
      entries: readonly {
        listId: string;
        lineId: string;
        recorded?: boolean;
      }[],
      throughBasketId: string | null = null
    ) {
      const recorded = new Set(
        entries.filter((entry) => entry.recorded).map((entry) => entry.listId)
      );
      for (const [listId, lineIds] of byList(entries)) {
        calls.linesMoved.push({
          listId,
          lineIds,
          marksMoved: recorded.has(listId),
          throughBasketId,
        });
      }
    },
    basketMoved(
      basket: { id: string; ownerUserId: string },
      entries: readonly { listId: string; lineId: string }[]
    ) {
      calls.basketMoved.push({
        basketId: basket.id,
        lineIds: entries.map((entry) => entry.lineId),
      });
    },
    async coverageMoved(zoneId: string) {
      calls.coverageMoved.push(zoneId);
    },
    async openBaskets(zoneId: string): Promise<CoveringBasket[]> {
      calls.openBaskets.push(zoneId);
      return [];
    },
    coverageMovedTo(baskets: readonly CoveringBasket[]) {
      calls.coverageMovedTo.push([...baskets]);
    },
  };

  return fake as unknown as FakeBasketAnnouncer;
}

/**
 * Grouped exactly as the real one groups, so a spec that asserts "once per
 * list" is asserting the same arithmetic.
 */
function byList(
  entries: readonly { listId: string; lineId: string }[]
): Map<string, string[]> {
  const lists = new Map<string, string[]>();
  for (const entry of entries) {
    const lines = lists.get(entry.listId);
    if (lines) {
      lines.push(entry.lineId);
    } else {
      lists.set(entry.listId, [entry.lineId]);
    }
  }
  return lists;
}
