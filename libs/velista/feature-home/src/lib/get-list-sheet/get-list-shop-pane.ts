import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
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
  type ShopGroup,
  type ShopPickerNear,
  type ShopPickerState,
  type ShopRow,
} from '@portfolio/velista/ui';

/** A shop "Near me" picked, with the distance the message says it was chosen on. */
export interface NearShopPick {
  readonly shop: Shop;
  readonly distanceMetres: number;
}

/**
 * How long typing waits before it asks, so a word costs one request and not one
 * per letter. The supermarkets page waits the same way for the same field.
 */
const SEARCH_DEBOUNCE_MS = 250;

/**
 * The get a list sheet's "Buying at" pane: which shop the new list is bought at
 * (velista `0102`).
 *
 * **The same body the basket's filter sheet opens**, `ShopPicker` from `ui`, over a
 * different source. There is no basket yet, so there are no basket scopes to list:
 * the shops are the chosen profile's, read from the catalog the way the supermarkets
 * page reads them, through a `ShopStore` of this pane's own. A pane inside the sheet
 * rather than a sheet of its own, because a second sheet would destroy this one and
 * everything typed and ticked in it before Generate.
 *
 * **Refused shops are not offered.** A shop or a whole chain the profile refuses is
 * a place the person said they do not go, and the basket's own picker leaves it out
 * too, because its scopes are trimmed of the refusals.
 *
 * It holds no choice of its own. A pick is handed to the sheet, which keeps it until
 * Generate and can change it as often as the person likes.
 *
 * ## Near me, and the shops you bought at (velista `0103`)
 *
 * There is no basket yet, so "Near me" asks the catalog's nearby route, judged
 * against the profile the list will use. When the server picks a shop, the pane
 * hands it to the sheet as a pick made near the person, and the sheet says so. The
 * person is signed in here, so their recent shops head the picker when they have
 * any. A shop from either section can be chosen, including one outside the
 * profile's areas: a list started there is priced there (backend `0163`).
 */
@Component({
  selector: 'lib-get-list-shop-pane',
  imports: [ChevronLeftIcon, NearMeButton, RokuTranslatorPipe, ShopPicker],
  providers: [ShopStore, ShopFinder],
  templateUrl: './get-list-shop-pane.html',
  styleUrl: './get-list-shop-pane.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GetListShopPane {
  private readonly _shops = inject(ShopStore);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _finder = inject(ShopFinder);
  private readonly _finderService =
    inject<ShopFinderServiceI>(SHOP_FINDER_SERVICE);

  /** The profile the list will be priced against, whose shops are offered. */
  readonly profileId = input.required<string>();

  /** The shop already chosen, so its radio is checked. */
  readonly pickedId = input<string | null>(null);

  /** A shop was chosen. The whole row, because the sheet names it afterwards. */
  readonly picked = output<Shop>();

  /**
   * "Near me" picked a shop (velista `0103`). Its own output, because the sheet
   * says this one out loud with its distance, and a pick by hand it does not.
   */
  readonly pickedNear = output<NearShopPick>();

  /** The chevron: back to the form, with nothing chosen. */
  readonly back = output<void>();

  private _debounce: ReturnType<typeof setTimeout> | null = null;

  private readonly _backButton =
    viewChild<ElementRef<HTMLButtonElement>>('backButton');

  constructor() {
    // Focus lands on the way back, the first thing in the pane, rather than on the
    // search: a focused field raises the phone's keyboard over the chain buttons,
    // which are what most people tap.
    afterNextRender(() => this._backButton()?.nativeElement.focus());

    // The profile's chains, read again when the sheet's profile changes under an
    // open pane. By hand rather than through a resolver, because the profile is an
    // input and the pane is drawn inside a sheet that already exists.
    effect(() => {
      const profileId = this.profileId();
      untracked(() => void this._shops.open(profileId));
    });

    // The person is signed in on this sheet, so their recent shops are theirs to
    // see. Asked once, when the pane opens; the device's position is not.
    void this._finder.loadRecent();

    inject(DestroyRef).onDestroy(() => {
      if (this._debounce !== null) {
        clearTimeout(this._debounce);
      }
    });
  }

  /**
   * What is in the search field, exactly as typed, which the field draws at once.
   * The store holds what was last **asked**, trimmed, after the debounce.
   */
  protected readonly query = signal('');

  /**
   * One button per chain the profile does not refuse, counting the shops it does
   * not refuse. OTHER stays: an independent is a place to buy like any other.
   */
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

  /** Whether the chains are there to draw. */
  protected readonly state = computed<ShopPickerState>(() => {
    const state = this._shops.state();
    return state === 'failed'
      ? 'failed'
      : state === 'loaded'
        ? 'ready'
        : 'loading';
  });

  /** The chain whose shops are open, while nothing is typed. */
  protected readonly openKey = computed(() =>
    this._shops.query() === '' ? this._shops.selection() : null
  );

  /**
   * The open chain's name, for the heading over its shops. OTHER has no name of
   * its own, so the screen names it, as the supermarkets page does.
   */
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

  /** The shops on screen that the profile does not refuse. */
  private readonly _offered = computed<readonly Shop[]>(() =>
    this._shops.shops().filter((shop) => !shop.excluded && !shop.excludedChain)
  );

  /** The open chain's shops under their postal codes, as the basket's picker draws them. */
  protected readonly groups = computed<readonly ShopGroup[]>(() => {
    if (this._shops.query() !== '' || this._shops.selection() === null) {
      return [];
    }

    const locale = this._locale();
    const byCode = new Map<string, ShopRow[]>();
    for (const shop of this._offered()) {
      const code = shop.postalCode ?? '';
      const held = byCode.get(code);
      const row = toRow(shop, locale);
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
        shops: this._offered().map((shop) => toRow(shop, locale)),
      },
    ];
  });

  protected readonly matchCount = computed(() =>
    this._shops.query() === '' ? 0 : this._offered().length
  );

  /**
   * Something was typed. The field shows it at once and the catalog is asked once
   * the typing stops, across every chain (`0059`, section 3.1).
   */
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
   * A chain button: open it, or close it when it is open. The search is cleared,
   * which is `ShopStore.select`'s own rule, and a search still waiting to be asked
   * is dropped with it.
   */
  protected select(key: string): void {
    if (this._debounce !== null) {
      clearTimeout(this._debounce);
      this._debounce = null;
    }
    this.query.set('');
    void this._shops.select(key);
  }

  /** Whether "Near me" is working, which is what the button says. */
  protected readonly finding = computed(
    () => this._finder.finding().state === 'locating'
  );

  /** What "Near me" answered, as the picker draws it. */
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

  /** The person's recent shops, newest first, with the day of the last purchase. */
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
   * "Near me" was pressed: ask the device, then the catalog's route for the
   * profile the list will use. **The server decides**: a pick goes to the sheet,
   * and no pick draws the candidates here.
   */
  protected async findNear(): Promise<void> {
    const profileId = this.profileId();
    const answer = await this._finder.find((point) =>
      this._finderService.nearProfile(point, profileId)
    );
    const shop = answer === null ? null : nearbyPickedShop(answer);
    const pick = answer?.pick ?? null;
    if (shop !== null && pick !== null) {
      this.pickedNear.emit({
        shop: shopOf(shop, shop.excluded),
        distanceMetres: pick.distanceMetres,
      });
    }
  }

  /**
   * A shop's radio: hand the whole shop to the sheet, from whichever section drew
   * it. The open chain's first, then the recent ones, then the ones near the device.
   */
  protected pick(locationId: string): void {
    const offered = this._offered().find((row) => row.id === locationId);
    if (offered !== undefined) {
      this.picked.emit(offered);
      return;
    }

    const recent = this._finder
      .recent()
      .find((row) => row.shop.id === locationId);
    if (recent !== undefined) {
      this.picked.emit(shopOf(recent.shop, false));
      return;
    }

    const finding = this._finder.finding();
    const near =
      finding.state === 'answered'
        ? finding.answer.candidates.find((row) => row.id === locationId)
        : undefined;
    if (near !== undefined) {
      this.picked.emit(shopOf(near, near.excluded));
    }
  }
}

/**
 * A shop the server named, as the catalog's `Shop` the sheet keeps until Generate.
 * The sheet reads its id, chain, name, street, town and postal code, and nothing
 * else of it.
 */
function shopOf(shop: BasketShop, excluded: boolean): Shop {
  return {
    id: shop.id,
    supermarketId: shop.supermarketId ?? '',
    chainName: shop.chain,
    name: shop.label,
    address: shop.address,
    city: shop.city,
    postalCode: shop.postalCode,
    postalCodeDerived: false,
    provider: null,
    excluded,
    excludedChain: false,
  };
}

/** One catalog shop as the list draws it, in the reader's language. */
function toRow(shop: Shop, locale: string): ShopRow {
  const where = [shop.address, shop.city]
    .filter((part): part is string => part !== null && part.trim() !== '')
    .join(', ');
  return {
    id: shop.id,
    chain: inLocale(shop.chainName, locale),
    name: shop.name === null ? null : inLocale(shop.name, locale),
    where: where === '' ? null : where,
    postalCode: shop.postalCode,
    excluded: false,
    excludedChain: false,
    failed: false,
  };
}
