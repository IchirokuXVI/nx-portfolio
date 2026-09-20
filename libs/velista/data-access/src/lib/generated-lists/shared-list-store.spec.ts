import { TestBed } from '@angular/core/testing';
import type {
  Page,
  SharedGeneratedListSummary,
} from '@portfolio/velista/models';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { REALTIME_CLIENT } from '../realtime/realtime-client';
import { RealtimeMemory } from '../realtime/realtime-memory';
import {
  GENERATED_LIST_SERVICE,
  type GeneratedListServiceI,
} from './generated-list-service';
import { SharedListStore } from './shared-list-store';

/** The Shared lists tab's store (velista `0085`, section 5, test 7). */

function shared(id: string): SharedGeneratedListSummary {
  return {
    id,
    kind: 'GENERATED',
    name: null,
    status: 'OPEN',
    generatedAt: new Date('2026-08-21T10:00:00.000Z'),
    lineCount: 3,
    settledLineCount: 0,
    boughtLineCount: 0,
    notAvailableLineCount: 0,
    presentCount: 0,
    owner: { userId: 'u-marta', name: 'Marta' },
    sharedAt: new Date('2026-08-21T11:00:00.000Z'),
  };
}

function harness(pages: readonly Page<SharedGeneratedListSummary>[]) {
  TestBed.resetTestingModule();
  const reads: (string | undefined)[] = [];
  let firstReads = 0;

  const service: Pick<GeneratedListServiceI, 'listShared'> = {
    listShared: async (cursor?: string) => {
      reads.push(cursor);
      if (cursor === undefined) {
        // Every cursorless read after the first is a refresh, and answers the last page
        // given, which is how a spec says "the listing changed underneath".
        const at = Math.min(firstReads++, pages.length - 1);
        return pages[at] ?? { items: [], nextCursor: null };
      }
      return { items: [shared('older')], nextCursor: null };
    },
  };

  TestBed.configureTestingModule({
    providers: [
      provideVelistaTesting(),
      SharedListStore,
      { provide: GENERATED_LIST_SERVICE, useValue: service },
      { provide: REALTIME_CLIENT, useExisting: RealtimeMemory },
    ],
  });

  return {
    store: TestBed.inject(SharedListStore),
    realtime: TestBed.inject(RealtimeMemory),
    reads,
  };
}

describe('SharedListStore', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('reads the first page once, however often it is asked', async () => {
    const { store, reads } = harness([
      { items: [shared('a')], nextCursor: 'c1' },
    ]);

    await store.load();
    await store.load();

    expect(reads).toEqual([undefined]);
    expect(store.lists().map((list) => list.id)).toEqual(['a']);
    expect(store.state()).toBe('loaded');
    expect(store.hasMore()).toBe(true);
    expect(store.pagesLoaded()).toBe(1);
  });

  it('appends the next page on its own cursor', async () => {
    const { store, reads } = harness([
      { items: [shared('a')], nextCursor: 'c1' },
    ]);
    await store.load();

    await store.loadMore();

    expect(reads).toEqual([undefined, 'c1']);
    expect(store.lists().map((list) => list.id)).toEqual(['a', 'older']);
    expect(store.pagesLoaded()).toBe(2);
  });

  it('refreshes once for a burst of shared events, quietly', async () => {
    jest.useFakeTimers();
    const { store, realtime, reads } = harness([
      { items: [shared('a')], nextCursor: null },
      { items: [shared('b'), shared('a')], nextCursor: null },
    ]);
    await store.load();

    realtime.emit('generatedList.shared', { generatedListId: 'b' });
    jest.advanceTimersByTime(500);
    realtime.emit('generatedList.shared', { generatedListId: 'c' });
    jest.advanceTimersByTime(500);
    realtime.emit('generatedList.shared', { generatedListId: 'd' });
    expect(store.state()).toBe('loaded');
    jest.advanceTimersByTime(2000);
    await Promise.resolve();
    await Promise.resolve();

    expect(reads).toEqual([undefined, undefined]);
    expect(store.lists().map((list) => list.id)).toEqual(['b', 'a']);
    // Quiet: no skeleton, and no announcement.
    expect(store.state()).toBe('loaded');
    expect(store.pagesLoaded()).toBe(1);
  });

  it('drops an unshared row at once', async () => {
    jest.useFakeTimers();
    const { store, realtime } = harness([
      { items: [shared('a'), shared('b')], nextCursor: null },
    ]);
    await store.load();

    realtime.emit('generatedList.unshared', { generatedListId: 'a' });

    expect(store.lists().map((list) => list.id)).toEqual(['b']);
  });

  it('reads nothing for an event while the tab was never opened', async () => {
    jest.useFakeTimers();
    const { realtime, reads } = harness([{ items: [], nextCursor: null }]);

    realtime.emit('generatedList.shared', { generatedListId: 'b' });
    jest.advanceTimersByTime(2000);
    await Promise.resolve();

    expect(reads).toEqual([]);
  });
});
