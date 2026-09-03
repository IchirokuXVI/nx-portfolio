import { TestBed } from '@angular/core/testing';
import type {
  CreateGeneratedListRequest,
  GeneratedListRun,
  GeneratedListSummary,
  Page,
  WritableGeneratedListStatus,
} from '@portfolio/velista/models';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { GatewayError } from '../errors';
import { REALTIME_CLIENT } from '../realtime/realtime-client';
import { RealtimeMemory } from '../realtime/realtime-memory';
import {
  GENERATED_LIST_SERVICE,
  type GeneratedListServiceI,
} from './generated-list-service';
import { GeneratedListStore } from './generated-list-store';

/**
 * The store behind the dashboard card and the history (plan 0045, section 5).
 *
 * Driven through a fake service rather than HTTP, so what is under test is the store's
 * own behaviour: the once-per-run first read, the merge on a further page, the realtime
 * upsert, and the two opposite failure policies.
 */

function summary(overrides: Partial<GeneratedListSummary> = {}) {
  return {
    id: 'gl1',
    name: 'Saturday big shop',
    status: 'ACTIVE',
    generatedAt: new Date('2026-08-21T10:00:00.000Z'),
    lineCount: 12,
    settledLineCount: 4,
    ...overrides,
  } as GeneratedListSummary;
}

interface FakeOptions {
  readonly pages?: readonly Page<GeneratedListSummary>[];
  readonly listRejectsWith?: unknown;
  /** Rejects only a **cursored** call, so the first page lands and the second fails. */
  readonly nextPageRejectsWith?: unknown;
  /**
   * What a **second and later** cursorless read answers, which is what a quiet refresh
   * makes. Separate from `pages` so a test can say "the listing changed under us"
   * without disturbing the cursor walk that `pages` describes.
   */
  readonly refreshPage?: Page<GeneratedListSummary>;
  readonly createRejectsWith?: unknown;
  /** What a status write fails with, for the rollback (velista `0057`). */
  readonly setStatusRejectsWith?: unknown;
}

/** A `GeneratedListServiceI` recording what it was asked, with no transport. */
function fakeService(options: FakeOptions = {}) {
  const calls: {
    method: string;
    cursor?: string;
    generatedListId?: string;
    status?: string;
  }[] = [];
  const pages = options.pages ?? [{ items: [], nextCursor: null }];
  let served = 0;
  let firstReads = 0;

  const service: GeneratedListServiceI = {
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
    setStatus: async (
      generatedListId: string,
      status: WritableGeneratedListStatus
    ) => {
      calls.push({ method: 'setStatus', generatedListId, status });
      if (options.setStatusRejectsWith !== undefined) {
        throw options.setStatusRejectsWith;
      }
    },
    create: async (request: CreateGeneratedListRequest) => {
      calls.push({ method: 'create' });
      if (options.createRejectsWith !== undefined) {
        throw options.createRejectsWith;
      }
      return {
        list: summary({ id: 'made', name: request.name ?? null }),
        skipped: [],
      } satisfies GeneratedListRun;
    },
  };

  return { service, calls };
}

function harness(options: FakeOptions = {}) {
  TestBed.resetTestingModule();
  const fake = fakeService(options);

  TestBed.configureTestingModule({
    providers: [
      provideVelistaTesting(),
      GeneratedListStore,
      { provide: GENERATED_LIST_SERVICE, useValue: fake.service },
      { provide: REALTIME_CLIENT, useExisting: RealtimeMemory },
    ],
  });

  return {
    store: TestBed.inject(GeneratedListStore),
    realtime: TestBed.inject(RealtimeMemory),
    calls: fake.calls,
  };
}

describe('GeneratedListStore', () => {
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
     * **`DRAFT` is in the set, and this assertion used to say the opposite.**
     *
     * It asserted that a draft is left out, on the reasoning that a draft has not been
     * taken to a shop yet and so is not what somebody is in the middle of. That was a
     * defensible thing to believe about the word and a wrong thing to believe about
     * this server: core composes every run as `DRAFT` and has no path that promotes one
     * to `ACTIVE`, so the filter this spec was protecting matched nothing velista had
     * ever generated. The dashboard card and the history's Shopping now badge both drew
     * for nobody from the day they shipped, with a green suite over them, because the
     * fixtures said `ACTIVE` and the server never did.
     *
     * The lesson worth keeping in the spec is the one about fixtures: `summary()`
     * defaults to `ACTIVE` here, so the draft row is written out explicitly.
     */
    it('keeps every basket still to be shopped, in the listing order', async () => {
      const { store } = harness({
        pages: [
          {
            items: [
              summary({ id: 'live' }),
              summary({ id: 'done', status: 'COMPLETED' }),
              summary({ id: 'draft', status: 'DRAFT' }),
              summary({ id: 'live2' }),
            ],
            nextCursor: null,
          },
        ],
      });

      await store.load();

      expect(store.active().map((list) => list.id)).toEqual([
        'live',
        'draft',
        'live2',
      ]);
    });

    // The other half of the pair, stated on its own so a regression names itself: what
    // a run actually produces is a draft, and a draft has to reach the dashboard.
    it('keeps a draft, which is what a run composes', async () => {
      const { store } = harness({
        pages: [
          {
            items: [summary({ id: 'fresh', status: 'DRAFT' })],
            nextCursor: null,
          },
        ],
      });

      await store.load();

      expect(store.active().map((list) => list.id)).toEqual(['fresh']);
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
  describe('a line being settled', () => {
    const settled = (generatedListId: string) => ({
      generatedListId,
      line: { id: 'line-1', content: 'Milk', quantity: 2, settledQuantity: 2 },
    });

    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('reads the listing again and moves the count', async () => {
      const { store, realtime } = harness({
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

      realtime.emit('generatedList.lineSettled', settled('a'));
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
      await Promise.resolve();

      expect(store.lists()[0]?.settledLineCount).toBe(5);
    });

    /**
     * Four people working through one basket settle lines seconds apart, and a request
     * each would be a request per tin of tomatoes.
     */
    it('collapses a burst into one read', async () => {
      const { store, realtime, calls } = harness({
        pages: [{ items: [summary({ id: 'a' })], nextCursor: null }],
      });
      await store.load();
      const before = calls.filter((call) => call.method === 'listMine').length;

      realtime.emit('generatedList.lineSettled', settled('a'));
      jest.advanceTimersByTime(500);
      realtime.emit('generatedList.lineSettled', settled('a'));
      jest.advanceTimersByTime(500);
      realtime.emit('generatedList.lineSettled', settled('a'));
      jest.advanceTimersByTime(2000);
      await Promise.resolve();

      expect(
        calls.filter((call) => call.method === 'listMine').length - before
      ).toBe(1);
    });

    /**
     * The pages render a skeleton for `loading`, so moving the state would blank the
     * very card the update is about, every time somebody in the shop ticked something
     * off. A live update must never do that.
     */
    it('never moves the load state, so the card does not blank', async () => {
      const { store, realtime } = harness({
        pages: [{ items: [summary({ id: 'a' })], nextCursor: null }],
      });
      await store.load();

      realtime.emit('generatedList.lineSettled', settled('a'));
      expect(store.state()).toBe('loaded');

      jest.advanceTimersByTime(2000);
      expect(store.state()).toBe('loaded');
      await Promise.resolve();
      expect(store.state()).toBe('loaded');
    });

    // Somebody who has scrolled a year into their history should not watch it collapse
    // to twenty rows because a flatmate settled a line.
    it('keeps the pages behind the first one', async () => {
      const { store, realtime } = harness({
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

      realtime.emit('generatedList.lineSettled', settled('a'));
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
      await Promise.resolve();

      expect(store.lists().map((list) => list.id)).toEqual(['a', 'old']);
      // And the refresh did happen, rather than the rows surviving because nothing ran.
      expect(store.lists()[0]?.settledLineCount).toBe(9);
    });

    // A settle on a basket that was never read changes nothing on screen, and letting
    // it drive a request would let any basket in the account do so from a page that is
    // not showing it.
    it('ignores a settle on a basket it is not holding', async () => {
      const { store, realtime, calls } = harness({
        pages: [{ items: [summary({ id: 'a' })], nextCursor: null }],
      });
      await store.load();
      const before = calls.filter((call) => call.method === 'listMine').length;

      realtime.emit('generatedList.lineSettled', settled('somebody-elses'));
      jest.advanceTimersByTime(2000);
      await Promise.resolve();

      expect(
        calls.filter((call) => call.method === 'listMine').length - before
      ).toBe(0);
    });

    // Rule D4 again: a payload with no basket id names nothing, so there is nothing to
    // refresh and nothing to guess.
    it('drops a payload with no basket id', async () => {
      const { store, realtime, calls } = harness({
        pages: [{ items: [summary({ id: 'a' })], nextCursor: null }],
      });
      await store.load();
      const before = calls.filter((call) => call.method === 'listMine').length;

      realtime.emit('generatedList.lineSettled', { line: { id: 'line-1' } });
      jest.advanceTimersByTime(2000);
      await Promise.resolve();

      expect(
        calls.filter((call) => call.method === 'listMine').length - before
      ).toBe(0);
    });
  });

  describe('the owner s own realtime room', () => {
    // Generating on a laptop puts the card on a phone with no reload.
    it('adds a basket created elsewhere', async () => {
      const { store, realtime } = harness();
      await store.load();

      realtime.emit('generatedList.created', {
        id: 'remote',
        name: 'From the laptop',
        status: 'ACTIVE',
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

      realtime.emit('generatedList.updated', {
        id: 'b',
        name: 'Renamed',
        status: 'ACTIVE',
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

      realtime.emit('generatedList.deleted', { id: 'a' });

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

      realtime.emit('generatedList.updated', {
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

      await store.setStatus('a', 'COMPLETED');

      expect(calls).toContainEqual({
        method: 'setStatus',
        generatedListId: 'a',
        status: 'COMPLETED',
      });
    });

    it('moves the row it holds before the server has answered', async () => {
      const { store } = harness({
        pages: [
          { items: [summary({ id: 'a', status: 'ACTIVE' })], nextCursor: null },
        ],
      });
      await store.load();

      // Deliberately not awaited: the flip is what the screen is drawn from, and it
      // has to be true the moment the gesture is made rather than a round trip later.
      const landing = store.setStatus('a', 'COMPLETED');

      expect(store.lists()[0]?.status).toBe('COMPLETED');
      await landing;
    });

    // The dashboard card asks the same question the history's badge does, so a
    // finished trip has to leave the live set as well as gaining a mark.
    it('takes the trip out of the live set', async () => {
      const { store } = harness({
        pages: [
          { items: [summary({ id: 'a', status: 'ACTIVE' })], nextCursor: null },
        ],
      });
      await store.load();
      expect(store.active()).toHaveLength(1);

      await store.setStatus('a', 'COMPLETED');

      expect(store.active()).toEqual([]);
    });

    it('puts back the status the row held when the write does not land', async () => {
      const { store } = harness({
        pages: [
          { items: [summary({ id: 'a', status: 'DRAFT' })], nextCursor: null },
        ],
        setStatusRejectsWith: new GatewayError({
          code: 'forbidden',
          status: 403,
          correlationId: 'c-1',
        }),
      });
      await store.load();

      const landed = await store.setStatus('a', 'COMPLETED');

      // `DRAFT` and not `ACTIVE`: the rollback restores what the row actually held,
      // rather than guessing at the status a live basket ought to have. Core
      // composes a run as `DRAFT` and never promotes one, so a guess would be wrong
      // for every basket this app has ever generated.
      expect(landed).toBe(false);
      expect(store.lists()[0]?.status).toBe('DRAFT');
    });

    /**
     * The ordinary case for the caller this write has: a basket opened from a link
     * or from the dashboard, on a session where the history has never been read.
     */
    it('writes for a basket it is not holding, and holds nothing new', async () => {
      const { store, calls } = harness();

      const landed = await store.setStatus('never-read', 'COMPLETED');

      expect(landed).toBe(true);
      expect(store.lists()).toEqual([]);
      expect(calls).toContainEqual({
        method: 'setStatus',
        generatedListId: 'never-read',
        status: 'COMPLETED',
      });
    });

    it('takes a finished trip back the same way', async () => {
      const { store } = harness({
        pages: [
          {
            items: [summary({ id: 'a', status: 'COMPLETED' })],
            nextCursor: null,
          },
        ],
      });
      await store.load();

      await store.setStatus('a', 'ACTIVE');

      expect(store.lists()[0]?.status).toBe('ACTIVE');
      expect(store.active()).toHaveLength(1);
    });
  });
});
