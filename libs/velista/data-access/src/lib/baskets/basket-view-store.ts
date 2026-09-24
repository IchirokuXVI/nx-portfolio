import { computed, inject, Injectable, signal } from '@angular/core';
import { RokuLocaleStore } from '@portfolio/localization/rokutranslator-angular';
import {
  basketPricedAtShop,
  basketReadAtShop,
  basketSettleShop,
  basketViewActiveCount,
  basketViewChips,
  basketViewRows,
  composeBasketView,
  DEFAULT_BASKET_VIEW_STATE,
  foldForSearch,
  inLocale,
  resetBasketViewProperty,
  type BasketGrouping,
  type BasketOrder,
  type BasketPriceScope,
  type BasketProduct,
  type BasketRow,
  type BasketShop,
  type BasketViewProperty,
  type BasketViewState,
} from '@portfolio/velista/models';
import { BrowserFacade, StorageKeys } from '@portfolio/velista/platform';
import { BasketStore } from './basket-store';
import {
  dropExpired,
  forget,
  holdsLegacyShop,
  NO_BASKET_VIEW_MEMORY,
  parseBasketViewMemory,
  remember,
  type BasketViewMemory,
} from './basket-view-memory';

/**
 * The chosen shop, named for a person (velista `0078`, section 3; `0102`).
 *
 * What the filter sheet's "Buying at" row draws and what the chip says. Resolved
 * here rather than in the sheet because the chip row on the page behind it needs the
 * same words, and two places resolving a `LocalizedName` is two places to forget the
 * locale changed.
 */
export interface BasketChosenShop {
  /** The shop's id, which the read and every settle send. */
  readonly id: string;
  /** The chain, which is what the chip says and what every mark on a row names. */
  readonly chain: string;
  /**
   * The shop itself, under the chain in the sheet, or null: its own name, else its
   * street, else its town, which is the order anybody standing outside it reads
   * them in.
   */
  readonly shop: string | null;
  /**
   * The shop is outside the basket owner's areas (backend `0163`, section 3), which
   * draws "Outside your areas" under it. False where nobody said, which is every
   * shop picked from the basket's own scopes: those are the profile's shops.
   */
  readonly outsideAreas: boolean;
  /**
   * The basket was started at this shop, so it is drawn disabled for everybody,
   * the owner included. **The server's fact**, from `Basket.lockedShopId`, and
   * never something this device stored.
   */
  readonly locked: boolean;
}

/** One row of the filter sheet's LISTS section, and of nothing else. */
export interface BasketSourceList {
  readonly id: string;
  readonly name: string;
  /** How many of the basket's lines reach this list, for the trailing number. */
  readonly lines: number;
}

/**
 * What the basket page actually draws, as opposed to what the basket holds
 * (velista `0074`, section 4.3).
 *
 * ## Why it is a second store
 *
 * {@link BasketStore} answers what is on this shopping trip. This answers which of
 * it is on the screen, and the two are different questions: `BasketStore.lines`
 * stays exactly what the server said, and `BasketStore.progress` keeps counting the
 * whole basket, so a search that hides eight rows never changes what "4 of 12 got"
 * means. Everything a control on the page decides about the view lands here, and
 * `0075` to `0078` grow {@link visibleLines} into the rest of the pipeline.
 *
 * ## Why it is provided on the route
 *
 * Beside `BasketStore` in `routes.ts`, and for the reason `BasketStore` is there:
 * the sheets that set these controls are **child routes of the page**, not children
 * of its component, and a store provided on the component is not one a sibling route
 * can be sure to reach.
 *
 * That has the consequence the store beside it already carries: Angular caches a
 * route's environment injector on the route config and destroys it only under
 * `withExperimentalAutoCleanupInjectors()`, so this instance is handed back on the
 * next visit and nothing here is ever torn down. {@link leave} is what the page
 * calls instead, from its own teardown, which is the one place a departure is
 * certain.
 */
@Injectable()
export class BasketViewStore {
  private readonly _basket = inject(BasketStore);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _browser = inject(BrowserFacade);

  private readonly _query = signal('');

  /** What is in the search field, exactly as it was typed. */
  readonly query = this._query.asReadonly();

  /** Whether anything is being searched for, which is not the same as the field being open. */
  readonly searching = computed(() => this._query() !== '');

  /**
   * The query folded once, for the row to draw its `<mark>` from.
   *
   * Folded here rather than by each row: a basket is a dozen rows deep and the
   * answer is the same for all of them.
   */
  readonly folded = computed(() => foldForSearch(this._query()));

  /**
   * Everything the filter sheet decides (velista `0075`, section 2).
   *
   * One signal holding the four properties rather than four signals, because the
   * chip row, the badge and `reset` all ask about the whole of it at once, and
   * `0076` stores and restores it as one record.
   */
  private readonly _state = signal<BasketViewState>(DEFAULT_BASKET_VIEW_STATE);

  /**
   * The shop the person is buying at, or null for any of their shops (velista
   * `0102`).
   *
   * **The basket's own shop when it was started at one**, whatever this device
   * chose, because the lock is the server's fact. Otherwise the device's choice,
   * which `BasketStore` holds because every read it makes has to send it. So this
   * store keeps no copy of the shop in {@link _state}: two copies of one choice are
   * two things to keep in step, and the one the reads send is the one that counts.
   */
  readonly shop = computed<string | null>(
    () => this._basket.basket()?.lockedShopId ?? this._basket.readAt()
  );

  /**
   * Whether the shop is the basket's own, fixed when it was started (velista
   * `0102`). Never on a `LIVE` basket, and never from anything stored here.
   */
  readonly shopLocked = computed(
    () => (this._basket.basket()?.lockedShopId ?? null) !== null
  );

  /** Everything the sheet decides, with the shop the reads are made at. */
  readonly state = computed<BasketViewState>(() => ({
    ...this._state(),
    shop: this.shop(),
  }));

  readonly order = computed(() => this._state().order);

  readonly grouping = computed(() => this._state().grouping);

  /** The kept source lists, or null for all of them. See {@link keptLists}. */
  readonly lists = computed(() => this._state().lists);

  /**
   * Every scope the basket was priced at, in the order the read named them
   * (velista `0078`, section 4).
   *
   * What the shop picker is built from, and what the filter sheet's PRICES FROM
   * section tests for emptiness: a run scoped by hand, a profile since deleted or a
   * gateway that could not price the read has none, and then the section is absent
   * rather than offering a choice between one thing and nothing.
   */
  readonly priceScopes = computed<readonly BasketPriceScope[]>(() => [
    ...(this._basket.basket()?.scopes.values() ?? []),
  ]);

  /**
   * The chosen shop, named, or null while prices come from anywhere.
   *
   * Null too for a shop this basket's read cannot name, which {@link restore}
   * already refuses to apply: a choice that survived the check could still be
   * outrun by a refetch that changed the run's scopes, and the honest answer then
   * is the same one the sheet gives before anything is chosen.
   */
  readonly chosenShop = computed<BasketChosenShop | null>(() => {
    const id = this.shop();
    const shop = id === null ? null : this._named(id);
    if (shop === null) {
      return null;
    }

    const locale = this._locale();
    return {
      id: shop.id,
      chain: inLocale(shop.chain, locale),
      shop: shopNameOf(shop, locale),
      outsideAreas: shop.inProfile === false,
      locked: this.shopLocked(),
    };
  });

  /**
   * The chosen shop, named, **once the read the products came from was made at
   * it**, or null (velista `0102`).
   *
   * What the pipeline and every settle are told about the shop. Null while a read
   * at a newly chosen shop is still out, so no row quotes the last shop's price
   * under the new shop's name.
   */
  readonly shopAt = computed<BasketShop | null>(() => {
    const read = this._basket.shopRead();
    return read === null ? null : this._named(read);
  });

  /**
   * The lists the filter offers, named and counted (velista `0090`, section 8.2).
   *
   * **Every list this reader was served**, and not the lists its rows happen to
   * name: a list this basket covers is still one of the households it is about
   * when every row of it has been bought, and a checkbox that appeared and
   * disappeared as rows were settled would be unusable.
   *
   * It used to read the run's `sources` and a map of names. Backend `0136` replaced
   * both with `Basket.lists`, which is exactly the lists a reader may name, so
   * a ref with no name is no longer representable and the whole section stays out
   * of a guest's sheet without a flag anywhere in the template.
   *
   * The count is the **rows** with a served entry on that list, so a row two
   * households ask for counts once under each of them, which is what the list
   * grouping draws.
   */
  readonly sourceLists = computed<readonly BasketSourceList[]>(() => {
    const rows = this._basket.rows();
    return [...this._basket.lists().values()].map((ref) => ({
      id: ref.listId,
      // The group's name beside the list's, because a list alone is ambiguous
      // when two households both keep one called "Groceries".
      name: `${ref.name} \u00b7 ${ref.zoneName}`,
      lines: rows.filter((row) =>
        row.entries.some((entry) => entry.listId === ref.listId)
      ).length,
    }));
  });

  /**
   * Which lists are kept, as a set that is never null.
   *
   * What the sheet's checkboxes read. The state's own null means "all of them",
   * which is the default and therefore unchipped, and resolving it here is what lets
   * the template ask one question per row instead of two.
   */
  readonly keptLists = computed<ReadonlySet<string>>(() => {
    const chosen = this._state().lists;
    return chosen ?? new Set(this.sourceLists().map((source) => source.id));
  });

  /**
   * The sections the page draws: filtered, ordered, then cut up (section 3).
   *
   * A `computed` over `BasketStore.rows` and nothing else, which is what makes
   * realtime free: a folded write and a whole `refresh` both land on that signal,
   * so a row that moves lands in its section with nothing subscribed to anything
   * (section 7).
   */
  readonly sections = computed(() =>
    composeBasketView(this._basket.rows(), this.state(), {
      query: this._query(),
      products: this._basket.products(),
      locale: this._locale(),
      lists: this._basket.lists(),
      // Empty until the basket loads, and empty for a read the gateway could not
      // price: the pipeline then marks nothing, which is the same screen as before.
      scopes: this._basket.basket()?.scopes ?? new Map(),
      shop: this.shopAt(),
    })
  );

  /**
   * The distinct rows on the screen, in the order they are drawn.
   *
   * `0074` answered this by identity for an untouched basket. It cannot any more:
   * every row in a section is wrapped, so the flat list is read back out of the
   * wrappers and is a new array each time. The rows themselves are still the
   * store's own objects, which is what `track row.rowKey` and every input depend
   * on, and a dozen wrappers per redraw does not pay for a second code path.
   */
  readonly visibleRows = computed<readonly BasketRow[]>(() =>
    basketViewRows(this.sections())
  );

  /**
   * How many rows the page is showing, which is what the sheet's button and the
   * chip row's count both say.
   *
   * One answer and not two: a row drawn once per household by `0077` counts once
   * here, so a basket grouped by list cannot report more rows than it has. A
   * `REMOVED` row is counted, because it is on the screen; what does not count it
   * is `progress`, which is a different question and the server's.
   */
  readonly visibleCount = computed(() => this.visibleRows().length);

  /**
   * Whether every row quotes the chosen shop's price, or the cheapest anywhere
   * (`0078`; `0102`).
   *
   * Not the same question as {@link shop}, which is what the sheet's radio says: a
   * read at the shop still out, and a shop that prices nothing on this basket, both
   * answer false here and leave the rows exactly as they were. What the page hands
   * each row, so one basket asks the question once.
   */
  readonly pricedAtShop = computed(() =>
    basketPricedAtShop(this._basket.rows(), this.state(), {
      products: this._basket.products(),
      shop: this.shopAt(),
    })
  );

  /**
   * Whether the products describe the chosen shop at all, priced or not, which is
   * what the shelf marks and the option offered instead turn on (`0102`).
   */
  readonly readAtShop = computed(() =>
    basketReadAtShop(this.state(), { shop: this.shopAt() })
  );

  /** How many of the four properties are on, for the filter button's badge. */
  readonly activeCount = computed(() => basketViewActiveCount(this.state()));

  /**
   * The chips the page draws, as keys and arguments rather than words.
   *
   * Keys, because this store has no translator and should not: the page resolves
   * them, and every spec asserts on the key and its arguments rather than on
   * rendered text.
   */
  readonly chips = computed(() =>
    basketViewChips(this.state(), {
      lists: this._basket.lists(),
      listCount: this.sourceLists().length,
      // The chain and never the shop (velista `0078`, section 5): the chip row is
      // one line on a 390 wide phone, and "Mercadona" is what distinguishes this
      // view from the default while a street name distinguishes one Mercadona from
      // another.
      chainName: this.chosenShop()?.chain ?? null,
      shopLocked: this.shopLocked(),
    })
  );

  /**
   * Where a settle of this product says it happened, as a body fragment (velista
   * `0102`): the chosen shop and the scope of the price the row drew, or in "any of
   * your shops" mode the scope alone and never a shop.
   *
   * The row, its reel and the settle sheet all ask here, so what one sends the others
   * send too.
   */
  settleShop(product: BasketProduct | null | undefined): {
    readonly priceScopeId?: string;
    readonly supermarketLocationId?: string;
  } {
    return basketSettleShop(product, this.shop(), this.pricedAtShop());
  }

  /** Search for this, or for nothing when it is empty. */
  search(query: string): void {
    this._query.set(query);
  }

  // --- The filter sheet's four properties (velista `0075`) -------------------
  //
  // Every setter applies **immediately**: the page behind the scrim redraws as the
  // radio is tapped. There is no draft and no apply step, for two reasons. The count
  // on the sheet's own button is then the truth rather than a prediction; and `0078`
  // leaves this sheet for the shop picker and comes back, which a draft held in the
  // sheet's component would not survive.

  setOrder(order: BasketOrder): void {
    this._state.update((state) => ({ ...state, order }));
    this._store((memory, now) => remember(memory, 'order', order, now));
  }

  setGrouping(grouping: BasketGrouping): void {
    this._state.update((state) => ({ ...state, grouping }));
    this._store((memory, now) => remember(memory, 'grouping', grouping, now));
  }

  /**
   * Buy at this shop, or at any of the person's shops (`0078`; `0102`).
   *
   * The basket is read again at the new shop straight away, because that read is
   * where the shop's prices and shelf come from. Choosing any **forgets** the shop
   * rather than remembering a null, and the two are the same thing to the next
   * basket: a property the record does not hold leaves the default in place, and
   * that default is none.
   *
   * **Refused on a basket started at a shop**, by doing nothing: nobody can change
   * that shop, the owner included, and the sheet draws no control that would ask.
   */
  setShop(shop: string | null): void {
    if (this.shopLocked()) {
      return;
    }
    void this._basket.readAtShop(shop);
    this._store((memory, now) =>
      shop === null
        ? forget(memory, 'location')
        : remember(memory, 'location', shop, now)
    );
  }

  /**
   * Keep or drop one source list (section 6).
   *
   * **Unchecking the last kept list is refused**, and refused by doing nothing, so
   * the checkbox does not move: a filter that keeps nothing is not a filter, and the
   * honest way to say so is that the control will not go there. The alternative,
   * disabling the last checked box, would make the sheet change shape as the second
   * to last one is unchecked.
   *
   * Keeping everything collapses back to null, which is the default: the view is the
   * same either way, and a set holding every list would leave a chip on the page
   * saying a filter is on when none is.
   */
  toggleList(listId: string): void {
    const all = this.sourceLists().map((source) => source.id);
    const kept = new Set(this._state().lists ?? all);

    if (kept.has(listId)) {
      if (kept.size <= 1) {
        return;
      }
      kept.delete(listId);
    } else {
      kept.add(listId);
    }

    const lists = kept.size === all.length ? null : kept;
    this._state.update((state) => ({ ...state, lists }));
  }

  /**
   * Put one property back to its default, which is what a chip's x does.
   *
   * **The default is then remembered, as a choice.** Somebody who takes a remembered
   * "By category" off the page has decided they want it off, and a record that
   * simply forgot it would hand the grouping straight back on the next basket. The
   * exception is the shop, for the reason written on {@link setShop}: its default is
   * the absence of a value, so choosing it forgets instead.
   */
  resetProperty(property: BasketViewProperty): void {
    if (property === 'shop') {
      // Held by `BasketStore`, and forgotten rather than remembered as a null.
      this.setShop(null);
      return;
    }

    this._state.update((state) => resetBasketViewProperty(state, property));

    if (property === 'lists') {
      // Never stored, so there is nothing to put back. `0075` section 6.
      return;
    }

    const value = DEFAULT_BASKET_VIEW_STATE[property];
    this._store((memory, now) =>
      value === null
        ? forget(memory, property)
        : remember(memory, property, value, now)
    );
  }

  /**
   * Put every property back, which is the sheet's Reset.
   *
   * The **search is left alone**. Reset is a control in the filter sheet and the
   * search is a field on the page behind it, so clearing what somebody typed from a
   * sheet they opened to change the order would be a surprise; and the search has a
   * Cancel of its own two taps away.
   */
  reset(): void {
    this._state.set(DEFAULT_BASKET_VIEW_STATE);
    // Any of the person's shops, which a basket started at a shop ignores: its
    // shop is not this device's to reset.
    void this._basket.readAtShop(null);
    // A record holding nothing, rather than three properties each holding their
    // default. Reset is the one gesture that says "forget all of this", and writing
    // the defaults back would be indistinguishable from three separate choices.
    this._write(NO_BASKET_VIEW_MEMORY);
  }

  /**
   * Apply what this device remembers, once, because a basket has just loaded
   * (`0076`, section 3).
   *
   * Called by the page after `BasketStore.open` resolves, which is the moment the
   * scopes and the source lists this has to check against exist. **Nothing is
   * watched afterwards**, and that is the whole design: a value whose date passes
   * while the basket is open stays applied, because the date is compared once rather
   * than counted down, and `watchStorage` is not used either, since a second tab
   * changing the grouping must not move rows under a thumb in this one.
   *
   * Applied **over the current state** rather than over the defaults, so the list
   * filter and the search survive it. Both are reachable before this runs: a sheet
   * is a child route, so a link straight to `sheet/filter` draws the controls while
   * the basket behind them is still loading.
   */
  restore(): void {
    const raw = this._browser.readStorage(StorageKeys.basketView);
    const stored = parseBasketViewMemory(raw);
    if (stored === null) {
      return;
    }

    const now = Date.now();
    const kept = dropExpired(stored, now);
    if (kept !== stored || holdsLegacyShop(raw)) {
      // An expired property is gone for good, and the record says so from now on.
      // So is a price scope id stored before velista `0102`, which the parse has
      // already left out.
      this._write(kept);
    }

    const order = kept.order?.value;
    const grouping = kept.grouping?.value;
    const location = kept.location?.value;

    this._state.update((state) => ({
      ...state,
      ...(order === undefined ? {} : { order }),
      ...(grouping === undefined || !this._offersGrouping(grouping)
        ? {}
        : { grouping }),
    }));

    if (location !== undefined && this._offersShop(location)) {
      // The read at the remembered shop, which is what prices the rows there.
      void this._basket.readAtShop(location);
    }
  }

  /**
   * Give the basket back, because the screen holding it has been left.
   *
   * Called from the page's own teardown beside `BasketStore.leave`, for the reason
   * written on that method: the `DestroyRef` this class can reach never fires. A
   * basket opened later must not start searched, because the search is the one thing
   * on this screen that is never remembered (`0076` names what is, and this is not on
   * the list).
   */
  leave(): void {
    this._query.set('');
    // The whole view state and not only the search. `0076` is what restores the two
    // properties a shopper keeps, and it restores them when the **next** basket
    // loads: leaving has to put this back to the defaults regardless, or a basket
    // opened with nothing stored would start on the last one's order.
    this._state.set(DEFAULT_BASKET_VIEW_STATE);
  }

  // --- What this device remembers (velista `0076`) ---------------------------

  /**
   * Whether this reader is offered the remembered grouping at all.
   *
   * `sourceLists` is the sheet's own test for its "List" option, and asking the same
   * question here is what keeps the two from disagreeing: a reader with no lists to
   * group by would otherwise get a grouping their sheet shows no radio for, and the
   * sheet would draw "Nothing" over a basket grouped by list.
   *
   * The value **stays in storage**, silently. The owner's phone is usually the
   * owner's, and the next basket is very possibly one whose lists they can see.
   */
  private _offersGrouping(grouping: BasketGrouping): boolean {
    return grouping !== 'list' || this.sourceLists().length > 0;
  }

  /**
   * Whether the remembered shop is one this basket offers to buy at.
   *
   * Never on a basket started at a shop, whose shop is not this device's to choose.
   * Otherwise the shop has to be one the read names among the basket's scopes: a
   * record written against another profile's shops, or a shop since closed, names
   * a place this basket knows nothing about. Dropped silently and, like the
   * grouping, kept in storage: the next basket is very possibly bought there again.
   */
  private _offersShop(location: string): boolean {
    return !this.shopLocked() && this._named(location) !== null;
  }

  /**
   * A shop by id, named from what the read carried, or null.
   *
   * The basket's own shop first, which is the one read that states whether the
   * shop is in the owner's areas. Otherwise the shop as a location of one of the
   * basket's scopes, with the chain from that scope and no statement about its
   * areas: those are the profile's own shops, and a read at a device's shop is
   * served that shop inside its scopes by the gateway (backend `0163`, section 2).
   */
  private _named(id: string): BasketShop | null {
    const basket = this._basket.basket();
    if (basket === null) {
      return null;
    }
    if (basket.shop?.id === id) {
      return basket.shop;
    }

    for (const scope of basket.scopes.values()) {
      const location = scope.locations.find((candidate) => candidate.id === id);
      if (location !== undefined) {
        return {
          id,
          supermarketId: null,
          chain: scope.supermarketName,
          label: location.label,
          address: location.address,
          city: location.city,
          postalCode: location.postalCode,
          inProfile: null,
        };
      }
    }
    return null;
  }

  /** The stored record, or null for anything this build cannot read (rule D4). */
  private _read(): BasketViewMemory | null {
    return parseBasketViewMemory(
      this._browser.readStorage(StorageKeys.basketView)
    );
  }

  private _write(memory: BasketViewMemory): void {
    this._browser.writeStorage(StorageKeys.basketView, JSON.stringify(memory));
  }

  /**
   * Change one property of the stored record, reading it first.
   *
   * Read, change, write, rather than holding the record in a field: the other
   * properties have to come back **with their own dates**, so that setting the
   * grouping does not extend the shop's two hours, and reading them from storage is
   * the one version of that which cannot drift. It is not a watch — nothing here
   * moves a row — and a storage that throws answers null through
   * {@link BrowserFacade}, which leaves the setter working and the device merely
   * forgetful.
   */
  private _store(
    change: (memory: BasketViewMemory, now: number) => BasketViewMemory
  ): void {
    this._write(change(this._read() ?? NO_BASKET_VIEW_MEMORY, Date.now()));
  }
}

/**
 * A shop in one string, or null when it names nothing.
 *
 * The label the catalog holds, falling back to the street and then to the town,
 * which is the order the pick sheet reads them in: any of the three identifies the
 * place to somebody standing outside it. A shop outside the owner's areas names its
 * town beside its street, because it is somewhere else (velista `0102`).
 */
function shopNameOf(shop: BasketShop, locale: string): string | null {
  const label = shop.label === null ? '' : inLocale(shop.label, locale);
  if (label !== '') {
    return label;
  }

  const parts =
    shop.inProfile === false ? [shop.address, shop.city] : [shop.address];
  const street = parts
    .filter((part): part is string => part !== null && part.trim() !== '')
    .join(', ');
  const named = street !== '' ? street : (shop.city ?? '');
  return named === '' ? null : named;
}
