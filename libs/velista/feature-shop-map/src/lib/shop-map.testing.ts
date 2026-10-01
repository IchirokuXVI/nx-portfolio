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
  WALK_SENSORS,
  WALK_TONES,
  type WalkCompassReading,
  type WalkPoseReading,
  type WalkSensorListener,
  type WalkSensorSession,
  type WalkSensorsI,
  type WalkSensorsRefusal,
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
  /** Whether the fake camera is offered (`immersive-ar`). True by default. */
  readonly camera?: boolean;
}

/**
 * The camera and the compass in a spec (velista `0126`): `supported` answers what
 * the harness was told, `start` hands back a session, and the spec plays readings
 * into it with `pose` and `compass`.
 */
export class FakeWalkSensors implements WalkSensorsI {
  listener: WalkSensorListener | null = null;
  starts = 0;
  ends = 0;
  refuse: WalkSensorsRefusal | null = null;
  /** Whether the camera session holds the screen; a hidden page then is not leaving. */
  showing = true;

  constructor(private readonly _supported: boolean) {}

  async supported(): Promise<boolean> {
    return this._supported;
  }

  async start(
    _root: Element | null,
    listener: WalkSensorListener
  ): Promise<WalkSensorSession | WalkSensorsRefusal> {
    if (this.refuse !== null) {
      return this.refuse;
    }
    this.starts += 1;
    this.listener = listener;
    return {
      showing: () => this.listener !== null && this.showing,
      end: () => {
        this.ends += 1;
        this.listener = null;
      },
    };
  }

  pose(reading: WalkPoseReading): void {
    this.listener?.pose(reading);
  }

  compass(reading: WalkCompassReading): void {
    this.listener?.compass(reading);
  }
}

/** A tracked, upright pose at a point of the walk's frame, facing `heading`. */
export function uprightPose(
  t: number,
  x: number,
  y: number,
  heading: number
): WalkPoseReading {
  const a = ((180 - heading) * Math.PI) / 180;
  return {
    t,
    x,
    y: 1.4,
    z: y,
    qx: 0,
    qy: Math.sin(a / 2),
    qz: 0,
    qw: Math.cos(a / 2),
    tracked: true,
  };
}

/** A compass reading for a bearing. */
export function compassAt(t: number, bearing: number): WalkCompassReading {
  const b = (-bearing * Math.PI) / 180;
  return { t, qx: 0, qy: 0, qz: Math.sin(b / 2), qw: Math.cos(b / 2) };
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
  const sensors = new FakeWalkSensors(options.camera ?? true);
  const tones = { stopped: jest.fn(), resumed: jest.fn() };
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
      useValue: {
        isAuthenticated: () => options.authenticated ?? true,
        userId: () => ((options.authenticated ?? true) ? 'u-1' : null),
      },
    },
    { provide: ActivatedRoute, useValue: route },
    { provide: PageNavigation, useValue: pages },
    { provide: SheetNavigation, useValue: sheets },
    { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
    { provide: WALK_SENSORS, useValue: sensors },
    { provide: WALK_TONES, useValue: tones },
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
    sensors,
    tones,
  };
}

/**
 * What a page's `PageHeader` draws (velista `0130`): which control its left end
 * holds and under what name, its title, and its actions, each by its accessible
 * name or else its word.
 */
export function headerOf(fixture: { readonly nativeElement: unknown }): {
  readonly lead: 'back' | 'close' | null;
  readonly leadLabel: string | null;
  readonly title: string;
  readonly actions: readonly string[];
} {
  const header = (fixture.nativeElement as HTMLElement).querySelector(
    'lib-page-header'
  );
  if (header === null) {
    throw new Error('the page draws no lib-page-header');
  }
  const lead = header.querySelector('.lead');
  const closes = lead?.querySelector('lib-close-icon') ?? null;
  return {
    lead: lead === null ? null : closes === null ? 'back' : 'close',
    leadLabel: lead?.getAttribute('aria-label') ?? null,
    title: header.querySelector('h1')?.textContent?.trim() ?? '',
    actions: Array.from(header.querySelectorAll('[libPageHeaderAction]')).map(
      (action) =>
        action.getAttribute('aria-label') ?? action.textContent?.trim() ?? ''
    ),
  };
}

/** Let the stores' reads land: they are promises the components started. */
export async function settle(detect: () => void): Promise<void> {
  for (let tick = 0; tick < 12; tick++) {
    await Promise.resolve();
  }
  detect();
}
