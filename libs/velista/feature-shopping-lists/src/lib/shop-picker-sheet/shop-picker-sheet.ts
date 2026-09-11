import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import { BasketViewStore } from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  foldForSearch,
  inLocale,
  type BasketPriceScope,
  type FranchiseButton,
  type ScopeLocation,
} from '@portfolio/velista/models';
import {
  generatedListIdOf,
  SheetNavigation,
} from '@portfolio/velista/platform';
import {
  ChevronLeftIcon,
  FranchiseButtons,
  SearchIcon,
  SheetShell,
  ShopList,
  type ShopGroup,
  type ShopRow,
} from '@portfolio/velista/ui';
import { filterSheetPath } from '../basket-paths';

/**
 * One shop of the basket, flattened out of the scope it belongs to.
 *
 * A scope is a set of shops one chain charges the same in, so a scope with two
 * locations is two rows here and **both pick the same scope**: the price is the
 * scope's, and which of two shops somebody is standing in changes nothing about it.
 * Picking either is therefore the same act, which is what {@link priceScopeId} says.
 */
interface PickerShop {
  /** The location's own id, which is what a radio is keyed by. */
  readonly id: string;
  readonly priceScopeId: string;
  readonly chainKey: string;
  readonly chain: string;
  readonly name: string | null;
  readonly where: string | null;
  readonly postalCode: string | null;
}

/**
 * Which shop the basket's prices come from (velista `0078`, section 4).
 *
 * A sheet of its own rather than a third radio group on the filter sheet, because a
 * profile can hold fifty shops: a flat list of them is a wall, and fifty of one
 * chain shadow the four of the next. So it is the supermarkets page's own shape
 * (`0059`), top to bottom in that page's order — a search across every chain, the
 * chain buttons, then the open chain's shops under their postal codes — with a radio
 * per row instead of a checkbox.
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
 * sheet, exactly once (`0031`). This used to go both ways with `leaveTo`, so the
 * filter sheet's entry was replaced by this one and the chevron, which pops, landed
 * on the basket instead. The filter sheet's URL is the fallback for a cold load on
 * this sheet's own address.
 *
 * ## A guest picks a chain
 *
 * A reader the server sent no locations to has chain buttons and nothing under them,
 * so tapping one **picks that chain's scope** rather than opening a list of shops it
 * cannot draw. A chain with two scopes and no locations to tell them apart is two
 * buttons with one name, which is honest and rare.
 */
@Component({
  selector: 'lib-shop-picker-sheet',
  imports: [
    ChevronLeftIcon,
    FranchiseButtons,
    RokuTranslatorPipe,
    SearchIcon,
    SheetShell,
    ShopList,
  ],
  templateUrl: './shop-picker-sheet.html',
  styleUrl: './shop-picker-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShopPickerSheet {
  private readonly _view = inject(BasketViewStore);
  private readonly _sheet = inject(SheetNavigation);
  private readonly _route = inject(ActivatedRoute);
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _locale = inject(RokuLocaleStore).locale;

  /** The basket underneath, which is what both ways out of here are built on. */
  private readonly _generatedListId = generatedListIdOf(this._route);

  /** Which chain's shops are open, or null when none is. */
  protected readonly openChain = signal<string | null>(null);

  /** What is in the search field, exactly as typed. */
  protected readonly typed = signal('');

  /** Whether a word is being searched, which decides what the body draws. */
  protected readonly searching = computed(() => this.typed().trim() !== '');

  /**
   * Which row is the checked radio: the **first** shop of the chosen scope.
   *
   * A radio group has one checked control and a scope can hold four shops, all of
   * which charge the same and any of which picks that scope. So the group checks the
   * first, which is the same shop the filter sheet names under the chain, and the
   * two therefore say the same thing about a pick rather than two different ones.
   *
   * Null while prices come from anywhere, and null for a scope this basket no longer
   * carries, where nothing on this screen can be checked.
   */
  protected readonly pickedId = computed<string | null>(() => {
    const scope = this._view.shop();
    return scope === null
      ? null
      : (this._shops().find((shop) => shop.priceScopeId === scope)?.id ?? null);
  });

  /** Every shop of every scope, in the order the read named them. */
  private readonly _shops = computed<readonly PickerShop[]>(() => {
    const locale = this._locale();

    return this._view.priceScopes().flatMap((scope) =>
      scope.locations.map((location) => ({
        id: location.id,
        priceScopeId: scope.priceScopeId,
        chainKey: chainKeyOf(scope),
        chain: inLocale(scope.supermarketName, locale),
        name: location.label === null ? null : inLocale(location.label, locale),
        where: whereOf(location),
        postalCode: location.postalCode,
      }))
    );
  });

  /**
   * One button per chain among the basket's scopes, with the count of its shops.
   *
   * **No OTHER button**: that bucket is the supermarkets page's answer to a chain
   * with no brand key, and a basket's scopes all belong to a chain by construction.
   * The three exclusion states are never set here either, for the reason the rows
   * draw none: this sheet asks where the reader is and not which shops they will go
   * to.
   *
   * Keyed on the chain's **name** rather than on an id, because a scope carries no
   * supermarket id: it carries the name the read resolved, which is the only thing
   * two scopes of one chain have in common here. A guest's two nameless scopes of
   * one chain therefore collapse to one button, which is the honest reading of a
   * read that tells them nothing else about the two.
   */
  protected readonly chains = computed<readonly FranchiseButton[]>(() => {
    const buttons = new Map<string, FranchiseButton>();

    for (const scope of this._view.priceScopes()) {
      const key = chainKeyOf(scope);
      const held = buttons.get(key);
      buttons.set(key, {
        key,
        // The first scope's name, kept: two scopes of one chain answer the same key
        // and so carry the same name, and taking the first says so plainly.
        name: held?.name ?? scope.supermarketName,
        locations: (held?.locations ?? 0) + scope.locations.length,
        excluded: 0,
        state: 'none',
      });
    }

    return [...buttons.values()];
  });

  /**
   * The scope a chain button picks, for a reader with no locations to pick between.
   *
   * The **first** scope of that chain. A chain with two scopes and nothing to tell
   * them apart offers no way to choose the second, and inventing one would be a
   * control that says nothing about what it does.
   */
  private readonly _scopeByChain = computed<ReadonlyMap<string, string>>(() => {
    const first = new Map<string, string>();
    for (const scope of this._view.priceScopes()) {
      const key = chainKeyOf(scope);
      if (!first.has(key)) {
        first.set(key, scope.priceScopeId);
      }
    }
    return first;
  });

  /** Whether any shop was sent at all, which is what a guest's picker turns on. */
  protected readonly hasLocations = computed(() => this._shops().length > 0);

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

  /** How many shops the search matched, for the count this sheet announces. */
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

  onQuery(event: Event): void {
    this.typed.set((event.target as HTMLInputElement).value);
  }

  /**
   * A chain button was pressed: open it, or pick it when there is nothing to open.
   *
   * Two acts behind one control, and they are one act to the reader: a chain with
   * shops under it is a place to look, and a chain with none is the finest thing
   * this reader can say about where they are.
   *
   * The search is cleared either way, which is `ShopStore.select`'s own rule and
   * holds here for its reason: the buttons and the flat matches are two answers to
   * the same question, and leaving a query behind would draw one over the other.
   */
  select(key: string): void {
    this.typed.set('');

    if (this.hasLocations()) {
      this.openChain.update((open) => (open === key ? null : key));
      return;
    }

    const scope = this._scopeByChain().get(key);
    if (scope !== undefined) {
      this.pick(scope);
    }
  }

  /**
   * A shop was chosen. Write the **scope** and go back to the filter sheet.
   *
   * The id a row carries is a location's and the id a price belongs to is a scope's,
   * which is why the two are separate fields on {@link PickerShop}: two shops of one
   * scope are two rows, and picking either is the same pick.
   */
  pickShop(locationId: string): void {
    const shop = this._shops().find((row) => row.id === locationId);
    if (shop !== undefined) {
      this.pick(shop.priceScopeId);
    }
  }

  /**
   * The pick is written to the store first, so the filter sheet this pops back onto
   * draws it the moment it is recreated.
   */
  private pick(priceScopeId: string): void {
    this._view.setShop(priceScopeId);
    void this._sheet.dismiss(this._filterUrl());
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
    return filterSheetPath(
      this._locale(),
      this._basePath,
      this._generatedListId()
    );
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
  return `${scope.supermarketName.en} ${scope.supermarketName.es}`;
}

/** Street and town on one line, or null when the read holds neither. */
function whereOf(location: ScopeLocation): string | null {
  const parts = [location.address, location.city].filter(
    (part): part is string => part !== null && part.trim() !== ''
  );

  return parts.length === 0 ? null : parts.join(', ');
}
