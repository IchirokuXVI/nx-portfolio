import { TestBed } from '@angular/core/testing';
import {
  TRIPS_REFETCH_QUIET_MS,
  tripKey,
  type Page,
  type Trip,
  type TripKind,
  type TripPage,
  type TripRow,
} from '@portfolio/velista/models';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { GatewayError } from '../errors';
import { REALTIME_CLIENT } from '../realtime/realtime-client';
import { RealtimeMemory } from '../realtime/realtime-memory';
import { TRIP_SERVICE, type TripServiceI } from './trip-service';
import { TripStore } from './trip-store';

const LIST = 'list-1';

function trip(id: string, overrides: Partial<Trip> = {}): Trip {
  return {
    id,
    kind: 'BASKET',
    name: null,
    live: false,
    startedAt: new Date('2026-09-10T10:00:00.000Z'),
    lineCount: 2,
    boughtLineCount: 1,
    ...overrides,
  };
}

function row(lineId: string, overrides: Partial<TripRow> = {}): TripRow {
  return {
    lineId,
    asked: 2,
    bought: 2,
    left: 0,
    outcome: 'BOUGHT',
    settledByUserId: null,
    ...overrides,
  };
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * A service whose answers the spec hands out one at a time, so the order two reads
 * answer in is the spec's to decide.
 */
function service() {
  const heads: Array<{
    options?: { cursor?: string };
    answer: Deferred<TripPage>;
  }> = [];
  const rows: Array<{
    kind: TripKind;
    tripId: string;
    options?: { cursor?: string };
    answer: Deferred<Page<TripRow>>;
  }> = [];

  const impl: TripServiceI = {
    listTrips: (_listId, options) => {
      const answer = deferred<TripPage>();
      heads.push({ options, answer });
      return answer.promise;
    },
    listTripRows: (_listId, kind, tripId, options) => {
      const answer = deferred<Page<TripRow>>();
      rows.push({ kind, tripId, options, answer });
      return answer.promise;
    },
  };

  return { impl, heads, rows };
}

async function flush(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) {
    await Promise.resolve();
  }
}

async function build() {
  TestBed.resetTestingModule();
  const fake = service();
  const realtime = new RealtimeMemory();

  await TestBed.configureTestingModule({
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      TripStore,
      { provide: TRIP_SERVICE, useValue: fake.impl },
      { provide: REALTIME_CLIENT, useValue: realtime },
    ],
  }).compileComponents();

  return { store: TestBed.inject(TripStore), fake, realtime };
}

/** Open the list and answer its first page. */
async function opened(page: TripPage) {
  const built = await build();
  built.store.open(LIST);
  built.fake.heads[0].answer.resolve(page);
  await flush();
  return built;
}

describe('TripStore (velista 0088)', () => {
  afterEach(() => jest.useRealTimers());

  it('reads the first page of heads when a list opens', async () => {
    const live = trip('b-live', { live: true });
    const { store, fake } = await opened({
      live: [live],
      items: [trip('b-old')],
      nextCursor: 'c-1',
    });

    expect(fake.heads).toHaveLength(1);
    expect(store.state()).toBe('loaded');
    expect(store.live()).toEqual([live]);
    expect(store.past().map((item) => item.id)).toEqual(['b-old']);
    expect(store.hasMore()).toBe(true);
  });

  it('opening a trip asks for its rows once, and a second opening asks for nothing (test 7)', async () => {
    const old = trip('b-old');
    const { store, fake } = await opened({
      live: [],
      items: [old],
      nextCursor: null,
    });

    store.ensureRows(old);
    store.ensureRows(old);
    expect(fake.rows).toHaveLength(1);
    expect(store.rowsOf(tripKey(old))).toBeUndefined();

    fake.rows[0].answer.resolve({ items: [row('l-1')], nextCursor: 'r-2' });
    await flush();
    expect(fake.rows).toHaveLength(2);
    expect(fake.rows[1].options?.cursor).toBe('r-2');

    fake.rows[1].answer.resolve({ items: [row('l-2')], nextCursor: null });
    await flush();

    expect(store.rowsOf(tripKey(old))?.map((item) => item.lineId)).toEqual([
      'l-1',
      'l-2',
    ]);
    store.ensureRows(old);
    expect(fake.rows).toHaveLength(2);
  });

  it('coalesces three signals in a burst into one heads read (test 8)', async () => {
    jest.useFakeTimers();
    const { store, fake, realtime } = await opened({
      live: [],
      items: [],
      nextCursor: null,
    });

    realtime.emit('list.tripsChanged', { listId: LIST });
    realtime.emit('line.claimChanged', {
      zoneId: 'z-1',
      claimed: true,
      claimedByUserId: 'u-2',
      lines: [{ lineId: 'l-1', listId: LIST }],
    });
    realtime.emit('line.settled', {
      line: { id: 'l-1', listId: LIST, quantity: 0 },
      settlement: {
        id: 's-1',
        lineId: 'l-1',
        settledAt: '2026-09-17T10:00:00.000Z',
      },
    });
    // Another list's signal is not this page's business.
    realtime.emit('list.tripsChanged', { listId: 'list-2' });

    jest.advanceTimersByTime(TRIPS_REFETCH_QUIET_MS - 1);
    expect(fake.heads).toHaveLength(1);

    jest.advanceTimersByTime(1);
    expect(fake.heads).toHaveLength(2);
    expect(store.state()).toBe('loaded');
  });

  it('drops a heads answer that a newer read overtook (test 8)', async () => {
    jest.useFakeTimers();
    const { store, fake } = await opened({
      live: [],
      items: [trip('b-1')],
      nextCursor: null,
    });

    store.refetch();
    jest.advanceTimersByTime(TRIPS_REFETCH_QUIET_MS);
    store.refetch();
    jest.advanceTimersByTime(TRIPS_REFETCH_QUIET_MS);
    expect(fake.heads).toHaveLength(3);

    // The newer read answers first, and the older one arrives after it.
    fake.heads[2].answer.resolve({
      live: [],
      items: [trip('b-2'), trip('b-1')],
      nextCursor: null,
    });
    await flush();
    fake.heads[1].answer.resolve({
      live: [],
      items: [trip('b-1')],
      nextCursor: null,
    });
    await flush();

    expect(store.past().map((item) => item.id)).toEqual(['b-2', 'b-1']);
  });

  it('a not found rows answer drops the group and reads the heads (test 9)', async () => {
    jest.useFakeTimers();
    const loose = trip('s-1', { kind: 'SESSION' });
    const { store, fake } = await opened({
      live: [],
      items: [loose, trip('b-1')],
      nextCursor: null,
    });

    store.ensureRows(loose);
    expect(fake.rows[0].kind).toBe('SESSION');
    fake.rows[0].answer.reject(
      new GatewayError({ code: 'not_found', status: 404, correlationId: 'x' })
    );
    await flush();

    expect(store.past().map((item) => item.id)).toEqual(['b-1']);
    jest.advanceTimersByTime(TRIPS_REFETCH_QUIET_MS);
    expect(fake.heads).toHaveLength(2);

    // The server still names it: it is not asked for again this visit.
    fake.heads[1].answer.resolve({
      live: [],
      items: [loose, trip('b-1')],
      nextCursor: null,
    });
    await flush();
    expect(store.past().map((item) => item.id)).toEqual(['b-1']);
    store.ensureRows(loose);
    expect(fake.rows).toHaveLength(1);
  });

  it('a refetch rereads the rows of live and opened trips, quietly', async () => {
    jest.useFakeTimers();
    const live = trip('b-live', { live: true });
    const old = trip('b-old');
    const closed = trip('b-closed');
    const { store, fake } = await opened({
      live: [live],
      items: [old, closed],
      nextCursor: null,
    });

    store.ensureRows(old);
    fake.rows[0].answer.resolve({ items: [row('l-1')], nextCursor: null });
    await flush();

    store.refetch();
    jest.advanceTimersByTime(TRIPS_REFETCH_QUIET_MS);
    fake.heads[1].answer.resolve({
      live: [live],
      items: [old, closed],
      nextCursor: null,
    });
    await flush();

    expect(
      fake.rows
        .slice(1)
        .map((read) => read.tripId)
        .sort()
    ).toEqual(['b-live', 'b-old']);
    // Still drawn while the reread is out: no skeleton once a group has rows.
    expect(store.rowsOf(tripKey(old))).toHaveLength(1);
  });

  it('keeps older pages across a refetch and drops a head the fresh page no longer names', async () => {
    jest.useFakeTimers();
    const at = (day: number) => new Date(`2026-09-${day}T10:00:00.000Z`);
    const { store, fake } = await opened({
      live: [],
      items: [
        trip('b-15', { startedAt: at(15) }),
        trip('b-14', { startedAt: at(14) }),
      ],
      nextCursor: 'c-1',
    });

    const more = store.loadMore();
    fake.heads[1].answer.resolve({
      live: [],
      items: [
        trip('b-14', { startedAt: at(14) }),
        trip('b-10', { startedAt: at(10) }),
      ],
      nextCursor: 'c-2',
    });
    expect(await more).toEqual({ state: 'loaded', added: 1 });

    store.refetch();
    jest.advanceTimersByTime(TRIPS_REFETCH_QUIET_MS);
    fake.heads[2].answer.resolve({
      live: [],
      items: [
        trip('b-16', { startedAt: at(16) }),
        trip('b-15', { startedAt: at(15) }),
        trip('b-12', { startedAt: at(12) }),
      ],
      nextCursor: 'c-3',
    });
    await flush();

    // b-14 sat inside the fresh page's range and is gone; b-10 is on a later page.
    expect(store.past().map((item) => item.id)).toEqual([
      'b-16',
      'b-15',
      'b-12',
      'b-10',
    ]);
    expect(store.hasMore()).toBe(true);
  });

  it('a failed first read says so, and retry reads again (test 13)', async () => {
    const { store, fake } = await build();
    store.open(LIST);
    fake.heads[0].answer.reject(new Error('offline'));
    await flush();

    expect(store.state()).toBe('failed');

    store.retry();
    expect(store.state()).toBe('loading');
    fake.heads[1].answer.resolve({ live: [], items: [], nextCursor: null });
    await flush();
    expect(store.state()).toBe('loaded');
  });

  it('leaving drops every read still out', async () => {
    const { store, fake } = await build();
    store.open(LIST);
    store.leave();
    fake.heads[0].answer.resolve({
      live: [],
      items: [trip('b-1')],
      nextCursor: null,
    });
    await flush();

    expect(store.state()).toBe('idle');
    expect(store.past()).toEqual([]);
  });
});
