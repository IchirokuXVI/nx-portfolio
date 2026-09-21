import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { LiveBasketSummary } from '@portfolio/velista/models';
import { AppResumed } from '@portfolio/velista/platform';
import { REALTIME_CLIENT } from '../realtime/realtime-client';
import { RealtimeMemory } from '../realtime/realtime-memory';
import { BasketMemory } from './basket-memory';
import { BASKET_SERVICE, type BasketServiceI } from './basket-service';
import { LiveBasketStore } from './live-basket-store';

/**
 * The three numbers the dashboard's `LIVE` card draws (velista `0091`,
 * section 5.2).
 *
 * It writes nothing, so what is worth asserting is **when it reads**: on the way
 * in, when the app comes back, and when a basket header moves. Plus the one rule
 * every refetching store here holds, which is that a slow answer must not land on
 * top of a fast one that came after it.
 */

/** The app coming back, which the store reads as a reason to ask again. */
class FakeResumed {
  readonly resumes = signal(0);
}

function summary(pending: number): LiveBasketSummary {
  return {
    id: 'basket-live',
    progress: { done: 0, unavailable: 0, total: pending },
    pending,
  };
}

function build(overrides: Partial<BasketServiceI> = {}): {
  store: LiveBasketStore;
  resumed: FakeResumed;
} {
  const memory = new BasketMemory();
  const resumed = new FakeResumed();

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      LiveBasketStore,
      {
        provide: BASKET_SERVICE,
        useValue: {
          getLiveSummary: () => memory.getLiveSummary(),
          ...overrides,
        },
      },
      { provide: AppResumed, useValue: resumed },
      { provide: REALTIME_CLIENT, useExisting: RealtimeMemory },
    ],
  });

  return { store: TestBed.inject(LiveBasketStore), resumed };
}

describe('LiveBasketStore', () => {
  it('reads the summary when the dashboard asks', async () => {
    const { store } = build();

    expect(store.state()).toBe('idle');
    await store.load();

    expect(store.state()).toBe('loaded');
    expect(store.summary()?.id).toBe('basket-live');
  });

  it('reads again when the app comes back', async () => {
    let reads = 0;
    const { store, resumed } = build({
      getLiveSummary: async () => {
        reads += 1;
        return summary(reads);
      },
    });

    await store.load();
    resumed.resumes.update((count) => count + 1);
    TestBed.tick();
    await Promise.resolve();

    expect(reads).toBe(2);
  });

  it('asks nothing on a resume before anything has read', () => {
    // A resume on a screen that never wanted this must not start a request, which
    // is the same rule `BasketListStore` holds for the listing.
    let reads = 0;
    const { resumed } = build({
      getLiveSummary: async () => {
        reads += 1;
        return summary(0);
      },
    });

    resumed.resumes.update((count) => count + 1);
    TestBed.tick();

    expect(reads).toBe(0);
  });

  it('reads again when a basket header moves', async () => {
    // Those events are about the account's **generated** baskets, and a run that
    // has just drawn from a list is exactly the moment these numbers are stale:
    // the same lines are covered by both.
    let reads = 0;
    const { store } = build({
      getLiveSummary: async () => {
        reads += 1;
        return summary(reads);
      },
    });

    await store.load();
    TestBed.inject(RealtimeMemory).emit('basket.updated', {
      id: 'basket-saturday',
      name: 'Saturday shop',
      status: 'OPEN',
      generatedAt: '2026-08-21T10:00:00.000Z',
      lines: [],
    });
    await Promise.resolve();

    expect(reads).toBe(2);
  });

  it('drops an answer a later read overtook', async () => {
    // Two reads are in flight whenever a resume lands on a dashboard that was
    // already asking, and the answers can arrive in either order.
    const answers: ((value: LiveBasketSummary) => void)[] = [];
    const { store } = build({
      getLiveSummary: () =>
        new Promise<LiveBasketSummary>((resolve) => answers.push(resolve)),
    });

    const first = store.load();
    const second = store.load();

    answers[1]?.(summary(2));
    await second;
    answers[0]?.(summary(1));
    await first;

    expect(store.summary()?.pending).toBe(2);
  });

  it('keeps the numbers it has when a later read fails', async () => {
    // A card that empties on a flaky connection is worse than one a minute old.
    let reads = 0;
    const { store } = build({
      getLiveSummary: async () => {
        reads += 1;
        if (reads === 2) {
          throw new Error('offline');
        }
        return summary(4);
      },
    });

    await store.load();
    await store.load();

    expect(store.summary()?.pending).toBe(4);
    expect(store.state()).toBe('loaded');
  });

  it('reports a first read that failed, so the card draws no sentence', async () => {
    const { store } = build({
      getLiveSummary: () => Promise.reject(new Error('offline')),
    });

    await store.load();

    expect(store.summary()).toBeNull();
    expect(store.state()).toBe('failed');
  });
});
