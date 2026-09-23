import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationStart, Router, type Event } from '@angular/router';
import { RokuLocaleStore } from '@portfolio/localization/rokutranslator-angular';
import { APP_BASE_PATH } from '@portfolio/velista/models';
import { Subject } from 'rxjs';
import { TourAnchors } from './tour-anchors';
import type { TourAnchorId, TourHoldings } from './tour-stops';
import {
  TOUR_ANCHOR_WAIT_MS,
  TOUR_HOLDINGS_WAIT_MS,
  TourStore,
} from './tour-store';

const NEW_ACCOUNT: TourHoldings = { hasGroup: false, firstList: null };
const WITH_A_LIST: TourHoldings = {
  hasGroup: true,
  firstList: { zoneId: 'z1', listId: 'l1' },
};

const EVERY_ANCHOR: readonly TourAnchorId[] = [
  'nav',
  'groups',
  'group-lists',
  'basket-tab',
  'assistant',
  'list-composer',
];

/** Enough microtask turns for a stop to navigate, find its anchor and draw. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) {
    await Promise.resolve();
  }
}

function setup(anchors: readonly TourAnchorId[] = EVERY_ANCHOR) {
  const events = new Subject<Event>();
  const navigateByUrl = jest.fn(async () => true);

  TestBed.configureTestingModule({
    providers: [
      TourStore,
      { provide: Router, useValue: { events, navigateByUrl } },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
      { provide: APP_BASE_PATH, useValue: '/velista' },
    ],
  });

  const registry = TestBed.inject(TourAnchors);
  for (const id of anchors) {
    registry.register(id, document.createElement('div'));
  }

  return {
    store: TestBed.inject(TourStore),
    registry,
    events,
    navigateByUrl,
  };
}

describe('TourStore', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('plays four cards for a new account, starting on home', async () => {
    const { store, navigateByUrl } = setup();
    store.setHoldings(NEW_ACCOUNT);

    void store.start();
    await settle();

    expect(navigateByUrl).toHaveBeenCalledWith('/velista/en/home', {
      replaceUrl: true,
    });
    expect(store.card()).toMatchObject({
      stopId: 'nav',
      n: 1,
      total: 4,
      last: false,
      placement: 'above',
    });
  });

  it('plays six cards once there is a group with a list, in the order of section 3', async () => {
    const { store } = setup();
    store.setHoldings(WITH_A_LIST);

    void store.start();
    await settle();

    const seen: string[] = [];
    for (let card = store.card(); card !== null; card = store.card()) {
      seen.push(`${card.stopId} ${card.n}/${card.total}`);
      store.next();
      await settle();
    }

    expect(seen).toEqual([
      'nav 1/6',
      'groups 2/6',
      'lists 3/6',
      'basket 4/6',
      'assistant 5/6',
      'voice 6/6',
    ]);
  });

  it('computes the stops once, so the total does not move mid run', async () => {
    const { store } = setup();
    store.setHoldings(NEW_ACCOUNT);

    void store.start();
    await settle();
    store.setHoldings(WITH_A_LIST);
    store.next();
    await settle();

    expect(store.card()).toMatchObject({ stopId: 'groups', n: 2, total: 4 });
  });

  it('goes to the stop’s own screen first, replacing the entry', async () => {
    const { store, navigateByUrl } = setup();
    store.setHoldings(WITH_A_LIST);

    void store.start();
    await settle();
    for (let step = 0; step < 5; step += 1) {
      store.next();
      await settle();
    }

    expect(navigateByUrl).toHaveBeenCalledWith(
      '/velista/en/shopping-lists/current',
      { replaceUrl: true }
    );
    expect(navigateByUrl).toHaveBeenCalledWith(
      '/velista/en/zones/z1/lists/l1',
      { replaceUrl: true }
    );
    for (const call of navigateByUrl.mock.calls as unknown[][]) {
      expect(call[1]).toEqual({ replaceUrl: true });
    }
  });

  it('drops a stop whose control never appears, and keeps the total', async () => {
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const { store } = setup(['nav', 'basket-tab', 'assistant']);
    store.setHoldings(NEW_ACCOUNT);

    void store.start();
    await settle();
    store.next();
    await settle();

    // Nothing lights `groups` while the window is open.
    expect(store.card()).toBeNull();
    expect(store.running()).toBe(true);

    jest.advanceTimersByTime(TOUR_ANCHOR_WAIT_MS);
    await settle();

    expect(store.card()).toMatchObject({ stopId: 'basket', n: 3, total: 4 });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"groups"'));
    warn.mockRestore();
  });

  it('ends after a dropped last stop, having said "n of total" honestly', async () => {
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const { store } = setup(['nav', 'groups', 'basket-tab']);
    store.setHoldings(NEW_ACCOUNT);

    void store.start();
    await settle();
    store.next();
    await settle();
    store.next();
    await settle();
    expect(store.card()).toMatchObject({ n: 3, total: 4, last: false });

    store.next();
    await settle();
    jest.advanceTimersByTime(TOUR_ANCHOR_WAIT_MS);
    await settle();

    expect(store.running()).toBe(false);
    expect(store.ended()).toBe(1);
    warn.mockRestore();
  });

  it('plans without the account after a while, rather than never starting', async () => {
    const { store } = setup();

    void store.start();
    await settle();
    expect(store.card()).toBeNull();

    jest.advanceTimersByTime(TOUR_HOLDINGS_WAIT_MS);
    await settle();

    expect(store.card()).toMatchObject({ stopId: 'nav', total: 4 });
  });

  it('says Finish on the last card, and finishing ends the run on home', async () => {
    const { store, navigateByUrl } = setup();
    store.setHoldings(NEW_ACCOUNT);

    void store.start();
    await settle();
    for (let step = 0; step < 3; step += 1) {
      store.next();
      await settle();
    }

    expect(store.card()).toMatchObject({ stopId: 'assistant', last: true });
    navigateByUrl.mockClear();

    store.next();
    await settle();

    expect(store.running()).toBe(false);
    expect(store.seen()).toBe(true);
    expect(store.ended()).toBe(1);
    expect(navigateByUrl).toHaveBeenCalledWith('/velista/en/home', {
      replaceUrl: true,
    });
  });

  it('marks it seen once when skipped, however often it is skipped', async () => {
    const { store } = setup();
    store.setHoldings(NEW_ACCOUNT);

    void store.start();
    await settle();
    store.skip();
    store.skip();
    store.finish();

    expect(store.seen()).toBe(true);
    expect(store.ended()).toBe(1);
    expect(store.card()).toBeNull();
  });

  it('ends on the back button, without navigating over the pop', async () => {
    const { store, events, navigateByUrl } = setup();
    store.setHoldings(NEW_ACCOUNT);

    void store.start();
    await settle();
    navigateByUrl.mockClear();

    events.next(new NavigationStart(9, '/velista/en/setup/done', 'popstate'));

    expect(store.running()).toBe(false);
    expect(store.ended()).toBe(1);
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it('ignores its own navigations', async () => {
    const { store, events } = setup();
    store.setHoldings(NEW_ACCOUNT);

    void store.start();
    await settle();
    events.next(new NavigationStart(9, '/velista/en/home', 'imperative'));

    expect(store.running()).toBe(true);
  });

  it('draws nothing more once a run ended while a stop was still loading', async () => {
    const { store } = setup(['nav']);
    store.setHoldings(NEW_ACCOUNT);

    void store.start();
    await settle();
    store.next();
    await settle();
    store.skip();

    jest.advanceTimersByTime(TOUR_ANCHOR_WAIT_MS);
    await settle();

    expect(store.card()).toBeNull();
    expect(store.ended()).toBe(1);
  });

  it('lights the anchor of the card that is up, and nothing once it ends', async () => {
    const { store, registry } = setup();
    store.setHoldings(NEW_ACCOUNT);

    void store.start();
    await settle();
    expect(registry.lit()).toBe('nav');

    store.skip();
    expect(registry.lit()).toBeNull();
  });

  it('plays again after it ended, which is the account row', async () => {
    const { store } = setup();
    store.setHoldings(NEW_ACCOUNT);

    void store.start();
    await settle();
    store.skip();

    store.setHoldings(WITH_A_LIST);
    void store.start();
    await settle();

    expect(store.card()).toMatchObject({ n: 1, total: 6 });
    expect(store.ended()).toBe(1);
  });
});
