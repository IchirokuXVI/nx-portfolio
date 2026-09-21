import type { BasketAnnouncer } from './basket-announcer.service';
import type { CoveringBasket } from './basket-coverage.sql';

/** One recorded call of {@link BasketAnnouncer.linesChanged}. */
export interface AnnouncedLines {
  listId: string;
  lineIds: readonly string[];
}

/** One recorded call of {@link BasketAnnouncer.basketChanged}. */
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
    basketChanged: AnnouncedBasket[];
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
    basketChanged: [],
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
      // Grouped exactly as the real one groups, so a spec that asserts "once
      // per list" is asserting the same arithmetic.
      const byList = new Map<string, string[]>();
      for (const entry of entries) {
        const lines = byList.get(entry.listId);
        if (lines) {
          lines.push(entry.lineId);
        } else {
          byList.set(entry.listId, [entry.lineId]);
        }
      }
      for (const [listId, lineIds] of byList) {
        calls.linesChanged.push({ listId, lineIds });
      }
    },
    basketChanged(
      basket: { id: string; ownerUserId: string },
      lineIds: readonly string[]
    ) {
      calls.basketChanged.push({ basketId: basket.id, lineIds: [...lineIds] });
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
