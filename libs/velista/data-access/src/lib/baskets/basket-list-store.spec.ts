import { TestBed } from '@angular/core/testing';
import type {
  BasketRun,
  BasketSummary,
  CreateBasketRequest,
  Page,
  WritableBasketStatus,
} from '@portfolio/velista/models';
import {
  BrowserFacade,
  LiveBasketBadge,
  provideVelistaTesting,
} from '@portfolio/velista/platform';
import { GatewayError } from '../errors';
import { REALTIME_CLIENT } from '../realtime/realtime-client';
import { RealtimeMemory } from '../realtime/realtime-memory';
import {
  fakeLiveBasketStore,
  provideFakeLiveBasketStore,
  type FakeLiveBasketStore,
} from '../testing/store-doubles';
import {
  BASKET_LIST_SERVICE,
  type BasketListServiceI,
} from './basket-list-service';
import { BasketListStore } from './basket-list-store';

/**
 * The store behind the dashboard card and the history (plan 0045, section 5).
 *
 * Driven through a fake service rather than HTTP, so what is under test is the store's
 * own behaviour: the once-per-run first read, the merge on a further page, the realtime
 * upsert, and the two opposite failure policies.
 */

function summary(overrides: Partial<BasketSummary> = {}) {
  return {
    id: 'gl1',
    kind: 'GENERATED',
    name: 'Saturday big shop',
    status: 'OPEN',
    generatedAt: new Date('2026-08-21T10:00:00.000Z'),
    lineCount: 12,
    settledLineCount: 4,
    ...overrides,
  } as BasketSummary;
}

interface FakeOptions {
  readonly pages?: readonly Page<BasketSummary>[];
  readonly listRejectsWith?: unknown;
  /** Rejects only a **cursored** call, so the first page lands and the second fails. */
  readonly nextPageRejectsWith?: unknown;
  /**
   * What a **second and later** cursorless read answers, which is what a quiet refresh
   * makes. Separate from `pages` so a test can say "the listing changed under us"
   * without disturbing the cursor walk that `pages` describes.
   */
  readonly refreshPage?: Page<BasketSummary>;
  readonly createRejectsWith?: unknown;
  /** What a status write fails with, for the rollback (velista `0057`). */
  readonly setStatusRejectsWith?: unknown;
}

/** A `BasketListServiceI` recording what it was asked, with no transport. */
function fakeService(options: FakeOptions = {}) {
  const calls: {
    method: string;
    cursor?: string;
    basketId?: string;
    status?: string;
  }[] = [];
  const pages = options.pages ?? [{ items: [], nextCursor: null }];
  let served = 0;
  let firstReads = 0;

  const service: BasketListServiceI = {
    listShared: async () => ({ items: [], nextCursor: null }),
    listMine: async (cursor?: string) => {
      calls.push({
        method: 'listMine',
        ...(cursor === undefined ? {} : { cursor }),
      });
      if (options.listRejectsWith !== undefined) {
        throw options.listRejectsWith;
      }
      if (cursor !== undefined && options.nextPageRejectsWith !== undefined) {
        throw options.nextPageRejectsWith;
      }
      // A cursor asks for the next page; no cursor is always the first one, so a
      // reload gets what a first read would rather than continuing the walk.
      if (cursor === undefined) {
        const isRefresh = firstReads++ > 0;
        return (
          (isRefresh ? options.refreshPage : undefined) ??
          pages[0] ?? { items: [], nextCursor: null }
        );
      }
      return pages[++served] ?? { items: [], nextCursor: null };
    },
    setStatus: async (basketId: string, status: WritableBasketStatus) => {
      calls.push({ method: 'setStatus', basketId, status });
      if (options.setStatusRejectsWith !== undefined) {
        throw options.setStatusRejectsWith;
      }
    },
    create: async (request: CreateBasketRequest) => {
      calls.push({ method: 'create' });
      if (options.createRejectsWith !== undefined) {
        throw options.createRejectsWith;
      }
      return {
        list: summary({ id: 'made', name: request.name ?? null }),
        skipped: [],
      } satisfies BasketRun;
    },
  };

  return { service, calls };
}

function harness(
  options: FakeOptions = {},
  live: FakeLiveBasketStore = fakeLiveBasketStore()
) {
  TestBed.resetTestingModule();
  const fake = fakeService(options);

  TestBed.configureTestingModule({
    providers: [
      provideVelistaTesting(),
      BasketListStore,
      { provide: BASKET_LIST_SERVICE, useValue: fake.service },
      { provide: REALTIME_CLIENT, useExisting: RealtimeMemory },
      provideFakeLiveBasketStore(live),
    ],
  });

  return {
    store: TestBed.inject(BasketListStore),
    live,
    realtime: TestBed.inject(RealtimeMemory),
    // What a resume is driven by: `AppResumed` counts the false to true edge of
    // this signal, and the store reads the listing again when the count moves.
    browser: TestBed.inject(BrowserFacade),
    calls: fake.calls,
  };
}

describe('BasketListStore', () => {
  /**
   * The badge counts the basket the tab opens (velista `0111`): the newest open
   * generated basket, or the live basket when there is none.
   */
  describe('the tab badge', () => {
    const pending = () => TestBed.inject(LiveBasketBadge).pending();

    it('counts the newest open generated basket', async () => {
      const { store } = harness({
        pages: [
          {
            items: [
              summary({ id: 'new', lineCount: 9, settledLineCount: 2 }),
              summary({ id: 'old', lineCount: 5, settledLineCount: 0 }),
            ],
            nextCursor: null,
          },
        ],
      });

      await store.load();
      TestBed.tick();

      expect(pending()).toBe(7);
    });

    it('counts the live basket when no generated basket is open', async () => {
      const live = fakeLiveBasketStore(
        {
          id: 'basket-live',
          progress: { done: 1, unavailable: 0, total: 5 },
          pending: 4,
        },
        { state: 'idle' }
      );
      const { store } = harness(
        {
          pages: [
            {
              items: [summary({ status: 'FINISHED' })],
              nextCursor: null,
            },
          ],
        },
        live
      );

      await store.load();
      TestBed.tick();

      expect(pending()).toBe(4);
      // Asked for, because nothing else had.
      expect(live.calls).toContain('load');
    });

    it('counts the live basket when the listing fails', async () => {
      const live = fakeLiveBasketStore({
        id: 'basket-live',
        progress: { done: 0, unavailable: 0, total: 3 },
        pending: 3,
      });
      const { store } = harness({ listRejectsWith: new Error('down') }, live);

      await store.load();
      TestBed.tick();

      expect(pending()).toBe(3);
    });

    it('draws nothing before the listing has answered', () => {
      harness(
        {},
        fakeLiveBasketStore({
          id: 'basket-live',
          progress: { done: 0, unavailable: 0, total: 3 },
          pending: 3,
        })
      );
      TestBed.tick();

      expect(pending()).toBeNull();
    });
  });

  describe('the first read', () => {
    it('holds what the listing answered, newest first as it arrived', async () => {
      const { store } = harness({
        pages: [
          {
            items: [summary({ id: 'a' }), summary({ id: 'b' })],
            nextCursor: null,
          },
        ],
      });

      await store.load();

      expect(store.lists().map((list) => list.id)).toEqual(['a', 'b']);
      expect(store.state()).toBe('loaded');
    });

    // Two screens call `load` on creation and either may be first. Without the latch
    // the second one to open would refetch a listing already in hand.
    it('reads once however many screens ask', async () => {
      const { store, calls } = harness();

      await store.load();
      await store.load();

      expect(calls.filter((call) => call.method === 'listMine')).toHaveLength(
        1
      );
    });

    it('reads again on an explicit reload, which is the retry', async () => {
      const { store, calls } = harness();

      await store.load();
      await store.reload();

      expect(calls.filter((call) => call.method === 'listMine')).toHaveLength(
        2
      );
      // Always the first page: a reload gets what a first read would rather than
      // continuing the walk from wherever the paging had got to.
      expect(calls.every((call) => call.cursor === undefined)).toBe(true);
    });

    it('reports a failure with the error behind it, for its reference', async () => {
      const failure = new GatewayError({
        code: 'internal',
        status: 500,
        correlationId: 'ref-1',
      });
      const { store } = harness({ listRejectsWith: failure });

      await store.load();

      expect(store.state()).toBe('failed');
      expect(store.error()).toBe(failure);
    });
  });

  describe('the active baskets', () => {
    /**
     * **There used to be two spellings of this state, and the set had one of them.**
     *
     * The filter asserted `ACTIVE`, on the reasoning that a draft has not been taken
     * to a shop yet and so is not what somebody is in the middle of. That was a
     * defensible thing to believe about the word and a wrong thing to believe about
     * this server: core composed every run as `DRAFT` and had no path that promoted
     * one, so the filter this spec was protecting matched nothing velista had ever
     * generated. The dashboard card and the history's Shopping now badge both drew for
     * nobody from the day they shipped, with a green suite over them, because the
     * fixtures said `ACTIVE` and the server never did. Backend `0133` folded the two
     * into `OPEN`, so there is one value for both to agree on.
     */
    it('keeps every basket still to be shopped, in the listing order', async () => {
      const { store } = harness({
        pages: [
          {
            items: [
              summary({ id: 'live' }),
              summary({ id: 'done', status: 'FINISHED' }),
              summary({ id: 'archived', status: 'ARCHIVED' }),
              summary({ id: 'live2' }),
            ],
            nextCursor: null,
          },
        ],
      });

      await store.load();

      expect(store.active().map((list) => list.id)).toEqual(['live', 'live2']);
    });

    // The safe direction, stated on its own: a status this build has never heard of
    // costs a card, where reading it as open would offer somebody a way back into a
    // trip the server considers over.
    it('leaves out a status it could not read', async () => {
      const { store } = harness({
        pages: [
          {
            items: [summary({ id: 'strange', status: 'UNKNOWN' })],
            nextCursor: null,
          },
        ],
      });

      await store.load();

      expect(store.active()).toEqual([]);
    });

    // An unrecognised status must never read as live, or a basket the server considers
    // finished goes back on the dashboard.
    it('leaves out a status this build does not recognise', async () => {
      const { store } = harness({
        pages: [
          {
            items: [summary({ id: 'x', status: 'UNKNOWN' })],
            nextCursor: null,
          },
        ],
      });

      await store.load();

      expect(store.active()).toEqual([]);
    });
  });

  describe('paging', () => {
    it('appends the next page and follows the cursor', async () => {
      const { store, calls } = harness({
        pages: [
          { items: [summary({ id: 'a' })], nextCursor: 'c1' },
          { items: [summary({ id: 'b' })], nextCursor: null },
        ],
      });

      await store.load();
      expect(store.hasMore()).toBe(true);

      await store.loadMore();

      expect(store.lists().map((list) => list.id)).toEqual(['a', 'b']);
      expect(store.hasMore()).toBe(false);
      expect(calls.at(-1)).toEqual({ method: 'listMine', cursor: 'c1' });
    });

    /**
     * A basket created while somebody is reading shifts the server's window, so the
     * same row can arrive on two pages. Appending blindly draws it twice and hands
     * `@for`'s `track` two rows with one id.
     */
    it('does not draw a row twice when the window shifts under it', async () => {
      const { store } = harness({
        pages: [
          { items: [summary({ id: 'a' })], nextCursor: 'c1' },
          {
            items: [summary({ id: 'a' }), summary({ id: 'b' })],
            nextCursor: null,
          },
        ],
      });

      await store.load();
      await store.loadMore();

      expect(store.lists().map((list) => list.id)).toEqual(['a', 'b']);
    });

    it('asks for nothing more once the cursor runs out', async () => {
      const { store, calls } = harness({
        pages: [{ items: [summary()], nextCursor: null }],
      });

      await store.load();
      await store.loadMore();

      expect(calls.filter((call) => call.method === 'listMine')).toHaveLength(
        1
      );
    });

    /**
     * The rows already on screen are good. Replacing a readable history with a full
     * page error because its fourth page did not arrive would lose somebody the thing
     * they were reading, so the state stays `loaded` and scrolling again retries.
     */
    it('keeps the rows it has when a further page fails', async () => {
      const { store } = harness({
        pages: [{ items: [summary({ id: 'a' })], nextCursor: 'c1' }],
        nextPageRejectsWith: new Error('the fourth page did not arrive'),
      });

      await store.load();
      await store.loadMore();

      expect(store.state()).toBe('loaded');
      expect(store.lists()).toHaveLength(1);
      // The bottom row stops spinning rather than staying stuck, so scrolling again
      // retries instead of being refused forever by the in-flight latch.
      expect(store.loadingMore()).toBe(false);
      expect(store.hasMore()).toBe(true);
    });
  });

  describe('creating one', () => {
    /**
     * Written in straight away rather than waited for over the socket, so the sheet can
     * navigate to a card that is already there.
     */
    it('puts the new basket at the front without a second read', async () => {
      const { store, calls } = harness();

      await store.load();
      const run = await store.create({ name: 'Tonight' });

      expect(run.list.id).toBe('made');
      expect(store.lists()[0]?.id).toBe('made');
      expect(calls.filter((call) => call.method === 'listMine')).toHaveLength(
        1
      );
    });

    /**
     * Thrown rather than swallowed into a state signal, which is the opposite of
     * `loadMore` and for the opposite reason: there is nothing already on screen to
     * protect, and the sheet can only keep itself open and say so if it hears about it.
     */
    it('throws so the sheet can stay open and report it', async () => {
      const failure = new GatewayError({
        code: 'validation_failed',
        status: 422,
        correlationId: 'ref-2',
      });
      const { store } = harness({ createRejectsWith: failure });

      await expect(store.create({})).rejects.toBe(failure);
      expect(store.state()).not.toBe('failed');
    });
  });

  /**
   * Settling, which is the one event this store cannot apply arithmetically.
   *
   * It holds summaries, so what would have to move is `settledLineCount`, and one line
   * event cannot say whether it should: knowing a line is now finished says nothing
   * about whether it was already finished and counted. So a settle triggers a refetch,
   * and these are the four properties that make a refetch safe to do on a broadcast.
   */
  /**
   * The card, once the four line events went (velista `0090`, section 7.1).
   *
   * It used to hear a settle on the owner's own sessions, through an event that
   * carried a line. A basket stores no lines since backend `0136`, so a settle no
   * longer reaches this room with anything in it, and backend `0130` section 7
   * names no successor.
   *
   * What is left is the basket's **header** moving, which is a rename, a finish or
   * a reopen, and the app coming back. Both read the listing again, coalesced,
   * because a burst of either would otherwise be a request each.
   */
  describe('coming back to the card', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    /**
     * The card's only news of a purchase, now that no line event carries one. A
     * phone in a pocket missed whatever happened while it was there, so coming
     * back is a reason to ask.
     */
    it('reads the listing again when the app comes back', async () => {
      const { store, browser } = harness({
        pages: [
          {
            items: [summary({ id: 'a', settledLineCount: 4 })],
            nextCursor: null,
          },
        ],
        refreshPage: {
          items: [summary({ id: 'a', settledLineCount: 5 })],
          nextCursor: null,
        },
      });
      await store.load();
      expect(store.lists()[0]?.settledLineCount).toBe(4);

      browser.visible.set(false);
      TestBed.flushEffects();
      browser.visible.set(true);
      TestBed.flushEffects();

      jest.advanceTimersByTime(2000);
      await Promise.resolve();
      await Promise.resolve();

      expect(store.lists()[0]?.settledLineCount).toBe(5);
    });

    /**
     * Nothing to bring up to date until something has been read, which is what
     * stops a resume on a page that never asked for the listing from asking.
     */
    it('reads nothing on a resume before anything was loaded', async () => {
      const { browser, calls } = harness({
        pages: [{ items: [summary({ id: 'a' })], nextCursor: null }],
      });

      browser.visible.set(false);
      TestBed.flushEffects();
      browser.visible.set(true);
      TestBed.flushEffects();

      jest.advanceTimersByTime(2000);
      await Promise.resolve();

      expect(calls.filter((call) => call.method === 'listMine')).toHaveLength(
        0
      );
    });

    /**
     * The pages render a skeleton for `loading`, so moving the state would blank the
     * very card the update is about. A live update must never do that.
     */
    it('never moves the load state, so the card does not blank', async () => {
      const { store, browser } = harness({
        pages: [{ items: [summary({ id: 'a' })], nextCursor: null }],
      });
      await store.load();

      browser.visible.set(false);
      TestBed.flushEffects();
      browser.visible.set(true);
      TestBed.flushEffects();
      expect(store.state()).toBe('loaded');

      jest.advanceTimersByTime(2000);
      expect(store.state()).toBe('loaded');
      await Promise.resolve();
      expect(store.state()).toBe('loaded');
    });

    // Somebody who has scrolled a year into their history should not watch it
    // collapse to twenty rows because a flatmate renamed a basket.
    it('keeps the pages behind the first one', async () => {
      const { store, browser } = harness({
        pages: [
          { items: [summary({ id: 'a' })], nextCursor: 'c1' },
          { items: [summary({ id: 'old' })], nextCursor: null },
        ],
        refreshPage: {
          items: [summary({ id: 'a', settledLineCount: 9 })],
          nextCursor: 'c1',
        },
      });
      await store.load();
      await store.loadMore();
      expect(store.lists().map((list) => list.id)).toEqual(['a', 'old']);

      browser.visible.set(false);
      TestBed.flushEffects();
      browser.visible.set(true);
      TestBed.flushEffects();

      jest.advanceTimersByTime(2000);
      await Promise.resolve();
      await Promise.resolve();

      expect(store.lists().map((list) => list.id)).toEqual(['a', 'old']);
      // And the refresh did happen, rather than the rows surviving because
      // nothing ran.
      expect(store.lists()[0]?.settledLineCount).toBe(9);
    });
  });

  describe('the owner s own realtime room', () => {
    // Generating on a laptop puts the card on a phone with no reload.
    it('adds a basket created elsewhere', async () => {
      const { store, realtime } = harness();
      await store.load();

      realtime.emit('basket.created', {
        id: 'remote',
        name: 'From the laptop',
        status: 'OPEN',
        generatedAt: '2026-08-21T10:00:00.000Z',
        lines: [],
      });

      expect(store.lists().map((list) => list.id)).toEqual(['remote']);
    });

    // Replaced in place rather than moved to the front: the order is by generation
    // time, and an edit does not regenerate anything.
    it('replaces one that moved, keeping its place in the order', async () => {
      const { store, realtime } = harness({
        pages: [
          {
            items: [summary({ id: 'a' }), summary({ id: 'b' })],
            nextCursor: null,
          },
        ],
      });
      await store.load();

      realtime.emit('basket.updated', {
        id: 'b',
        name: 'Renamed',
        status: 'OPEN',
        generatedAt: '2026-08-21T10:00:00.000Z',
        lines: [],
      });

      expect(store.lists().map((list) => list.id)).toEqual(['a', 'b']);
      expect(store.lists()[1]?.name).toBe('Renamed');
    });

    it('takes one away when it is deleted elsewhere', async () => {
      const { store, realtime } = harness({
        pages: [{ items: [summary({ id: 'a' })], nextCursor: null }],
      });
      await store.load();

      realtime.emit('basket.deleted', { id: 'a' });

      expect(store.lists()).toEqual([]);
    });

    /**
     * Rule D4: a payload this build cannot read is dropped and counted, never applied.
     * Here that means the card keeps the counts the last read gave it rather than
     * losing them to an unreadable event.
     */
    it('drops a payload it cannot read rather than emptying the card', async () => {
      const { store, realtime } = harness({
        pages: [{ items: [summary({ id: 'a' })], nextCursor: null }],
      });
      await store.load();

      realtime.emit('basket.updated', {
        id: 'a',
        generatedAt: 'not a date',
      });

      expect(store.lists()).toHaveLength(1);
      expect(store.lists()[0]?.lineCount).toBe(12);
    });
  });

  /**
   * Finishing a trip, and taking it back (velista `0057`, section 10).
   *
   * The one write on this surface a **participant screen** makes, and the only
   * optimistic one this store has: it is pressed on the basket screen, where the
   * whole answer is a banner appearing and a page's worth of controls going away,
   * and a round trip of nothing happening in a shop reads as a button that did not
   * work.
   */
  describe('finishing a trip', () => {
    it('asks the server for the status the caller named', async () => {
      const { store, calls } = harness({
        pages: [{ items: [summary({ id: 'a' })], nextCursor: null }],
      });
      await store.load();

      await store.setStatus('a', 'FINISHED');

      expect(calls).toContainEqual({
        method: 'setStatus',
        basketId: 'a',
        status: 'FINISHED',
      });
    });

    it('moves the row it holds before the server has answered', async () => {
      const { store } = harness({
        pages: [
          { items: [summary({ id: 'a', status: 'OPEN' })], nextCursor: null },
        ],
      });
      await store.load();

      // Deliberately not awaited: the flip is what the screen is drawn from, and it
      // has to be true the moment the gesture is made rather than a round trip later.
      const landing = store.setStatus('a', 'FINISHED');

      expect(store.lists()[0]?.status).toBe('FINISHED');
      await landing;
    });

    // The dashboard card asks the same question the history's badge does, so a
    // finished trip has to leave the live set as well as gaining a mark.
    it('takes the trip out of the live set', async () => {
      const { store } = harness({
        pages: [
          { items: [summary({ id: 'a', status: 'OPEN' })], nextCursor: null },
        ],
      });
      await store.load();
      expect(store.active()).toHaveLength(1);

      await store.setStatus('a', 'FINISHED');

      expect(store.active()).toEqual([]);
    });

    it('puts back the status the row held when the write does not land', async () => {
      const { store } = harness({
        pages: [
          {
            items: [summary({ id: 'a', status: 'ARCHIVED' })],
            nextCursor: null,
          },
        ],
        setStatusRejectsWith: new GatewayError({
          code: 'forbidden',
          status: 403,
          correlationId: 'c-1',
        }),
      });
      await store.load();

      const landed = await store.setStatus('a', 'FINISHED');

      // `ARCHIVED` and not `OPEN`: the rollback restores what the row actually
      // held, rather than guessing at the status a basket ought to have.
      expect(landed).toBe(false);
      expect(store.lists()[0]?.status).toBe('ARCHIVED');
    });

    /**
     * The ordinary case for the caller this write has: a basket opened from a link
     * or from the dashboard, on a session where the history has never been read.
     */
    it('writes for a basket it is not holding, and holds nothing new', async () => {
      const { store, calls } = harness();

      const landed = await store.setStatus('never-read', 'FINISHED');

      expect(landed).toBe(true);
      expect(store.lists()).toEqual([]);
      expect(calls).toContainEqual({
        method: 'setStatus',
        basketId: 'never-read',
        status: 'FINISHED',
      });
    });

    it('takes a finished trip back the same way', async () => {
      const { store } = harness({
        pages: [
          {
            items: [summary({ id: 'a', status: 'FINISHED' })],
            nextCursor: null,
          },
        ],
      });
      await store.load();

      await store.setStatus('a', 'OPEN');

      expect(store.lists()[0]?.status).toBe('OPEN');
      expect(store.active()).toHaveLength(1);
    });
  });
});
