import { TestBed } from '@angular/core/testing';
import {
  outstanding,
  type BasketLine,
  type BasketSession,
} from '@portfolio/velista/models';
import { GatewayError } from '../errors';
import { BasketMemory } from './basket-memory';
import { BASKET_SERVICE, type BasketServiceI } from './basket-service';
import { BasketSessionStore } from './basket-session-store';
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
 * A service that delegates to {@link BasketMemory}, with named overrides on top.
 *
 * Written out rather than spread from the instance: the methods live on the
 * prototype, so `{ ...memory }` copies the two public fields and none of the
 * behaviour, and every call lands on `undefined`.
 */
function build(
  overrides: Partial<BasketServiceI> = {},
  sessions: FakeSessions = new FakeSessions()
): { store: BasketStore; sessions: FakeSessions } {
  const memory = new BasketMemory();
  const service: BasketServiceI = {
    previewLink: (secret) => memory.previewLink(secret),
    join: (secret, name) => memory.join(secret, name),
    getBasket: () => memory.getBasket(),
    settle: (id, lineId, body) => memory.settle(id, lineId, body),
    setPick: (id, lineId, itemId) => memory.setPick(id, lineId, itemId),
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
    ],
  });

  return { store: TestBed.inject(BasketStore), sessions };
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

      expect(await store.loadShareLink().then(() => store.shareLink())).toBeNull();
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
});
