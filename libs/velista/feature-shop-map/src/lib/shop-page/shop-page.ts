import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import { ShopDetailStore } from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  catalogName,
  roundedFootprint,
  type ShopDetail,
} from '@portfolio/velista/models';
import {
  appPath,
  locationIdOf,
  PageNavigation,
  shopMapPath,
} from '@portfolio/velista/platform';
import {
  FloorAreaIcon,
  MapIcon,
  PageHeader,
  PinIcon,
} from '@portfolio/velista/ui';

/** What the header, the chain line and the address row say, worked out once. */
export interface ShopPageText {
  readonly title: string;
  /** The chain, the first line under the header, or null when the title already is the chain. */
  readonly chain: string | null;
  /** The street, else the town, else null for a shop with no address at all. */
  readonly street: string | null;
  /** The postal code and the town, under the street. */
  readonly place: string | null;
}

/**
 * The words of a shop's page (velista `0121`, target 2): the shop's own name,
 * else its street, else its town, else its chain, as the picker row titles it.
 */
export function shopPageText(shop: ShopDetail, locale: string): ShopPageText {
  const chain = shop.chain === null ? null : catalogName(shop.chain, locale);
  const label = shop.label === null ? null : catalogName(shop.label, locale);
  const street = nonEmpty(shop.address);
  const town = nonEmpty(shop.city);
  const title = label ?? street ?? town ?? chain ?? '';
  const place = [nonEmpty(shop.postalCode), town]
    .filter((part): part is string => part !== null)
    .join(' ');
  return {
    title,
    chain: chain !== null && chain !== title ? chain : null,
    street: street ?? (town !== title ? town : null),
    place: street === null || place === '' ? null : place,
  };
}

function nonEmpty(value: string | null): string | null {
  return value === null || value.trim() === '' ? null : value.trim();
}

/**
 * A shop's own page (velista `0121`, target 2), reached from the round button on
 * every row of the shop picker: its name and chain, its address, its size when
 * OpenStreetMap knows it, "See the map" when it has one, and its sections in the
 * order the shop is walked.
 *
 * `shops/:locationId`. Everything it draws comes from one read, held for the
 * session by `ShopDetailStore`, so going on to the map and back draws it at once.
 */
@Component({
  selector: 'lib-shop-page',
  imports: [FloorAreaIcon, MapIcon, PageHeader, PinIcon, RokuTranslatorPipe],
  templateUrl: './shop-page.html',
  styleUrl: './shop-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShopPage {
  private readonly _shops = inject(ShopDetailStore);
  private readonly _pages = inject(PageNavigation);
  private readonly _router = inject(Router);
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _locale = inject(RokuLocaleStore).locale;

  protected readonly locationId = locationIdOf(inject(ActivatedRoute));

  protected readonly read = computed(() => this._shops.read(this.locationId()));

  protected readonly shop = computed(() => {
    const read = this.read();
    return read.kind === 'shop' ? read.shop : null;
  });

  protected readonly text = computed<ShopPageText | null>(() => {
    const shop = this.shop();
    return shop === null ? null : shopPageText(shop, this._locale());
  });

  /** "1,200", in the reader's own digits, or null to leave the size row out. */
  protected readonly size = computed<string | null>(() => {
    const size = roundedFootprint(this.shop()?.footprintM2 ?? null);
    if (size === null) {
      return null;
    }
    try {
      return new Intl.NumberFormat(this._locale()).format(size);
    } catch {
      return String(size);
    }
  });

  /** The sections, named in the reader's language, in the order they are walked. */
  protected readonly sections = computed(() => {
    const locale = this._locale();
    return (this.shop()?.sections ?? []).map((one) => ({
      id: one.id,
      name: catalogName(one.name, locale),
    }));
  });

  constructor() {
    effect(() => {
      const locationId = this.locationId();
      if (locationId !== '') {
        untracked(() => void this._shops.ensure(locationId));
      }
    });
  }

  protected back(): Promise<void> {
    return this._pages.back(appPath(this._locale(), this._basePath, 'home'));
  }

  protected retry(): void {
    void this._shops.ensure(this.locationId());
  }

  protected openMap(): void {
    void this._router.navigateByUrl(
      shopMapPath(this._locale(), this._basePath, this.locationId())
    );
  }
}
