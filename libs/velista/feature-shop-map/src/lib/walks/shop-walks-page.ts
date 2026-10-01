import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import {
  ShopDetailStore,
  ShopWalksStore,
} from '@portfolio/velista/data-access';
import { APP_BASE_PATH, type ShopWalkSummary } from '@portfolio/velista/models';
import {
  locationIdOf,
  mappingSettingsPath,
  PageNavigation,
  sheetSegments,
  SHOP_PATHS,
  shopMapPath,
  shopWalkPath,
} from '@portfolio/velista/platform';
import { ChevronLeftIcon, SlidersIcon } from '@portfolio/velista/ui';
import { clockText, dateText, dayName, shopLine } from './walk-text';

/** How a row says when its walk last changed. */
export type WalkChanged =
  | { readonly kind: 'today'; readonly time: string }
  | { readonly kind: 'yesterday'; readonly time: string }
  | { readonly kind: 'date'; readonly date: string };

/**
 * A shop's walks (velista `0122`, target 2; the `Walks` board): one row per walk
 * with its name, "Shown to shoppers" on the one shoppers see, when it last
 * changed, and how many entries and marks it has. A row opens the walk, whose
 * page holds its name, the shoppers switch and Delete (velista `0129`). The bar
 * carries the settings for every walk, and "Start a new walk" sits at the foot,
 * asking for a name in a sheet.
 *
 * `shops/:locationId/walks`, only with `shopMap.record`.
 */
@Component({
  selector: 'lib-shop-walks-page',
  imports: [ChevronLeftIcon, RokuTranslatorPipe, RouterOutlet, SlidersIcon],
  templateUrl: './shop-walks-page.html',
  styleUrl: './shop-walks-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShopWalksPage {
  private readonly _walks = inject(ShopWalksStore);
  private readonly _shops = inject(ShopDetailStore);
  private readonly _pages = inject(PageNavigation);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _locale = inject(RokuLocaleStore).locale;

  protected readonly locationId = locationIdOf(this._route);

  protected readonly read = computed(() =>
    this._walks.walksAt(this.locationId())
  );

  protected readonly subtitle = computed(() => {
    const read = this._shops.read(this.locationId());
    return read.kind === 'shop' ? shopLine(read.shop, this._locale()) : null;
  });

  constructor() {
    effect(() => {
      const locationId = this.locationId();
      if (locationId === '') {
        return;
      }
      untracked(() => {
        void this._walks.loadWalks(locationId);
        void this._shops.ensure(locationId);
      });
    });
  }

  protected changed(walk: ShopWalkSummary): WalkChanged {
    const locale = this._locale();
    const day = dayName(walk.lastChangedAt, locale);
    const time = clockText(walk.lastChangedAt, locale);
    return day.kind === 'date'
      ? { kind: 'date', date: dateText(walk.lastChangedAt, locale) }
      : { kind: day.kind, time };
  }

  protected historyUrl(walk: ShopWalkSummary): string {
    return shopWalkPath(
      this._locale(),
      this._basePath,
      this.locationId(),
      walk.id
    );
  }

  protected open(walk: ShopWalkSummary): void {
    void this._router.navigateByUrl(this.historyUrl(walk));
  }

  protected openMappingSettings(): void {
    void this._router.navigateByUrl(
      mappingSettingsPath(this._locale(), this._basePath, this.locationId())
    );
  }

  protected startNew(): void {
    void this._router.navigate(sheetSegments(SHOP_PATHS.newWalk), {
      relativeTo: this._route,
    });
  }

  protected retry(): void {
    void this._walks.loadWalks(this.locationId());
  }

  /** Back to the map, which is where the Walks button is. */
  protected back(): Promise<void> {
    return this._pages.back(
      shopMapPath(this._locale(), this._basePath, this.locationId())
    );
  }
}
