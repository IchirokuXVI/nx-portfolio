import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { NearbyShops } from '@portfolio/velista/models';
import {
  fakeGeolocationReader,
  provideFakeGeolocationReader,
  type LocationOutcome,
} from '@portfolio/velista/platform';
import { SHOP_FINDING_READ, ShopFinder } from './shop-finder';
import { toNearbyShops, toRecentShops } from './shop-finder-mappers';
import { ShopFinderMemory } from './shop-finder-memory';
import { SHOP_FINDER_SERVICE } from './shop-finder-service';

const SHOP_VIEW = {
  id: 'loc-1',
  supermarketId: 'sm-1',
  supermarketName: { en: 'Mercadona', es: 'Mercadona' },
  label: null,
  address: 'Calle Mayor 3',
  city: 'Córdoba',
  postalCode: '14001',
  inProfile: true,
};

const PICKED: NearbyShops = toNearbyShops({
  candidates: [{ ...SHOP_VIEW, distanceMetres: 120, excluded: false }],
  pick: { locationId: 'loc-1', distanceMetres: 120 },
  noPick: null,
});

/** A host whose providers are the finder's own, as a picker's container holds it. */
@Component({
  selector: 'lib-finder-host',
  template: '',
  providers: [ShopFinder],
})
class FinderHost {
  readonly finder = inject(ShopFinder);
}

function harness(outcome?: LocationOutcome) {
  const reader = fakeGeolocationReader(
    outcome === undefined ? {} : { outcome }
  );
  const memory = new ShopFinderMemory();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideFakeGeolocationReader(reader),
      { provide: SHOP_FINDER_SERVICE, useValue: memory },
    ],
  });
  const fixture = TestBed.createComponent(FinderHost);
  return { fixture, finder: fixture.componentInstance.finder, reader, memory };
}

/**
 * "Near me" for one open picker (velista `0103`): the position is asked for only
 * when somebody presses, with the picker's own options, and it is held for the one
 * request that carries it.
 */
describe('ShopFinder', () => {
  it('asks nothing on construction', () => {
    const { reader, memory } = harness();

    expect(reader.state.reads).toBe(0);
    expect(memory.calls).toEqual([]);
  });

  it('reads the satellite fix, fresh, within fifteen seconds, with its accuracy', async () => {
    const { finder, reader, memory } = harness({
      state: 'located',
      point: { latitude: 37.88, longitude: -4.78, accuracyMetres: 12 },
    });
    memory.nearby = PICKED;

    const answer = await finder.find((point) =>
      memory.nearBasket('b-1', point)
    );

    expect(reader.state.options).toEqual([SHOP_FINDING_READ]);
    expect(SHOP_FINDING_READ).toEqual({
      enableHighAccuracy: true,
      timeoutMs: 15_000,
      maximumAgeMs: 0,
      withAccuracy: true,
    });
    expect(memory.calls).toEqual(['basket']);
    expect(memory.accuracySent).toEqual([true]);
    expect(answer).toBe(PICKED);
    expect(finder.finding()).toEqual({ state: 'answered', answer: PICKED });
  });

  it('keeps no coordinate once the answer is in', async () => {
    const { finder, memory } = harness({
      state: 'located',
      point: { latitude: 37.123456, longitude: -4.654321, accuracyMetres: 12 },
    });
    memory.nearby = PICKED;

    await finder.find((point) => memory.nearProfile(point));

    const held = JSON.stringify([finder.finding(), finder.recent(), memory]);
    expect(held).not.toContain('37.123456');
    expect(held).not.toContain('-4.654321');
  });

  it.each([
    [{ state: 'denied' } as const, 'denied'],
    [{ state: 'timed-out' } as const, 'timed-out'],
    [{ state: 'unavailable' } as const, 'failed'],
  ])('reads %o as %s and asks no server', async (outcome, state) => {
    const { finder, memory } = harness(outcome);

    const answer = await finder.find((point) =>
      memory.nearBasket('b-1', point)
    );

    expect(answer).toBeNull();
    expect(finder.finding()).toEqual({ state });
    expect(memory.calls).toEqual([]);
  });

  it('reads a server that did not answer as failed', async () => {
    const { finder, memory } = harness();
    memory.failNearby = true;

    await expect(
      finder.find((point) => memory.nearBasket('b-1', point))
    ).resolves.toBeNull();
    expect(finder.finding()).toEqual({ state: 'failed' });
  });

  it('swallows a second press while the first is out', async () => {
    const { finder, reader, memory } = harness();

    const first = finder.find((point) => memory.nearBasket('b-1', point));
    const second = await finder.find((point) =>
      memory.nearBasket('b-1', point)
    );
    await first;

    expect(second).toBeNull();
    expect(reader.state.reads).toBe(1);
  });

  it('acts on nothing once the picker has closed', async () => {
    const { fixture, finder, memory } = harness();
    memory.nearby = PICKED;

    const out = finder.find((point) => memory.nearBasket('b-1', point));
    fixture.destroy();

    await expect(out).resolves.toBeNull();
  });

  it('reads the recent shops when asked, and none when the route fails', async () => {
    const { finder, memory } = harness();
    memory.recent = toRecentShops({
      shops: [{ shop: SHOP_VIEW, lastBoughtAt: '2026-09-24T10:00:00Z' }],
    });

    await finder.loadRecent();
    expect(finder.recent()).toHaveLength(1);

    const failing = harness();
    failing.memory.recentShops = () => Promise.reject(new Error('down'));
    await failing.finder.loadRecent();
    expect(failing.finder.recent()).toEqual([]);
  });
});

describe('the nearby and recent mappers (rule D4)', () => {
  it('copies the pick and never computes one', () => {
    expect(PICKED.pick).toEqual({ locationId: 'loc-1', distanceMetres: 120 });
    expect(PICKED.noPick).toBeNull();

    const none = toNearbyShops({
      candidates: [
        { ...SHOP_VIEW, id: 'a', distanceMetres: 180, excluded: false },
        { ...SHOP_VIEW, id: 'b', distanceMetres: 230, excluded: true },
      ],
      pick: null,
      noPick: 'AMBIGUOUS',
    });
    expect(none.pick).toBeNull();
    expect(none.noPick).toBe('AMBIGUOUS');
    expect(none.candidates.map((shop) => shop.id)).toEqual(['a', 'b']);
    expect(none.candidates[1].excluded).toBe(true);
  });

  it('reads an answer it cannot square as no pick, never as a guess', () => {
    expect(
      toNearbyShops({ candidates: [], pick: { locationId: 7 }, noPick: 'NEW' })
    ).toEqual({ candidates: [], pick: null, noPick: 'NONE_NEARBY' });
    expect(toNearbyShops(null)).toEqual({
      candidates: [],
      pick: null,
      noPick: 'NONE_NEARBY',
    });
  });

  it('keeps the recent shops in the order the server gave, dropping unreadable ones', () => {
    const recent = toRecentShops({
      shops: [
        {
          shop: { ...SHOP_VIEW, id: 'new' },
          lastBoughtAt: '2026-09-24T10:00:00Z',
        },
        { shop: { ...SHOP_VIEW, id: 'bad' }, lastBoughtAt: 'not a date' },
        {
          shop: { ...SHOP_VIEW, id: 'old' },
          lastBoughtAt: '2026-09-01T10:00:00Z',
        },
      ],
    });

    expect(recent.map((row) => row.shop.id)).toEqual(['new', 'old']);
  });
});
