import { signal, type Provider } from '@angular/core';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { RokuLocaleStore } from '@portfolio/localization/rokutranslator-angular';
import {
  BASKET_SERVICE,
  MappingSettingsStore,
  ProfileStore,
  SessionStore,
  SHOP_DETAIL_SERVICE,
  SHOP_MAP_SERVICE,
  SHOP_WALK_SERVICE,
  ShopDetailMemory,
  ShopDetailStore,
  ShopMapMemory,
  ShopMapStore,
  ShopWalkMemory,
  ShopWalksStore,
} from '@portfolio/velista/data-access';
import type { AccountPermission, Basket } from '@portfolio/velista/models';
import {
  PageNavigation,
  provideFakeBrowserFacade,
  provideVelistaTesting,
  SheetNavigation,
} from '@portfolio/velista/platform';
import { BehaviorSubject } from 'rxjs';

/** What a spec of this library can set about the page it renders. */
export interface ShopMapHarnessOptions {
  readonly params?: Record<string, string>;
  readonly query?: Record<string, string>;
  /** The basket the map reads at the shop, for `?basket=`. */
  readonly basket?: Basket;
  readonly authenticated?: boolean;
  /** What `me` answered, or null for "not read yet". Mapping by default. */
  readonly permissions?: readonly AccountPermission[] | null;
}

/**
 * The providers every page and sheet of this library needs in a spec: the real
 * stores over their memory twins, a route, and doubles for the two navigations.
 */
export function shopMapTesting(options: ShopMapHarnessOptions = {}) {
  const details = new ShopDetailMemory();
  const maps = new ShopMapMemory();
  const walks = new ShopWalkMemory();
  const permissions = signal<readonly AccountPermission[] | null>(
    options.permissions === undefined ? ['shopMap.record'] : options.permissions
  );
  const profile = {
    permissions,
    can: (permission: AccountPermission) =>
      permissions()?.includes(permission) ?? false,
    load: jest.fn().mockResolvedValue(undefined),
  };
  const pages = { back: jest.fn().mockResolvedValue(undefined) };
  const sheets = {
    dismiss: jest.fn().mockResolvedValue(undefined),
    leaveTo: jest.fn().mockResolvedValue(undefined),
  };
  const params = convertToParamMap(options.params ?? {});
  const query = convertToParamMap(options.query ?? {});
  const route = {
    paramMap: new BehaviorSubject(params),
    queryParamMap: new BehaviorSubject(query),
    snapshot: { paramMap: params, queryParamMap: query, parent: null },
    parent: null,
  };
  const providers: Provider[] = [
    provideRouter([]),
    provideVelistaTesting(),
    provideFakeBrowserFacade(new Map()),
    ShopDetailStore,
    ShopMapStore,
    ShopWalksStore,
    MappingSettingsStore,
    { provide: SHOP_WALK_SERVICE, useValue: walks },
    { provide: ProfileStore, useValue: profile },
    { provide: SHOP_DETAIL_SERVICE, useValue: details },
    { provide: SHOP_MAP_SERVICE, useValue: maps },
    {
      provide: BASKET_SERVICE,
      useValue: {
        getBasket: async () => options.basket,
        getLiveBasket: async () => options.basket,
      },
    },
    {
      provide: SessionStore,
      useValue: { isAuthenticated: () => options.authenticated ?? true },
    },
    { provide: ActivatedRoute, useValue: route },
    { provide: PageNavigation, useValue: pages },
    { provide: SheetNavigation, useValue: sheets },
    { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
  ];
  return {
    providers,
    details,
    maps,
    walks,
    profile,
    pages,
    sheets,
    route,
  };
}

/** Let the stores' reads land: they are promises the components started. */
export async function settle(detect: () => void): Promise<void> {
  for (let tick = 0; tick < 12; tick++) {
    await Promise.resolve();
  }
  detect();
}
