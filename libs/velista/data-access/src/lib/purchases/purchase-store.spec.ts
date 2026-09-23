import { TestBed } from '@angular/core/testing';
import {
  purchaseEntryKey,
  PURCHASES_REFETCH_QUIET_MS,
  type Page,
  type PurchaseEntry,
  type PurchaseEntryPage,
  type PurchaseEntryRow,
} from '@portfolio/velista/models';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { GatewayError } from '../errors';
import { REALTIME_CLIENT } from '../realtime/realtime-client';
import { RealtimeMemory } from '../realtime/realtime-memory';
import { PURCHASE_SERVICE, type PurchaseServiceI } from './purchase-service';
import { PurchaseStore } from './purchase-store';

function entry(
  id: string,
  overrides: Partial<PurchaseEntry> = {}
): PurchaseEntry {
  return {
    id,
    kind: 'SESSION',
    name: null,
    startedAt: new Date('2026-09-20T10:00:00.000Z'),
    purchaseCount: 2,
    spend: null,
    unpricedCount: 2,
    ...overrides,
  };
}

function row(id: string): PurchaseEntryRow {
  return {
    id,
    content: id,
    itemId: null,
    quantity: 1,
    unitPriceCents: null,
    currency: null,
    listName: null,
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
  const heads: Array<{ cursor?: string; answer: Deferred<PurchaseEntryPage> }> =
    [];
  const rows: Array<{
    key: string;
    cursor?: string;
    answer: Deferred<Page<PurchaseEntryRow>>;
  }> = [];

  const impl: PurchaseServiceI = {
    sessions: (cursor) => {
      const answer = deferred<PurchaseEntryPage>();
      heads.push({ cursor, answer });
      return answer.promise;
    },
    rows: (target, cursor) => {
      const answer = deferred<Page<PurchaseEntryRow>>();
      rows.push({ key: purchaseEntryKey(target), cursor, answer });
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
      PurchaseStore,
      { provide: PURCHASE_SERVICE, useValue: fake.impl },
      { provide: REALTIME_CLIENT, useValue: realtime },
    ],
  }).compileComponents();

  return { store: TestBed.inject(PurchaseStore), fake, realtime };
}

async function loaded(page: PurchaseEntryPage) {
  const built = await build();
  const done = built.store.loadFirst();
  built.fake.heads[0].answer.resolve(page);
  await done;
  return built;
}

function settled() {
  return {
    line: { id: 'l-1', listId: 'list-1', quantity: 0 },
    settlement: {
      id: 'st-9',
      lineId: 'l-1',
      settledAt: '2026-09-20T12:00:00.000Z',
    },
  };
}

describe('PurchaseStore (velista 0095)', () => {
  afterEach(() => jest.useRealTimers());

  it('reads nothing until the tab asks, and the first page once', async () => {
    const { store, fake } = await build();
    expect(fake.heads).toHaveLength(0);
    expect(store.state()).toBe('idle');

    const first = store.loadFirst();
    expect(store.state()).toBe('loading');
    fake.heads[0].answer.resolve({ items: [entry('s-1')], nextCursor: 'c-2' });
    await first;

    expect(store.state()).toBe('loaded');
    expect(store.entries().map((item) => item.id)).toEqual(['s-1']);
    expect(store.hasMore()).toBe(true);

    await store.loadFirst();
    expect(fake.heads).toHaveLength(1);
  });

  it('says a failed first read failed, and reload reads again', async () => {
    const { store, fake } = await build();
    const first = store.loadFirst();
    fake.heads[0].answer.reject(new Error('offline'));
    await first;
    expect(store.state()).toBe('failed');

    void store.reload();
    expect(fake.heads).toHaveLength(2);
  });

  it('appends the next page and answers how many arrived', async () => {
    const { store, fake } = await loaded({
      items: [entry('s-1')],
      nextCursor: 'c-2',
    });

    const more = store.loadMore();
    expect(fake.heads[1].cursor).toBe('c-2');
    fake.heads[1].answer.resolve({
      items: [entry('s-1'), entry('s-2')],
      nextCursor: null,
    });

    await expect(more).resolves.toEqual({ state: 'loaded', added: 1 });
    expect(store.entries().map((item) => item.id)).toEqual(['s-1', 's-2']);
    expect(store.hasMore()).toBe(false);
  });

  describe('rows (test 5)', () => {
    it('reads an entry once on first open, every page, and never again', async () => {
      const session = entry('s-1');
      const key = purchaseEntryKey(session);
      const { store, fake } = await loaded({
        items: [session],
        nextCursor: null,
      });

      store.open(key);
      store.open(key);
      expect(fake.rows).toHaveLength(1);
      expect(store.rowsOf(key)).toBeUndefined();

      fake.rows[0].answer.resolve({ items: [row('r-1')], nextCursor: 'p-2' });
      await flush();
      expect(fake.rows).toHaveLength(2);
      expect(fake.rows[1].cursor).toBe('p-2');

      fake.rows[1].answer.resolve({ items: [row('r-2')], nextCursor: null });
      await flush();

      expect(store.rowsOf(key)?.map((item) => item.id)).toEqual(['r-1', 'r-2']);
      store.open(key);
      expect(fake.rows).toHaveLength(2);
    });

    it('drops a rows answer that a newer read overtook', async () => {
      jest.useFakeTimers();
      const session = entry('s-1');
      const key = purchaseEntryKey(session);
      const { store, fake } = await loaded({
        items: [session],
        nextCursor: null,
      });

      store.open(key);
      store.refetch();
      jest.advanceTimersByTime(PURCHASES_REFETCH_QUIET_MS);
      fake.heads[1].answer.resolve({ items: [session], nextCursor: null });
      await flush();
      expect(fake.rows).toHaveLength(2);

      // The newer read answers first, and the older one arrives after it.
      fake.rows[1].answer.resolve({
        items: [row('r-1'), row('r-2')],
        nextCursor: null,
      });
      await flush();
      fake.rows[0].answer.resolve({ items: [row('r-1')], nextCursor: null });
      await flush();

      expect(store.rowsOf(key)?.map((item) => item.id)).toEqual(['r-1', 'r-2']);
    });

    it('drops an entry whose rows answer not found, and reads the first page', async () => {
      jest.useFakeTimers();
      const session = entry('s-1');
      const key = purchaseEntryKey(session);
      const { store, fake } = await loaded({
        items: [session, entry('s-2')],
        nextCursor: null,
      });

      store.open(key);
      fake.rows[0].answer.reject(
        new GatewayError({
          code: 'not_found',
          status: 404,
          correlationId: 'c',
        })
      );
      await flush();

      expect(store.entries().map((item) => item.id)).toEqual(['s-2']);
      jest.advanceTimersByTime(PURCHASES_REFETCH_QUIET_MS);
      expect(fake.heads).toHaveLength(2);
    });
  });

  describe('realtime (section 10)', () => {
    it('refetches once for a burst of settles and basket updates, quietly', async () => {
      jest.useFakeTimers();
      const { store, fake, realtime } = await loaded({
        items: [entry('s-1')],
        nextCursor: null,
      });
      store.attach();

      realtime.emit('line.settled', settled());
      realtime.emit('basket.updated', {
        id: 'b',
        name: null,
        status: 'OPEN',
        generatedAt: '2026-09-20T10:00:00.000Z',
        lines: [],
      });

      jest.advanceTimersByTime(PURCHASES_REFETCH_QUIET_MS - 1);
      expect(fake.heads).toHaveLength(1);
      jest.advanceTimersByTime(1);
      expect(fake.heads).toHaveLength(2);
      expect(store.state()).toBe('loaded');

      fake.heads[1].answer.resolve({
        items: [entry('s-2'), entry('s-1')],
        nextCursor: null,
      });
      await flush();
      expect(store.entries().map((item) => item.id)).toEqual(['s-2', 's-1']);
    });

    it('drops an entry the fresh first page no longer names', async () => {
      jest.useFakeTimers();
      const { store, fake } = await loaded({
        items: [entry('s-1'), entry('s-2')],
        nextCursor: null,
      });

      store.refetch();
      jest.advanceTimersByTime(PURCHASES_REFETCH_QUIET_MS);
      fake.heads[1].answer.resolve({ items: [entry('s-2')], nextCursor: null });
      await flush();

      expect(store.entries().map((item) => item.id)).toEqual(['s-2']);
    });

    it('hears nothing once the page detached', async () => {
      jest.useFakeTimers();
      const { store, fake, realtime } = await loaded({
        items: [],
        nextCursor: null,
      });
      store.attach();
      store.detach();

      realtime.emit('line.settled', settled());
      jest.advanceTimersByTime(PURCHASES_REFETCH_QUIET_MS);

      expect(fake.heads).toHaveLength(1);
    });
  });
});
