import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import {
  BasketStore,
  BasketViewStore,
  SHOP_FINDER_SERVICE,
  ShopFinder,
  ShopPickNotices,
  type ShopFinderServiceI,
} from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  catalogName,
  foldForSearch,
  nearbyPickedShop,
  type BasketPriceScope,
  type FranchiseButton,
  type ShopSectionName,
} from '@portfolio/velista/models';
import {
  GEOLOCATION_READER,
  SheetNavigation,
  shopPageOpener,
  type GeolocationReaderI,
} from '@portfolio/velista/platform';
import {
  ChainLogo,
  ChevronLeftIcon,
  CloseIcon,
  groupByPostalCode,
  nearbyShopRow,
  NearMeButton,
  pickRowOf,
  recentShopRow,
  SheetShell,
  ShopPicker,
  type ChainLogoView,
  type ShopGroup,
  type ShopPickerNear,
  type ShopRow,
} from '@portfolio/velista/ui';
import { basketPath, filterSheetPath } from '../basket-paths';
import { HeldBuy } from '../held-buy';

/**
 * One shop of the basket, flattened out of the scope it belongs to.
 *
 * Picking one picks **the shop** since velista `0102`, and not its scope: the shop
 * is where the person is standing, which prices the rows, marks what it lacks and
 * is recorded on every purchase. The server decides the price there, so nothing
 * here carries a scope any more.
 */
interface PickerShop {
  /** The location's own id, which is what a radio is keyed by and what is chosen. */
  readonly id: string;
  readonly chainKey: string;
  readonly chain: string;
  readonly name: string | null;
  readonly address: string | null;
  readonly city: string | null;
  readonly postalCode: string | null;
  readonly logoUrl: string | null;
  readonly sections: readonly ShopSectionName[];
}

/**
 * Which shop the person is buying at (velista `0078`, section 4; `0102`).
 *
 * A sheet of its own rather than a third radio group on the filter sheet, because a
 * profile can hold fifty shops. The body is `ShopPicker` from `ui`, which the get a
 * list sheet draws too; this is its container over **the shops the basket read
 * carried**, and it decides what they are, which chain is open and what a search
 * matched.
 *
 * ## It holds no state of its own
 *
 * The pick is `BasketViewStore.shop`, written the moment a row is tapped, so it
 * survives leaving this sheet and `0076` remembers it for two hours. What is local
 * is which chain is open and what is typed, and neither is worth surviving anything:
 * both are answers to "where am I looking", and coming back to this sheet is coming
 * back to look again.
 *
 * ## Pushed over the filter sheet, and popped back onto it both ways
 *
 * The filter sheet pushes this one, and every way out of here pops: the chevron,
 * the scrim, Escape, the phone's back gesture and a pick all land on the filter
 * sheet, exactly once (`0031`). The filter sheet's URL is the fallback for a cold
 * load on this sheet's own address.
 *
 * ## A guest picks from the same shops
 *
 * Backend `0163` serves every participant the shops, so a guest's picker is the
 * owner's picker. The chain buttons that used to pick a whole scope for a reader
 * with no shops are gone with the scope: a chain is not a place to stand in.
 *
 * ## Near me, and the shops you bought at (velista `0103`)
 *
 * "Near me" asks the device where it is only when pressed, and then the basket's
 * own nearby route, which any participant may ask, a guest included. The answer
 * is judged against the owner's profile, and a guest may choose a nearby shop the
 * owner never listed, because a read at any shop is priced (backend `0163`). When
 * the server picks a shop, it is set, the picker closes, and the filter sheet it
 * lands on says what was chosen. Otherwise the candidates are drawn at the top.
 *
 * The recent shops are the signed in reader's own, asked for once when the reader
 * is known and never for a guest.
 *
 * ## The question at the first buy of a trip (velista `0141`)
 *
 * The same sheet at `sheet/shop` over the basket, with `data.shopAsk`: the first
 * buy of a trip with no shop chosen opens it and waits in {@link HeldBuy}. It adds
 * "No shop" as a row, a foot with "Don't ask again", and a cross where the
 * chevron back to the filter would be. Every way out releases the buy, and leaves
 * for the basket rather than for the filter.
 *
 * It looks for the shop without a press **only when the browser already allows
 * location**, which `permission()` answers without asking anybody. When it finds
 * shops, the nearest is selected and the title asks "Are you buying here?". When it
 * finds none, or cannot look, the sheet is the plain picker and says nothing about
 * the look it made: nobody asked for it.
 */
@Component({
  selector: 'lib-shop-picker-sheet',
  imports: [
    ChainLogo,
    ChevronLeftIcon,
    CloseIcon,
    NearMeButton,
    RokuTranslatorPipe,
    SheetShell,
    ShopPicker,
  ],
  providers: [ShopFinder],
  templateUrl: './shop-picker-sheet.html',
  styleUrl: './shop-picker-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShopPickerSheet {
  /** A shop row's round button: that shop's own page (velista `0121`). */
  protected readonly openShop = shopPageOpener();

  private readonly _view = inject(BasketViewStore);
  private readonly _sheet = inject(SheetNavigation);
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _locale = inject(RokuLocaleStore).locale;

  /**
   * The basket underneath, which is what both ways out of here are built on.
   *
   * From the **store** and not from `paramMap` since velista `0091`: the same
   * page is routed at `shopping-lists/live`, where there is no id in the URL at
   * all, and a sheet that read one there would dismiss to `/shopping-lists/`.
   */
  private readonly _address = inject(BasketStore).address;

  private readonly _basket = inject(BasketStore);
  private readonly _finder = inject(ShopFinder);
  private readonly _finderService =
    inject<ShopFinderServiceI>(SHOP_FINDER_SERVICE);
  private readonly _notices = inject(ShopPickNotices);
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _held = inject(HeldBuy);
  private readonly _reader = inject<GeolocationReaderI>(GEOLOCATION_READER);
  private readonly _router = inject(Router);

  /** Whether this is the question at the first buy (velista `0141`). */
  protected readonly asking =
    inject(ActivatedRoute).snapshot.data?.['shopAsk'] === true;

  /**
   * Whether the last look for shops near the device was the one made without a
   * press. Its failures are not drawn, and its answer is what selects a shop.
   */
  private readonly _lookedByItself = signal(false);

  /** Whether the question was answered, so the teardown does not answer it again. */
  private _answered = false;

  constructor() {
    // The recent shops, once the reader is known, and only for somebody signed
    // in. By an effect and not in the constructor, because under
    // `shopping-lists/live` a cold load builds this sheet before the basket, and
    // its reader, have arrived.
    let asked = false;
    effect(() => {
      const me = this._basket.me();
      if (asked || me === null || me.kind === 'GUEST') {
        return;
      }
      asked = true;
      untracked(() => void this._finder.loadRecent());
    });

    // The question looks for the shop by itself once the basket is known, and only
    // where the browser already allows it (velista `0141`, section 2).
    let looked = false;
    effect(() => {
      const basketId = this._basket.basket()?.id;
      if (!this.asking || looked || basketId === undefined) {
        return;
      }
      looked = true;
      untracked(() => void this._lookIfAllowed(basketId));
    });

    // Any way out to the basket that did not answer is an answer for the trip
    // with no shop, the back gesture included, which only destroys this sheet.
    // The buy is written. A way out that leaves the basket itself answers
    // nothing, and the buy is dropped: the page lets the basket go as it leaves.
    inject(DestroyRef).onDestroy(() => {
      if (!this.asking || this._answered) {
        return;
      }
      this._answered = true;
      if (this._leavesBasket()) {
        this._held.drop();
        return;
      }
      this._view.answerShopForTrip();
      void this._held.release();
    });
  }

  /** Whether "Near me" is working, which is what the button says. */
  protected readonly finding = computed(
    () => this._finder.finding().state === 'locating'
  );

  /**
   * The shop the look made by itself selects (velista `0141`): the server's pick
   * when it named one of the candidates, else the nearest. Null when that look
   * found nothing, or a pressed look replaced it.
   */
  protected readonly suggested = computed<string | null>(() => {
    const finding = this._finder.finding();
    if (
      !this.asking ||
      !this._lookedByItself() ||
      finding.state !== 'answered'
    ) {
      return null;
    }
    const answer = finding.answer;
    return nearbyPickedShop(answer)?.id ?? answer.candidates[0]?.id ?? null;
  });

  /** The title: the question once a shop near the device is selected. */
  protected readonly titleKey = computed(() =>
    this.suggested() === null
      ? 'basket.view.shop.title'
      : 'basket.shopAsk.title'
  );

  /** What "Near me" answered, as the picker draws it. */
  protected readonly near = computed<ShopPickerNear>(() => {
    const finding = this._finder.finding();
    if (this._lookedByItself()) {
      // The look nobody pressed for: its loading rows, and its shops when it found
      // some. Anything else is the plain picker, with no line about it.
      if (finding.state === 'locating') {
        return { state: 'locating' };
      }
      if (this.suggested() === null || finding.state !== 'answered') {
        return { state: 'idle' };
      }
      const locale = this._locale();
      return {
        state: 'answered',
        reason: null,
        candidates: finding.answer.candidates.map((shop) =>
          nearbyShopRow(shop, locale)
        ),
      };
    }
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

  /** The reader's recent shops, newest first, with the day of the last purchase. */
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

  /** Which chain's shops are open, or null when none is. */
  protected readonly openChain = signal<string | null>(null);

  /** What is in the search field, exactly as typed. */
  protected readonly typed = signal('');

  /** Which row is the checked radio: the chosen shop, when this basket names it. */
  protected readonly pickedId = computed<string | null>(() => {
    const suggested = this.suggested();
    if (suggested !== null) {
      return suggested;
    }
    const shop = this._view.shop();
    return shop !== null && this._shops().some((row) => row.id === shop)
      ? shop
      : null;
  });

  /**
   * Every shop of every scope, in the order the read named them, once each.
   *
   * A shop can sit in two scopes of its own stack, so it is kept the first time it
   * is met: it is one door, whichever scope a read happened to list it under.
   */
  private readonly _shops = computed<readonly PickerShop[]>(() => {
    const locale = this._locale();
    const seen = new Set<string>();
    const shops: PickerShop[] = [];

    for (const scope of this._view.priceScopes()) {
      for (const location of scope.locations) {
        if (seen.has(location.id)) {
          continue;
        }
        seen.add(location.id);
        const name =
          location.label === null ? '' : catalogName(location.label, locale);
        shops.push({
          id: location.id,
          chainKey: chainKeyOf(scope),
          chain: catalogName(scope.supermarketName, locale),
          name: name === '' ? null : name,
          address: location.address,
          city: location.city,
          postalCode: location.postalCode,
          logoUrl: scope.logoUrl,
          sections: location.sections,
        });
      }
    }
    return shops;
  });

  /**
   * One button per chain with a shop to pick, with the count of its shops.
   *
   * **No OTHER button**: that bucket is the supermarkets page's answer to a chain
   * with no brand key, and a basket's scopes all belong to a chain by construction.
   * A chain none of whose scopes names a shop has no button, because there is no
   * door under it to choose.
   *
   * Keyed on the chain's id, which every scope carries (velista `0124`).
   */
  protected readonly chains = computed<readonly FranchiseButton[]>(() => {
    const buttons = new Map<string, FranchiseButton>();
    const scopes = new Map(
      this._view.priceScopes().map((scope) => [chainKeyOf(scope), scope])
    );

    for (const shop of this._shops()) {
      const held = buttons.get(shop.chainKey);
      const scope = scopes.get(shop.chainKey);
      buttons.set(shop.chainKey, {
        key: shop.chainKey,
        name: held?.name ?? scope?.supermarketName ?? null,
        locations: (held?.locations ?? 0) + 1,
        excluded: 0,
        state: 'none',
        logoUrl: held?.logoUrl ?? scope?.logoUrl ?? null,
      });
    }

    return [...buttons.values()];
  });

  /**
   * The chains that price nothing on this basket (velista `0153`): every scope
   * of the chain says `quotesBasket: false`. Backend `0213` names every scope of
   * the profile, so such a chain has a button, says so under its name and stays
   * choosable. A chain with one scope that quotes something is not in here.
   */
  protected readonly noPrices = computed<ReadonlySet<string>>(() => {
    const quotes = new Map<string, boolean>();
    for (const scope of this._view.priceScopes()) {
      const key = chainKeyOf(scope);
      quotes.set(
        key,
        (quotes.get(key) ?? false) || scope.quotesBasket !== false
      );
    }
    return new Set(
      [...quotes].filter(([, quoted]) => !quoted).map(([key]) => key)
    );
  });

  /**
   * Whether the read could not list every scope or shop of the profile
   * (backend `0213`), which the picker says above the Near you results with a way to read
   * again. The list may still hold some shops.
   */
  protected readonly incomplete = computed(
    () => this._basket.basket()?.scopesIncomplete === true
  );

  /** Whether the read that "Try again" asked for is still out. */
  protected readonly retrying = signal(false);

  /** The chain of the shop being bought at, whose button draws a tick. */
  protected readonly pickedChain = computed<string | null>(() => {
    const picked = this.pickedId();
    return this._shops().find((shop) => shop.id === picked)?.chainKey ?? null;
  });

  /**
   * What a search matched, across every chain, over the five fields `0059` names.
   *
   * In memory and over the basket's own scopes, because that is the whole list: the
   * supermarkets page asks the server because a profile's postal codes reach
   * thousands of shops, and a basket is priced at a handful.
   *
   * Folded with `0074`'s fold, so "Cordoba" finds "Córdoba" and a typed capital
   * finds a lower case street.
   */
  private readonly _matches = computed<readonly PickerShop[]>(() => {
    const query = foldForSearch(this.typed());
    if (query === '') {
      return [];
    }

    return this._shops().filter((shop) =>
      [shop.name, shop.chain, shop.address, shop.city, shop.postalCode].some(
        (field) => field !== null && foldForSearch(field).includes(query)
      )
    );
  });

  /** How many shops the search matched, for the count the body announces. */
  protected readonly matches = computed(() => this._matches().length);

  /** The matches as one ungrouped run, which is what a search answers with. */
  protected readonly flat = computed<readonly ShopGroup[]>(() =>
    this._matches().length === 0
      ? []
      : [
          {
            key: 'search',
            heading: '',
            code: null,
            shops: this._matches().map((shop) => toRow(shop, this._locale())),
          },
        ]
  );

  /**
   * The open chain as the title row draws it (velista `0124`): its logo and its
   * name, and how many of its shops there are. Null at the root.
   */
  protected readonly openHead = computed<{
    readonly name: string;
    readonly logo: ChainLogoView;
    readonly count: number;
    readonly noPrices: boolean;
  } | null>(() => {
    const open = this.openChain();
    const chain = this.chains().find((row) => row.key === open);
    if (chain === undefined) {
      return null;
    }
    const name =
      chain.name === null ? '' : catalogName(chain.name, this._locale());
    return {
      name,
      logo: { logoUrl: chain.logoUrl, name, store: false },
      count: chain.locations,
      noPrices: this.noPrices().has(chain.key),
    };
  });

  /**
   * The open chain's shops, under their postal code (`0059`, section 3.3).
   *
   * The heading is the **code itself** and never a label: a basket's `ScopeLocation`
   * carries the code and not the profile's word for it, which is the fallback that
   * page already names. A shop with no code at all heads an empty string, which the
   * list draws as a run with a blank heading rather than dropping the row.
   */
  protected readonly groups = computed<readonly ShopGroup[]>(() => {
    const open = this.openChain();
    if (open === null) {
      return [];
    }

    const locale = this._locale();
    return groupByPostalCode(
      this._shops()
        .filter((shop) => shop.chainKey === open)
        .map((shop) => toRow(shop, locale))
    );
  });

  onQuery(query: string): void {
    this.typed.set(query);
  }

  /**
   * "Try again" under the line that says the shops could not all be listed
   * (velista `0153`): read the basket again, which brings the scopes again.
   * One read at a time, so a second press waits for the first.
   */
  async retry(): Promise<void> {
    if (this.retrying()) {
      return;
    }
    this.retrying.set(true);
    try {
      await this._basket.refresh();
    } finally {
      this.retrying.set(false);
    }
  }

  /**
   * A chain button was pressed: open its screen inside the sheet (velista `0124`).
   * A sheet cannot push a page, so the chain replaces the root here and the title
   * row's chevron brings the root back.
   *
   * The search is cleared: the buttons are hidden while something is typed, so a
   * query left behind would greet the root with matches instead of the buttons.
   */
  select(key: string): void {
    this.typed.set('');
    this.openChain.set(key);
  }

  /**
   * A shop was chosen. Write it, and go back to the filter sheet.
   *
   * The pick is written to the store first, so the filter sheet this pops back onto
   * draws it the moment it is recreated.
   */
  pickShop(locationId: string): void {
    if (!this._offers(locationId)) {
      return;
    }
    // A pick by hand is not the automatic one, so any message about that goes.
    this._notices.dismiss();
    this._view.setShop(locationId);
    if (this.asking) {
      this._leaveAnswered();
      return;
    }
    void this._sheet.dismiss(this._filterUrl());
  }

  /** "No shop" (velista `0141`): an answer for this trip, and the buy with none. */
  noShop(): void {
    this._view.answerShopForTrip();
    this._leaveAnswered();
  }

  /** "Don't ask again": the device's flag, and the buy with no shop. */
  neverAsk(): void {
    this._view.neverAskShop();
    this._leaveAnswered();
  }

  /**
   * "Near me" was pressed (velista `0103`): ask the device, then the basket's route.
   *
   * **The server decides.** With a pick, the shop it named is set, the message is
   * left for the filter sheet, and this sheet closes onto it. With none, the
   * candidates and the reason are drawn at the top and the person chooses.
   */
  async findNear(): Promise<void> {
    const basketId = this._basket.basket()?.id;
    if (basketId === undefined) {
      return;
    }
    // A press is a look somebody asked for, drawn the way the filter draws it.
    this._lookedByItself.set(false);
    const answer = await this._finder.find((point) =>
      this._finderService.nearBasket(basketId, point)
    );
    const shop = answer === null ? null : nearbyPickedShop(answer);
    const pick = answer?.pick ?? null;
    if (shop === null || pick === null) {
      return;
    }

    if (this.asking) {
      // As the filter does, the server's pick is chosen. The message about it is
      // the filter sheet's, which this does not land on, so none is left.
      this._view.setShop(shop.id);
      this._leaveAnswered();
      return;
    }

    this._notices.show({
      basket: basketId,
      shop,
      distanceMetres: pick.distanceMetres,
    });
    this._view.setShop(shop.id);
    void this._sheet.dismiss(this._filterUrl());
  }

  /**
   * Whether a shop is one this sheet offered: one of the basket's, one of the
   * reader's recent shops, or one the server found near the device. A shop outside
   * the basket's scopes is priced by the read made at it (backend `0163`).
   */
  private _offers(locationId: string): boolean {
    if (this._shops().some((row) => row.id === locationId)) {
      return true;
    }
    if (this._finder.recent().some((recent) => recent.shop.id === locationId)) {
      return true;
    }
    const finding = this._finder.finding();
    return (
      finding.state === 'answered' &&
      finding.answer.candidates.some((shop) => shop.id === locationId)
    );
  }

  /**
   * The chevron in the title row. On a chain's screen it returns to the root and
   * never leaves the sheet (velista `0124`); at the root it leaves, as {@link close}.
   */
  back(): void {
    if (this.openChain() !== null) {
      this.openChain.set(null);
      return;
    }
    this.close();
  }

  /**
   * The way out, which is Escape, the scrim, the back gesture and the root's
   * chevron.
   *
   * `dismiss` and not `leaveTo`: the entry under this sheet is the filter sheet's,
   * which pushed it, so popping lands there, and the URL is the fallback for a cold
   * load on this sheet's own address.
   */
  close(): void {
    if (this.asking) {
      this._view.answerShopForTrip();
      this._leaveAnswered();
      return;
    }
    void this._sheet.dismiss(this._filterUrl());
  }

  /**
   * Look for the shop without a press, when the browser already allows location
   * (velista `0141`). `permission()` raises no dialog, and a browser that cannot
   * say counts as not allowed.
   */
  private async _lookIfAllowed(basketId: string): Promise<void> {
    const permission = await this._reader.permission().catch(() => 'unknown');
    if (permission !== 'granted' || this._answered) {
      return;
    }
    this._lookedByItself.set(true);
    await this._finder.find((point) =>
      this._finderService.nearBasket(basketId, point)
    );
  }

  /**
   * The question was answered: leave for the basket and write the buy that waits.
   * The sheet goes first, so the row that was pressed is bought on the page.
   */
  private _leaveAnswered(): void {
    this._answered = true;
    void this._sheet.dismiss(
      basketPath(this._locale(), this._basePath, this._address())
    );
    void this._held.release();
  }

  /**
   * Whether the navigation that is destroying this sheet leaves the basket under
   * it: a URL that is neither the basket nor one of its sheets, another basket
   * included. A teardown outside a navigation counts as staying, which is the
   * dismissal it always was.
   */
  private _leavesBasket(): boolean {
    const navigation = this._router.getCurrentNavigation();
    if (navigation === null) {
      return false;
    }
    const address = this._address();
    if (address === null) {
      return true;
    }
    const basket = basketPath(this._locale(), this._basePath, address);
    const target = this._router
      .serializeUrl(navigation.finalUrl ?? navigation.extractedUrl)
      .split(/[?#]/)[0];
    return target !== basket && !target.startsWith(`${basket}/`);
  }

  private _filterUrl(): string {
    return filterSheetPath(this._locale(), this._basePath, this._address());
  }
}

/** One picker shop as the list draws it. No exclusion state is ever set here. */
function toRow(shop: PickerShop, locale: string): ShopRow {
  return pickRowOf(shop, locale);
}

/**
 * The chain a scope belongs to: its id (velista `0124`), or the scope itself from
 * a server that did not name the chain, which is one button per scope rather than
 * two chains folded into one.
 */
function chainKeyOf(scope: BasketPriceScope): string {
  return scope.supermarketId ?? scope.priceScopeId;
}
