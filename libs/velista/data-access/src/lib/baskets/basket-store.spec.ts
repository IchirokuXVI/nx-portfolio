import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  type Basket,
  type BasketRow,
  type BasketSession,
  type BasketSettleRequest,
} from '@portfolio/velista/models';
import { AppResumed } from '@portfolio/velista/platform';
import { Subject } from 'rxjs';
import { GatewayError } from '../errors';
import { REALTIME_CLIENT } from '../realtime/realtime-client';
import type { RealtimeEvent } from '../realtime/realtime-events';
import { RealtimeMemory } from '../realtime/realtime-memory';
import { BasketMemory } from './basket-memory';
import { BASKET_SERVICE, type BasketServiceI } from './basket-service';
import { BasketSessionStore } from './basket-session-store';
import { BasketSocket } from './basket-socket';
import { BasketStore } from './basket-store';

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
  resumed: FakeResumed = new FakeResumed()
): {
  store: BasketStore;
  sessions: FakeSessions;
  socket: FakeSocket;
  resumed: FakeResumed;
} {
  const memory = new BasketMemory();
  const service: BasketServiceI = {
    previewLink: (secret) => memory.previewLink(secret),
    join: (secret, name) => memory.join(secret, name),
    getBasket: () => memory.getBasket(),
    settle: (id, rowKey, body) => memory.settle(id, rowKey, body),
    revert: (id, rowKey, body) => memory.revert(id, rowKey, body),
    renameRow: (id, rowKey, body) => memory.renameRow(id, rowKey, body),
    suggest: (id, query) => memory.suggest(id, query),
    listParticipants: () => memory.listParticipants(),
    refreshSocketToken: () => memory.refreshSocketToken(),
    ensureShareLink: () => memory.ensureShareLink(),
    getShareLink: () => memory.getShareLink(),
    revokeShareLink: (id, cascade) => memory.revokeShareLink(id, cascade),
    revokeParticipant: (id, participantId) =>
      memory.revokeParticipant(id, participantId),
    addParticipant: (id, userId) => memory.addParticipant(id, userId),
    leaveBasket: () => memory.leaveBasket(),
    ...overrides,
  };

  TestBed.configureTestingModule({
    providers: [
      BasketStore,
      { provide: BasketSessionStore, useValue: sessions },
      { provide: BASKET_SERVICE, useValue: service },
      { provide: BasketSocket, useValue: socket },
      { provide: AppResumed, useValue: resumed },
      { provide: REALTIME_CLIENT, useExisting: RealtimeMemory },
    ],
  });

  return { store: TestBed.inject(BasketStore), sessions, socket, resumed };
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
     * **It takes the answer's counts whole and patches nothing.** Every number on
     * this screen is one the server sent, so a store that added the units it just
     * sent to the number it was holding would be a second arithmetic.
     */
    it('takes the counts from the answer rather than adjusting its own', async () => {
      const memory = new BasketMemory();
      const { store } = build({
        getBasket: () => memory.getBasket(),
        settle: async (id, rowKey, body) => ({
          ...(await memory.settle(id, rowKey, body)),
          progress: { done: 5, unavailable: 1, total: 8 },
          pending: 2,
        }),
      });
      await store.open('basket-saturday');

      const milk = rowOf(store, 'Milk');
      await store.settle(milk.rowKey, {
        outcome: 'BOUGHT',
        quantity: 1,
        from: milk.left,
      });

      expect(store.progress()).toEqual({ done: 5, unavailable: 1, total: 8 });
      expect(store.pending()).toBe(2);
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
    it('renames in place when the name is free', async () => {
      const { store } = build();
      await store.open('basket-saturday');
      const eggs = rowOf(store, 'Eggs');

      const result = await store.renameRow(eggs.rowKey, {
        content: 'Free range eggs',
      });

      expect(result?.absorbedRowKey).toBeNull();
      expect(rowOf(store, 'Free range eggs').rowKey).toBe(eggs.rowKey);
    });

    it('answers null and keeps the question when the name is taken', async () => {
      const { store } = build();
      await store.open('basket-saturday');
      const before = store.rows().length;

      const result = await store.renameRow(rowOf(store, 'Eggs').rowKey, {
        content: 'milk',
      });

      expect(result).toBeNull();
      expect(store.rows()).toHaveLength(before);
      expect((store.error() as GatewayError).code).toBe('line_merge_required');
    });

    /**
     * The earliest line survives, so the row the rename addressed can be the one
     * that goes away: the answer names the survivor and `replacedRowKey` names the
     * key the request used, and the store drops that one.
     */
    it('drops the absorbed row at once and folds the survivor', async () => {
      const { store } = build();
      await store.open('basket-saturday');
      const eggs = rowOf(store, 'Eggs');
      const before = store.rows().length;

      const result = await store.renameRow(eggs.rowKey, {
        content: 'milk',
        confirmMerge: true,
      });

      // The **survivor's** own spelling, which is the earliest line's: a merge
      // folds the renamed row into the one already there rather than renaming it.
      expect(result?.row.content).toBe('Milk');
      expect(store.rows()).toHaveLength(before - 1);
      expect(store.rows().some((row) => row.rowKey === eggs.rowKey)).toBe(
        false
      );
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

    it('asks again rather than applying an answer a write overtook', async () => {
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

      // The stale answer is dropped and the read goes round again.
      const before = held.counted.reads;
      await held.release();
      expect(held.counted.reads).toBe(before + 1);

      await held.release();
      await reading;
      expect(rowOf(store, 'Eggs').bought).toBe(eggs.bought + 1);
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
        socket.events.next({
          type: 'basket.linesChanged',
          lineIds: ['zl-1'],
        });

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
     * A broadcast carries **ids and no numbers** (backend `0130`, section 6), and a
     * row is a group the server computes, so a line id does not even say which row
     * moved. There is nothing to merge and the only honest answer is to ask.
     */
    it('reads the basket again on basket.linesChanged rather than merging it', async () => {
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

        socket.events.next({
          type: 'basket.linesChanged',
          lineIds: ['zl-1', 'zl-3'],
        });

        // Nothing at once: a shop full of people settling rows is a stream of
        // these, and a request each would be a request per tin of tomatoes.
        expect(reads).toBe(readsAfterOpen);

        jest.advanceTimersByTime(2000);
        await Promise.resolve();
        await Promise.resolve();

        expect(reads).toBe(readsAfterOpen + 1);
      } finally {
        jest.useRealTimers();
      }
    });

    it('costs one read for a burst of three', async () => {
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

        for (const lineId of ['zl-1', 'zl-2', 'zl-3']) {
          socket.events.next({
            type: 'basket.linesChanged',
            lineIds: [lineId],
          });
        }

        jest.advanceTimersByTime(2000);
        await Promise.resolve();
        await Promise.resolve();

        expect(reads).toBe(readsAfterOpen + 1);
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
        socket.events.next({
          type: 'basket.linesChanged',
          lineIds: ['zl-1'],
        });

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
      settle: (id, rowKey, body) => {
        sent.push({ rowKey, body });
        return memory.settle(id, rowKey, body);
      },
    });
    await store.open('basket-saturday');
    const milk = rowOf(store, 'Milk');

    await store.setLeft(milk.rowKey, milk.left - 2, milk.left);

    expect(sent).toEqual([
      {
        rowKey: milk.rowKey,
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
      revert: (id, rowKey, body) => {
        sent.push({ rowKey, body });
        return memory.revert(id, rowKey, body);
      },
    });
    await store.open('basket-saturday');
    const eggs = rowOf(store, 'Eggs');

    await store.setLeft(eggs.rowKey, eggs.left + 1, eggs.left);

    expect(sent).toEqual([
      {
        rowKey: eggs.rowKey,
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
  it('draws the answer’s row rather than the number that was sent', async () => {
    const memory = new BasketMemory();
    const { store } = build({
      getBasket: () => memory.getBasket(),
      settle: async (id, rowKey, body) => {
        const answered = await memory.settle(id, rowKey, body);
        // A second shopper bought one more while this gesture was in flight.
        return { ...answered, row: { ...answered.row, left: 99 } };
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
});
