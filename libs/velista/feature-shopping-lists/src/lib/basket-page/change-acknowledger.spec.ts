import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BasketChangeStore, BasketStore } from '@portfolio/velista/data-access';
import type { Basket, BasketChange } from '@portfolio/velista/models';
import { BrowserFacade } from '@portfolio/velista/platform';
import {
  ChangeAcknowledger,
  CHANGE_SEEN_DWELL_MS,
} from './change-acknowledger';

/**
 * When this viewer has really seen a change (velista `0093`, section 7).
 *
 * The one part of this plan that is easy to get subtly wrong, because every
 * failure looks like nothing happening. So each condition is asserted on its
 * own and in the direction that costs something: hidden sends nothing, nothing
 * on screen sends nothing, under the dwell sends nothing, and a background
 * refetch sends nothing at all.
 *
 * **Nothing here reads a clock to decide what is new.** The only timer is the
 * display dwell, which is why the fake timers below are legitimate: they stand
 * in for a second and a half of somebody looking at a screen, not for a window
 * in which a change counts as new.
 */

function basket(over: Partial<Basket> = {}): Basket {
  return {
    id: 'basket-saturday',
    kind: 'LIVE',
    name: null,
    status: 'OPEN',
    createdAt: null,
    rows: [],
    lists: [],
    participants: [],
    me: {
      id: 'p-1',
      kind: 'OWNER',
      displayName: null,
      username: 'Dani',
      guestNumber: null,
      userId: 'u-1',
      joinedAt: null,
      lastSeenAt: null,
      shareLinkId: null,
    },
    products: new Map(),
    scopes: new Map(),
    progress: { done: 0, unavailable: 0, total: 0 },
    pending: 0,
    unseenChangeCount: 2,
    newestUnseenChangeId: 'chg-5',
    ...over,
  };
}

function change(id: string): BasketChange {
  return {
    id,
    kind: 'RENAMED',
    rowKey: 'zl-1',
    contentBefore: 'Leche',
    contentAfter: 'Milk',
    quantityBefore: null,
    quantityAfter: null,
    approvalBefore: null,
    approvalAfter: null,
    rowContent: null,
    actor: null,
    list: null,
    at: new Date('2026-09-01T09:00:00.000Z'),
    unseen: true,
  };
}

interface Harness {
  readonly acknowledger: ChangeAcknowledger;
  readonly visible: WritableSignal<boolean>;
  readonly held: WritableSignal<Basket | null>;
  readonly entries: WritableSignal<readonly BasketChange[]>;
  readonly acknowledge: jest.Mock;
  readonly refresh: jest.Mock;
}

function build(over: { basket?: Basket | null } = {}): Harness {
  const visible = signal(true);
  const held = signal<Basket | null>(
    over.basket === undefined ? basket() : over.basket
  );
  const entries = signal<readonly BasketChange[]>([]);
  const acknowledge = jest.fn().mockResolvedValue(undefined);
  const refresh = jest.fn().mockResolvedValue(undefined);

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      ChangeAcknowledger,
      { provide: BrowserFacade, useValue: { visible } },
      { provide: BasketStore, useValue: { basket: held, refresh } },
      {
        provide: BasketChangeStore,
        useValue: { changes: entries, acknowledge },
      },
    ],
  });

  return {
    acknowledger: TestBed.inject(ChangeAcknowledger),
    visible,
    held,
    entries,
    acknowledge,
    refresh,
  };
}

/** Let the dwell end, and let the request that follows settle. */
async function dwell(): Promise<void> {
  TestBed.tick();
  jest.advanceTimersByTime(CHANGE_SEEN_DWELL_MS);
  await Promise.resolve();
  await Promise.resolve();
}

/** A marked row, standing in for the element the directive registers. */
const ROW = {};
const OTHER_ROW = {};

describe('ChangeAcknowledger', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('sends the newest id the read drew, once the row has been on screen', async () => {
    const harness = build();

    harness.acknowledger.reportRowSeen(ROW, true);
    await dwell();

    expect(harness.acknowledge).toHaveBeenCalledWith('chg-5');
  });

  it('sends nothing at all while the tab is hidden', async () => {
    // Everything is still new when the person comes back, which is the safe
    // way to be wrong: nothing was cleared that nobody read.
    const harness = build();
    harness.visible.set(false);

    harness.acknowledger.reportRowSeen(ROW, true);
    await dwell();

    expect(harness.acknowledge).not.toHaveBeenCalled();
  });

  it('sends nothing while no marked row is on screen', async () => {
    // Marked rows below the fold, never scrolled to. The banner still counts
    // them and the marks stay.
    const harness = build();

    await dwell();

    expect(harness.acknowledge).not.toHaveBeenCalled();
  });

  it('sends nothing when the row leaves before the dwell is up', async () => {
    const harness = build();

    harness.acknowledger.reportRowSeen(ROW, true);
    TestBed.tick();
    jest.advanceTimersByTime(CHANGE_SEEN_DWELL_MS - 1);
    harness.acknowledger.reportRowSeen(ROW, false);
    await dwell();

    expect(harness.acknowledge).not.toHaveBeenCalled();
  });

  it('sends nothing when the sheet is opened and shut inside the dwell', async () => {
    const harness = build();

    harness.acknowledger.reportSheetEntries(3);
    TestBed.tick();
    jest.advanceTimersByTime(CHANGE_SEEN_DWELL_MS - 1);
    harness.acknowledger.reportSheetEntries(0);
    await dwell();

    expect(harness.acknowledge).not.toHaveBeenCalled();
  });

  it('never runs from a refetch alone', async () => {
    // A read caused by the socket, by a reconnect or by the app resuming
    // changes what is drawn and nothing else. It is the intersection and the
    // visibility that decide, afterwards, whether a person saw it.
    //
    // Asserted with a marked row **already on screen** and the dwell only half
    // spent, which is the case a weaker test would miss: a read landing there
    // must not shorten the wait or stand in for it.
    const harness = build();

    harness.acknowledger.reportRowSeen(ROW, true);
    TestBed.tick();
    jest.advanceTimersByTime(CHANGE_SEEN_DWELL_MS - 100);

    harness.held.set(basket({ unseenChangeCount: 9 }));
    TestBed.tick();
    await Promise.resolve();
    expect(harness.acknowledge).not.toHaveBeenCalled();

    // And the wait that was already running still ends where it was going to.
    jest.advanceTimersByTime(100);
    await Promise.resolve();
    expect(harness.acknowledge).toHaveBeenCalledTimes(1);
  });

  it('names the sheet’s own first entry while the sheet is drawing', async () => {
    // The newest thing the reader is actually looking at, which is not
    // necessarily the id the marked rows were drawn from.
    const harness = build();
    harness.entries.set([change('chg-7'), change('chg-6')]);

    harness.acknowledger.reportSheetEntries(2);
    await dwell();

    expect(harness.acknowledge).toHaveBeenCalledWith('chg-7');
  });

  it('falls back to the read’s own id when the sheet is shut', async () => {
    const harness = build();
    harness.entries.set([change('chg-7')]);

    harness.acknowledger.reportRowSeen(ROW, true);
    await dwell();

    expect(harness.acknowledge).toHaveBeenCalledWith('chg-5');
  });

  it('sends nothing when the server says nothing is unseen', async () => {
    const harness = build({
      basket: basket({ unseenChangeCount: 0, newestUnseenChangeId: null }),
    });

    harness.acknowledger.reportRowSeen(ROW, true);
    await dwell();

    expect(harness.acknowledge).not.toHaveBeenCalled();
  });

  it('counts a second row without restarting the dwell', async () => {
    // A slow scroll down a changed basket would otherwise never reach the end
    // of one dwell, because every row arriving would push it out again.
    const harness = build();

    harness.acknowledger.reportRowSeen(ROW, true);
    TestBed.tick();
    jest.advanceTimersByTime(CHANGE_SEEN_DWELL_MS - 100);
    harness.acknowledger.reportRowSeen(OTHER_ROW, true);
    await dwell();

    expect(harness.acknowledge).toHaveBeenCalledTimes(1);
  });

  it('keeps counting while one of two rows scrolls away', async () => {
    const harness = build();

    harness.acknowledger.reportRowSeen(ROW, true);
    harness.acknowledger.reportRowSeen(OTHER_ROW, true);
    TestBed.tick();
    jest.advanceTimersByTime(100);
    harness.acknowledger.reportRowSeen(ROW, false);
    await dwell();

    expect(harness.acknowledge).toHaveBeenCalledWith('chg-5');
  });

  it('sends nothing before the basket has loaded', async () => {
    const harness = build({ basket: null });

    harness.acknowledger.reportRowSeen(ROW, true);
    await dwell();

    expect(harness.acknowledge).not.toHaveBeenCalled();
  });
});
