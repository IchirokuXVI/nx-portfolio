import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  outstanding,
  type BasketLine,
  type BasketSession,
} from '@portfolio/velista/models';
import { Subject } from 'rxjs';
import { GatewayError } from '../errors';
import type { RealtimeEvent } from '../realtime/realtime-events';
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
 * **`apply` merges rather than replaces**, because a line arriving from the
 * basket's room is redacted to the least privileged reader in it. Replacing
 * would take a privileged reader's "from" captions off the screen every time
 * somebody else settled something.
 */

/** A session store over a plain object, so nothing here touches `localStorage`. */
class FakeSessions {
  private readonly _held = new Map<string, BasketSession>();

  read(generatedListId: string): BasketSession | null {
    return this._held.get(generatedListId) ?? null;
  }

  write(session: BasketSession): void {
    this._held.set(session.generatedListId, session);
  }

  forget(generatedListId: string): void {
    this._held.delete(generatedListId);
  }

  /** Seeds a credential, which is what a guest who has joined would hold. */
  seed(generatedListId: string): void {
    this._held.set(generatedListId, {
      generatedListId,
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

  readonly opened: string[] = [];
  closes = 0;

  open(generatedListId: string): void {
    this.opened.push(generatedListId);
  }

  close(): void {
    this.closes += 1;
    this.connected.set(false);
  }
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
  socket: FakeSocket = new FakeSocket()
): { store: BasketStore; sessions: FakeSessions; socket: FakeSocket } {
  const memory = new BasketMemory();
  const service: BasketServiceI = {
    previewLink: (secret) => memory.previewLink(secret),
    join: (secret, name) => memory.join(secret, name),
    getBasket: () => memory.getBasket(),
    settle: (id, lineId, body) => memory.settle(id, lineId, body),
    reopen: (id, lineId) => memory.reopen(id, lineId),
    setPick: (id, lineId, itemId) => memory.setPick(id, lineId, itemId),
    addLine: (id, body) => memory.addLine(id, body),
    suggest: (id, query) => memory.suggest(id, query),
    listParticipants: () => memory.listParticipants(),
    refreshSocketToken: () => memory.refreshSocketToken(),
    ensureShareLink: () => memory.ensureShareLink(),
    getShareLink: () => memory.getShareLink(),
    revokeShareLink: (id, cascade) => memory.revokeShareLink(id, cascade),
    revokeParticipant: (id, participantId) =>
      memory.revokeParticipant(id, participantId),
    ...overrides,
  };

  TestBed.configureTestingModule({
    providers: [
      BasketStore,
      { provide: BasketSessionStore, useValue: sessions },
      { provide: BASKET_SERVICE, useValue: service },
      { provide: BasketSocket, useValue: socket },
    ],
  });

  return { store: TestBed.inject(BasketStore), sessions, socket };
}

describe('BasketStore', () => {
  describe('opening one', () => {
    it('loads the basket and reports ready', async () => {
      const { store } = build();
      await store.open('basket-saturday');

      expect(store.state()).toBe('ready');
      expect(store.lines().length).toBeGreaterThan(0);
      expect(store.me()).not.toBeNull();
    });

    it('does not count a line the shop had none of as one somebody got', async () => {
      // The header says "got", and got means bought. A NOT_AVAILABLE settle
      // closes a line's outstanding amount without buying anything, so counting
      // every finished line as one somebody got would claim a purchase that
      // never happened — the same claim the row's caption is careful to avoid.
      const { store } = build();
      await store.open('basket-saturday');

      const bread = store
        .lines()
        .find((line) => line.lastOutcome === 'NOT_AVAILABLE');
      expect(bread).toBeDefined();
      expect(outstanding(bread as BasketLine)).toBe(0);

      expect(store.progress().unavailable).toBe(1);
      // Finished, and deliberately absent from `done`.
      const finished = store
        .lines()
        .filter((line) => outstanding(line) === 0).length;
      expect(store.progress().done).toBe(finished - 1);
    });

    it('counts progress in lines rather than in units', async () => {
      // "Four things done out of twelve" is what somebody in a shop is tracking.
      // A basket of one line asking for twelve tins would otherwise read as
      // almost finished the moment one tin went in the trolley.
      const { store } = build();
      await store.open('basket-saturday');

      expect(store.progress().total).toBe(store.lines().length);
    });

    it('reports what the server said about zone data, never a guess', async () => {
      const memory = new BasketMemory();
      memory.seesZoneData = false;
      const { store } = build({
        getBasket: () => memory.getBasket(),
      });
      await store.open('basket-saturday');

      expect(store.seesZoneData()).toBe(false);
      // Redacted by omission, so the guest's line genuinely has no origins key
      // rather than an empty one behind a flag.
      expect(store.lines().every((line) => line.origins === undefined)).toBe(
        true
      );
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
      const before = store.lines().length;
      await store.refresh();

      expect(store.state()).toBe('ready');
      expect(store.lines()).toHaveLength(before);
    });
  });

  describe('settling', () => {
    it('folds the answer in, so the row is right before the refresh lands', async () => {
      const { store } = build();
      await store.open('basket-saturday');

      const milk = store.lines().find((line) => line.content === 'Milk');
      if (milk === undefined) {
        throw new Error('the fixture basket lost its milk');
      }
      await store.settle(milk.id, { outcome: 'BOUGHT' });

      const after = store.lines().find((line) => line.id === milk.id);
      expect(after?.settled).toBe(milk.quantity);
    });

    it('reports a partial settle rather than swallowing it', async () => {
      // Section 6.4: a shopper who has bought the thing has to be told an origin
      // was missed, whether or not they may know whose it was.
      const memory = new BasketMemory();
      const { store } = build({
        getBasket: () => memory.getBasket(),
        settle: async (id, lineId, body) => {
          const answered = await memory.settle(id, lineId, body);
          return { ...answered, skippedCount: 1 };
        },
      });
      await store.open('basket-saturday');

      const result = await store.settle(store.lines()[0].id, {
        outcome: 'BOUGHT',
      });

      expect(result?.skippedCount).toBe(1);
    });

    it('marks the line busy while the write is out, and only that line', async () => {
      let release: (() => void) | undefined;
      const memory = new BasketMemory();
      const { store } = build({
        getBasket: () => memory.getBasket(),
        settle: (id, lineId, body) =>
          new Promise((resolve) => {
            release = () => resolve(memory.settle(id, lineId, body));
          }),
      });
      await store.open('basket-saturday');

      const first = store.lines()[0];
      const pending = store.settle(first.id, { outcome: 'BOUGHT' });

      expect(store.busyLines().has(first.id)).toBe(true);
      expect(store.busyLines().has(store.lines()[1].id)).toBe(false);

      release?.();
      await pending;
      expect(store.busyLines().has(first.id)).toBe(false);
    });
  });

  /**
   * The merge that keeps a privileged reader's captions on screen.
   *
   * A broadcast into a basket room is redacted to the least privileged reader in
   * it, because it cannot be projected per socket. The three gated fields do not
   * move when a line is settled, so keeping the held ones is both correct and
   * what stops the captions vanishing when somebody else settles something.
   */
  describe('apply', () => {
    it('keeps the origins it already holds when a redacted line arrives', async () => {
      const { store } = build();
      await store.open('basket-saturday');

      const held = store.lines().find((line) => line.origins !== undefined);
      if (held === undefined) {
        throw new Error('the fixture basket has no line with origins');
      }

      const redacted: BasketLine = { ...held, settled: 1 };
      delete (redacted as { origins?: unknown }).origins;

      store.apply(redacted);

      const after = store.lines().find((line) => line.id === held.id);
      expect(after?.settled).toBe(1);
      expect(after?.origins).toEqual(held.origins);
    });

    it('takes newer origins when the line actually carries them', async () => {
      const { store } = build();
      await store.open('basket-saturday');

      const held = store.lines().find((line) => line.origins !== undefined);
      if (held === undefined) {
        throw new Error('the fixture basket has no line with origins');
      }
      store.apply({ ...held, origins: [] });

      expect(
        store.lines().find((line) => line.id === held.id)?.origins
      ).toEqual([]);
    });

    it('ignores a line for a basket that is not open', () => {
      const { store } = build();
      // Nothing loaded, so there is nothing to fold into. It must not invent a
      // basket out of one line.
      store.apply({
        id: 'line-x',
        content: 'Milk',
        quantity: 1,
        settled: 0,
        pickId: null,
        optionIds: [],
        position: 0,
        touchedBy: null,
        touchedAt: null,
        lastOutcome: null,
      });

      expect(store.basket()).toBeNull();
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
   * Plan 0053: a line added in a shop.
   *
   * Three claims, and each is a way the row could go wrong on somebody's phone: it
   * arrives from the **server** rather than optimistically, it arrives **once**
   * however many routes carried it, and somebody else's arrives at all.
   */
  describe('adding a line', () => {
    it('appends what the server answered, at the end', async () => {
      const { store } = build();
      await store.open('basket-saturday');
      const before = store.lines().length;

      const line = await store.addLine({ content: 'Batteries', quantity: 2 });

      expect(line).not.toBeNull();
      expect(store.lines()).toHaveLength(before + 1);
      expect(store.lines()[before].content).toBe('Batteries');
      // Written once, by the add, and it is what the row's caption reads.
      expect(store.lines()[before].createdBy).not.toBeNull();
    });

    it('appends it once when the broadcast follows the answer', async () => {
      // The add answers a line and the basket's room broadcasts the same one, so
      // the person who typed it meets it twice. Without the id check they would
      // have two rows for one thing, in a shop, on the screen they are working
      // from.
      const { store, socket } = build();
      await store.open('basket-saturday');
      const before = store.lines().length;

      const line = await store.addLine({ content: 'Batteries' });
      socket.events.next({
        type: 'generatedList.lineAdded',
        generatedListId: 'basket-saturday',
        line: line as BasketLine,
      });

      expect(store.lines()).toHaveLength(before + 1);
    });

    it('appends a line somebody else added, with no refetch', async () => {
      const { store, socket } = build();
      await store.open('basket-saturday');
      const before = store.lines().length;

      socket.events.next({
        type: 'generatedList.lineAdded',
        generatedListId: 'basket-saturday',
        line: { ...store.lines()[0], id: 'line-theirs', content: 'Ice' },
      });

      expect(store.lines()).toHaveLength(before + 1);
      expect(store.lastAdded()?.content).toBe('Ice');
    });

    it('ignores an append addressed to another basket', async () => {
      const { store, socket } = build();
      await store.open('basket-saturday');
      const before = store.lines().length;

      socket.events.next({
        type: 'generatedList.lineAdded',
        generatedListId: 'basket-somebody-elses',
        line: { ...store.lines()[0], id: 'line-theirs' },
      });

      expect(store.lines()).toHaveLength(before);
    });

    it('answers null on a refusal, leaving the basket as it was', async () => {
      // The caller has something to do with that null: put the text back in the
      // field. Losing the item somebody just remembered in an aisle is the
      // failure this screen cannot afford.
      const memory = new BasketMemory();
      memory.status = 'COMPLETED';
      const { store } = build({
        addLine: (id, body) => memory.addLine(id, body),
      });
      await store.open('basket-saturday');
      const before = store.lines().length;

      const line = await store.addLine({ content: 'Batteries' });

      expect(line).toBeNull();
      expect(store.lines()).toHaveLength(before);
    });

    it('says a finished basket takes no lines', async () => {
      const memory = new BasketMemory();
      memory.status = 'COMPLETED';
      const { store } = build({ getBasket: () => memory.getBasket() });
      await store.open('basket-saturday');

      expect(store.takesLines()).toBe(false);
    });

    it('says nothing takes lines before anything has loaded', async () => {
      // The safe direction: a field drawn for a frame over a basket that turns out
      // to be finished is an invitation that cannot be honoured.
      const { store } = build();

      expect(store.takesLines()).toBe(false);
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
      const { store, socket } = build();
      await store.open('basket-saturday');
      store.leave();

      await store.open('basket-saturday');
      const held = store.lines()[0];
      socket.events.next({
        type: 'generatedList.lineSettled',
        generatedListId: 'basket-saturday',
        line: { ...held, settled: held.settled + 1 },
      });

      expect(socket.opened).toEqual(['basket-saturday', 'basket-saturday']);
      expect(store.lines()[0].settled).toBe(held.settled + 1);
    });

    it('drops an event that arrives after the screen was left', async () => {
      // A broadcast can be in flight while somebody walks out of the screen, and the
      // socket is closed rather than instantly silent. Applying it would refetch a
      // basket nobody is looking at.
      const { store, socket } = build();
      await store.open('basket-saturday');
      const held = store.lines()[0];

      store.leave();
      socket.events.next({
        type: 'generatedList.lineSettled',
        generatedListId: 'basket-saturday',
        line: { ...held, settled: held.settled + 1 },
      });

      expect(store.basket()).toBeNull();
    });

    it('merges a settled line off the room with no refetch', async () => {
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

      const held = store.lines()[0];
      socket.events.next({
        type: 'generatedList.lineSettled',
        generatedListId: 'basket-saturday',
        line: { ...held, settled: held.settled + 1 },
      });

      expect(store.lines()[0].settled).toBe(held.settled + 1);
      // The whole point: one row moved and nothing was asked of the server.
      expect(reads).toBe(readsAfterOpen);
    });

    it('keeps the origins it holds when the line off the room is redacted', async () => {
      // `apply` is tested for this directly; this asserts it on the path a redacted
      // line actually arrives on. A broadcast cannot be projected per socket, so it
      // carries the least privileged reader's view of the line, and a privileged
      // reader must not lose their "from" captions when somebody else settles.
      const { store, socket } = build();
      await store.open('basket-saturday');

      const held = store.lines().find((line) => line.origins !== undefined);
      if (held === undefined) {
        throw new Error('the fixture basket has no line with origins');
      }

      const redacted: BasketLine = { ...held, settled: 1 };
      delete (redacted as { origins?: unknown }).origins;

      socket.events.next({
        type: 'generatedList.lineSettled',
        generatedListId: 'basket-saturday',
        line: redacted,
      });

      const after = store.lines().find((line) => line.id === held.id);
      expect(after?.settled).toBe(1);
      expect(after?.origins).toEqual(held.origins);
    });

    it('ignores an event about a different basket', async () => {
      const { store, socket } = build();
      await store.open('basket-saturday');

      const held = store.lines()[0];
      socket.events.next({
        type: 'generatedList.lineUpdated',
        generatedListId: 'somebody-elses-basket',
        line: { ...held, settled: held.settled + 5 },
      });

      expect(store.lines()[0].settled).toBe(held.settled);
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

      const milk = store.lines().find((line) => line.content === 'Milk');
      if (milk === undefined) {
        throw new Error('the fixture basket lost its milk');
      }
      const result = await store.settle(milk.id, { outcome: 'BOUGHT' });

      expect(result).not.toBeNull();
      expect(store.lines().find((line) => line.id === milk.id)?.settled).toBe(
        milk.quantity
      );

      // And the refetch `0035` makes on resume, which is the other half of what
      // keeps a basket with no room current.
      const before = reads;
      await store.refresh();
      expect(reads).toBe(before + 1);
      expect(store.state()).toBe('ready');
      expect(socket.opened).toEqual(['basket-saturday']);
    });

    it('shows who is present only while the socket is up', async () => {
      const { store, socket } = build();
      await store.open('basket-saturday');
      socket.connected.set(true);

      socket.events.next({
        type: 'presence.generatedListUpdated',
        generatedListId: 'basket-saturday',
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
  });
});
