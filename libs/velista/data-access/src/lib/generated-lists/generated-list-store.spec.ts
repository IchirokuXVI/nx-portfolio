import { TestBed } from '@angular/core/testing';
import type {
  CreateGeneratedListRequest,
  GeneratedListRun,
  GeneratedListSummary,
  Page,
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
  readonly createRejectsWith?: unknown;
}

/** A `GeneratedListServiceI` recording what it was asked, with no transport. */
function fakeService(options: FakeOptions = {}) {
  const calls: { method: string; cursor?: string }[] = [];
  const pages = options.pages ?? [{ items: [], nextCursor: null }];
  let served = 0;

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
      const at = cursor === undefined ? 0 : ++served;
      return pages[at] ?? { items: [], nextCursor: null };
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
    it('keeps only the ones being shopped, in the listing order', async () => {
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

      expect(store.active().map((list) => list.id)).toEqual(['live', 'live2']);
    });

    // An unrecognised status must never read as ACTIVE, or a basket the server
    // considers finished goes back on the dashboard.
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
});
