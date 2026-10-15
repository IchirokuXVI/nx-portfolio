import { signal, type Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RokuLocaleStore } from '@portfolio/localization/rokutranslator-angular';
import {
  applyBasketMarks,
  applyBasketPatch,
  BASKET_PATCH_READ,
  type Basket,
  type BasketProduct,
  type BasketRow,
  type BasketRowEntry,
  type BasketSession,
  type BasketSettleRequest,
} from '@portfolio/velista/models';
import {
  AppResumed,
  provideFakeBrowserFacade,
} from '@portfolio/velista/platform';
import { Subject } from 'rxjs';
import { MEMORY_CATEGORIES, memoryCategory } from '../catalog/category-memory';
import { GatewayError } from '../errors';
import { REALTIME_CLIENT } from '../realtime/realtime-client';
import type { RealtimeEvent } from '../realtime/realtime-events';
import { RealtimeMemory } from '../realtime/realtime-memory';
import {
  fakeCategoryStore,
  provideFakeCategoryStore,
  provideFakeShopSectionsStore,
} from '../testing/store-doubles';
import { BasketMemory } from './basket-memory';
import { BASKET_SERVICE, type BasketServiceI } from './basket-service';
import { BasketSessionStore } from './basket-session-store';
import { BasketSocket } from './basket-socket';
import { BasketStore } from './basket-store';
import { BasketViewStore } from './basket-view-store';
import { HeldProductChoices } from './held-product-choices';

/**
 * The basket store (plan 0044).
 *
 * Two things are worth a spec here and the rest is plumbing.
 *
 * **A 401 has two readings**, and which one the screen shows decides whether
 * somebody is told they were removed or quietly offered the join screen. The
 * store tells them apart by what this browser was holding, which is a rule with
 * no visible symptom when it is wrong: both states render *something*, and the
 * wrong one is merely a lie.
 *
 * **A write's answer is folded and never patched.** The store replaces the row by
 * key and takes the counts whole, because every number on this screen is one the
 * server sent (backend `0130`, section 4). `apply` and its merge are gone with the
 * line events they existed for: a broadcast carries ids and no numbers now, so
 * there is nothing to merge and the store reads again.
 *
 * **Three things make it read again**, and two of them are edges rather than
 * events: the socket coming back and the app coming back. A reader that missed an
 * edge cannot tell it happened, so both are counters and the store compares each
 * against what it last acted on.
 */

/** A session store over a plain object, so nothing here touches `localStorage`. */
class FakeSessions {
  private readonly _held = new Map<string, BasketSession>();

  read(basketId: string): BasketSession | null {
    return this._held.get(basketId) ?? null;
  }

  write(session: BasketSession): void {
    this._held.set(session.basketId, session);
  }

  forget(basketId: string): void {
    this._held.delete(basketId);
  }

  /** Seeds a credential, which is what a guest who has joined would hold. */
  seed(basketId: string): void {
    this._held.set(basketId, {
      basketId,
      participantId: 'p-guest-9',
      secret: 'secret',
      socketToken: 'socket',
      socketTokenExpiresAt: null,
    });
  }
}

function unauthorized(): GatewayError {
  return new GatewayError({
    code: 'unauthorized',
    status: 401,
    correlationId: 'spec',
  });
}

/**
 * A socket that opens nothing and that the spec drives by hand.
 *
 * The real one reaches `ApiUrl` and `SOCKET_FACTORY` and owns a backoff and two
 * timers, none of which any assertion here is about: what these tests care about is
 * what the **store** does with an event, so the connection is a `Subject` and going
 * live is a signal somebody sets.
 */
class FakeSocket {
  readonly events = new Subject<RealtimeEvent>();
  readonly connected = signal(false);
  readonly revoked = signal(false);
  /** Comings **back**, which the store reads as a reason to ask again. */
  readonly reconnects = signal(0);

  readonly opened: string[] = [];
  closes = 0;

  open(basketId: string): void {
    this.opened.push(basketId);
  }

  close(): void {
    this.closes += 1;
    this.connected.set(false);
    this.reconnects.set(0);
  }
}

/** The app coming back, which the store reads the same way. */
class FakeResumed {
  readonly resumes = signal(0);
}

/**
 * A service that delegates to {@link BasketMemory}, with named overrides on top.
 *
 * Written out rather than spread from the instance: the methods live on the
 * prototype, so `{ ...memory }` copies the two public fields and none of the
 * behaviour, and every call lands on `undefined`.
 */
function build(
  overrides: Partial<BasketServiceI> = {},
  sessions: FakeSessions = new FakeSessions(),
  socket: FakeSocket = new FakeSocket(),
  resumed: FakeResumed = new FakeResumed(),
  /** More of the route's providers, for a spec that reads the store through them. */
  extra: readonly Provider[] = []
): {
  store: BasketStore;
  sessions: FakeSessions;
  socket: FakeSocket;
  resumed: FakeResumed;
  /** The twin behind every method the spec did not override. */
  memory: BasketMemory;
} {
  const memory = new BasketMemory();
  const service: BasketServiceI = {
    previewLink: (secret) => memory.previewLink(secret),
    join: (secret, name) => memory.join(secret, name),
    getBasket: () => memory.getBasket(),
    getLiveBasket: () => memory.getLiveBasket(),
    getLiveSummary: () => memory.getLiveSummary(),
    settle: (id, target, body) => memory.settle(id, target, body),
    revert: (id, target, body) => memory.revert(id, target, body),
    renameRow: (id, target, body) => memory.renameRow(id, target, body),
    skip: (id, target) => memory.skip(id, target),
    unskip: (id, target) => memory.unskip(id, target),
    setDemand: (id, body) => memory.setDemand(id, body),
    changeProduct: (id, body) => memory.changeProduct(id, body),
    productLists: (id, itemId) => memory.productLists(id, itemId),
    addLine: (id, body) => memory.addLine(id, body),
    suggest: (id, query) => memory.suggest(id, query),
    changes: (id, ctx, cursor) => memory.changes(id, ctx, cursor),
    acknowledgeChanges: (id, through) => memory.acknowledgeChanges(id, through),
    listParticipants: () => memory.listParticipants(),
    refreshSocketToken: () => memory.refreshSocketToken(),
    ensureShareLink: () => memory.ensureShareLink(),
    getShareLink: () => memory.getShareLink(),
    revokeShareLink: (id, cascade) => memory.revokeShareLink(id, cascade),
    revokeParticipant: (id, participantId) =>
      memory.revokeParticipant(id, participantId),
    addParticipant: (id, userId) => memory.addParticipant(id, userId),
    leaveBasket: () => memory.leaveBasket(),
    getMarks: () => memory.getMarks(),
    ...overrides,
    // The rows read is the full read with no catalog half (backend `0205`). A
    // spec that holds or counts the full read holds and counts this one too.
    getBasketRows:
      overrides.getBasketRows ??
      (async (id, at) => {
        const read = overrides.getBasket ?? (() => memory.getBasket());
        return {
          ...(await read(id, at)),
          products: new Map(),
          scopes: new Map(),
          shop: null,
        };
      }),
  };

  TestBed.configureTestingModule({
    providers: [
      BasketStore,
      HeldProductChoices,
      { provide: BasketSessionStore, useValue: sessions },
      { provide: BASKET_SERVICE, useValue: service },
      { provide: BasketSocket, useValue: socket },
      { provide: AppResumed, useValue: resumed },
      { provide: REALTIME_CLIENT, useExisting: RealtimeMemory },
      ...extra,
    ],
  });

  return {
    store: TestBed.inject(BasketStore),
    sessions,
    socket,
    resumed,
    memory,
  };
}

/** A `basket.linesChanged` with ids alone, as every envelope before backend `0204`. */
function idsAlone(lineIds: readonly string[]): RealtimeEvent {
  return {
    type: 'basket.linesChanged',
    lineIds,
    entries: null,
    marksMoved: false,
  };
}

/** Let the promises a timer started settle. */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) {
    await Promise.resolve();
  }
}

/** The row this basket holds under one name, which every write here addresses. */
function rowOf(store: BasketStore, content: string): BasketRow {
  const found = store.rows().find((row) => row.content === content);
  if (found === undefined) {
    throw new Error(`the fixture basket lost its ${content}`);
  }
  return found;
}

describe('BasketStore', () => {
  describe('opening one', () => {
    it('loads the basket and reports ready', async () => {
      const { store } = build();
      await store.open('basket-saturday');

      expect(store.state()).toBe('ready');
      expect(store.rows().length).toBeGreaterThan(0);
      expect(store.me()).not.toBeNull();
    });

    it('does not count a row the shop had none of as one somebody got', async () => {
      // The header says "got", and got means bought. A `NOT_AVAILABLE` row is
      // closed without anything being bought, so counting every finished row as
      // one somebody got would claim a purchase that never happened — the same
      // claim the row's caption is careful to avoid.
      const { store } = build();
      await store.open('basket-saturday');

      expect(rowOf(store, 'Sourdough loaf').state).toBe('NOT_AVAILABLE');
      expect(store.progress().unavailable).toBe(1);
      // None: the butter somebody bought through another basket counts for
      // nothing in this one (backend `0203`).
      expect(rowOf(store, 'Butter').state).toBe('BOUGHT_ELSEWHERE');
      expect(store.progress().done).toBe(0);
    });

    /**
     * The count is the **server's**, and this is what says so: the store reads it
     * off the basket rather than walking the rows, which is the arithmetic backend
     * `0130` section 4 took over.
     */
    it('takes the counts from the server rather than counting rows', async () => {
      const memory = new BasketMemory();
      const { store } = build({
        getBasket: async () => ({
          ...(await memory.getBasket()),
          // Deliberately disagreeing with the rows, so a store that recounted
          // would answer something else.
          progress: { done: 7, unavailable: 0, total: 9 },
          pending: 2,
        }),
      });
      await store.open('basket-saturday');

      expect(store.progress()).toEqual({ done: 7, unavailable: 0, total: 9 });
      expect(store.pending()).toBe(2);
    });

    it('reports what the server served, never a guess', async () => {
      const memory = new BasketMemory();
      memory.servesLists = false;
      const { store } = build({ getBasket: () => memory.getBasket() });
      await store.open('basket-saturday');

      // A guest is served no ref, so every entry they hold names no list: they
      // know how much and never where.
      expect(store.lists().size).toBe(0);
      expect(
        store
          .rows()
          .every((row) => row.entries.every((entry) => entry.listId === null))
      ).toBe(true);
    });
  });

  /**
   * The rule with two readings of one status code.
   *
   * A credential that has stopped working was **revoked** and the person should
   * be told. No credential at all is a stranger who followed a link and has not
   * joined yet, which is not a failure and must not be reported as one.
   */
  describe('a 401', () => {
    it('reads as revoked when this browser held a credential', async () => {
      const sessions = new FakeSessions();
      sessions.seed('basket-saturday');
      const { store } = build(
        {
          getBasket: () => Promise.reject(unauthorized()),
        },
        sessions
      );

      await store.open('basket-saturday');

      expect(store.state()).toBe('revoked');
    });

    it('reads as needing a join when it held none', async () => {
      const { store } = build({
        getBasket: () => Promise.reject(unauthorized()),
      });

      await store.open('basket-saturday');

      expect(store.state()).toBe('needsJoin');
    });

    it('drops the credential either way, so no tap is refused twice', async () => {
      const sessions = new FakeSessions();
      sessions.seed('basket-saturday');
      const { store } = build(
        { getBasket: () => Promise.reject(unauthorized()) },
        sessions
      );

      await store.open('basket-saturday');

      // Keeping a secret known not to work would send the reader to a basket
      // that refuses every action, rather than to the join screen where the link
      // they still hold might let them back in.
      expect(sessions.read('basket-saturday')).toBeNull();
    });
  });

  describe('a failure that is not a 401', () => {
    it('fails outright when there is nothing on screen yet', async () => {
      const { store } = build({
        getBasket: () =>
          Promise.reject(
            new GatewayError({
              code: 'internal',
              status: 500,
              correlationId: 'spec',
            })
          ),
      });

      await store.open('basket-saturday');

      expect(store.state()).toBe('failed');
    });

    it('keeps a basket that is already drawn rather than blanking it', async () => {
      // A shopper in an aisle is better served by a list that is a minute old
      // than by an error page.
      const memory = new BasketMemory();
      let calls = 0;
      const { store } = build({
        getBasket: () => {
          calls += 1;
          return calls === 1
            ? memory.getBasket()
            : Promise.reject(
                new GatewayError({
                  code: 'internal',
                  status: 500,
                  correlationId: 'spec',
                })
              );
        },
      });

      await store.open('basket-saturday');
      const before = store.rows().length;
      await store.refresh();

      expect(store.state()).toBe('ready');
      expect(store.rows()).toHaveLength(before);
    });
  });

  describe('settling', () => {
    it('folds the answer in, so the row is right before any refresh lands', async () => {
      const { store } = build();
      await store.open('basket-saturday');

      const milk = rowOf(store, 'Milk');
      await store.settle(milk.rowKey, {
        outcome: 'BOUGHT',
        quantity: milk.left,
        from: milk.left,
      });

      const after = rowOf(store, 'Milk');
      expect(after.bought).toBe(milk.left);
      expect(after.left).toBe(0);
    });

    /**
     * A write answers `usual` null (backend `0165`), and taking that as the answer
     * would put a row the usual filter hid back on the screen the moment it was
     * settled (velista `0104`). The last read's value stays until the next read.
     */
    it('keeps the usual of the last read on a row a write answered', async () => {
      const seeded = new BasketMemory();
      const { store } = build({
        getBasket: async () => {
          const read = await seeded.getBasket();
          return {
            ...read,
            rows: read.rows.map((row) => ({
              ...row,
              usual: { state: 'HERE' as const, bought: 3, of: 6 },
            })),
          };
        },
      });
      await store.open('basket-saturday');

      const milk = rowOf(store, 'Milk');
      await store.settle(milk.rowKey, {
        outcome: 'BOUGHT',
        quantity: milk.left,
        from: milk.left,
      });

      expect(rowOf(store, 'Milk').left).toBe(0);
      expect(rowOf(store, 'Milk').usual).toEqual({
        state: 'HERE',
        bought: 3,
        of: 6,
      });
    });

    /**
     * The header is counted over the rows held, with the shared rule, and not taken
     * from the answer: a write's progress is core's count with no prices, and can
     * be one off the read (backend `0201`, "What the build decided", point 1).
     */
    it('counts the header over the rows it holds, not from the answer', async () => {
      const memory = new BasketMemory();
      const { store } = build({
        getBasket: () => memory.getBasket(),
        settle: async (id, target, body) => ({
          ...(await memory.settle(id, target, body)),
          progress: { done: 5, unavailable: 1, total: 8 },
          pending: 2,
        }),
      });
      await store.open('basket-saturday');

      const eggs = rowOf(store, 'Eggs');
      await store.settle(eggs.rowKey, {
        outcome: 'BOUGHT',
        quantity: eggs.left,
        from: eggs.left,
      });

      // Eggs done, the loaf had none, the milk is still wanted.
      expect(store.progress()).toEqual({ done: 1, unavailable: 1, total: 3 });
      expect(store.pending()).toBe(1);
    });

    /** Every write names every line of the row, served or not (velista `0139`). */
    it('names every line of the row on each write, a guest\u2019s unserved ones too', async () => {
      const memory = new BasketMemory();
      memory.servesLists = false;
      const targets: unknown[] = [];
      const { store } = build({
        getBasket: () => memory.getBasket(),
        settle: (id, target, body) => {
          targets.push(target);
          return memory.settle(id, target, body);
        },
        revert: (id, target, body) => {
          targets.push(target);
          return memory.revert(id, target, body);
        },
        skip: (id, target) => {
          targets.push(target);
          return memory.skip(id, target);
        },
        unskip: (id, target) => {
          targets.push(target);
          return memory.unskip(id, target);
        },
      });
      await store.open('basket-saturday');
      const eggs = rowOf(store, 'Eggs');
      expect(eggs.entries.every((entry) => entry.listId === null)).toBe(true);

      await store.skip(eggs.rowKey);
      await store.unskip(eggs.rowKey);
      await store.settle(eggs.rowKey, {
        outcome: 'BOUGHT',
        quantity: 1,
        from: rowOf(store, 'Eggs').left,
      });
      await store.revert(eggs.rowKey, {
        target: 'UNITS',
        units: 1,
        from: rowOf(store, 'Eggs').bought,
      });

      expect(targets).toEqual(
        Array(4).fill({ rowKey: 'zl-3', lineIds: ['zl-3', 'zl-5'] })
      );
    });

    it('sends nothing for a row it does not hold', async () => {
      const settle = jest.fn();
      const { store } = build({ settle });
      await store.open('basket-saturday');

      const result = await store.settle('zl-gone', {
        outcome: 'BOUGHT',
        quantity: 1,
        from: 1,
      });

      expect(result).toBeNull();
      expect(settle).not.toHaveBeenCalled();
    });

    it('reports an entry a write could not reach rather than swallowing it', async () => {
      // A shopper who has bought the thing has to be told something did not land,
      // whether or not they may know whose list it was.
      const memory = new BasketMemory();
      const { store } = build({
        getBasket: () => memory.getBasket(),
        settle: async (id, rowKey, body) => ({
          ...(await memory.settle(id, rowKey, body)),
          skippedCount: 1,
        }),
      });
      await store.open('basket-saturday');

      const milk = rowOf(store, 'Milk');
      const result = await store.settle(milk.rowKey, {
        outcome: 'BOUGHT',
        quantity: 1,
        from: milk.left,
      });

      expect(result?.skippedCount).toBe(1);
    });

    it('marks the row busy while the write is out, and only that row', async () => {
      let release: (() => void) | undefined;
      const memory = new BasketMemory();
      const { store } = build({
        getBasket: () => memory.getBasket(),
        settle: (id, rowKey, body) =>
          new Promise((resolve) => {
            release = () => resolve(memory.settle(id, rowKey, body));
          }),
      });
      await store.open('basket-saturday');

      const first = store.rows()[0];
      const pending = store.settle(first.rowKey, {
        outcome: 'BOUGHT',
        quantity: 1,
        from: first.left,
      });

      expect(store.busyRows().has(first.rowKey)).toBe(true);
      expect(store.busyRows().has(store.rows()[1].rowKey)).toBe(false);

      release?.();
      await pending;
      expect(store.busyRows().has(first.rowKey)).toBe(false);
    });
  });

  describe('the share link', () => {
    it('mints one when the basket has none, because that is what share means', async () => {
      const memory = new BasketMemory();
      await memory.revokeShareLink('basket-saturday');
      const { store } = build({
        getBasket: () => memory.getBasket(),
        getShareLink: () => memory.getShareLink(),
        ensureShareLink: () => memory.ensureShareLink(),
      });
      await store.open('basket-saturday');

      expect(
        await store.loadShareLink().then(() => store.shareLink())
      ).toBeNull();
      await store.share();
      expect(store.shareLink()).not.toBeNull();
    });

    it('revoking without the cascade leaves everybody shopping', async () => {
      // The default, and the one people mean: stop it spreading, do not throw
      // three people out of a shop.
      const memory = new BasketMemory();
      let cascaded: boolean | undefined;
      const { store } = build({
        getBasket: () => memory.getBasket(),
        revokeShareLink: (id, cascade) => {
          cascaded = cascade;
          return memory.revokeShareLink(id, cascade);
        },
      });
      await store.open('basket-saturday');
      const before = store.participants().length;

      await store.revokeLink(false);

      expect(cascaded).toBe(false);
      expect(store.participants()).toHaveLength(before);
      expect(store.shareLink()).toBeNull();
    });

    it('revoking with the cascade removes the people it let in', async () => {
      const memory = new BasketMemory();
      const { store } = build({
        getBasket: () => memory.getBasket(),
        revokeShareLink: (id, cascade) => memory.revokeShareLink(id, cascade),
      });
      await store.open('basket-saturday');
      const before = store.participants().length;

      await store.revokeLink(true);

      expect(store.participants().length).toBeLessThan(before);
    });
  });

  /**
   * The live basket (plan 0048).
   *
   * These are the store's half of the plan and deliberately not the socket's: the
   * connection, its backoff and its token refresh are `BasketSocket`'s business, and
   * what matters here is that an event off the room moves the screen **without a
   * request**. A request per settle is what four people in a shop would generate, and
   * stopping that is what a live basket is for.
   */
  /**
   * Renaming a row (velista `0084`, backend `0113`).
   *
   * The claim worth a spec is the merge: the row that goes away must leave the
   * basket at once, whichever of the two it was, and the answer's row is not
   * always the row the rename addressed.
   */
  describe('renaming a row', () => {
    it('renames the lines of a row with no product, and keeps its key', async () => {
      const { store } = build();
      await store.open('basket-saturday');
      const loaf = rowOf(store, 'Sourdough loaf');

      const result = await store.renameRow(loaf.rowKey, {
        content: 'Rye bread',
      });

      expect(result?.entries.map((entry) => entry.content)).toEqual([
        'Rye bread',
      ]);
      const row = store.rows().find((held) => held.rowKey === loaf.rowKey);
      expect(row?.entries[0].content).toBe('Rye bread');
    });

    it('answers null and keeps the question when the name is taken', async () => {
      const { store } = build();
      await store.open('basket-saturday');
      const before = store.rows().length;

      const result = await store.renameRow(
        rowOf(store, 'Sourdough loaf').rowKey,
        { content: 'butter' }
      );

      expect(result).toBeNull();
      expect(store.rows()).toHaveLength(before);
      expect((store.error() as GatewayError).code).toBe('line_merge_required');
    });

    /** The read after the write is where the merged row comes from. */
    it('takes the merged row from the read that follows', async () => {
      const { store } = build();
      await store.open('basket-saturday');
      const before = store.rows().length;

      await store.renameRow(rowOf(store, 'Sourdough loaf').rowKey, {
        content: 'butter',
        confirmMerge: true,
      });
      await store.refresh();

      expect(store.rows()).toHaveLength(before - 1);
    });

    it('refuses a row with a product, which the catalog names', async () => {
      const { store } = build();
      await store.open('basket-saturday');

      const result = await store.renameRow(rowOf(store, 'Eggs').rowKey, {
        content: 'Free range eggs',
      });

      expect(result).toBeNull();
      expect((store.error() as GatewayError).code).toBe('validation_failed');
    });
  });

  /**
   * A read cannot erase what landed while it was out (velista `0086`).
   *
   * Found by the browser suite, in the order it happens in a shop: somebody joins,
   * the burst of events their arrival makes is coalesced into one re-read a second
   * and a half later, and while that read is out the person holding the phone
   * settles a row. The write answered first and its row was drawn. The read
   * answered second, from before the write, and replaced the whole basket, so the
   * row the shopper had just watched move went back to what it was.
   *
   * These drive it by hand rather than through the timer, because the timer is not
   * what makes the defect: a read that is out when something lands is.
   */
  describe('a read that was out when something landed', () => {
    /**
     * A basket read the spec holds open, answering the basket **as it was when the
     * read went out**.
     *
     * The snapshot is composed at the call and not at the release, which is the
     * whole arrangement: releasing it later then delivers an answer that is
     * genuinely older than whatever the spec did in between.
     */
    function holdReads(memory: BasketMemory) {
      const waiting: (() => void)[] = [];
      const counted = { reads: 0 };

      return {
        counted,
        getBasket: (): Promise<Basket> => {
          counted.reads += 1;
          const answer = memory.getBasket();
          return new Promise<Basket>((resolve) => {
            waiting.push(() => resolve(answer));
          });
        },
        /** Answer the oldest read still out, and let the store act on it. */
        async release(): Promise<void> {
          const next = waiting.shift();
          if (next === undefined) {
            throw new Error('no read was waiting to be answered');
          }
          next();
          await new Promise((resolve) => setTimeout(resolve, 0));
        },
      };
    }

    it('puts a write back on an answer that left before it (velista 0143, section 5)', async () => {
      const memory = new BasketMemory();
      const held = holdReads(memory);
      const { store } = build({
        getBasket: held.getBasket,
        settle: (id, rowKey, body) => memory.settle(id, rowKey, body),
      });

      const opening = store.open('basket-saturday');
      await held.release();
      await opening;

      // A read goes out, and a settle lands while it is still out.
      const reading = store.refresh();
      const eggs = rowOf(store, 'Eggs');
      await store.settle(eggs.rowKey, {
        outcome: 'BOUGHT',
        quantity: 1,
        from: eggs.left,
      });
      expect(rowOf(store, 'Eggs').bought).toBe(eggs.bought + 1);

      // The answer is older than the settle. The settle's lines are newer by
      // their version, so they are put on it, and nothing reads again.
      const before = held.counted.reads;
      await held.release();
      await reading;
      expect(held.counted.reads).toBe(before);
      expect(rowOf(store, 'Eggs').bought).toBe(eggs.bought + 1);
    });

    it('asks again rather than applying an answer an add overtook', async () => {
      const memory = new BasketMemory();
      const held = holdReads(memory);
      const { store } = build({
        getBasket: held.getBasket,
        addLine: (id, body) => memory.addLine(id, body),
      });

      const opening = store.open('basket-saturday');
      await held.release();
      await opening;

      // An add is folded and not patched: its line is new to this client.
      const reading = store.refresh();
      await store.addLine({
        content: 'Rice',
        quantity: 1,
        targetListId: 'list-weekly',
      });

      // The stale answer is dropped and the read goes round again.
      const before = held.counted.reads;
      await held.release();
      expect(held.counted.reads).toBe(before + 1);

      await held.release();
      await reading;
      expect(rowOf(store, 'Rice').left).toBe(1);
    });

    /**
     * Two callers at once collapse into one read with at most one queued behind
     * it, because a caller that arrived while a read was out is not served by that
     * read: it left before they asked.
     */
    it('collapses two refreshes into one read and one queued behind it', async () => {
      const memory = new BasketMemory();
      const held = holdReads(memory);
      const { store } = build({ getBasket: held.getBasket });

      const opening = store.open('basket-saturday');
      await held.release();
      await opening;

      const first = store.refresh();
      const second = store.refresh();
      await held.release();
      await held.release();
      await Promise.all([first, second]);

      // The open's read, the first refresh, and one more for the caller that
      // arrived while it was out.
      expect(held.counted.reads).toBe(3);
    });

    /**
     * A read that is still out was asked for the basket being let go, so `leave`
     * disowns it: the next visit starts one of its own rather than waiting on an
     * answer nothing will apply.
     */
    it('drops an answer for a basket the screen has since left', async () => {
      const memory = new BasketMemory();
      const held = holdReads(memory);
      const { store } = build({ getBasket: held.getBasket });

      const opening = store.open('basket-saturday');
      await held.release();
      await opening;

      const reading = store.refresh();
      store.leave();
      await held.release();
      await reading;

      expect(store.basket()).toBeNull();
    });
  });

  /**
   * The trip being over, which is what takes every control off the screen
   * (velista `0057`, section 6).
   *
   * `finished` is the negation of `takesLines` and not a status of its own, which is
   * the whole of what these assert: one question, asked once, so a control and the
   * banner beside it cannot disagree about whether the basket may be changed.
   */
  describe('a finished basket', () => {
    it('says so once the basket has been read', async () => {
      const memory = new BasketMemory();
      memory.status = 'FINISHED';
      const { store } = build({ getBasket: () => memory.getBasket() });
      await store.open('basket-saturday');

      expect(store.finished()).toBe(true);
      expect(store.isOpen()).toBe(false);
    });

    it('says nothing at all before the first read lands', async () => {
      // The one place the two questions come apart, and the reason `finished` is not
      // written as a plain negation: nothing has loaded, so the screen must not draw
      // a banner claiming a trip is over while it is still asking what the trip is.
      const { store } = build();

      expect(store.isOpen()).toBe(false);
      expect(store.finished()).toBe(false);
    });

    it('is not finished while the trip is live', async () => {
      const { store } = build();
      await store.open('basket-saturday');

      expect(store.finished()).toBe(false);
    });

    /**
     * **The server's count, read and never worked out.** A `SKIPPED` row is
     * pending and this side has no way to know that, which is why the store reads
     * `pending` rather than subtracting the three numbers beside it.
     */
    it('reads the pending count the server sent, for the sheet warning', async () => {
      const memory = new BasketMemory();
      const { store } = build({
        getBasket: async () => ({ ...(await memory.getBasket()), pending: 7 }),
      });
      await store.open('basket-saturday');

      expect(store.pending()).toBe(7);
    });

    /**
     * The guest standing in a shop when the owner presses Finish (section 6.1).
     *
     * Their screen redraws **in place**: no reload, and no disconnection. Finishing
     * does not revoke the link, evict anybody or drop a socket, so the event arrives
     * over the connection they already hold and the basket they are looking at
     * becomes the finished one. Disconnecting them would tell them nothing at all,
     * and they are the people who most need to see that it happened.
     */
    it('redraws from the broadcast, over the socket already held', async () => {
      jest.useFakeTimers();
      try {
        const memory = new BasketMemory();
        const { store, socket } = build({
          getBasket: () => memory.getBasket(),
        });
        await store.open('basket-saturday');
        expect(store.finished()).toBe(false);

        memory.status = 'FINISHED';
        socket.events.next({
          type: 'basket.updated',
          list: { id: 'basket-saturday' },
        } as never);

        // Coalesced, like every other refetch this store schedules: a shop full of
        // people is a stream of broadcasts and a request each would be a request per
        // tin of tomatoes.
        jest.advanceTimersByTime(2000);
        await Promise.resolve();
        await Promise.resolve();

        expect(store.finished()).toBe(true);
        // Nobody was thrown out of the shop.
        expect(socket.closes).toBe(0);
      } finally {
        jest.useRealTimers();
      }
    });

    it('counts nothing pending once the server says so', async () => {
      const memory = new BasketMemory();
      const { store } = build({
        getBasket: async () => ({ ...(await memory.getBasket()), pending: 0 }),
      });
      await store.open('basket-saturday');

      expect(store.pending()).toBe(0);
    });
  });

  /**
   * The refusal a guest gets when the owner finishes while their phone is in a shop
   * (velista `0057`, section 7).
   *
   * The screen does not stop at the message: the store refetches, so the basket
   * redraws as a finished one and the controls that just refused are gone. A refusal
   * that left them sitting there would invite the same tap again.
   */
  describe('a write into a trip somebody has just finished', () => {
    /** A basket a spec can finish underneath the store, as the owner's PATCH does. */
    function underneath() {
      const memory = new BasketMemory();
      const reads: number[] = [];
      return {
        memory,
        reads,
        service: {
          getBasket: () => {
            reads.push(1);
            return memory.getBasket();
          },
          settle: (id: string, rowKey: string, body: BasketSettleRequest) =>
            memory.settle(id, rowKey, body),
          revert: (
            id: string,
            rowKey: string,
            body: Parameters<BasketMemory['revert']>[2]
          ) => memory.revert(id, rowKey, body),
        },
      };
    }

    it('reads the basket again before the caller is told, so the controls go', async () => {
      const { memory, reads, service } = underneath();
      const { store } = build(service);
      await store.open('basket-saturday');
      const readsAfterOpen = reads.length;
      let told = -1;

      memory.status = 'FINISHED';
      const milk = rowOf(store, 'Milk');
      const result = await store
        .settle(milk.rowKey, {
          outcome: 'BOUGHT',
          quantity: 1,
          from: milk.left,
        })
        .then((answer) => {
          told = reads.length;
          return answer;
        });

      expect(result).toBeNull();
      expect(told).toBe(readsAfterOpen + 1);
      // What the caller now reads is the finished basket, so every control drawn
      // from this store has already gone by the time the sentence is rendered.
      expect(store.finished()).toBe(true);
      // And the failure is still there to be named, rather than cleared by the read
      // that followed it.
      expect((store.error() as GatewayError).code).toBe('basket_finished');
    });

    it('does the same for a revert, which is a write like any other', async () => {
      const { memory, reads, service } = underneath();
      const { store } = build(service);
      await store.open('basket-saturday');
      const readsAfterOpen = reads.length;
      const eggs = rowOf(store, 'Eggs');

      memory.status = 'FINISHED';
      const result = await store.revert(eggs.rowKey, {
        target: 'UNITS',
        units: 1,
        from: eggs.bought,
      });

      expect(result).toBeNull();
      expect(reads.length).toBe(readsAfterOpen + 1);
      expect(store.isOpen()).toBe(false);
    });
  });

  describe('the live basket', () => {
    it('holds a connection to the basket it was opened for', async () => {
      const { store, socket } = build();
      await store.open('basket-saturday');

      expect(socket.opened).toEqual(['basket-saturday']);
    });

    it('closes the connection when the screen is left', async () => {
      // Nothing else does. This store and its socket are provided by the basket route
      // and Angular does not destroy a route's environment injector, so the hooks that
      // read as though they closed this connection never run: the socket stayed up,
      // and stayed in the room, for the rest of the page's life. `BasketPage` calls
      // this from its own teardown, which is a component's and therefore real.
      const { store, socket } = build();
      await store.open('basket-saturday');

      store.leave();

      expect(socket.closes).toBe(1);
      expect(store.basket()).toBeNull();
      expect(store.present()).toEqual([]);
    });

    it('is opened again after being left, still listening', async () => {
      // The same instance is handed back on the next visit, since the injector holding
      // it was never destroyed. So leaving must not unsubscribe: a second basket with
      // a live socket and nothing listening to it is the same bug one screen later.
      jest.useFakeTimers();
      try {
        let reads = 0;
        const memory = new BasketMemory();
        const { store, socket } = build({
          getBasket: () => {
            reads += 1;
            return memory.getBasket();
          },
        });
        await store.open('basket-saturday');
        store.leave();

        await store.open('basket-saturday');
        const readsAfterOpen = reads;
        socket.events.next(idsAlone(['zl-1']));

        jest.advanceTimersByTime(2000);
        await Promise.resolve();
        await Promise.resolve();

        expect(socket.opened).toEqual(['basket-saturday', 'basket-saturday']);
        expect(reads).toBe(readsAfterOpen + 1);
      } finally {
        jest.useRealTimers();
      }
    });

    /**
     * An event with no entries carries ids alone: every write that is not a
     * change of numbers, and every envelope from before backend `0204`. It reads
     * the rows, and the first one after a quiet time reads **at once** (velista
     * `0143`, section 5).
     */
    it('reads the rows at once for an event with ids alone', async () => {
      jest.useFakeTimers();
      try {
        let reads = 0;
        const memory = new BasketMemory();
        const { store, socket } = build({
          getBasket: () => memory.getBasket(),
          getBasketRows: async () => {
            reads += 1;
            return { ...(await memory.getBasket()), products: new Map() };
          },
        });
        await store.open('basket-saturday');

        socket.events.next(idsAlone(['zl-1', 'zl-3']));
        await flush();

        expect(reads).toBe(1);
      } finally {
        jest.useRealTimers();
      }
    });

    it('gathers three more events inside the window into one more read', async () => {
      jest.useFakeTimers();
      try {
        let reads = 0;
        const memory = new BasketMemory();
        const { store, socket } = build({
          getBasket: () => {
            reads += 1;
            return memory.getBasket();
          },
        });
        await store.open('basket-saturday');
        const readsAfterOpen = reads;

        socket.events.next(idsAlone(['zl-1']));
        await flush();
        expect(reads).toBe(readsAfterOpen + 1);

        for (const lineId of ['zl-2', 'zl-3', 'zl-4']) {
          jest.advanceTimersByTime(200);
          socket.events.next(idsAlone([lineId]));
        }
        await flush();
        expect(reads).toBe(readsAfterOpen + 1);

        jest.advanceTimersByTime(1500);
        await flush();
        expect(reads).toBe(readsAfterOpen + 2);

        jest.advanceTimersByTime(5000);
        await flush();
        expect(reads).toBe(readsAfterOpen + 2);
        // And the event set nothing by itself (velista `0093`, section 11).
        // It carries ids and no marks, so every mark on screen is one the
        // read that followed it answered with.
        expect(store.rows().map((row) => row.mark)).toEqual(
          (await memory.getBasket()).rows.map((row) => row.mark)
        );
      } finally {
        jest.useRealTimers();
      }
    });

    /**
     * Review point 2 of velista `0143`: with a ceiling of 3000 ms a long burst
     * costs about one read for each 3000 ms it lasts, not two in all. Ten events
     * a second apart cost the first read, one for each ceiling inside the burst,
     * and one after it.
     */
    it('never lets a read asked for wait more than 3000 ms, so a long burst reads every 3000 ms', async () => {
      jest.useFakeTimers();
      try {
        const at: number[] = [];
        let now = 0;
        const memory = new BasketMemory();
        const { store, socket } = build({
          getBasket: () => memory.getBasket(),
          getBasketRows: async () => {
            at.push(now);
            return { ...(await memory.getBasket()), products: new Map() };
          },
        });
        await store.open('basket-saturday');

        const asked: number[] = [];
        for (let second = 0; second < 10; second += 1) {
          asked.push(now);
          socket.events.next(idsAlone(['zl-1']));
          await flush();
          for (let tick = 0; tick < 10; tick += 1) {
            now += 100;
            jest.advanceTimersByTime(100);
            await flush();
          }
        }
        for (let tick = 0; tick < 40; tick += 1) {
          now += 100;
          jest.advanceTimersByTime(100);
          await flush();
        }

        // At once, then 3000 ms after the first event the window gathered, and
        // again for each ceiling: four reads for ten seconds, not two.
        expect(at).toEqual([0, 4000, 7000, 10000]);
        // No ask waited longer than the ceiling for a read that started after it.
        for (const ask of asked) {
          const answered = at.find((read) => read >= ask);
          expect(answered).toBeDefined();
          expect((answered as number) - ask).toBeLessThanOrEqual(3000);
        }
      } finally {
        jest.useRealTimers();
      }
    });

    it('drops an event that arrives after the screen was left', async () => {
      // A broadcast can be in flight while somebody walks out of the screen, and the
      // socket is closed rather than instantly silent. Acting on it would read a
      // basket nobody is looking at.
      jest.useFakeTimers();
      try {
        let reads = 0;
        const memory = new BasketMemory();
        const { store, socket } = build({
          getBasket: () => {
            reads += 1;
            return memory.getBasket();
          },
        });
        await store.open('basket-saturday');
        const readsAfterOpen = reads;

        store.leave();
        socket.events.next(idsAlone(['zl-1']));

        jest.advanceTimersByTime(2000);
        await Promise.resolve();

        expect(store.basket()).toBeNull();
        expect(reads).toBe(readsAfterOpen);
      } finally {
        jest.useRealTimers();
      }
    });

    it('still settles and still refetches with no socket at all', async () => {
      // Section 5: a connection that will not open must not turn the basket into a
      // broken screen. It degrades to `0044`'s behaviour, which is a **working**
      // screen, and the only difference is that the page says so. So this asserts
      // the screen with `connected` never set, which is what a refused socket looks
      // like from here.
      let reads = 0;
      const memory = new BasketMemory();
      const { store, socket } = build({
        getBasket: () => {
          reads += 1;
          return memory.getBasket();
        },
      });
      await store.open('basket-saturday');

      expect(store.live()).toBe(false);

      const milk = rowOf(store, 'Milk');
      const result = await store.settle(milk.rowKey, {
        outcome: 'BOUGHT',
        quantity: milk.left,
        from: milk.left,
      });

      expect(result).not.toBeNull();
      expect(rowOf(store, 'Milk').bought).toBe(milk.left);

      // And the read the resume makes, which is the other half of what keeps a
      // basket with no room current.
      const before = reads;
      await store.refresh();
      expect(reads).toBe(before + 1);
      expect(store.state()).toBe('ready');
      expect(socket.opened).toEqual(['basket-saturday']);
    });

    /**
     * Coming back, from a socket or from a pocket (velista `0090`, section 7.1).
     *
     * **The room is rejoined, not replayed.** Everything that happened while the
     * socket was down was broadcast to a room this socket was not in, and a phone
     * that spent ten minutes in a pocket missed the same window. So each is a
     * single edge after a gap in which anything may have happened, and each reads
     * **at once** rather than through the coalescing timer: a second and a half of
     * a stale basket after a phone wakes is the delay this exists to remove.
     *
     * Before this plan `BasketSocket._onConnected` set a flag and a health timer
     * and nothing else, and two comments claimed the screen read again on resume
     * while no code did.
     */
    describe('coming back', () => {
      function counting() {
        let reads = 0;
        const memory = new BasketMemory();
        return {
          reads: () => reads,
          service: {
            getBasket: () => {
              reads += 1;
              return memory.getBasket();
            },
          },
        };
      }

      it('reads again when the socket comes back', async () => {
        const counted = counting();
        const { store, socket } = build(counted.service);
        await store.open('basket-saturday');
        const readsAfterOpen = counted.reads();

        socket.reconnects.set(1);
        TestBed.flushEffects();
        await Promise.resolve();
        await Promise.resolve();

        expect(counted.reads()).toBe(readsAfterOpen + 1);
      });

      it('reads again when the app comes back', async () => {
        const counted = counting();
        const resumed = new FakeResumed();
        const { store } = build(
          counted.service,
          new FakeSessions(),
          new FakeSocket(),
          resumed
        );
        await store.open('basket-saturday');
        const readsAfterOpen = counted.reads();

        resumed.resumes.set(1);
        TestBed.flushEffects();
        await Promise.resolve();
        await Promise.resolve();

        expect(counted.reads()).toBe(readsAfterOpen + 1);
      });

      /**
       * Both counters start at zero, which is what stops the first frame of a
       * visit from looking like a coming back: the effect's first run finds
       * nothing moved.
       */
      it('reads nothing extra on the first connect', async () => {
        const counted = counting();
        const { store, socket } = build(counted.service);
        await store.open('basket-saturday');
        const readsAfterOpen = counted.reads();

        socket.connected.set(true);
        TestBed.flushEffects();
        await Promise.resolve();

        expect(counted.reads()).toBe(readsAfterOpen);
      });

      /**
       * The route injector is never destroyed by the router, so this effect
       * outlives the page. It must do nothing while no basket is open, or a
       * resume would read a basket nobody is looking at.
       */
      it('reads nothing at all with no basket open', async () => {
        const counted = counting();
        const resumed = new FakeResumed();
        const { store, socket } = build(
          counted.service,
          new FakeSessions(),
          new FakeSocket(),
          resumed
        );
        await store.open('basket-saturday');
        store.leave();
        const readsAfterLeave = counted.reads();

        socket.reconnects.set(1);
        resumed.resumes.set(1);
        TestBed.flushEffects();
        await Promise.resolve();
        await Promise.resolve();

        expect(counted.reads()).toBe(readsAfterLeave);
      });
    });

    it('shows who is present only while the socket is up', async () => {
      const { store, socket } = build();
      await store.open('basket-saturday');
      socket.connected.set(true);

      socket.events.next({
        type: 'presence.basketUpdated',
        basketId: 'basket-saturday',
        present: [
          {
            participantId: 'p-1',
            kind: 'GUEST',
            displayName: null,
            guestNumber: 2,
            userId: null,
          },
        ],
      });

      expect(store.present()).toHaveLength(1);

      // Empty rather than frozen at its last known value: a stale face row is a
      // claim about the present tense that nothing is checking.
      socket.connected.set(false);
      expect(store.present()).toEqual([]);
    });

    it('counts a participant with two tabs open once', async () => {
      const { store, socket } = build();
      await store.open('basket-saturday');
      socket.connected.set(true);

      // The server keeps presence per socket, so every tab is its own entry.
      const tab = {
        participantId: 'p-1',
        kind: 'REGISTERED' as const,
        displayName: null,
        guestNumber: null,
        userId: 'u-1',
      };
      socket.events.next({
        type: 'presence.basketUpdated',
        basketId: 'basket-saturday',
        present: [tab, { ...tab }, { ...tab, participantId: 'p-2' }],
      });

      expect(store.present().map((entry) => entry.participantId)).toEqual([
        'p-1',
        'p-2',
      ]);
    });
  });

  /**
   * The four writes and two reads velista `0054`, `0055` and `0056` add.
   *
   * What is worth asserting here is not that a call reaches the service, which is
   * plumbing. It is the three rules the screens' correctness rests on and that have
   * no visible symptom when they are wrong: a stale write **refetches before the
   * caller hears about it**, the names learned from a sheet fill a gap in the basket
   * read without ever correcting it, and both stopgaps go when the basket does.
   */
});

/**
 * The row reel's one call (velista `0090`, section 6).
 *
 * **The client never decides whether a drag was a purchase or a take back.** It
 * sends where the gesture ended and where it believed it began, and `setLeft` is
 * the one place that pair becomes a settle or a revert, so the row, the entries
 * pane and the page cannot disagree about which.
 */
describe('BasketStore: moving a row’s reel', () => {
  it('settles the difference when the reel goes down', async () => {
    const sent: unknown[] = [];
    const memory = new BasketMemory();
    const { store } = build({
      getBasket: () => memory.getBasket(),
      settle: (id, target, body) => {
        sent.push({ target, body });
        return memory.settle(id, target, body);
      },
    });
    await store.open('basket-saturday');
    const milk = rowOf(store, 'Milk');

    await store.setLeft(milk.rowKey, milk.left - 2, milk.left);

    expect(sent).toEqual([
      {
        target: { rowKey: milk.rowKey, lineIds: ['zl-1', 'zl-2'] },
        body: { outcome: 'BOUGHT', quantity: 2, from: milk.left },
      },
    ]);
  });

  /**
   * A revert names the row's `bought` and not its `left`, because that is the
   * number it takes from (backend `0136`, section 5.2).
   */
  it('reverts the difference when the reel goes up', async () => {
    const sent: unknown[] = [];
    const memory = new BasketMemory();
    const { store } = build({
      getBasket: () => memory.getBasket(),
      revert: (id, target, body) => {
        sent.push({ target, body });
        return memory.revert(id, target, body);
      },
    });
    await store.open('basket-saturday');
    const eggs = rowOf(store, 'Eggs');

    await store.setLeft(eggs.rowKey, eggs.left + 1, eggs.left);

    expect(sent).toEqual([
      {
        target: { rowKey: eggs.rowKey, lineIds: ['zl-3', 'zl-5'] },
        body: { target: 'UNITS', units: 1, from: eggs.bought },
      },
    ]);
  });

  /** A reel dropped where it was picked up is not a gesture, and costs no request. */
  it('sends nothing at all when the reel lands where it started', async () => {
    let writes = 0;
    const memory = new BasketMemory();
    const { store } = build({
      getBasket: () => memory.getBasket(),
      settle: (id, rowKey, body) => {
        writes += 1;
        return memory.settle(id, rowKey, body);
      },
      revert: (id, rowKey, body) => {
        writes += 1;
        return memory.revert(id, rowKey, body);
      },
    });
    await store.open('basket-saturday');
    const milk = rowOf(store, 'Milk');

    const result = await store.setLeft(milk.rowKey, milk.left, milk.left);

    expect(result).toBeNull();
    expect(writes).toBe(0);
  });

  /**
   * **Neither direction patches a number**: the row on screen is the answer's, so
   * a server that answered something other than the arithmetic the gesture implied
   * is what the screen shows.
   */
  it('draws the answer’s lines rather than the number that was sent', async () => {
    const memory = new BasketMemory();
    const { store } = build({
      getBasket: () => memory.getBasket(),
      settle: async (id, target, body) => {
        const answered = await memory.settle(id, target, body);
        // The list asked for more while this gesture was in flight.
        const [first, ...rest] = answered.entries;
        return { ...answered, entries: [{ ...first, left: 99 }, ...rest] };
      },
    });
    await store.open('basket-saturday');
    const milk = rowOf(store, 'Milk');

    await store.setLeft(milk.rowKey, 0, milk.left);

    expect(rowOf(store, 'Milk').left).toBe(99);
  });

  /**
   * That code means the number this gesture was moving is not where the control
   * believed it started, which is two phones in one shop. The store reads the
   * basket again **before** it returns, so the caller can name the true amount.
   */
  it('reads the basket again once on a stale quantity, then answers null', async () => {
    let reads = 0;
    const memory = new BasketMemory();
    const { store } = build({
      getBasket: () => {
        reads += 1;
        return memory.getBasket();
      },
      settle: (id, rowKey, body) => memory.settle(id, rowKey, body),
    });
    await store.open('basket-saturday');
    const readsAfterOpen = reads;
    const milk = rowOf(store, 'Milk');

    const result = await store.setLeft(milk.rowKey, 0, milk.left + 5);

    expect(result).toBeNull();
    expect(reads).toBe(readsAfterOpen + 1);
    // And the failure is still there to be named, rather than cleared by the read
    // that followed it.
    expect((store.error() as GatewayError).code).toBe('stale_quantity');
  });
});

/**
 * Finding a row again (velista `0090`, section 7.3).
 *
 * A row's key is its **anchor's** line id, and the anchor moves: somebody adds an
 * earlier line of the same name on another list, a rename merges two rows, the
 * anchor is deleted. `rowFor` is what lets a sheet follow its row through that
 * rather than dismissing itself over nothing.
 */
describe('BasketStore: rowFor', () => {
  it('finds a row by its own key', async () => {
    const { store } = build();
    await store.open('basket-saturday');
    const milk = rowOf(store, 'Milk');

    expect(store.rowFor(milk.rowKey)?.rowKey).toBe(milk.rowKey);
  });

  /**
   * The second lookup, and the whole reason the method exists: a row whose anchor
   * was just bought to zero must not turn the next tap on the same row into a
   * sheet about nothing.
   */
  it('finds a row by any entry’s line id', async () => {
    const { store } = build();
    await store.open('basket-saturday');
    const milk = rowOf(store, 'Milk');
    const second = milk.entries[1];

    expect(store.rowFor(second.lineId)?.rowKey).toBe(milk.rowKey);
  });

  it('finds nothing for a key this basket does not hold', async () => {
    const { store } = build();
    await store.open('basket-saturday');

    expect(store.rowFor('zl-nowhere')).toBeNull();
  });

  /** Said once per sheet that closed, so the page can announce it once. */
  it('counts a row that left the basket, for the page’s sentence', async () => {
    const { store } = build();
    await store.open('basket-saturday');

    expect(store.rowGone()).toBe(0);
    store.sayRowGone();
    expect(store.rowGone()).toBe(1);

    store.leave();
    expect(store.rowGone()).toBe(0);
  });
});

/** Velista `0085`, sections 4, 6 and 7. */
describe('BasketStore: sharing with people', () => {
  it('shows the revoked state when the account socket says the basket is unshared', async () => {
    const sessions = new FakeSessions();
    sessions.seed('basket-saturday');
    const { store } = build({}, sessions);
    await store.open('basket-saturday');

    TestBed.inject(RealtimeMemory).emit('basket.unshared', {
      basketId: 'basket-saturday',
    });

    expect(store.state()).toBe('revoked');
    expect(sessions.read('basket-saturday')).toBeNull();
  });

  it('ignores an unshared for another basket', async () => {
    const { store } = build();
    await store.open('basket-saturday');

    TestBed.inject(RealtimeMemory).emit('basket.unshared', {
      basketId: 'basket-sunday',
    });

    expect(store.state()).toBe('ready');
  });

  it('adds a person and reads the participants again', async () => {
    const getBasket = jest.fn(() => new BasketMemory().getBasket());
    const { store } = build({ getBasket });
    await store.open('basket-saturday');
    const reads = getBasket.mock.calls.length;

    await expect(store.addParticipant('u-marta')).resolves.toBe(true);

    expect(getBasket.mock.calls.length).toBeGreaterThan(reads);
  });

  it('answers false rather than throwing when an add is refused', async () => {
    const { store } = build({
      addParticipant: () => Promise.reject(new Error('refused')),
    });
    await store.open('basket-saturday');

    await expect(store.addParticipant('u-marta')).resolves.toBe(false);
  });

  it('leaves, forgets the session, and does not draw itself revoked on the way out', async () => {
    const sessions = new FakeSessions();
    sessions.seed('basket-saturday');
    const leaveBasket = jest.fn(() => Promise.resolve());
    const { store } = build({ leaveBasket }, sessions);
    await store.open('basket-saturday');

    await expect(store.leaveBasket()).resolves.toBe(true);
    TestBed.inject(RealtimeMemory).emit('basket.unshared', {
      basketId: 'basket-saturday',
    });

    expect(leaveBasket).toHaveBeenCalledWith('basket-saturday');
    expect(sessions.read('basket-saturday')).toBeNull();
    expect(store.state()).toBe('ready');
  });

  it('answers false when leaving is refused', async () => {
    const { store } = build({
      leaveBasket: () => Promise.reject(new Error('forbidden')),
    });
    await store.open('basket-saturday');

    await expect(store.leaveBasket()).resolves.toBe(false);
  });

  /**
   * The basket that is always there (velista `0091`, section 2.4).
   *
   * The one read in this store that has **no id to ask with**: the route is a
   * word, the server creates the basket the first time anybody reads it, and the
   * id arrives on the answer. Everything after it is an ordinary basket.
   */
  describe('opening the caller’s own', () => {
    it('takes the id from the answer and connects to it', async () => {
      const { store, socket } = build();

      await store.openLive();

      expect(store.state()).toBe('ready');
      expect(store.basket()?.kind).toBe('LIVE');
      // The id nothing asked for, on the socket that needed it.
      expect(socket.opened).toEqual(['basket-live']);
    });

    it('remembers that the URL names it by a word, not by that id', async () => {
      // What every sheet over the page builds its own address from. A sheet that
      // read `paramMap` instead would dismiss to `/shopping-lists/`, because
      // there is no id in this URL at all.
      const { store } = build();

      await store.openLive();

      expect(store.address()).toBe('live');
    });

    it('says so before the answer arrives, for a sheet loaded cold', async () => {
      // A sheet over this page is constructed while the first read is still out,
      // and it needs the address then rather than a beat later.
      const { store } = build({
        getLiveBasket: () => new Promise(() => undefined),
      });

      void store.openLive();

      expect(store.address()).toBe('live');
    });

    it('reads by id from then on, so a refresh is an ordinary read', async () => {
      const ids: string[] = [];
      const memory = new BasketMemory();
      const { store } = build({
        getBasket: (id) => {
          ids.push(id);
          return memory.getBasket();
        },
      });

      await store.openLive();
      await store.refresh();

      expect(ids).toEqual(['basket-live']);
    });

    it('lands in the failed state with no connection when the read fails', async () => {
      const { store, socket } = build({
        getLiveBasket: () => Promise.reject(new Error('offline')),
      });

      await store.openLive();

      expect(store.state()).toBe('failed');
      expect(socket.opened).toEqual([]);
    });

    it('never offers the join screen, because there is no participant to be', async () => {
      // A 401 here is an account session that has ended, which the interceptor
      // answers for the whole app. Neither reading of the participant surface's
      // 401 is about this reader, and `needsJoin` on the caller's own basket
      // would offer a link nobody has.
      const { store } = build({
        getLiveBasket: () =>
          Promise.reject(
            Object.assign(new Error('unauthorized'), { status: 401 })
          ),
      });

      await store.openLive();

      expect(store.state()).toBe('failed');
    });

    it('lets it go like any other basket', async () => {
      const { store, socket } = build();
      await store.openLive();

      store.leave();

      expect(socket.closes).toBe(1);
      expect(store.basket()).toBeNull();
      expect(store.address()).toBeNull();
    });
  });
});

/**
 * The four writes of velista `0092`, through the store (sections 3, 6 and 7).
 *
 * What is asserted here and nowhere below is the **fold**: the store replaces the
 * row by key and takes the counts whole, and three of these four answer something
 * the fold has to get right. A skip answers the same row under the same key; a
 * demand can answer no row at all; an add can answer a row that was already on
 * the screen, under a key nobody named.
 */
describe('BasketStore: skip, demand and the add', () => {
  it('folds a skip, without patching a state of its own', async () => {
    const { store } = build();
    await store.open('basket-saturday');

    const before = rowOf(store, 'Eggs');
    await store.skip(before.rowKey);

    // The state is the server\u2019s answer. Nothing here decided that a skipped row
    // is skipped, which is the rule the whole row model rests on.
    expect(rowOf(store, 'Eggs').state).toBe('SKIPPED');
  });

  it('keeps a skipped row where it was', async () => {
    // A row that jumps the moment a sheet closes is an order moving under a
    // thumb (velista `0053`, section 7), and the person who skipped it knows
    // where it was.
    const { store } = build();
    await store.open('basket-saturday');
    const order = store.rows().map((row) => row.content);

    await store.skip(rowOf(store, 'Eggs').rowKey);

    expect(store.rows().map((row) => row.content)).toEqual(order);
  });

  it('takes a skip back', async () => {
    const { store } = build();
    await store.open('basket-saturday');
    const key = rowOf(store, 'Eggs').rowKey;

    await store.skip(key);
    await store.unskip(key);

    expect(rowOf(store, 'Eggs').state).toBe('PARTLY');
  });

  it('folds a demand and leaves the other household alone', async () => {
    const { store } = build();
    await store.open('basket-saturday');
    const milk = rowOf(store, 'Milk');

    await store.setDemand({
      lineId: milk.entries[0].lineId,
      quantity: 5,
      from: milk.entries[0].left,
    });

    const after = rowOf(store, 'Milk');
    expect(after.entries[0].left).toBe(5);
    expect(after.entries[1].left).toBe(1);
  });

  it('drops the row when a demand leaves nothing to buy of it, and says the line left', async () => {
    const { store } = build();
    await store.open('basket-saturday');
    const loaf = rowOf(store, 'Sourdough loaf');

    const result = await store.setDemand({
      lineId: loaf.entries[0].lineId,
      quantity: 0,
      from: loaf.entries[0].left,
    });

    // Not a failure: the list now asks for nothing, which is what was asked for.
    // The caller reads `lineLeft` to know which of the two happened.
    expect(result).not.toBeNull();
    expect(
      result !== null && store.lineLeft(result, loaf.entries[0].lineId)
    ).toBe(true);
    expect(store.rows().some((row) => row.content === 'Sourdough loaf')).toBe(
      false
    );
  });

  it('counts the header again when the row went away', async () => {
    const { store } = build();
    await store.open('basket-saturday');
    const loaf = rowOf(store, 'Sourdough loaf');
    const before = store.progress().total;

    await store.setDemand({
      lineId: loaf.entries[0].lineId,
      quantity: 0,
      from: loaf.entries[0].left,
    });

    // Counted over the rows held, by the shared rule: one fewer.
    expect(store.progress().total).toBe(before - 1);
  });

  it('adds a line and draws it as a row of its own', async () => {
    const { store } = build();
    await store.open('basket-saturday');

    const result = await store.addLine({
      targetListId: 'list-weekly',
      content: 'Batteries',
      quantity: 1,
    });

    expect(result?.entries[0].content).toBe('Batteries');
    expect(store.rows().some((row) => row.content === 'Batteries')).toBe(true);
  });

  /** "Add it to another list" (velista `0139`, section 3). */
  it('raises a line at zero into the row of its product', async () => {
    const { store } = build();
    await store.open('basket-saturday');

    const result = await store.setDemand({
      lineId: 'zl-8',
      quantity: 2,
      from: 0,
    });

    expect(result).not.toBeNull();
    expect(rowOf(store, 'Eggs').entries.map((entry) => entry.lineId)).toEqual([
      'zl-3',
      'zl-5',
      'zl-8',
    ]);
  });

  describe('a change of product (velista 0140, section 4)', () => {
    const PASCUAL = 'item-milk-pascual';

    it('holds a change for this trip on the device when the line has no buy', async () => {
      const sent: unknown[] = [];
      const { store } = build({
        changeProduct: async (_id, body) => {
          sent.push(body);
          return { entries: [], skippedCount: 0 };
        },
      });
      await store.open('basket-saturday');
      const milk = rowOf(store, 'Milk');
      const lineId = milk.entries[0].lineId;

      const done = await store.changeProduct(
        milk.rowKey,
        { lineIds: [lineId], itemId: PASCUAL, keep: false },
        null
      );

      expect(done).toBe(true);
      expect(sent).toEqual([]);
      const moved = store
        .rows()
        .find((row) => row.entries.some((entry) => entry.lineId === lineId));
      expect(moved?.productId).toBe(PASCUAL);
      // The next buy of that row names the product held for it.
      expect(moved === undefined ? null : store.itemIdFor(moved.rowKey)).toBe(
        PASCUAL
      );
    });

    it('draws a held product the read does not name from what the sheet had', async () => {
      const { store } = build();
      await store.open('basket-saturday');
      const milk = rowOf(store, 'Milk');
      const product = {
        ...(store.products().get(milk.productId ?? '') ?? null),
        id: 'item-oat',
      };

      await store.changeProduct(
        milk.rowKey,
        { lineIds: [milk.entries[0].lineId], itemId: 'item-oat', keep: false },
        product as never
      );

      expect(store.products().get('item-oat')?.id).toBe('item-oat');
    });

    it('counts the header over the rows a held choice split', async () => {
      const { store } = build();
      await store.open('basket-saturday');
      const milk = rowOf(store, 'Milk');
      const before = store.progress().total;

      await store.changeProduct(
        milk.rowKey,
        { lineIds: [milk.entries[0].lineId], itemId: PASCUAL, keep: false },
        null
      );

      expect(store.progress().total).toBe(before + 1);
    });

    it('sends a kept change and moves the line to the row of its favourite', async () => {
      const sent: { keep: boolean; lineIds: readonly string[] }[] = [];
      const memory = new BasketMemory();
      const { store } = build({
        getBasket: () => memory.getBasket(),
        changeProduct: (id, body) => {
          sent.push(body);
          return memory.changeProduct(id, body);
        },
      });
      await store.open('basket-saturday');
      const milk = rowOf(store, 'Milk');
      const lineId = milk.entries[0].lineId;

      await store.changeProduct(
        milk.rowKey,
        { lineIds: [lineId], itemId: PASCUAL, keep: true },
        null
      );

      expect(sent).toEqual([
        { lineIds: [lineId], itemId: PASCUAL, keep: true },
      ]);
      const moved = store
        .rows()
        .find((row) => row.entries.some((entry) => entry.lineId === lineId));
      expect(moved?.productId).toBe(PASCUAL);
      expect(moved?.entries[0].favoriteItemId).toBe(PASCUAL);
    });

    it('sends the lines with a buy today and holds the rest', async () => {
      const sent: { keep: boolean; lineIds: readonly string[] }[] = [];
      const memory = new BasketMemory();
      const { store } = build({
        getBasket: () => memory.getBasket(),
        settle: (id, target, body) => memory.settle(id, target, body),
        changeProduct: (id, body) => {
          sent.push(body);
          return memory.changeProduct(id, body);
        },
      });
      await store.open('basket-saturday');
      const eggs = rowOf(store, 'Eggs');
      const [bought, ...rest] = eggs.entries.map((entry) => entry.lineId);
      const body: BasketSettleRequest = {
        outcome: 'BOUGHT',
        quantity: 1,
        from: eggs.left,
        itemId: eggs.productId ?? undefined,
        allocations: [{ lineId: bought, quantity: 1 }],
      };
      await store.settle(eggs.rowKey, body);
      await store.refresh();
      const hadBuy = rest.filter((lineId) => store.hasTripBuy(lineId));

      await store.changeProduct(
        rowOf(store, 'Eggs').rowKey,
        { lineIds: [bought, ...rest], itemId: PASCUAL, keep: false },
        null
      );

      expect(sent).toEqual([
        {
          lineIds: [bought, ...hadBuy],
          itemId: PASCUAL,
          keep: false,
        },
      ]);
    });

    it('holds nothing when the write fails, and says it failed', async () => {
      const { store } = build({
        changeProduct: async () => {
          throw new GatewayError({
            code: 'forbidden',
            status: 403,
            correlationId: 'spec',
          });
        },
      });
      await store.open('basket-saturday');
      const milk = rowOf(store, 'Milk');

      const done = await store.changeProduct(
        milk.rowKey,
        {
          lineIds: milk.entries.map((entry) => entry.lineId),
          itemId: PASCUAL,
          keep: true,
        },
        null
      );

      expect(done).toBe(false);
      expect(rowOf(store, 'Milk').productId).toBe(milk.productId);
      expect(store.error()).toBeInstanceOf(GatewayError);
    });
  });

  describe('a held choice lets go once it is spent (velista 0149)', () => {
    const PASCUAL = 'item-milk-pascual';

    /**
     * A service whose read passes through `edit`, so a spec can state what the
     * next read says about one line.
     */
    function withRead(): {
      store: BasketStore;
      choices: HeldProductChoices;
      edit: { next: ((basket: Basket) => Basket) | null };
    } {
      const memory = new BasketMemory();
      const edit: { next: ((basket: Basket) => Basket) | null } = {
        next: null,
      };
      const { store } = build({
        getBasket: async () => {
          const basket = await memory.getBasket();
          return edit.next === null ? basket : edit.next(basket);
        },
      });
      return { store, choices: TestBed.inject(HeldProductChoices), edit };
    }

    /** The read with one line changed, or dropped when `change` is null. */
    function readWith(
      lineId: string,
      change: ((entry: BasketRowEntry) => BasketRowEntry) | null
    ): (basket: Basket) => Basket {
      return (basket) => ({
        ...basket,
        rows: basket.rows.map((row) => ({
          ...row,
          entries: row.entries.flatMap((entry) =>
            entry.lineId !== lineId
              ? [entry]
              : change === null
                ? []
                : [change(entry)]
          ),
        })),
      });
    }

    async function holdOat(
      store: BasketStore
    ): Promise<{ lineId: string; basketId: string }> {
      await store.open('basket-saturday');
      const milk = rowOf(store, 'Milk');
      const lineId = milk.entries[0].lineId;
      const product = {
        ...(store.products().get(milk.productId ?? '') ?? null),
        id: 'item-oat',
      };
      await store.changeProduct(
        milk.rowKey,
        { lineIds: [lineId], itemId: 'item-oat', keep: false },
        product as never
      );
      return { lineId, basketId: store.basket()?.id ?? '' };
    }

    it('releases a choice once the read names a buy of its own for the line', async () => {
      const { store, choices, edit } = withRead();
      const { lineId, basketId } = await holdOat(store);
      expect(choices.heldOn(basketId).has(lineId)).toBe(true);
      expect(store.products().has('item-oat')).toBe(true);

      edit.next = readWith(lineId, (entry) => ({
        ...entry,
        tripItemId: 'item-oat',
      }));
      await store.refresh();

      expect(choices.heldOn(basketId).size).toBe(0);
      // The read names no row for it, and nothing held draws it any more.
      expect(store.products().has('item-oat')).toBe(false);
    });

    it('releases a choice for a line the read no longer names', async () => {
      const { store, choices, edit } = withRead();
      const { lineId, basketId } = await holdOat(store);

      edit.next = readWith(lineId, null);
      await store.refresh();

      expect(choices.heldOn(basketId).size).toBe(0);
    });

    it('keeps a choice whose line is still unbought across a refresh', async () => {
      const { store, choices } = withRead();
      const { lineId, basketId } = await holdOat(store);

      await store.refresh();

      expect(choices.heldOn(basketId).get(lineId)?.itemId).toBe('item-oat');
      const moved = store
        .rows()
        .find((row) => row.entries.some((entry) => entry.lineId === lineId));
      expect(moved?.productId).toBe('item-oat');
    });

    it('holds nothing for a line taken back to the product the read draws', async () => {
      const { store, choices } = withRead();
      await store.open('basket-saturday');
      const milk = rowOf(store, 'Milk');
      const own = milk.productId ?? '';
      const lineId = milk.entries[0].lineId;
      const basketId = store.basket()?.id ?? '';

      await store.changeProduct(
        milk.rowKey,
        { lineIds: [lineId], itemId: PASCUAL, keep: false },
        null
      );
      expect(choices.heldOn(basketId).has(lineId)).toBe(true);
      const moved = store
        .rows()
        .find((row) => row.entries.some((entry) => entry.lineId === lineId));

      await store.changeProduct(
        moved?.rowKey ?? '',
        { lineIds: [lineId], itemId: own, keep: false },
        null
      );

      expect(choices.heldOn(basketId).size).toBe(0);
      expect(store.rows()).toBe(store.basket()?.rows);
    });
  });

  it('reads the lists that can take a product', async () => {
    const { store } = build();
    await store.open('basket-saturday');

    expect(
      (await store.productLists('item-eggs'))?.map((list) => list.lineId)
    ).toEqual(['zl-8']);
  });

  it('answers null for lists it could not read, and keeps the basket ready', async () => {
    const { store } = build({
      productLists: () => Promise.reject(new Error('offline')),
    });
    await store.open('basket-saturday');

    expect(await store.productLists('item-eggs')).toBeNull();
    expect(store.state()).toBe('ready');
  });

  it('folds an add that merged in place, rather than drawing a second row', async () => {
    // The add goes through the target list\u2019s own rules, so it can land on a
    // line the list already held (backend `0091`). The answer is then a row
    // already on the screen under a key nobody named.
    const { store } = build();
    await store.open('basket-saturday');
    const rows = store.rows().length;

    await store.addLine({
      targetListId: 'list-weekly',
      content: 'milk',
      quantity: 2,
      // The products that line holds: the name alone is not a match.
      itemIds: [
        'item-milk-hacendado',
        'item-milk-pascual',
        'item-milk-central',
      ],
    });

    expect(store.rows()).toHaveLength(rows);
    expect(rowOf(store, 'Milk').entries[0].left).toBe(4);
  });

  it('says when an add is out, and stops when it lands', async () => {
    const { store } = build();
    await store.open('basket-saturday');

    const out = store.addLine({
      targetListId: 'list-weekly',
      content: 'Batteries',
      quantity: 1,
    });
    // An add names no row, so it is its own flag rather than a member of
    // `busyRows`: which row it lands on is the answer and not the request.
    expect(store.adding()).toBe(true);

    await out;
    expect(store.adding()).toBe(false);
  });

  it('hands one sentence to the page, with a sequence so it can be said twice', () => {
    const { store } = build();

    store.handOver('Sourdough loaf is no longer asked for.');
    const first = store.handedOver();
    store.handOver('Sourdough loaf is no longer asked for.');

    expect(first?.text).toBe('Sourdough loaf is no longer asked for.');
    // The same words twice are two announcements, which a bare string could not
    // say: a polite region reads a node that changed.
    expect(store.handedOver()?.seq).not.toBe(first?.seq);
  });
});

/**
 * Buying at one shop (velista `0102`).
 *
 * The device's shop reaches the server only as the read parameter and on each
 * settle, so these follow the parameter: every read after a choice sends it, the
 * answer says which shop it describes, and a basket started at a shop of its own
 * refuses anything else, which drops the choice and reads it at its own shop.
 */
describe('BasketStore: buying at one shop', () => {
  function shopLocked(): GatewayError {
    return new GatewayError({
      code: 'basket_shop_locked',
      status: 409,
      correlationId: 'spec',
    });
  }

  it('reads again at the chosen shop, and every later read sends it', async () => {
    const asked: (string | undefined)[] = [];
    const memory = new BasketMemory();
    const { store } = build({
      getBasket: (id, locationId) => {
        asked.push(locationId);
        return memory.getBasket(id, locationId);
      },
    });
    await store.open('basket-saturday');

    await store.readAtShop('loc-tejares');
    await store.refresh();

    expect(asked).toEqual([undefined, 'loc-tejares', 'loc-tejares']);
    expect(store.basket()?.readAt).toBe('loc-tejares');
    expect(store.shopRead()).toBe('loc-tejares');
  });

  it('reads at no shop again when any of the shops is chosen', async () => {
    const asked: (string | undefined)[] = [];
    const memory = new BasketMemory();
    const { store } = build({
      getBasket: (id, locationId) => {
        asked.push(locationId);
        return memory.getBasket(id, locationId);
      },
    });
    await store.open('basket-saturday');
    await store.readAtShop('loc-tejares');

    await store.readAtShop(null);

    expect(asked.at(-1)).toBeUndefined();
    expect(store.shopRead()).toBeNull();
  });

  it('drops the device’s shop and reads the basket at its own when it is refused', async () => {
    const asked: (string | undefined)[] = [];
    const memory = new BasketMemory();
    // The first read says nothing about a lock, which is a read a moment before
    // the refusal: the basket's own shop is what the refusal teaches the store.
    let refused = false;
    const { store } = build({
      getBasket: async (id, locationId) => {
        asked.push(locationId);
        if (locationId !== undefined) {
          refused = true;
          throw shopLocked();
        }
        const read = await memory.getBasket(id);
        return refused
          ? { ...read, lockedShopId: 'loc-own', readAt: 'loc-own' }
          : read;
      },
    });
    await store.open('basket-saturday');

    await store.readAtShop('loc-tejares');

    expect(asked).toEqual([undefined, 'loc-tejares', undefined]);
    expect(store.state()).toBe('ready');
    expect(store.readAt()).toBeNull();
    expect(store.shopRead()).toBe('loc-own');
  });

  it('sends nothing for a basket started at a shop, which is read at its own', async () => {
    const asked: (string | undefined)[] = [];
    const memory = new BasketMemory();
    const { store } = build({
      getBasket: async (id, locationId) => {
        asked.push(locationId);
        const read = await memory.getBasket(id);
        return { ...read, lockedShopId: 'loc-own', readAt: 'loc-own' };
      },
    });
    await store.open('basket-saturday');

    await store.readAtShop('loc-tejares');
    await store.refresh();

    expect(asked).toEqual([undefined, undefined]);
  });

  it('drops the device’s shop when a settle is refused for it, and reads again', async () => {
    const memory = new BasketMemory();
    const { store } = build({
      settle: () => Promise.reject(shopLocked()),
    });
    await store.open('basket-saturday');
    await store.readAtShop('loc-tejares');
    const milk = rowOf(store, 'Milk');

    const result = await store.settle(milk.rowKey, {
      outcome: 'BOUGHT',
      quantity: 1,
      from: milk.left,
      supermarketLocationId: 'loc-tejares',
    });

    expect(result).toBeNull();
    expect(store.readAt()).toBeNull();
    expect(store.shopRead()).toBeNull();
    expect((store.error() as GatewayError).code).toBe('basket_shop_locked');
    void memory;
  });

  /** A row is one product, and a settle on it names that product (velista `0139`). */
  it('buys the row\u2019s own product, and none for a row with no product', async () => {
    const { store } = build();
    await store.open('basket-saturday');

    expect(store.itemIdFor(rowOf(store, 'Milk').rowKey)).toBe(
      'item-milk-hacendado'
    );
    expect(
      store.itemIdFor(rowOf(store, 'Sourdough loaf').rowKey)
    ).toBeUndefined();
  });
});

type LinesChanged = Extract<RealtimeEvent, { type: 'basket.linesChanged' }>;

/** What a person sees of a basket: the rows, the header and the banner. */
function drawn(basket: Basket) {
  return {
    rows: basket.rows,
    progress: basket.progress,
    pending: basket.pending,
    unseenChangeCount: basket.unseenChangeCount,
    newestUnseenChangeId: basket.newestUnseenChangeId,
  };
}

/** The target of the row the twin draws under one name. */
function targetIn(basket: Basket, content: string) {
  const row = basket.rows.find((held) => held.content === content);
  if (row === undefined) {
    throw new Error(`the twin lost its ${content}`);
  }
  return {
    row,
    target: {
      rowKey: row.rowKey,
      lineIds: row.entries.map((entry) => entry.lineId),
    },
  };
}

/**
 * One set of entries, through a read and through a patch (velista `0143`,
 * section 3).
 *
 * The twin stands in for the server: it is read before the write, the write's
 * events are applied to that read with `applyBasketPatch` (and the marks read
 * when they say so), and the result is compared field by field with a read made
 * after the write. Both run the shared rules, so they cannot drift.
 */
async function patchedAndRead(
  write: (memory: BasketMemory, before: Basket) => Promise<unknown> | void,
  setup: (memory: BasketMemory) => void = () => undefined
): Promise<{ patched: Basket | 'read'; read: Basket; events: LinesChanged[] }> {
  const memory = new BasketMemory();
  setup(memory);
  const before = await memory.getBasket();
  const events: LinesChanged[] = [];
  const listening = memory.events.subscribe((event) => events.push(event));
  await write(memory, before);
  listening.unsubscribe();
  const read = await memory.getBasket();

  let patched: Basket | 'read' = before;
  for (const event of events) {
    if (patched === BASKET_PATCH_READ) {
      break;
    }
    patched =
      event.entries === null
        ? BASKET_PATCH_READ
        : applyBasketPatch(patched, event.lineIds, event.entries);
    if (patched !== BASKET_PATCH_READ && event.marksMoved) {
      patched = applyBasketMarks(patched, await memory.getMarks());
    }
  }
  return { patched, read, events };
}

describe('a read and a patch give the same shopping list (velista 0143, section 3)', () => {
  it('for a buy', async () => {
    const { patched, read, events } = await patchedAndRead((memory, before) => {
      const { row, target } = targetIn(before, 'Milk');
      return memory.settle('b', target, {
        outcome: 'BOUGHT',
        quantity: 1,
        from: row.left,
      });
    });
    expect(events[0].entries).not.toBeNull();
    expect(patched).not.toBe(BASKET_PATCH_READ);
    expect(drawn(patched as Basket)).toEqual(drawn(read));
  });

  it('for a buy that finishes a row of two lists', async () => {
    const { patched, read } = await patchedAndRead((memory, before) => {
      const { row, target } = targetIn(before, 'Milk');
      return memory.settle('b', target, {
        outcome: 'BOUGHT',
        quantity: row.left,
        from: row.left,
      });
    });
    expect(drawn(patched as Basket)).toEqual(drawn(read));
    expect(targetIn(read, 'Milk').row.state).toBe('DONE');
  });

  it('for a buy taken back', async () => {
    const { patched, read } = await patchedAndRead((memory, before) => {
      const { row, target } = targetIn(before, 'Eggs');
      return memory.revert('b', target, {
        target: 'UNITS',
        units: 1,
        from: row.bought,
      });
    });
    expect(drawn(patched as Basket)).toEqual(drawn(read));
  });

  it('for a change of quantity', async () => {
    const { patched, read } = await patchedAndRead((memory) =>
      memory.setDemand('b', { lineId: 'zl-1', quantity: 5, from: 2 })
    );
    expect(drawn(patched as Basket)).toEqual(drawn(read));
  });

  it('for a line of a row of two lists taken to zero, which leaves the row', async () => {
    const { patched, read, events } = await patchedAndRead((memory) =>
      memory.setDemand('b', { lineId: 'zl-2', quantity: 0, from: 1 })
    );
    // The line has no patch, so the client removes its entry.
    expect(events[0].entries).toEqual([]);
    expect(drawn(patched as Basket)).toEqual(drawn(read));
  });

  it('for a row crossed out when its last demand goes (velista 0142)', async () => {
    const { patched, read } = await patchedAndRead(
      (memory) =>
        memory.setDemand('b', { lineId: 'zl-2', quantity: 0, from: 1 }),
      (memory) => memory.buyElsewhere('zl-1', 2)
    );
    expect(targetIn(read, 'Milk').row.state).toBe('BOUGHT_ELSEWHERE');
    expect(drawn(patched as Basket)).toEqual(drawn(read));
  });

  it('for a crossed out row its list asks for again (velista 0142)', async () => {
    const { patched, read } = await patchedAndRead(
      (memory) =>
        memory.setDemand('b', { lineId: 'zl-1', quantity: 1, from: 0 }),
      (memory) => {
        memory.buyElsewhere('zl-1', 2);
        memory.buyElsewhere('zl-2', 1);
      }
    );
    expect(targetIn(read, 'Milk').row.state).toBe('WANTED');
    expect(drawn(patched as Basket)).toEqual(drawn(read));
  });

  it('reads for a skip, whose note a patch does not write', async () => {
    const { patched } = await patchedAndRead((memory, before) =>
      memory.skip('b', targetIn(before, 'Milk').target)
    );
    expect(patched).toBe(BASKET_PATCH_READ);
  });

  it('reads for "they had none", which moves no version', async () => {
    const { patched } = await patchedAndRead((memory, before) => {
      const { row, target } = targetIn(before, 'Milk');
      return memory.settle('b', target, {
        outcome: 'NOT_AVAILABLE',
        from: row.left,
      });
    });
    expect(patched).toBe(BASKET_PATCH_READ);
  });

  it('reads for a buy made through another shopping list, whose note a patch does not carry', async () => {
    const { patched } = await patchedAndRead((memory) =>
      memory.buyElsewhere('zl-3', 1)
    );
    expect(patched).toBe(BASKET_PATCH_READ);
  });
});

describe('BasketStore: a buy reaches the other phone at once (velista 0143)', () => {
  /** A store whose twin's room is this store's socket, and that counts reads. */
  async function live(
    overrides: Partial<BasketServiceI> = {},
    extra: readonly Provider[] = []
  ) {
    const reads = { full: 0, rows: 0, marks: 0 };
    const twin = new BasketMemory();
    const built = build(
      {
        getBasket: (id, at) => {
          reads.full += 1;
          return twin.getBasket(id, at);
        },
        getBasketRows: (id, at) => {
          reads.rows += 1;
          return twin.getBasketRows(id, at);
        },
        getMarks: () => {
          reads.marks += 1;
          return twin.getMarks();
        },
        settle: (id, target, body) => twin.settle(id, target, body),
        setDemand: (id, body) => twin.setDemand(id, body),
        skip: (id, target) => twin.skip(id, target),
        changeProduct: (id, body) => twin.changeProduct(id, body),
        ...overrides,
      },
      undefined,
      undefined,
      undefined,
      extra
    );
    await built.store.open('basket-saturday');
    reads.full = 0;
    return { ...built, twin, reads };
  }

  /** The other phone writes, and this one hears it on its socket. */
  function wire(
    twin: BasketMemory,
    socket: { events: Subject<RealtimeEvent> }
  ) {
    return twin.events.subscribe((event) => socket.events.next(event));
  }

  afterEach(() => {
    jest.useRealTimers();
  });

  it('draws a buy from the event with no request', async () => {
    jest.useFakeTimers();
    const { store, socket, twin, reads } = await live();
    wire(twin, socket);

    const milk = rowOf(store, 'Milk');
    await twin.settle('b', store.targetOf(milk.rowKey) as never, {
      outcome: 'BOUGHT',
      quantity: 1,
      from: milk.left,
    });

    expect(rowOf(store, 'Milk')).toMatchObject({
      bought: milk.bought + 1,
      left: milk.left - 1,
      state: 'PARTLY',
    });
    jest.advanceTimersByTime(10_000);
    await flush();
    expect(reads.full + reads.rows).toBe(0);
    // The settle moved the marks, which are read once, 300 ms later.
    expect(reads.marks).toBe(1);
  });

  it('keeps the rows on screen as they were for a row nothing touched', async () => {
    const { store, socket, twin } = await live();
    wire(twin, socket);
    const eggs = rowOf(store, 'Eggs');

    await twin.setDemand('b', { lineId: 'zl-1', quantity: 4, from: 2 });

    expect(rowOf(store, 'Eggs')).toBe(eggs);
  });

  it('reads the rows at once for a patch it cannot apply', async () => {
    const { store, socket, twin, reads } = await live();
    wire(twin, socket);

    await twin.skip('b', store.targetOf(rowOf(store, 'Milk').rowKey) as never);
    await flush();

    expect(reads.rows).toBe(1);
    expect(rowOf(store, 'Milk').state).toBe('SKIPPED');
  });

  it('applies the answer of a write, then its own event changes nothing, and no read follows', async () => {
    jest.useFakeTimers();
    const { store, socket, twin, reads } = await live();
    const own: RealtimeEvent[] = [];
    twin.events.subscribe((event) => own.push(event));

    const milk = rowOf(store, 'Milk');
    await store.settle(milk.rowKey, {
      outcome: 'BOUGHT',
      quantity: 1,
      from: milk.left,
    });
    const answered = store.basket();
    expect(rowOf(store, 'Milk').bought).toBe(milk.bought + 1);

    for (const event of own) {
      socket.events.next(event);
    }
    expect(store.basket()).toBe(answered);

    jest.advanceTimersByTime(10_000);
    await flush();
    expect(reads.full + reads.rows).toBe(0);
  });

  it('counts the header from the rows after a patch', async () => {
    const { store, socket, twin } = await live();
    wire(twin, socket);
    const milk = rowOf(store, 'Milk');
    const done = store.progress().done;

    await twin.settle('b', store.targetOf(milk.rowKey) as never, {
      outcome: 'BOUGHT',
      quantity: milk.left,
      from: milk.left,
    });

    expect(rowOf(store, 'Milk').state).toBe('DONE');
    expect(store.progress().done).toBe(done + 1);
    expect(store.progress()).toEqual((await twin.getBasket()).progress);
  });

  it('asks the marks once for a burst, 300 ms after the first', async () => {
    jest.useFakeTimers();
    const { store, socket, twin, reads } = await live();
    wire(twin, socket);
    twin.seenThrough = 'chg-5';

    for (const quantity of [3, 4, 5]) {
      await twin.setDemand('b', {
        lineId: 'zl-1',
        quantity,
        from: quantity - 1,
      });
      jest.advanceTimersByTime(50);
    }
    expect(reads.marks).toBe(0);

    jest.advanceTimersByTime(300);
    await flush();
    expect(reads.marks).toBe(1);
    expect(store.basket()?.unseenChangeCount).toBe(0);
    expect(store.rows().every((row) => row.mark !== 'CHANGED')).toBe(true);
  });

  it('keeps the screen as it is when the marks read fails', async () => {
    jest.useFakeTimers();
    const { store, socket, twin } = await live({
      getMarks: () => Promise.reject(new Error('offline')),
    });
    wire(twin, socket);
    await twin.setDemand('b', { lineId: 'zl-1', quantity: 3, from: 2 });
    const shown = store.basket();

    jest.advanceTimersByTime(300);
    await flush();

    expect(store.basket()).toBe(shown);
    expect(store.state()).toBe('ready');
  });

  it('keeps the products it holds on a rows read', async () => {
    const { store, socket, reads } = await live();
    const products = store.products();

    socket.events.next(idsAlone(['zl-1']));
    await flush();

    expect(reads.rows).toBe(1);
    expect(reads.full).toBe(0);
    expect(store.products()).toBe(products);
  });

  it('makes the full read when the rows name a product it does not hold', async () => {
    const twin = new BasketMemory();
    const { store, socket, reads } = await live({
      getBasketRows: async (id, at) => {
        const rows = await twin.getBasketRows(id, at);
        return {
          ...rows,
          rows: rows.rows.map((row, index) =>
            index === 0 ? { ...row, productId: 'item-new' } : row
          ),
        };
      },
    });

    socket.events.next(idsAlone(['zl-1']));
    await flush();

    expect(reads.full).toBe(1);
    expect(store.state()).toBe('ready');
  });

  it('applies a patch to a held choice and draws what a read draws (velista 0140, 0149)', async () => {
    const { store, socket, twin } = await live();
    wire(twin, socket);
    const milk = rowOf(store, 'Milk');
    await store.changeProduct(
      milk.rowKey,
      { lineIds: ['zl-1'], itemId: 'item-milk-pascual', keep: false },
      null
    );
    expect(store.rowFor('zl-1')?.productId).toBe('item-milk-pascual');

    await twin.setDemand('b', { lineId: 'zl-1', quantity: 4, from: 2 });
    const patched = store.rows();
    expect(store.rowFor('zl-1')).toMatchObject({
      productId: 'item-milk-pascual',
      left: 4,
    });

    await store.refresh();
    expect(store.rows()).toEqual(patched);
  });

  it('reads when the other phone buys a held line under another product, and spends the choice', async () => {
    const { store, socket, twin, reads } = await live();
    wire(twin, socket);
    const milk = rowOf(store, 'Milk');
    await store.changeProduct(
      milk.rowKey,
      { lineIds: ['zl-1'], itemId: 'item-milk-pascual', keep: false },
      null
    );

    await twin.settle(
      'b',
      { rowKey: 'zl-1', lineIds: ['zl-1'] },
      { outcome: 'BOUGHT', quantity: 1, from: 2, itemId: 'item-milk-pascual' }
    );
    await flush();

    // The line now counts as the product it was bought as, which only a read
    // places, and the held choice is spent exactly as velista 0149 spends it.
    expect(reads.rows + reads.full).toBeGreaterThan(0);
    expect(store.rowFor('zl-1')).toMatchObject({
      productId: 'item-milk-pascual',
    });
    expect(
      TestBed.inject(HeldProductChoices).heldOn(store.basket()?.id ?? null).size
    ).toBe(0);
  });

  it('applies a patch that lands while a read is out to that read’s answer', async () => {
    const twin = new BasketMemory();
    const waiting: (() => void)[] = [];
    let holding = false;
    const { store, socket } = await live({
      // The answer is composed when the read leaves, so it is older than the
      // change of demand that lands while it is out.
      getBasket: (id, at) => {
        const answer = twin.getBasket(id, at);
        return holding
          ? new Promise((resolve) => waiting.push(() => resolve(answer)))
          : answer;
      },
      setDemand: (id, body) => twin.setDemand(id, body),
    });
    wire(twin, socket);
    holding = true;

    const reading = store.refresh();
    await twin.setDemand('b', { lineId: 'zl-1', quantity: 6, from: 2 });
    expect(store.rowFor('zl-1')?.entries[0].left).toBe(6);

    holding = false;
    waiting.shift()?.();
    await reading;
    expect(store.rowFor('zl-1')?.entries[0].left).toBe(6);
  });

  /**
   * Velista `0138`: the shopping list grouped by category is grouped by the parent
   * of each category, and stays so on both paths that change rows without a read:
   * a patch from an event, and a product choice held on this device.
   */
  describe('the parent headings', () => {
    /** Yoghurt, under a parent the read's products do not use. */
    const YOGHURT: BasketProduct = {
      id: 'item-yoghurt',
      name: { en: 'Natural yoghurt, 4', es: 'Yogur natural, 4' },
      brand: 'Hacendado',
      productGroupId: null,
      size: 4,
      unit: 'UNIT',
      offer: null,
      offers: [],
      atShop: null,
      imageUrl: null,
      categories: [memoryCategory('natural-and-skimmed-yogurts')],
      sectionIds: null,
    };

    async function grouped(overrides: Partial<BasketServiceI> = {}) {
      const built = await live(overrides, [
        BasketViewStore,
        { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
        provideFakeBrowserFacade(new Map()),
        provideFakeShopSectionsStore(),
        provideFakeCategoryStore(fakeCategoryStore(MEMORY_CATEGORIES)),
      ]);
      wire(built.twin, built.socket);
      const view = TestBed.inject(BasketViewStore);
      view.setGrouping('category');
      return { ...built, view };
    }

    /** Each heading's key and the products of its rows. */
    function outline(view: BasketViewStore) {
      return view
        .sections()
        .map((part) => [part.key, part.rows.map((one) => one.row.productId)]);
    }

    it('draws milk and eggs under their one parent, after a patch as after the read', async () => {
      jest.useFakeTimers();
      const { view, twin, reads } = await grouped();
      const read = outline(view);

      expect(read[0]).toEqual([
        'category:cat-eggs-milk-and-butter',
        ['item-milk-hacendado', 'item-eggs'],
      ]);
      expect(read[read.length - 1][0]).toBe('no-category');

      await twin.setDemand('b', { lineId: 'zl-1', quantity: 4, from: 2 });
      jest.advanceTimersByTime(10_000);
      await flush();

      // The event's patch drew this, and no read did.
      expect(reads.full + reads.rows).toBe(0);
      expect(outline(view)).toEqual(read);
      const milk = view
        .sections()[0]
        .rows.find((one) => one.row.productId === 'item-milk-hacendado');
      expect(milk?.row.entries.find((one) => one.lineId === 'zl-1')?.left).toBe(
        4
      );
    });

    it('moves a line held under another product to that product’s parent, and keeps it there after a patch', async () => {
      const { view, store, twin } = await grouped();
      const milk = rowOf(store, 'Milk');

      await store.changeProduct(
        milk.rowKey,
        { lineIds: ['zl-1'], itemId: 'item-yoghurt', keep: false },
        YOGHURT
      );

      const held = outline(view);
      expect(held.slice(0, 2)).toEqual([
        // The other milk line stays where it was, under the dairy parent.
        [
          'category:cat-eggs-milk-and-butter',
          ['item-milk-hacendado', 'item-eggs'],
        ],
        ['category:cat-yoghurts-and-desserts', ['item-yoghurt']],
      ]);

      await twin.setDemand('b', { lineId: 'zl-1', quantity: 4, from: 2 });

      expect(outline(view)).toEqual(held);
      expect(store.rowFor('zl-1')).toMatchObject({
        productId: 'item-yoghurt',
        left: 4,
      });
    });

    it('keeps a choice the server never heard of under its parent through a patch, with no read', async () => {
      jest.useFakeTimers();
      const { view, store, twin, reads } = await grouped({
        // The twin does not take the change, so only the device holds it: a read
        // would put the line back under milk.
        changeProduct: async () => ({ entries: [], skippedCount: 0 }),
      });
      const milk = rowOf(store, 'Milk');

      await store.changeProduct(
        milk.rowKey,
        { lineIds: ['zl-1'], itemId: 'item-yoghurt', keep: false },
        YOGHURT
      );
      const held = outline(view);
      expect(held[1]).toEqual([
        'category:cat-yoghurts-and-desserts',
        ['item-yoghurt'],
      ]);

      await twin.setDemand('b', { lineId: 'zl-1', quantity: 4, from: 2 });
      jest.advanceTimersByTime(10_000);
      await flush();

      expect(reads.full + reads.rows).toBe(0);
      expect(outline(view)).toEqual(held);
      expect(store.rowFor('zl-1')).toMatchObject({
        productId: 'item-yoghurt',
        left: 4,
      });
      // And the twin still names the read's product for that line.
      const rows = await twin.getBasketRows('basket-saturday');
      expect(JSON.stringify(rows)).not.toContain('item-yoghurt');
    });
  });
});
