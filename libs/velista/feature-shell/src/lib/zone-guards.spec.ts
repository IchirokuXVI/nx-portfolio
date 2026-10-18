<<<<<<< HEAD
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  convertToParamMap,
  provideRouter,
  Router,
  UrlSegment,
  UrlTree,
  type ActivatedRouteSnapshot,
  type CanActivateFn,
  type Route,
  type RouterStateSnapshot,
} from '@angular/router';
import { RokuLocaleStore } from '@portfolio/localization/rokutranslator-angular';
import { ZoneStore } from '@portfolio/velista/data-access';
import type { MyZone } from '@portfolio/velista/models';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import {
  listIdGuard,
  zoneIdGuard,
  zoneMemberGuard,
  zoneStaffGuard,
} from './zone-guards';
=======
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, UrlSegment, type Route } from '@angular/router';
import { basketIdGuard, listIdGuard, zoneIdGuard } from './zone-guards';
>>>>>>> origin/dev

/**
 * Plan 0010, rule G1: `zones/:zoneId` matches only a UUID.
 *
 * `routes.spec.ts` asserts that the guard is declared and that it is a `canMatch`;
 * this asserts what it actually decides. The two together are the acceptance
 * criterion, and neither is much use alone.
 *
 * The guard takes segments rather than a param map because at `canMatch` time the
 * route has not been matched and there are no params yet, so it is exercised the same
 * way the router calls it. It injects nothing, deliberately, which is what lets it be
 * called straight rather than through a `TestBed` that would exist only to satisfy an
 * injection context this guard never uses.
 */
function matches(...paths: readonly string[]): boolean {
  const segments = paths.map((path) => new UrlSegment(path, {}));

  return zoneIdGuard({} as Route, segments) as boolean;
}

describe('zoneIdGuard', () => {
  it('matches a real zone id', () => {
    // Every id in the product comes from `@PrimaryGeneratedColumn('uuid')`, so this
    // is checkable rather than agreed.
    expect(matches('zones', '8f14e45f-ceea-4e2c-9e0b-9c1a6a3f2b71')).toBe(true);
  });

  it('declines `new`, which is what keeps the create sheet reachable', () => {
    // The whole point of the rule. Without this, `/zones/new` is swallowed by
    // `:zoneId` and the person who tapped Create a group gets a group page firing
    // `GET /v1/zones/new`.
    expect(matches('zones', 'new')).toBe(false);
  });

  it('declines `join`, the other reserved word under the same prefix', () => {
    expect(matches('zones', 'join')).toBe(false);
  });

  it('declines anything else that is not an id', () => {
    // A mistyped link now falls through to the front door instead of spending a
    // request to be told `not_found`.
    for (const segment of [
      'whatever',
      '123',
      '8f14e45f-ceea-4e2c-9e0b',
      '8f14e45f_ceea_4e2c_9e0b_9c1a6a3f2b71',
      '',
    ]) {
      expect(matches('zones', segment)).toBe(false);
    }
  });

  it('declines a URL with no id segment at all', () => {
    expect(matches('zones')).toBe(false);
  });
});

/**
 * Plan 0012, rule L1: `lists/:listId` matches only a UUID.
 *
 * Rule G1 one level deeper, with the same trap and the same fix. `lists/new` is a
 * child of `zones/:zoneId`, so `zones/:zoneId/lists/:listId` declared beside it is
 * offered `/lists/new` first and matches it with `listId` set to the string `new`.
 *
 * The list page is a **sibling** of `zones/:zoneId` rather than a child, because it is
 * its own destination, so its route matches all four segments and the list id is the
 * fourth rather than the second. That off by two is the thing most likely to be got
 * wrong here, which is why the fixtures below are whole paths.
 */
function listMatches(...paths: readonly string[]): boolean {
  const segments = paths.map((path) => new UrlSegment(path, {}));

  return listIdGuard({} as Route, segments) as boolean;
}

describe('listIdGuard', () => {
  const ZONE = '8f14e45f-ceea-4e2c-9e0b-9c1a6a3f2b71';
  const LIST = '3c9a1d02-5f47-4b8e-9a1c-7d2e6b4f0a35';

  it('matches a real list id in the fourth segment', () => {
    expect(listMatches('zones', ZONE, 'lists', LIST)).toBe(true);
  });

  it('declines `new`, which is what keeps the create sheet reachable', () => {
    // The whole point of the rule. Without it, `/zones/<uuid>/lists/new` is swallowed
    // and the person who tapped Start a list gets a list page firing
    // `GET /v1/lists/new/lines`.
    expect(listMatches('zones', ZONE, 'lists', 'new')).toBe(false);
  });

  it('declines anything else that is not an id', () => {
    for (const segment of [
      'whatever',
      '123',
      '3c9a1d02-5f47-4b8e',
      '3c9a1d02_5f47_4b8e_9a1c_7d2e6b4f0a35',
      '',
    ]) {
      expect(listMatches('zones', ZONE, 'lists', segment)).toBe(false);
    }
  });

  it('declines a URL that stops before the list id', () => {
    expect(listMatches('zones', ZONE, 'lists')).toBe(false);
    expect(listMatches('zones', ZONE)).toBe(false);
  });

  it('reads the fourth segment and not the second', () => {
    // The zone half is `zoneIdGuard`'s job and the two run side by side. A guard that
    // read from the wrong end would match the zone id and let `/lists/new` through.
    expect(listMatches('zones', ZONE, 'lists', 'new')).toBe(false);
    expect(listMatches('zones', 'new', 'lists', LIST)).toBe(true);
  });
});

/**
<<<<<<< HEAD
 * Plan 0157, item 2: the role guards on the sheets under a group load the group when
 * the cache does not hold it, so a cold link to a sheet opens the sheet.
 *
 * The store is a hand built double of the two members the guard reads. Its load writes
 * what the server would answer, or nothing, which is what the real `loadZone` leaves
 * behind on a failure it swallowed.
 */
const GROUP = '8f14e45f-ceea-4e2c-9e0b-9c1a6a3f2b71';
const GROUP_PAGE = `/velista/en/zones/${GROUP}`;

function member(overrides: Partial<MyZone> = {}): MyZone {
  return {
    id: GROUP,
    name: 'Flat 3B',
    joinCode: 'HK7M2QPD',
    status: 'ACTIVE',
    ownerUserId: 'u1',
    myRole: 'MEMBER',
    myStatus: 'APPROVED',
    counts: {
      memberCount: 3,
      listCount: 0,
      pendingRequestCount: 0,
      firstPendingRequesterName: null,
    },
    lists: [],
    ...overrides,
  };
}

function zoneCache(
  cached: MyZone | undefined,
  load: () => Promise<MyZone | undefined>
) {
  const zones = new Map<string, MyZone>();
  if (cached !== undefined) {
    zones.set(cached.id, cached);
  }

  return {
    zoneById: (zoneId: string) => zones.get(zoneId),
    loadZone: jest.fn(async (zoneId: string) => {
      const answer = await load();
      if (answer !== undefined) {
        zones.set(zoneId, answer);
      }
    }),
  };
}

async function roleDecides(
  guard: CanActivateFn,
  store: ReturnType<typeof zoneCache>
): Promise<boolean | string> {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideVelistaTesting({ basePath: '/velista' }),
      { provide: ZoneStore, useValue: store },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
    ],
  });

  // A confirm sheet under the members page: the id is two levels up, as it is on
  // `zones/:zoneId/members/sheet/:membershipId/confirm/*`.
  const route = {
    paramMap: convertToParamMap({ membershipId: 'm-1' }),
    parent: {
      paramMap: convertToParamMap({}),
      parent: { paramMap: convertToParamMap({ zoneId: GROUP }), parent: null },
    },
  } as unknown as ActivatedRouteSnapshot;

  const answer = await TestBed.runInInjectionContext(() =>
    guard(route, {} as RouterStateSnapshot)
  );

  if (answer instanceof UrlTree) {
    return TestBed.inject(Router).serializeUrl(answer);
  }
  return answer as boolean;
}

describe('the role guards on a cold load', () => {
  it('loads the group and lets a member open the member sheet', async () => {
    const store = zoneCache(undefined, async () => member());

    expect(await roleDecides(zoneMemberGuard, store)).toBe(true);
    expect(store.loadZone).toHaveBeenCalledWith(GROUP);
  });

  it('loads the group and lets staff open a staff sheet', async () => {
    const store = zoneCache(undefined, async () => member({ myRole: 'ADMIN' }));

    expect(await roleDecides(zoneStaffGuard, store)).toBe(true);
  });

  it('sends a plain member to the group page from a staff sheet', async () => {
    const store = zoneCache(undefined, async () => member());

    expect(await roleDecides(zoneStaffGuard, store)).toBe(GROUP_PAGE);
  });

  it('sends a member still waiting to the group page', async () => {
    const store = zoneCache(undefined, async () =>
      member({ myStatus: 'PENDING' })
    );

    expect(await roleDecides(zoneMemberGuard, store)).toBe(GROUP_PAGE);
  });

  it('sends a non member to the group page when the read finds nothing', async () => {
    // A stranger's read answers `not_found`, which the store swallows: the cache
    // still holds nothing, and the group page draws the one sentence for it.
    const store = zoneCache(undefined, async () => undefined);

    expect(await roleDecides(zoneMemberGuard, store)).toBe(GROUP_PAGE);
    expect(store.loadZone).toHaveBeenCalledTimes(1);
  });

  it('answers rather than hanging when the load itself rejects', async () => {
    const store = zoneCache(undefined, async () => {
      throw new Error('offline');
    });

    expect(await roleDecides(zoneMemberGuard, store)).toBe(GROUP_PAGE);
  });

  it('reads a cached group without asking the server again', async () => {
    const store = zoneCache(member(), async () => member());

    expect(await roleDecides(zoneMemberGuard, store)).toBe(true);
    expect(store.loadZone).not.toHaveBeenCalled();
  });

  it('refuses a cached group by its role without asking the server again', async () => {
    const store = zoneCache(member(), async () => member({ myRole: 'OWNER' }));

    expect(await roleDecides(zoneStaffGuard, store)).toBe(GROUP_PAGE);
    expect(store.loadZone).not.toHaveBeenCalled();
=======
 * Velista 0156: an id typed in upper case lands on the lower case URL.
 *
 * The pattern accepts both cases, and so does the backend, but the stores key on the id
 * as typed. So an upper case id is not declined: the guard answers a tree with every id
 * lower cased, and the page under it only ever sees the one form. Exercised through a
 * real router, because the tree is built from the navigation the guard runs in.
 */
describe('the id guards on an upper case id', () => {
  const ZONE = '8f14e45f-ceea-4e2c-9e0b-9c1a6a3f2b71';
  const LIST = '3c9a1d02-5f47-4b8e-9a1c-7d2e6b4f0a35';
  const BASKET = '5b2e7c41-9d03-4f6a-8e1b-2c4d6f8a0b13';

  @Component({ template: '' })
  class Blank {}

  function router(): Router {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          {
            // The locale is consumed above the guarded routes, as in the app, so
            // each guard reads its id where the real table puts it.
            path: 'en',
            children: [
              {
                path: 'zones/:zoneId/lists/:listId',
                canMatch: [zoneIdGuard, listIdGuard],
                component: Blank,
              },
              {
                path: 'zones/:zoneId',
                canMatch: [zoneIdGuard],
                component: Blank,
              },
              {
                path: 'shopping-lists/:basketId',
                canMatch: [basketIdGuard],
                component: Blank,
              },
            ],
          },
          { path: '**', component: Blank },
        ]),
      ],
    });
    return TestBed.inject(Router);
  }

  it('listIdGuard answers a tree with the lower case list id', async () => {
    const at = router();
    await at.navigateByUrl(
      `/en/zones/${ZONE}/lists/${LIST.toUpperCase()}?q=milk`
    );
    expect(at.url).toBe(`/en/zones/${ZONE}/lists/${LIST}?q=milk`);
  });

  it('lets an upper case id through outside a navigation, with nothing to rebuild', () => {
    router();
    const segments = ['zones', ZONE, 'lists', LIST.toUpperCase()].map(
      (path) => new UrlSegment(path, {})
    );
    TestBed.runInInjectionContext(() => {
      expect(listIdGuard({} as Route, segments)).toBe(true);
    });
  });

  it('lower cases every id of the URL in one redirect', async () => {
    const at = router();
    await at.navigateByUrl(
      `/en/zones/${ZONE.toUpperCase()}/lists/${LIST.toUpperCase()}`
    );
    expect(at.url).toBe(`/en/zones/${ZONE}/lists/${LIST}`);
  });

  it('zoneIdGuard lands an upper case group id on the lower case URL', async () => {
    const at = router();
    await at.navigateByUrl(`/en/zones/${ZONE.toUpperCase()}`);
    expect(at.url).toBe(`/en/zones/${ZONE}`);
  });

  it('basketIdGuard lands an upper case basket id on the lower case URL', async () => {
    const at = router();
    await at.navigateByUrl(`/en/shopping-lists/${BASKET.toUpperCase()}`);
    expect(at.url).toBe(`/en/shopping-lists/${BASKET}`);
  });

  it('leaves a lower case URL alone', async () => {
    const at = router();
    await at.navigateByUrl(`/en/zones/${ZONE}/lists/${LIST}`);
    expect(at.url).toBe(`/en/zones/${ZONE}/lists/${LIST}`);
>>>>>>> origin/dev
  });
});
