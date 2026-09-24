import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
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
  foldForSearch,
  inLocale,
  nearbyPickedShop,
  type BasketPriceScope,
  type FranchiseButton,
  type ScopeLocation,
} from '@portfolio/velista/models';
import { SheetNavigation } from '@portfolio/velista/platform';
import {
  ChevronLeftIcon,
  nearbyShopRow,
  NearMeButton,
  recentShopRow,
  SheetShell,
  ShopPicker,
  type ShopGroup,
  type ShopPickerNear,
  type ShopRow,
} from '@portfolio/velista/ui';
import { filterSheetPath } from '../basket-paths';

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
  readonly where: string | null;
  readonly postalCode: string | null;
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
 */
@Component({
  selector: 'lib-shop-picker-sheet',
  imports: [
    ChevronLeftIcon,
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
        shops.push({
          id: location.id,
          chainKey: chainKeyOf(scope),
          chain: inLocale(scope.supermarketName, locale),
          name:
            location.label === null ? null : inLocale(location.label, locale),
          where: whereOf(location),
          postalCode: location.postalCode,
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
   * Keyed on the chain's **name** rather than on an id, because a scope carries no
   * supermarket id: it carries the name the read resolved, which is the only thing
   * two scopes of one chain have in common here.
   */
  protected readonly chains = computed<readonly FranchiseButton[]>(() => {
    const buttons = new Map<string, FranchiseButton>();
    const names = new Map(
      this._view
        .priceScopes()
        .map((scope) => [chainKeyOf(scope), scope.supermarketName])
    );

    for (const shop of this._shops()) {
      const held = buttons.get(shop.chainKey);
      buttons.set(shop.chainKey, {
        key: shop.chainKey,
        name: held?.name ?? names.get(shop.chainKey) ?? null,
        locations: (held?.locations ?? 0) + 1,
        excluded: 0,
        state: 'none',
      });
    }

    return [...buttons.values()];
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
      [shop.name, shop.chain, shop.where, shop.postalCode].some(
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
            shops: this._matches().map(toRow),
          },
        ]
  );

  /** The open chain's name, for the heading over its rows. */
  protected readonly openName = computed(() => {
    const open = this.openChain();
    const chain = this.chains().find((row) => row.key === open);
    return chain?.name === null || chain === undefined
      ? null
      : inLocale(chain.name, this._locale());
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

    const byCode = new Map<string, ShopRow[]>();
    for (const shop of this._shops()) {
      if (shop.chainKey !== open) {
        continue;
      }
      const code = shop.postalCode ?? '';
      const held = byCode.get(code);
      if (held === undefined) {
        byCode.set(code, [toRow(shop)]);
      } else {
        held.push(toRow(shop));
      }
    }

    return [...byCode.entries()].map(([code, shops]) => ({
      key: code,
      heading: code,
      code: null,
      shops,
    }));
  });

  onQuery(query: string): void {
    this.typed.set(query);
  }

  /**
   * A chain button was pressed: open it, or close it when it is open.
   *
   * The search is cleared, which is `ShopStore.select`'s own rule and holds here for
   * its reason: the buttons and the flat matches are two answers to the same
   * question, and leaving a query behind would draw one over the other.
   */
  select(key: string): void {
    this.typed.set('');
    this.openChain.update((open) => (open === key ? null : key));
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
    void this._sheet.dismiss(this._filterUrl());
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
    const answer = await this._finder.find((point) =>
      this._finderService.nearBasket(basketId, point)
    );
    const shop = answer === null ? null : nearbyPickedShop(answer);
    const pick = answer?.pick ?? null;
    if (shop === null || pick === null) {
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
   * The way back, which is the chevron, Escape, the scrim and the back gesture.
   *
   * `dismiss` and not `leaveTo`: the entry under this sheet is the filter sheet's,
   * which pushed it, so popping lands there, and the URL is the fallback for a cold
   * load on this sheet's own address.
   */
  back(): void {
    void this._sheet.dismiss(this._filterUrl());
  }

  private _filterUrl(): string {
    return filterSheetPath(this._locale(), this._basePath, this._address());
  }
}

/** One picker shop as the list draws it. No exclusion state is ever set here. */
function toRow(shop: PickerShop): ShopRow {
  return {
    id: shop.id,
    chain: shop.chain,
    name: shop.name,
    where: shop.where,
    postalCode: shop.postalCode,
    excluded: false,
    excludedChain: false,
    failed: false,
  };
}

/**
 * What two scopes of one chain have in common, which is the name and nothing else.
 *
 * `BasketPriceScope` carries no supermarket id: the read resolves the chain to a
 * name and stops there, so the name in both languages is the identity available to
 * this screen. Both are used rather than one, so a chain whose Spanish name is
 * shared with another's English name cannot collapse two brands into one button.
 */
function chainKeyOf(scope: BasketPriceScope): string {
  return `${scope.supermarketName.en} ${scope.supermarketName.es}`;
}

/** Street and town on one line, or null when the read holds neither. */
function whereOf(location: ScopeLocation): string | null {
  const parts = [location.address, location.city].filter(
    (part): part is string => part !== null && part.trim() !== ''
  );

  return parts.length === 0 ? null : parts.join(', ');
}
