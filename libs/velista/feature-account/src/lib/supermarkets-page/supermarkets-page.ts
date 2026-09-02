import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import {
  OTHER_CHAINS,
  REALTIME_CLIENT,
  ShoppingProfileStore,
  ShopStore,
  type RealtimeClientI,
} from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  inLocale,
  type Shop,
  type ShoppingProfile,
} from '@portfolio/velista/models';
import {
  appPath,
  PageNavigation,
  profileIdOf,
} from '@portfolio/velista/platform';
import { AppBar, ChevronLeftIcon, SearchIcon } from '@portfolio/velista/ui';
import { AttributionNote } from '../attribution-note/attribution-note';
import { FranchiseButtons } from '../franchise-buttons/franchise-buttons';
import { ShopList, type ShopGroup, type ShopRow } from '../shop-list/shop-list';

/**
 * How long the field is quiet before the search goes out.
 *
 * The same beat the composer's product search uses, for the same reason: a request per
 * character is a request per character on a phone on supermarket signal.
 */
const SEARCH_DEBOUNCE_MS = 250;

/**
 * The screen that picks the shops (plan 0059).
 *
 * A profile knows which postal codes its owner shops in and the catalog knows which shops
 * sit in them. This is the first place in velista where a person sees an actual shop, and
 * the only control that existed before it was a list of chain names, which cannot say
 * "not that one, the one with no parking".
 *
 * ## A page, and a sibling of the profiles page rather than its child
 *
 * The test `0009` section 4.1 set and `0015` reused: it is deep linkable, it has its own
 * scroll, and it is somewhere a person goes deliberately. It is **not** a child of
 * `account/profiles`, which renders its children into a sheet outlet at the bottom of its
 * own scroll: a child route here would draw the whole thing under the profile rows
 * instead of instead of them.
 *
 * ## Two things it never does
 *
 * - **It shows no prices.** Not per shop, not per chain. This is a screen about where you
 *   are willing to go, and a price here would invite the reading that excluding a shop is
 *   how you get a cheaper number.
 * - **It does not filter the catalog.** Excluding every shop leaves every product visible
 *   and every price absent, which is the same state as a profile with no postal code and
 *   is already what the client renders (backend plan 0064, section 3). So there is no
 *   warning here implying otherwise.
 *
 * ## Where the state lives
 *
 * `ShopStore` is provided by this **component** and destroyed with it, because everything
 * it holds is about the screen that is open. A route's providers would outlive the page:
 * the injector a route creates is never destroyed, so its `DestroyRef` never fires.
 *
 * The profile itself comes from the app scoped `ShoppingProfileStore`, which the profiles
 * page has usually already filled in, and is read by **id from the URL** rather than from
 * that store's selection: this page is deep linkable and a selection is not.
 */
@Component({
  selector: 'lib-supermarkets-page',
  imports: [
    RokuTranslatorPipe,
    AppBar,
    AttributionNote,
    ChevronLeftIcon,
    FranchiseButtons,
    SearchIcon,
    ShopList,
  ],
  providers: [ShopStore],
  templateUrl: './supermarkets-page.html',
  styleUrl: './supermarkets-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SupermarketsPage {
  private readonly _profiles = inject(ShoppingProfileStore);
  private readonly _shops = inject(ShopStore);
  private readonly _router = inject(Router);
  private readonly _pages = inject(PageNavigation);
  private readonly _route = inject(ActivatedRoute);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);

  /** For the app bar's offline mark and nothing else. This page subscribes to no room. */
  private readonly _realtime = inject<RealtimeClientI>(REALTIME_CLIENT);

  /** The profile this screen is about, from the URL. */
  protected readonly profileId = profileIdOf(this._route);

  protected readonly profileState = this._profiles.state;
  protected readonly connected = this._realtime.connected;
  protected readonly state = this._shops.state;
  protected readonly shopState = this._shops.shopState;
  protected readonly chains = this._shops.chains;
  protected readonly selection = this._shops.selection;
  protected readonly noShops = this._shops.noShops;

  /** Where the header's lockup leads. Home, from every screen that is not home. */
  protected readonly homeUrl = computed(() =>
    appPath(this._locale(), this._basePath, 'home')
  );

  /** Back, and the page this screen is reached from. */
  protected readonly profilesUrl = computed(() =>
    appPath(this._locale(), this._basePath, 'account', 'profiles')
  );

  /** The profile named by the URL, or null while the list is still being read. */
  protected readonly profile = computed<ShoppingProfile | null>(() => {
    const id = this.profileId();
    return this._profiles.profiles().find((held) => held.id === id) ?? null;
  });

  /** A profile the caller does not have, which is a stale link rather than a failure. */
  protected readonly missing = computed(
    () => this.profileState() === 'loaded' && this.profile() === null
  );

  /**
   * The first empty state, and the only one with an action: the profile says nowhere.
   *
   * The screen cannot be drawn at all, because there is nothing to look in. The way to
   * fix it is `0058`'s screen, which is the profiles page, so this offers the way back
   * rather than an apology.
   */
  protected readonly noPostalCodes = computed(() => {
    const profile = this.profile();
    return profile !== null && profile.postalCodes.length === 0;
  });

  /** What was typed, held per keystroke; the request is debounced below. */
  protected readonly typed = signal('');

  /** Whether a word is being searched, which decides what the body draws. */
  protected readonly searching = computed(() => this._shops.query() !== '');

  /** Every row on screen, with its strings already in the reader's language. */
  private readonly _rows = computed<readonly ShopRow[]>(() => {
    const locale = this._locale();

    return this._shops.shops().map((shop) => ({
      id: shop.id,
      chain: inLocale(shop.chainName, locale),
      name: shop.name === null ? null : inLocale(shop.name, locale),
      where: whereOf(shop),
      postalCode: shop.postalCode,
      excluded: shop.excluded,
      excludedChain: shop.excludedChain,
      failed: this._shops.failed(shop.id),
    }));
  });

  /**
   * The rows, under the postal code they sit in (section 3.3).
   *
   * The profile's own codes come first, in the order the profile holds them, so the
   * headings read in the order somebody typed them rather than in whatever order the
   * catalog answered. A code that is **not** on the profile can still appear, because a
   * postal code brings its neighbours (backend plan 0062), and those follow, sorted, under
   * the code itself.
   */
  protected readonly groups = computed<readonly ShopGroup[]>(() => {
    const profile = this.profile();
    const labels = new Map(
      (profile?.postalCodes ?? []).map((code) => [code.postalCode, code.label])
    );
    const order = new Map(
      (profile?.postalCodes ?? []).map((code, index) => [
        code.postalCode,
        index,
      ])
    );

    const byCode = new Map<string, ShopRow[]>();
    for (const row of this._rows()) {
      const key = row.postalCode ?? '';
      const held = byCode.get(key);
      if (held === undefined) {
        byCode.set(key, [row]);
      } else {
        held.push(row);
      }
    }

    return [...byCode.entries()]
      .sort(
        ([left], [right]) =>
          (order.get(left) ?? Number.MAX_SAFE_INTEGER) -
            (order.get(right) ?? Number.MAX_SAFE_INTEGER) ||
          left.localeCompare(right)
      )
      .map(([code, shops]) => {
        const label = labels.get(code) ?? null;
        return {
          key: code,
          // The label the profile gave the code, falling back to the code, which is the
          // rule `0058` applies to the code list itself.
          heading: label === null || label.trim() === '' ? code : label,
          code: label === null || label.trim() === '' ? null : code,
          shops,
        };
      });
  });

  /**
   * The same rows, ungrouped, which is what a search answers with.
   *
   * A search crosses franchises **and** postal codes, so filing its results under "home"
   * would be answering a question nobody asked. Each row names its chain either way,
   * which is what makes a result identifiable at all (section 3.1).
   */
  protected readonly flat = computed<readonly ShopGroup[]>(() =>
    this._rows().length === 0
      ? []
      : [{ key: 'search', heading: '', code: null, shops: this._rows() }]
  );

  /** Whether any code on screen was derived, which is what makes GeoNames' credit due. */
  protected readonly derivedCodes = computed(() =>
    this._shops.shops().some((shop) => shop.postalCodeDerived)
  );

  /** How many shops a search matched, for the count this page announces. */
  protected readonly matches = computed(() => this._rows().length);

  /** Whether the open franchise's brand is refused, which its one control flips. */
  protected readonly chainExcluded = computed(() => {
    const open = this.selection();
    return (
      open !== null &&
      (this.chains().find((chain) => chain.key === open)?.state ?? 'none') ===
        'chain'
    );
  });

  /** Whether the open franchise is the OTHER bucket, whose control reads in the plural. */
  protected readonly otherOpen = computed(
    () => this.selection() === OTHER_CHAINS
  );

  /** The open franchise's name, for the heading over its rows. */
  protected readonly openName = computed(() => {
    const open = this.selection();
    const name = this.chains().find((row) => row.key === open)?.name ?? null;
    return name === null ? null : inLocale(name, this._locale());
  });

  /** Which profile the shops were read for, so a parameter change re-reads them. */
  private _openedFor: string | null = null;

  constructor() {
    // The profiles, from the store every other screen shares. Usually already read, since
    // this page is reached from the one that reads them, and asked for again on a cold
    // arrival because a deep link has nothing behind it.
    void this._profiles.load();
  }

  /**
   * Read the shops once the profile is known to have somewhere to look.
   *
   * A profile with no postal code is **not** asked about, for `refreshCoverage`'s reason:
   * the endpoint answers `CATALOG_SCOPE_REQUIRED` for one by design, so asking would spend
   * a request on a refusal this page can already work out from the profile it is holding.
   */
  private readonly _open = effect(() => {
    const profile = this.profile();
    if (profile === null || profile.postalCodes.length === 0) {
      return;
    }

    if (this._openedFor === profile.id) {
      return;
    }
    this._openedFor = profile.id;

    untracked(() => void this._shops.open(profile.id));
  });

  /**
   * Ask, at most once per {@link SEARCH_DEBOUNCE_MS} of quiet.
   *
   * No minimum length, unlike the product composer's three characters: "14" is a postal
   * code somebody has half typed and the shops it matches are a handful, where a two
   * letter product search is thousands of rows of noise.
   */
  private readonly _search = effect((onCleanup) => {
    const typed = this.typed();
    if (this._openedFor === null) {
      return;
    }

    // The call is made from a timeout, so it is already outside the reactive context the
    // effect established and needs no `untracked` of its own.
    const timer = setTimeout(() => {
      void this._shops.search(typed);
    }, SEARCH_DEBOUNCE_MS);

    onCleanup(() => clearTimeout(timer));
  });

  /** Back to the profiles page, which is the only place this page is reached from. */
  async back(): Promise<void> {
    await this._pages.back(this.profilesUrl());
  }

  /** The assistant, which is the one app bar button that goes anywhere from here. */
  async openAssistant(): Promise<void> {
    await this._router.navigateByUrl(
      appPath(this._locale(), this._basePath, 'assistant')
    );
  }

  /** The way out of the first empty state: the screen that holds the postal codes. */
  async openProfiles(): Promise<void> {
    await this._router.navigateByUrl(this.profilesUrl());
  }

  onQuery(event: Event): void {
    this.typed.set((event.target as HTMLInputElement).value);
  }

  select(key: string): void {
    void this._shops.select(key);
  }

  toggle(shopId: string): void {
    void this._shops.toggleShop(shopId);
  }

  /** Refuse the open franchise's brand, or take the refusal back. */
  setChainExcluded(excluded: boolean): void {
    const open = this.selection();
    if (open === null) {
      return;
    }

    void this._shops.setChainExcluded(open, excluded);
  }

  retry(): void {
    void this._shops.retry();
  }
}

/** Street and town on one line, or null when the catalog holds neither. */
function whereOf(shop: Shop): string | null {
  const parts = [shop.address, shop.city].filter(
    (part): part is string => part !== null && part.trim() !== ''
  );

  return parts.length === 0 ? null : parts.join(', ');
}
