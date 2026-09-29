import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import {
  SHOP_FINDER_SERVICE,
  ShopFinder,
  ShoppingProfileStore,
  ShopStore,
  type ShopFinderServiceI,
} from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  catalogName,
  nearbyPickedShop,
  OTHER_CHAINS,
  type FranchiseButton,
  type Shop,
} from '@portfolio/velista/models';
import { appPath, PageNavigation } from '@portfolio/velista/platform';
import {
  catalogShopRow,
  ChainLogo,
  ChevronLeftIcon,
  groupByPostalCode,
  nearbyShopRow,
  NearMeButton,
  offeredChains,
  recentShopRow,
  ShopPicker,
  type ChainLogoView,
  type ShopGroup,
  type ShopPickerAny,
  type ShopPickerNear,
  type ShopPickerState,
  type ShopRow,
} from '@portfolio/velista/ui';
import {
  catalogChoiceOf,
  catalogQueryOf,
  type CatalogChoice,
} from '../supermarket-choice';

/** How long typing waits before it asks, as the other pickers wait. */
const SEARCH_DEBOUNCE_MS = 250;

/** The route parameter that names the open chain. */
export const SUPERMARKET_PARAM = 'supermarketId';

/**
 * The catalog's supermarket picker (velista `0124`, target 8): a page of its own at
 * `catalog/supermarket`, and one chain's screen at `catalog/supermarket/:id`.
 *
 * ## Why a page, when the basket's picker is a sheet
 *
 * The catalog is a tab, and a choice here changes the whole tab, so its picker is a
 * page with a URL that back leaves. The body is `ShopPicker`, the one the basket's
 * sheets draw, so the two cannot drift: only the frame differs (section 1).
 *
 * ## A chain is enough
 *
 * Only here is there an any row: All supermarkets at the root, and Any Mercadona
 * shop at the top of a chain. Those are how a chain alone is chosen. A shop is
 * optional.
 *
 * ## Every answer replaces this entry
 *
 * A pick, an any row or a Near me pick goes to the catalog with the choice in its
 * URL and **replaces** the picker's entry, so back from the catalog does not reopen
 * the picker. A chain button replaces the root the same way, and the chain's chevron
 * replaces it back, so however the person wanders the history holds one entry for
 * the picker and it is the one an answer replaces.
 *
 * ## Shops
 *
 * From `ShopStore` over the default profile, refused chains out and states forced to
 * none, as the get a list sheet offers them. Near me asks the catalog's nearby
 * route for that profile, and its candidates sit above the any row.
 */
@Component({
  selector: 'lib-catalog-supermarket-page',
  imports: [
    ChainLogo,
    ChevronLeftIcon,
    NearMeButton,
    RokuTranslatorPipe,
    ShopPicker,
  ],
  providers: [ShopStore, ShopFinder],
  templateUrl: './supermarket-page.html',
  styleUrl: './supermarket-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CatalogSupermarketPage {
  private readonly _shops = inject(ShopStore);
  private readonly _profiles = inject(ShoppingProfileStore);
  private readonly _finder = inject(ShopFinder);
  private readonly _finderService =
    inject<ShopFinderServiceI>(SHOP_FINDER_SERVICE);
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _pages = inject(PageNavigation);

  /** The open chain, from the route, or null at the root. Fixed for this page. */
  protected readonly openKey: string | null =
    this._route.snapshot.paramMap.get(SUPERMARKET_PARAM);

  /** The catalog's choice as the picker was handed it, for the checks and the way back. */
  private readonly _choice: CatalogChoice = catalogChoiceOf(
    this._route.snapshot.queryParamMap
  );

  private readonly _profileId = signal<string | null>(null);

  /** What is in the field, exactly as typed. */
  protected readonly query = signal('');

  private _debounce: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // The default profile's chains, then the open chain's shops. Without a profile
    // there are no chains to offer, and the recent shops and Near me still work.
    void this._profiles.load().then(async () => {
      const profile =
        this._profiles.profiles().find((row) => row.isDefault) ??
        this._profiles.profiles()[0];
      if (profile === undefined) {
        return;
      }
      this._profileId.set(profile.id);
      await this._shops.open(profile.id);
      if (this.openKey !== null) {
        await this._shops.select(this.openKey);
      }
    });

    if (this.openKey === null) {
      void this._finder.loadRecent();
    }

    inject(DestroyRef).onDestroy(() => {
      if (this._debounce !== null) {
        clearTimeout(this._debounce);
      }
    });
  }

  protected readonly chains = computed<readonly FranchiseButton[]>(() =>
    offeredChains(this._shops.chains())
  );

  protected readonly state = computed<ShopPickerState>(() => {
    const state =
      this.openKey === null ? this._shops.state() : this._shops.shopState();
    return state === 'failed'
      ? 'failed'
      : state === 'loaded' || this._profileId() === null
        ? 'ready'
        : 'loading';
  });

  /** The shops on screen that the profile does not refuse. */
  private readonly _offered = computed<readonly Shop[]>(() =>
    this._shops.shops().filter((shop) => !shop.excluded && !shop.excludedChain)
  );

  /** The open chain's shops under their postal codes. */
  protected readonly groups = computed<readonly ShopGroup[]>(() => {
    if (this.openKey === null || this._shops.query() !== '') {
      return [];
    }
    const locale = this._locale();
    return groupByPostalCode(
      this._offered().map((shop) => catalogShopRow(shop, locale))
    );
  });

  /** What a search matched, as one run, while something is typed. */
  protected readonly matches = computed<readonly ShopGroup[]>(() => {
    if (this._shops.query() === '' || this._offered().length === 0) {
      return [];
    }
    const locale = this._locale();
    return [
      {
        key: 'search',
        heading: '',
        code: null,
        shops: this._offered().map((shop) => catalogShopRow(shop, locale)),
      },
    ];
  });

  protected readonly matchCount = computed(() =>
    this._shops.query() === '' ? 0 : this._offered().length
  );

  /** The open chain's head: the logo at 56px, the name and the count. */
  protected readonly head = computed<{
    readonly name: string;
    readonly logo: ChainLogoView;
    readonly count: number;
  } | null>(() => {
    const chain = this.chains().find((row) => row.key === this.openKey);
    if (chain === undefined) {
      return null;
    }
    const name = this._chainName(chain);
    return {
      name,
      logo: { logoUrl: chain.logoUrl, name, store: chain.name === null },
      count: chain.locations,
    };
  });

  /** All supermarkets at the root, Any Mercadona shop on a chain's screen. */
  protected readonly anyRow = computed<ShopPickerAny | null>(() => {
    const locale = this._locale();
    this._translator.loaded();
    const t = (key: string, args?: Record<string, unknown>) =>
      this._translator.t(key, undefined, locale, args);

    if (this.openKey === null) {
      return {
        title: t('catalog.supermarket.all'),
        detail: t('catalog.supermarket.allDetail'),
        logo: { logoUrl: null, name: '', store: true },
        checked: this._choice.chain === null,
      };
    }
    const head = this.head();
    // OTHER is several independents rather than one chain, and the catalog narrows
    // to one chain, so it has no "any" row: its shops are chosen one by one.
    if (head === null || this.openKey === OTHER_CHAINS) {
      return null;
    }
    return {
      title: t('catalog.supermarket.any', { chain: head.name }),
      detail: t('catalog.supermarket.anyDetail', { chain: head.name }),
      logo: head.logo,
      checked:
        this._choice.chain === this.openKey && this._choice.shop === null,
    };
  });

  /** The shop in the catalog's URL, whose radio is checked. */
  protected readonly pickedId = this._choice.shop;

  /** The chain in the catalog's URL, whose button draws a tick. */
  protected readonly pickedChain = this._choice.chain;

  protected readonly finding = computed(
    () => this._finder.finding().state === 'locating'
  );

  protected readonly near = computed<ShopPickerNear>(() => {
    const finding = this._finder.finding();
    if (finding.state !== 'answered') {
      return { state: finding.state };
    }
    const locale = this._locale();
    return {
      state: 'answered',
      reason: finding.answer.noPick,
      candidates: finding.answer.candidates.map((shop) =>
        nearbyShopRow(shop, locale)
      ),
    };
  });

  protected readonly recent = computed<readonly ShopRow[]>(() => {
    const locale = this._locale();
    const words = {
      today: this._translator.t(
        'basket.view.shop.recent.today',
        undefined,
        locale
      ),
      yesterday: this._translator.t(
        'basket.view.shop.recent.yesterday',
        undefined,
        locale
      ),
    };
    return this._finder
      .recent()
      .map((recent) => recentShopRow(recent, locale, words));
  });

  /** Something was typed: shown at once, asked for across every chain after a pause. */
  protected onQuery(query: string): void {
    this.query.set(query);
    if (this._debounce !== null) {
      clearTimeout(this._debounce);
    }
    this._debounce = setTimeout(() => {
      this._debounce = null;
      void this._shops.search(query);
    }, SEARCH_DEBOUNCE_MS);
  }

  /**
   * A chain button: that chain's screen, in place of this entry (see the class
   * comment), with the catalog's choice carried along.
   */
  protected openChain(key: string): void {
    void this._router.navigateByUrl(this._pickerUrl(key), {
      replaceUrl: true,
    });
  }

  /** The any row: every supermarket at the root, the whole chain on its screen. */
  protected chooseAny(): void {
    this._answer(
      this.openKey === null
        ? { chain: null, shop: null }
        : { chain: this.openKey, shop: null }
    );
  }

  /** A shop's radio, from whichever section drew it. A shop also sets its chain. */
  protected pick(locationId: string): void {
    this._answer({ chain: this._chainOf(locationId), shop: locationId });
  }

  /**
   * Near me: ask the device, then the catalog's route for the default profile. The
   * server decides; a pick goes straight to the catalog.
   */
  protected async findNear(): Promise<void> {
    const profileId = this._profileId() ?? undefined;
    const answer = await this._finder.find((point) =>
      this._finderService.nearProfile(point, profileId)
    );
    const shop = answer === null ? null : nearbyPickedShop(answer);
    if (shop !== null) {
      this._answer({ chain: shop.supermarketId, shop: shop.id });
    }
  }

  /**
   * The chevron. At the root it is back to the catalog, or the catalog on a cold
   * load. On a chain's screen it is the root again, in place of this entry, which
   * is how the chain was reached.
   */
  protected async back(): Promise<void> {
    if (this.openKey !== null) {
      await this._router.navigateByUrl(this._pickerUrl(null), {
        replaceUrl: true,
      });
      return;
    }
    await this._pages.back(
      this._router.serializeUrl(this._catalogUrl(this._choice))
    );
  }

  /** Go to the catalog with this answer, replacing the picker's entry. */
  private _answer(answer: {
    readonly chain: string | null;
    readonly shop: string | null;
  }): void {
    void this._router.navigateByUrl(
      this._catalogUrl({ category: this._choice.category, ...answer }),
      { replaceUrl: true }
    );
  }

  /** The chain of a shop this page offered, or null when none of them names it. */
  private _chainOf(locationId: string): string | null {
    const offered = this._offered().find((shop) => shop.id === locationId);
    if (offered !== undefined) {
      return offered.supermarketId;
    }
    const recent = this._finder
      .recent()
      .find((row) => row.shop.id === locationId);
    if (recent !== undefined) {
      return recent.shop.supermarketId;
    }
    const finding = this._finder.finding();
    return finding.state === 'answered'
      ? (finding.answer.candidates.find((shop) => shop.id === locationId)
          ?.supermarketId ?? null)
      : null;
  }

  private _chainName(chain: FranchiseButton): string {
    const locale = this._locale();
    return chain.name !== null
      ? catalogName(chain.name, locale)
      : chain.key === OTHER_CHAINS
        ? this._translator.t('shops.other', undefined, locale)
        : '';
  }

  private _catalogUrl(choice: CatalogChoice) {
    const url = this._router.parseUrl(
      appPath(this._locale(), this._basePath, 'catalog')
    );
    url.queryParams = catalogQueryOf(choice);
    return url;
  }

  private _pickerUrl(chain: string | null) {
    const segments = chain === null ? ['supermarket'] : ['supermarket', chain];
    const url = this._router.parseUrl(
      appPath(this._locale(), this._basePath, 'catalog', ...segments)
    );
    url.queryParams = catalogQueryOf(this._choice);
    return url;
  }
}
