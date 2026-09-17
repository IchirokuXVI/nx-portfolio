import { TestBed } from '@angular/core/testing';
import {
  TRIPS_REFETCH_QUIET_MS,
  type DueLine,
} from '@portfolio/velista/models';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { REALTIME_CLIENT } from '../realtime/realtime-client';
import { RealtimeMemory } from '../realtime/realtime-memory';
import { DUE_LINE_SERVICE, type DueLineServiceI } from './due-line-service';
import { DueLineStore } from './due-line-store';

const LIST = 'list-1';

function due(lineId: string, overrides: Partial<DueLine> = {}): DueLine {
  return {
    lineId,
    reason: 'PERIOD',
    periodDays: 7,
    daysSinceBought: 6,
    tripsWith: null,
    tripsSeen: null,
    quantity: 1,
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

/** A service whose answers the spec hands out one at a time. */
function service() {
  const reads: Array<{
    listId: string;
    answer: Deferred<readonly DueLine[]>;
  }> = [];
  const impl: DueLineServiceI = {
    listDueLines: (listId) => {
      const answer = deferred<readonly DueLine[]>();
      reads.push({ listId, answer });
      return answer.promise;
    },
  };
  return { impl, reads };
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
      DueLineStore,
      { provide: DUE_LINE_SERVICE, useValue: fake.impl },
      { provide: REALTIME_CLIENT, useValue: realtime },
    ],
  }).compileComponents();

  return { store: TestBed.inject(DueLineStore), fake, realtime };
}

describe('DueLineStore (velista 0089)', () => {
  afterEach(() => jest.useRealTimers());

  it('reads the due lines of a list once when it opens', async () => {
    const { store, fake } = await build();

    store.open(LIST);
    store.open(LIST);
    expect(fake.reads).toHaveLength(1);
    expect(fake.reads[0].listId).toBe(LIST);
    expect(store.lines()).toEqual([]);

    fake.reads[0].answer.resolve([due('l-1'), due('l-2')]);
    await flush();

    expect(store.lines().map((line) => line.lineId)).toEqual(['l-1', 'l-2']);
  });

  it('says nothing and holds nothing when the first read fails', async () => {
    const { store, fake } = await build();

    store.open(LIST);
    fake.reads[0].answer.reject(new Error('offline'));
    await flush();

    expect(store.lines()).toEqual([]);
    expect(store.listId()).toBe(LIST);
  });

  it('keeps what it held when a later read fails', async () => {
    jest.useFakeTimers();
    const { store, fake } = await build();
    store.open(LIST);
    fake.reads[0].answer.resolve([due('l-1')]);
    await flush();

    store.refetch();
    jest.advanceTimersByTime(TRIPS_REFETCH_QUIET_MS);
    fake.reads[1].answer.reject(new Error('offline'));
    await flush();

    expect(store.lines().map((line) => line.lineId)).toEqual(['l-1']);
  });

  it('reads again on the shared signal, once per burst (test 8)', async () => {
    jest.useFakeTimers();
    const { store, fake, realtime } = await build();
    store.open(LIST);
    fake.reads[0].answer.resolve([due('l-1')]);
    await flush();

    realtime.emit('list.tripsChanged', { listId: LIST });
    realtime.emit('line.claimChanged', {
      zoneId: 'z-1',
      claimed: false,
      claimedByUserId: null,
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
    // Another list's signal is not this list's business.
    realtime.emit('list.tripsChanged', { listId: 'list-2' });

    jest.advanceTimersByTime(TRIPS_REFETCH_QUIET_MS - 1);
    expect(fake.reads).toHaveLength(1);

    jest.advanceTimersByTime(1);
    expect(fake.reads).toHaveLength(2);

    fake.reads[1].answer.resolve([due('l-2')]);
    await flush();
    expect(store.lines().map((line) => line.lineId)).toEqual(['l-2']);
  });

  it('ignores signals for another list and signals before a list is open', async () => {
    jest.useFakeTimers();
    const { store, fake, realtime } = await build();

    realtime.emit('list.tripsChanged', { listId: LIST });
    jest.advanceTimersByTime(TRIPS_REFETCH_QUIET_MS);
    expect(fake.reads).toHaveLength(0);

    store.open(LIST);
    realtime.emit('list.tripsChanged', { listId: 'list-2' });
    jest.advanceTimersByTime(TRIPS_REFETCH_QUIET_MS);
    expect(fake.reads).toHaveLength(1);
  });

  it('drops an answer that a newer read overtook', async () => {
    jest.useFakeTimers();
    const { store, fake } = await build();
    store.open(LIST);

    store.refetch();
    jest.advanceTimersByTime(TRIPS_REFETCH_QUIET_MS);
    expect(fake.reads).toHaveLength(2);

    fake.reads[1].answer.resolve([due('fresh')]);
    await flush();
    fake.reads[0].answer.resolve([due('stale')]);
    await flush();

    expect(store.lines().map((line) => line.lineId)).toEqual(['fresh']);
  });

  it('drops a read still out when the list is left or another opens', async () => {
    const { store, fake } = await build();
    store.open(LIST);
    store.open('list-2');

    fake.reads[0].answer.resolve([due('old')]);
    await flush();
    expect(store.lines()).toEqual([]);

    fake.reads[1].answer.resolve([due('new')]);
    await flush();
    expect(store.lines().map((line) => line.lineId)).toEqual(['new']);

    store.leave();
    expect(store.lines()).toEqual([]);
    expect(store.listId()).toBeNull();
  });
});
