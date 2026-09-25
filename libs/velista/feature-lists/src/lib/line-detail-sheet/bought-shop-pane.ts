import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  output,
  signal,
  viewChild,
  type ElementRef,
} from '@angular/core';
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
  inLocale,
  nearbyPickedShop,
  OTHER_CHAINS,
  type BasketShop,
  type FranchiseButton,
  type Shop,
} from '@portfolio/velista/models';
import {
  ChevronLeftIcon,
  nearbyShopRow,
  NearMeButton,
  recentShopRow,
  ShopPicker,
  shopRowOf,
  type ShopGroup,
  type ShopPickerNear,
  type ShopPickerState,
  type ShopRow,
} from '@portfolio/velista/ui';

/** How long typing waits before it asks, as the other two pickers wait. */
const SEARCH_DEBOUNCE_MS = 250;

/**
 * "Where did you buy it?", the zone list's own shop picker (velista `0114`).
 *
 * **The same body the basket and the get a list sheet open**, `ShopPicker`, with the
 * shops this person bought at recently first, "Near me" in the title row, and then
 * the chains of their default profile with the search across them. There is no
 * basket here, so "Near me" asks the catalog's nearby route and the chains come from
 * the catalog, as in the get a list sheet.
 *
 * A pane inside the line sheet rather than a sheet of its own, for that sheet's
 * reason: a second sheet would destroy this one, and the quantity and the product
 * chosen a moment ago with it.
 *
 * **Every pick is a choice and none is automatic.** "Near me" that finds one shop
 * hands it over like a tap would, because the person pressed the button asking for
 * exactly that; with several it draws them and waits.
 *
 * It holds no choice of its own. The sheet keeps the shop, draws it, and can clear it.
 */
@Component({
  selector: 'lib-bought-shop-pane',
  imports: [ChevronLeftIcon, NearMeButton, RokuTranslatorPipe, ShopPicker],
  providers: [ShopStore, ShopFinder],
  templateUrl: './bought-shop-pane.html',
  styleUrl: './bought-shop-pane.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BoughtShopPane {
  private readonly _shops = inject(ShopStore);
  private readonly _profiles = inject(ShoppingProfileStore);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _finder = inject(ShopFinder);
  private readonly _finderService =
    inject<ShopFinderServiceI>(SHOP_FINDER_SERVICE);

  /** The shop already chosen, so its radio is checked. */
  readonly pickedId = input<string | null>(null);

  /** A shop was chosen, whole, because the step names it afterwards. */
  readonly picked = output<BasketShop>();

  /** The chevron: back to the step, with the choice as it was. */
  readonly back = output<void>();

  private _debounce: ReturnType<typeof setTimeout> | null = null;

  private readonly _backButton =
    viewChild<ElementRef<HTMLButtonElement>>('backButton');

  /** The profile whose chains are offered, once the profiles have arrived. */
  private readonly _profileId = signal<string | null>(null);

  constructor() {
    // Focus on the way back rather than on the search, for the get a list sheet's
    // reason: a focused field raises the keyboard over the chain buttons.
    afterNextRender(() => this._backButton()?.nativeElement.focus());

    // The default profile's chains. Idempotent, and a session that already read
    // the profiles pays nothing. Without a profile there are no chains to offer,
    // and the recent shops and "Near me" still work.
    void this._profiles.load().then(() => {
      const profile =
        this._profiles.profiles().find((row) => row.isDefault) ??
        this._profiles.profiles()[0];
      if (profile !== undefined) {
        this._profileId.set(profile.id);
        void this._shops.open(profile.id);
      }
    });

    void this._finder.loadRecent();

    inject(DestroyRef).onDestroy(() => {
      if (this._debounce !== null) {
        clearTimeout(this._debounce);
      }
    });
  }

  /** What is in the search field, exactly as typed. */
  protected readonly query = signal('');

  /** One button per chain the profile does not refuse. */
  protected readonly chains = computed<readonly FranchiseButton[]>(() =>
    this._shops
      .chains()
      .filter((chain) => chain.state !== 'chain')
      .map((chain) => ({
        ...chain,
        locations: chain.locations - chain.excluded,
        excluded: 0,
        state: 'none' as const,
      }))
      .filter((chain) => chain.locations > 0)
  );

  /** Whether the chains are there to draw. No profile draws an empty, ready list. */
  protected readonly state = computed<ShopPickerState>(() => {
    const state = this._shops.state();
    return state === 'failed'
      ? 'failed'
      : state === 'loaded' || this._profileId() === null
        ? 'ready'
        : 'loading';
  });

  protected readonly openKey = computed(() =>
    this._shops.query() === '' ? this._shops.selection() : null
  );

  protected readonly openName = computed<string | null>(() => {
    const key = this._shops.selection();
    const chain = this.chains().find((row) => row.key === key);
    if (chain === undefined) {
      return null;
    }
    const locale = this._locale();
    return chain.name !== null
      ? inLocale(chain.name, locale)
      : key === OTHER_CHAINS
        ? this._translator.t('shops.other', undefined, locale)
        : null;
  });

  private readonly _offered = computed<readonly Shop[]>(() =>
    this._shops.shops().filter((shop) => !shop.excluded && !shop.excludedChain)
  );

  protected readonly groups = computed<readonly ShopGroup[]>(() => {
    if (this._shops.query() !== '' || this._shops.selection() === null) {
      return [];
    }

    const locale = this._locale();
    const byCode = new Map<string, ShopRow[]>();
    for (const shop of this._offered()) {
      const code = shop.postalCode ?? '';
      const row = shopRowOf(basketShopOf(shop), locale);
      const held = byCode.get(code);
      if (held === undefined) {
        byCode.set(code, [row]);
      } else {
        held.push(row);
      }
    }

    return [...byCode.entries()].map(([code, shops]) => ({
      key: code,
      heading: code,
      code: null,
      shops,
    }));
  });

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
        shops: this._offered().map((shop) =>
          shopRowOf(basketShopOf(shop), locale)
        ),
      },
    ];
  });

  protected readonly matchCount = computed(() =>
    this._shops.query() === '' ? 0 : this._offered().length
  );

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

  protected select(key: string): void {
    if (this._debounce !== null) {
      clearTimeout(this._debounce);
      this._debounce = null;
    }
    this.query.set('');
    void this._shops.select(key);
  }

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

  /**
   * "Near me": the device, then the catalog's route for the caller's default
   * profile. **The server decides**: a pick is handed over, and no pick draws the
   * candidates here.
   */
  protected async findNear(): Promise<void> {
    const profileId = this._profileId() ?? undefined;
    const answer = await this._finder.find((point) =>
      this._finderService.nearProfile(point, profileId)
    );
    const shop = answer === null ? null : nearbyPickedShop(answer);
    if (shop !== null) {
      this.picked.emit(withoutDistance(shop));
    }
  }

  /** A shop's radio, from whichever section drew it. */
  protected pick(locationId: string): void {
    const recent = this._finder
      .recent()
      .find((row) => row.shop.id === locationId);
    if (recent !== undefined) {
      this.picked.emit(recent.shop);
      return;
    }

    const finding = this._finder.finding();
    const near =
      finding.state === 'answered'
        ? finding.answer.candidates.find((row) => row.id === locationId)
        : undefined;
    if (near !== undefined) {
      this.picked.emit(withoutDistance(near));
      return;
    }

    const offered = this._offered().find((row) => row.id === locationId);
    if (offered !== undefined) {
      this.picked.emit(basketShopOf(offered));
    }
  }
}

/** A catalog shop in the shape every other section of the picker names a shop in. */
function basketShopOf(shop: Shop): BasketShop {
  return {
    id: shop.id,
    supermarketId: shop.supermarketId === '' ? null : shop.supermarketId,
    chain: shop.chainName,
    label: shop.name,
    address: shop.address,
    city: shop.city,
    postalCode: shop.postalCode,
    // One of the caller's own profile's shops, which is the one thing a chain
    // button can offer, so there is nothing to say about areas.
    inProfile: null,
  };
}

/** A shop "Near me" named, without what only the moment of asking knew. */
function withoutDistance(shop: BasketShop): BasketShop {
  return {
    id: shop.id,
    supermarketId: shop.supermarketId,
    chain: shop.chain,
    label: shop.label,
    address: shop.address,
    city: shop.city,
    postalCode: shop.postalCode,
    inProfile: shop.inProfile,
  };
}
