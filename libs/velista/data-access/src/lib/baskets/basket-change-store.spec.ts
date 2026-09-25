import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Basket, BasketChangePage } from '@portfolio/velista/models';
import { AppResumed } from '@portfolio/velista/platform';
import { Subject } from 'rxjs';
import { REALTIME_CLIENT } from '../realtime/realtime-client';
import type { RealtimeEvent } from '../realtime/realtime-events';
import { RealtimeMemory } from '../realtime/realtime-memory';
import { BasketChangeStore } from './basket-change-store';
import { BasketMemory } from './basket-memory';
import { BASKET_SERVICE, type BasketServiceI } from './basket-service';
import { BasketSessionStore } from './basket-session-store';
import { BasketSocket } from './basket-socket';
import { BasketStore } from './basket-store';

/**
 * What changed on the covered lists, as the sheet reads it (velista `0093`,
 * section 2).
 *
 * Four things are worth a spec and the rest is plumbing.
 *
 * **An answer a newer request overtook is dropped.** A read that started before
 * an acknowledgement would otherwise land afterwards and put every `unseen`
 * flag back the way it was.
 *
 * **The same `through` is never sent twice**, whichever half of the screen
 * asked, and a failure takes that back so the next dwell can try again.
 *
 * **A success asks for the basket again**, because the count and the marks are
 * the server's answer and this side never decrements one.
 *
 * **Nothing here reads a clock.** `unseen` comes off the wire.
 */

class FakeSocket {
  readonly events = new Subject<RealtimeEvent>();
  readonly connected = signal(false);
  readonly revoked = signal(false);
  readonly reconnects = signal(0);
  open(): void {
    /* nothing to open */
  }
  close(): void {
    /* nothing to close */
  }
}

class FakeSessions {
  read(): null {
    return null;
  }
  write(): void {
    /* nothing is persisted here */
  }
  forget(): void {
    /* nothing is persisted here */
  }
}

const EMPTY: BasketChangePage = { items: [], nextCursor: null };

/**
 * The change store over a faked gateway, with the real {@link BasketStore}
 * beside it so the context it resolves against is a real basket.
 *
 * `overrides` is a **function of the memory** rather than an object, and that is
 * not decoration: an override written as `() => memory.getBasket()` beside a
 * `const { memory } = await opened(...)` reads the binding while it is still in
 * its temporal dead zone, because the first read happens inside `opened`. The
 * whole call then fails with a `ReferenceError` the store swallows, and the
 * spec asserts against a basket that never opened.
 */
function build(
  overrides: (memory: BasketMemory) => Partial<BasketServiceI> = () => ({})
) {
  const memory = new BasketMemory();
  const service: BasketServiceI = {
    previewLink: (secret) => memory.previewLink(secret),
    join: (secret, name) => memory.join(secret, name),
    getBasket: () => memory.getBasket(),
    getLiveBasket: () => memory.getLiveBasket(),
    getLiveSummary: () => memory.getLiveSummary(),
    settle: (id, rowKey, body) => memory.settle(id, rowKey, body),
    revert: (id, rowKey, body) => memory.revert(id, rowKey, body),
    renameRow: (id, rowKey, body) => memory.renameRow(id, rowKey, body),
    skip: (id, rowKey) => memory.skip(id, rowKey),
    unskip: (id, rowKey) => memory.unskip(id, rowKey),
    setDemand: (id, rowKey, body) => memory.setDemand(id, rowKey, body),
    addLine: (id, body) => memory.addLine(id, body),
    suggest: (id, query) => memory.suggest(id, query),
    changes: (id, context, cursor) => memory.changes(id, context, cursor),
    acknowledgeChanges: (id, through) =>
      memory.acknowledgeChanges(id, through),
    listParticipants: () => memory.listParticipants(),
    refreshSocketToken: () => memory.refreshSocketToken(),
    ensureShareLink: () => memory.ensureShareLink(),
    getShareLink: () => memory.getShareLink(),
    revokeShareLink: (id, cascade) => memory.revokeShareLink(id, cascade),
    revokeParticipant: (id, participantId) =>
      memory.revokeParticipant(id, participantId),
    addParticipant: (id, userId) => memory.addParticipant(id, userId),
    leaveBasket: () => memory.leaveBasket(),
    ...overrides(memory),
  };

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      BasketStore,
      BasketChangeStore,
      { provide: BasketSessionStore, useValue: new FakeSessions() },
      { provide: BASKET_SERVICE, useValue: service },
      { provide: BasketSocket, useValue: new FakeSocket() },
      { provide: AppResumed, useValue: { resumes: signal(0) } },
      { provide: REALTIME_CLIENT, useExisting: RealtimeMemory },
    ],
  });

  return {
    memory,
    basket: TestBed.inject(BasketStore),
    changes: TestBed.inject(BasketChangeStore),
  };
}

/** Open the basket, which is what every one of these starts from. */
async function opened(
  overrides: (memory: BasketMemory) => Partial<BasketServiceI> = () => ({})
) {
  const built = build(overrides);
  await built.basket.open('basket-saturday');
  return built;
}

describe('BasketChangeStore', () => {
  it('starts idle and reads nothing until the sheet opens it', async () => {
    const asked = jest.fn().mockResolvedValue(EMPTY);
    const { changes } = await opened(() => ({ changes: asked }));

    expect(changes.state()).toBe('idle');
    expect(asked).not.toHaveBeenCalled();
  });

  it('reads a page and names the people and lists the basket holds', async () => {
    const { changes } = await opened();
    await changes.load();

    expect(changes.state()).toBe('ready');
    // The fake's own log: five changes, one per sentence of the table.
    expect(changes.changes()).not.toHaveLength(0);
    const renamed = changes
      .changes()
      .find((change) => change.kind === 'RENAMED');
    // Somebody on no participant row of this basket, which the sheet draws as
    // "Someone" rather than as a blank.
    expect(renamed?.actor).toBeNull();
    const added = changes.changes().find((change) => change.kind === 'ADDED');
    expect(added?.list?.name).toBe('Weekly shop');
  });

  it('says so when the read will not arrive, and reads again on a retry', async () => {
    let fail = true;
    const { changes } = await opened(() => ({
      changes: async () => {
        if (fail) {
          throw new Error('offline');
        }
        return EMPTY;
      },
    }));

    await changes.load();
    expect(changes.state()).toBe('failed');

    fail = false;
    await changes.load();
    expect(changes.state()).toBe('ready');
  });

  it('drops an answer a newer read overtook', async () => {
    // The failure this exists to stop: a slow first read landing after a fast
    // second one, putting every `unseen` flag back the way it was.
    const gates: Array<(page: BasketChangePage) => void> = [];
    const { changes } = await opened(() => ({
      changes: () =>
        new Promise<BasketChangePage>((resolve) => gates.push(resolve)),
    }));

    const slow = changes.load();
    const fast = changes.load();

    gates[1]({
      items: [],
      nextCursor: 'from-the-newer-read',
    });
    await fast;
    gates[0]({ items: [], nextCursor: 'from-the-older-read' });
    await slow;

    expect(changes.nextCursor()).toBe('from-the-newer-read');
  });

  it('appends a second page and never the rows it already holds', async () => {
    const pages: BasketChangePage[] = [
      {
        items: [],
        nextCursor: 'page-2',
      },
      { items: [], nextCursor: null },
    ];
    let call = 0;
    const { changes } = await opened((memory) => ({
      changes: async (id, context, cursor) => {
        const page = await memory.changes(id, context, cursor);
        const answer = pages[call++] ?? { items: [], nextCursor: null };
        return { items: page.items.slice(0, 2), nextCursor: answer.nextCursor };
      },
    }));

    await changes.load();
    expect(changes.hasMore()).toBe(true);
    const added = await changes.loadMore();

    // The second page answers the same two rows, and every one of them is held
    // already: appending by id is what keeps the sheet from saying it twice.
    expect(added).toBe(0);
    expect(changes.changes()).toHaveLength(2);
    expect(changes.hasMore()).toBe(false);
  });

  it('answers null from a failed second page and keeps the first', async () => {
    let call = 0;
    const { changes } = await opened((memory) => ({
      changes: async (id, context, cursor) => {
        if (call++ === 0) {
          const page = await memory.changes(id, context, cursor);
          return { items: page.items, nextCursor: 'page-2' };
        }
        throw new Error('offline');
      },
    }));

    await changes.load();
    const held = changes.changes().length;

    expect(await changes.loadMore()).toBeNull();
    expect(changes.changes()).toHaveLength(held);
    expect(changes.state()).toBe('ready');
  });

  it('sends one acknowledgement per distinct id, and reads the basket again', async () => {
    const sent: string[] = [];
    let reads = 0;
    const { changes } = await opened((memory) => ({
      getBasket: () => {
        reads += 1;
        return memory.getBasket();
      },
      acknowledgeChanges: async (id, through) => {
        sent.push(through);
        await memory.acknowledgeChanges(id, through);
      },
    }));
    const readsAfterOpen = reads;

    await changes.acknowledge('chg-5');
    await changes.acknowledge('chg-5');

    expect(sent).toEqual(['chg-5']);
    // The count and the marks are the server's new answer, never a local guess.
    expect(reads).toBe(readsAfterOpen + 1);
  });

  it('retries once, and leaves the id sendable when both attempts fail', async () => {
    let attempts = 0;
    const { changes } = await opened(() => ({
      acknowledgeChanges: async () => {
        attempts += 1;
        throw new Error('offline');
      },
    }));

    await changes.acknowledge('chg-5');
    expect(attempts).toBe(2);

    // The marks stay and the next dwell tries again, which is the safe way to
    // be wrong: nothing was cleared that the reader had not read.
    await changes.acknowledge('chg-5');
    expect(attempts).toBe(4);
  });

  it('gives the instance back when the page lets it go', async () => {
    const { changes } = await opened();
    await changes.load();

    changes.reset();

    expect(changes.state()).toBe('idle');
    expect(changes.changes()).toEqual([]);
    expect(changes.nextCursor()).toBeNull();
  });

  it('reads again when the basket does, but only while the sheet is open', async () => {
    let calls = 0;
    const { basket, changes } = await opened(() => ({
      changes: async () => {
        calls += 1;
        return EMPTY;
      },
    }));

    // Shut: a refetch of the basket reads no changes at all.
    await basket.refresh();
    TestBed.tick();
    expect(calls).toBe(0);

    await changes.load();
    expect(calls).toBe(1);

    // Open: the same refetch reads them again, so a line edited while somebody
    // is reading the sheet appears in it. `tick` because the watcher is an
    // `effect`, which a zoneless test bed runs only when it is flushed.
    await basket.refresh();
    TestBed.tick();
    await Promise.resolve();
    expect(calls).toBe(2);
  });
});

/** The fields the basket read carries for this plan (section 2). */
describe('the basket a change store reads against', () => {
  it('carries the count and the newest unseen id', async () => {
    const { basket } = await opened();
    const held = basket.basket() as Basket;

    expect(held.unseenChangeCount).toBeGreaterThan(0);
    expect(held.newestUnseenChangeId).toBe('chg-5');
  });

  it('marks the rows the unseen changes touched, and no others', async () => {
    const { basket } = await opened();
    const rows = basket.rows();

    // The fake's log adds the bread, changes the eggs and deletes the oil.
    expect(rows.find((row) => row.content === 'Sourdough loaf')?.mark).toBe(
      'ADDED'
    );
    expect(rows.find((row) => row.content === 'Eggs')?.mark).toBe('CHANGED');
    expect(rows.find((row) => row.content === 'Olive oil')?.mark).toBe(
      'REMOVED'
    );
  });

  it('loses the marks and the count once the viewer has acknowledged', async () => {
    const { basket, changes } = await opened();

    await changes.acknowledge('chg-5');

    expect(basket.basket()?.unseenChangeCount).toBe(0);
    expect(basket.rows().every((row) => row.mark === null)).toBe(true);
  });
});
