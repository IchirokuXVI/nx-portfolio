import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  convertToParamMap,
  provideRouter,
  Router,
  UrlSegment,
  UrlTree,
  type ActivatedRouteSnapshot,
  type Route,
  type RouterStateSnapshot,
} from '@angular/router';
import { RokuLocaleStore } from '@portfolio/localization/rokutranslator-angular';
import { ProfileStore, SessionStore } from '@portfolio/velista/data-access';
import type { AccountPermission } from '@portfolio/velista/models';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { shopMapRecordGuard, walkIdGuard } from './shop-map-guards';

function profile(held: readonly AccountPermission[] | null, loaded = held) {
  const permissions = signal(held);
  return {
    permissions,
    can: (permission: AccountPermission) =>
      permissions()?.includes(permission) ?? false,
    load: jest.fn(async () => permissions.set(loaded)),
  };
}

async function decide(store: ReturnType<typeof profile>, signedIn = true) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideVelistaTesting(),
      { provide: ProfileStore, useValue: store },
      { provide: SessionStore, useValue: { isAuthenticated: () => signedIn } },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
    ],
  });
  const route = {
    paramMap: convertToParamMap({}),
    parent: {
      paramMap: convertToParamMap({ locationId: 'loc-1' }),
      parent: null,
    },
  } as unknown as ActivatedRouteSnapshot;
  const answer = await TestBed.runInInjectionContext(() =>
    shopMapRecordGuard(route, {} as RouterStateSnapshot)
  );
  return answer instanceof UrlTree
    ? TestBed.inject(Router).serializeUrl(answer)
    : answer;
}

/** Velista `0122`: nothing of a shop's walks without `shopMap.record`. */
describe('shopMapRecordGuard', () => {
  it('lets a mapper through', async () => {
    expect(await decide(profile(['shopMap.record']))).toBe(true);
  });

  it('sends anybody else to the shop’s map', async () => {
    expect(await decide(profile([]))).toMatch(/\/en\/shops\/loc-1\/map$/);
  });

  it('waits for me when it does not know yet, and asks once', async () => {
    const store = profile(null, ['shopMap.record']);

    expect(await decide(store)).toBe(true);
    expect(store.load).toHaveBeenCalledTimes(1);
  });

  it('leaves a signed out visitor to the sign in guard, and reads nothing', async () => {
    const store = profile(null);

    expect(await decide(store, false)).toBe(true);
    expect(store.load).not.toHaveBeenCalled();
  });

  it('turns them away when me does not answer', async () => {
    expect(await decide(profile(null, null))).toMatch(/\/shops\/loc-1\/map$/);
  });
});

describe('walkIdGuard', () => {
  const matches = (...paths: string[]) =>
    walkIdGuard(
      {} as Route,
      paths.map((path) => new UrlSegment(path, {}))
    );

  it('reads only a uuid as a walk', () => {
    expect(
      matches('shops', 'loc-1', 'walks', '7a1c0f5e-0122-4a00-8000-000000000001')
    ).toBe(true);
    expect(matches('shops', 'loc-1', 'walks', 'settings')).toBe(false);
    expect(matches('shops', 'loc-1', 'walks', 'sheet', 'new')).toBe(false);
    expect(matches('shops', 'loc-1', 'walks')).toBe(false);
  });
});
