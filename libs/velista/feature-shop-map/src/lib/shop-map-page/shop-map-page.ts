import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import { SHOP_MAP_PROPERTIES } from '@portfolio/luna-shopper/shop-map/editor';
import {
  ProfileStore,
  SessionStore,
  ShopDetailStore,
  ShopMapStore,
} from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  shopMapBadges,
  shopMapSectionNamed,
  type ShopMapBadgeCount,
} from '@portfolio/velista/models';
import {
  appPath,
  locationIdOf,
  PageNavigation,
  sheetSegments,
  SHOP_PATHS,
  shopPagePath,
  shopWalksPath,
  ThemeStore,
} from '@portfolio/velista/platform';
import { CheckIcon, ChevronLeftIcon, WalkIcon } from '@portfolio/velista/ui';
import { ShopMapView } from '../shop-map-view/shop-map-view';
import { shopPageText } from '../shop-page/shop-page';

/** Which sections the map marks: the ones on your list, or all of them alike. */
export type ShopMapShow = 'mine' | 'all';

/**
 * The map every shopper sees (velista `0121`, target 3; the `ShopMap` board):
 * "Where things are", the shop under it, "My list · N" and "All sections", the
 * canvas filling the rest of the screen, the legend and the hint.
 *
 * `shops/:locationId/map`, with `?basket=<id or live>` when the basket's Map
 * button opened it. With a basket, every section holding a line carries a badge
 * and the others are dimmed; from the shop page there is no basket, so "My list"
 * is absent and every section shows alike. A tap on a section opens the section
 * sheet over this page.
 */
@Component({
  selector: 'lib-shop-map-page',
  imports: [
    CheckIcon,
    ChevronLeftIcon,
    RokuTranslatorPipe,
    RouterOutlet,
    ShopMapView,
    WalkIcon,
  ],
  templateUrl: './shop-map-page.html',
  styleUrl: './shop-map-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[style.--shop-map-walkway]': 'walkway()[0]',
    '[style.--shop-map-walkway-dot]': 'walkway()[1]',
  },
})
export class ShopMapPage {
  private readonly _maps = inject(ShopMapStore);
  private readonly _shops = inject(ShopDetailStore);
  private readonly _session = inject(SessionStore);
  private readonly _profile = inject(ProfileStore);
  private readonly _pages = inject(PageNavigation);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _theme = inject(ThemeStore).theme;

  protected readonly locationId = locationIdOf(this._route);

  private readonly _query = toSignal(this._route.queryParamMap, {
    initialValue: this._route.snapshot.queryParamMap,
  });

  /** The basket the counts come from, or null for a map opened with none. */
  protected readonly basket = computed(() => {
    const basket = this._query().get(SHOP_PATHS.basketParam);
    return basket === null || basket === '' ? null : basket;
  });

  /**
   * Whether the Walks button is drawn: only for an account that may record a
   * shop's walks (velista `0122`, target 1). It appears when `me` answers, and a
   * guest or an account without the permission never sees it.
   */
  protected readonly canMap = computed(
    () => this._session.isAuthenticated() && this._profile.can('shopMap.record')
  );

  protected readonly status = this._maps.status;
  protected readonly map = this._maps.map;
  protected readonly fromDevice = this._maps.fromDevice;

  private readonly _show = signal<ShopMapShow>('mine');

  /** Whether "My list" is offered: a basket was read at this shop. */
  protected readonly hasList = computed(() => this._maps.lines() !== null);

  protected readonly show = computed<ShopMapShow>(() =>
    this.hasList() ? this._show() : 'all'
  );

  /** How many lines the basket holds at this shop, for "My list · N". */
  protected readonly lineCount = computed(
    () => this._maps.lines()?.length ?? 0
  );

  protected readonly badges = computed<
    Readonly<Record<string, ShopMapBadgeCount>>
  >(() => {
    const map = this.map();
    const lines = this._maps.lines();
    return map === null || lines === null || this.show() !== 'mine'
      ? {}
      : shopMapBadges(map, lines);
  });

  /** "<chain> · <address>" under the title, once the shop has been read. */
  protected readonly subtitle = computed(() => {
    const read = this._shops.read(this.locationId());
    if (read.kind !== 'shop') {
      return null;
    }
    const text = shopPageText(read.shop, this._locale());
    const chain = text.chain ?? text.title;
    const street = text.street !== chain ? text.street : null;
    return [chain, street].filter((part) => part !== null).join(' · ');
  });

  /**
   * The walkway's two colours in the theme on screen, set on this page so the
   * legend's swatch and the canvas draw the same walkway. They are the canvas's
   * own values: velista has no token for a walkway.
   */
  protected readonly walkway = computed(() => {
    const at = this._theme() === 'day' ? 0 : 1;
    return [
      SHOP_MAP_PROPERTIES.walkway[at],
      SHOP_MAP_PROPERTIES['walkway-dot'][at],
    ] as const;
  });

  constructor() {
    effect(() => {
      const locationId = this.locationId();
      const basket = this.basket();
      if (locationId === '') {
        return;
      }
      untracked(() => {
        void this._maps.open(locationId, basket);
        // The shop read takes an account. A guest on a shared basket gets the map
        // and no line under the title.
        if (this._session.isAuthenticated()) {
          void this._shops.ensure(locationId);
        }
      });
    });
  }

  protected setShow(show: ShopMapShow): void {
    this._show.set(show);
  }

  /** A shop's walks, pushed so back returns to this map. */
  protected openWalks(): void {
    void this._router.navigateByUrl(
      shopWalksPath(this._locale(), this._basePath, this.locationId())
    );
  }

  protected retry(): void {
    void this._maps.retry();
  }

  /** A section's area was tapped: its sheet, over this page. */
  protected openSection(name: string): void {
    const map = this.map();
    const section = map === null ? null : shopMapSectionNamed(map, name);
    if (section === null) {
      return;
    }
    void this._router.navigate(sheetSegments('sections', section.sectionId), {
      relativeTo: this._route,
      queryParamsHandling: 'preserve',
    });
  }

  /**
   * Back where the map was opened from. On a cold load, the basket it counts
   * from, or the shop's own page when it counts from none.
   */
  protected back(): Promise<void> {
    const locale = this._locale();
    const basket = this.basket();
    const fallback =
      basket === null
        ? shopPagePath(locale, this._basePath, this.locationId())
        : basket === 'live'
          ? appPath(locale, this._basePath, 'shopping-lists', 'live')
          : appPath(locale, this._basePath, 'shopping-lists', basket);
    return this._pages.back(fallback);
  }
}
