import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import {
  BasketStore,
  BasketViewStore,
  type BasketChosenShop,
} from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  type BasketGrouping,
  type BasketOrder,
} from '@portfolio/velista/models';
import { SheetNavigation } from '@portfolio/velista/platform';
import { LockIcon, OutsideAreas, SheetShell } from '@portfolio/velista/ui';
import { basketPath, shopPickerPath } from '../basket-paths';

/**
 * How the basket is ordered, grouped and narrowed (velista `0075`, section 4).
 *
 * ## Nothing is confirmed here, because nothing is pending
 *
 * Every control applies the moment it is tapped, and the page behind the scrim
 * redraws with it. So this sheet has **no Cancel and no Apply**, which is unusual
 * among velista's sheets and is the right shape for two reasons. The number on its
 * own footer button is then the truth rather than a prediction of what Apply would
 * do. And `0078` leaves this sheet for the shop picker and comes back, which a draft
 * held in this component would not survive.
 *
 * The footer button is therefore a way out that happens to say what it is leaving
 * behind, not a commit. Reset is in the title row rather than the footer for the
 * same reason: it is not the counterweight to an action, it is one more immediate
 * control.
 *
 * ## What a guest never sees, and how
 *
 * A guest gets ORDER and GROUP BY and nothing else. There is no flag
 * branch in the template: the LISTS section is drawn from
 * {@link BasketViewStore.sourceLists}, which is empty for a reader the server sent
 * no sources to, and the "List" grouping is drawn from the same emptiness. The data
 * decides, which is the rule `0044` section 4.1 set for the row's "from" caption and
 * the reason a redaction cannot be got wrong in one place and right in another.
 *
 * ## BUYING AT, and the sheet this one leaves for
 *
 * The section is drawn from the data too (velista `0078`, section 3; `0102`): a
 * basket with no shop to name has no section, which covers a run scoped by hand, a
 * profile since deleted and a gateway that failed to price the read. Its second
 * radio opens the picker until a shop is known, so the group reads as two choices
 * with one not yet made.
 *
 * On a basket started at a shop the fieldset is **disabled for everybody**, the
 * owner included, and says so in one line under it. The lock is the server's fact,
 * `Basket.lockedShopId`, and nothing this device stored can draw it or lift it.
 *
 * Choosing **which** shop is a sheet of its own, because a profile can hold fifty of
 * them. Change **pushes** the picker over this sheet, and the picker pops back onto
 * it whether a shop was picked or not, so its back gesture lands here exactly once
 * (`0031`). That is also why nothing here is a draft: a component holding one would
 * not survive the trip.
 */
@Component({
  selector: 'lib-filter-sheet',
  imports: [LockIcon, OutsideAreas, RokuTranslatorPipe, SheetShell],
  templateUrl: './filter-sheet.html',
  styleUrl: './filter-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FilterSheet {
  private readonly _view = inject(BasketViewStore);
  private readonly _sheet = inject(SheetNavigation);
  private readonly _router = inject(Router);
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _locale = inject(RokuLocaleStore).locale;

  /**
   * The basket underneath, which is where closing this sheet goes.
   *
   * From the **store** and not from `paramMap` since velista `0091`: the same
   * page is routed at `shopping-lists/live`, where there is no id in the URL at
   * all, and a sheet that read one there would dismiss to `/shopping-lists/`.
   */
  private readonly _address = inject(BasketStore).address;

  /** The reader's own participant row, for whose shops "any" names. */
  private readonly _me = inject(BasketStore).me;

  protected readonly order = this._view.order;
  protected readonly grouping = this._view.grouping;
  protected readonly sourceLists = this._view.sourceLists;
  protected readonly keptLists = this._view.keptLists;
  private readonly _chosenShop = this._view.chosenShop;

  /**
   * The shop the second radio offers, which outlives choosing the first one.
   *
   * `setShop(null)` **forgets** the shop rather than remembering a null, which is
   * `0076`'s rule and the right one for the next basket. It is the wrong one for the
   * next tap: somebody comparing this shop's prices with the cheapest would have to
   * choose the shop again every time they came back, from a row that had gone back
   * to reading "One shop". So the row this sheet draws is held here while the sheet
   * is open, and the state stays exactly as `0076` wants it.
   *
   * It does not survive the sheet, and it should not: what a device remembers about
   * a shop is `0076`'s answer, and this is a control, not a memory.
   */
  private readonly _lastShop = signal<BasketChosenShop | null>(null);

  /** What the second radio says, whether or not it is the chosen one right now. */
  protected readonly shopRow = computed(
    () => this._chosenShop() ?? this._lastShop()
  );

  /** Whether the person is buying at that shop, which is which radio is checked. */
  protected readonly oneShop = computed(() => this._chosenShop() !== null);

  /**
   * Whether the basket was started at its shop, which disables the whole fieldset
   * for everybody (velista `0102`). The server's fact, never a stored choice.
   */
  protected readonly locked = this._view.shopLocked;

  /**
   * Whether this basket was priced anywhere, which decides the whole section
   * (velista `0078`, section 3).
   *
   * The data decides, as it does for the LISTS section above: a basket with no
   * scopes has no shops to choose between, so there is no radio group rather than a
   * radio group offering one choice.
   */
  protected readonly hasShops = () =>
    this.locked() ||
    this._view.priceScopes().some((scope) => scope.locations.length > 0);

  /**
   * Whether the shopper is told these are **their** shops.
   *
   * The owner's alone. A basket is priced at its owner's shops (`0066`, section 5),
   * and since backend `0163` every participant is served them, so the data no
   * longer tells a guest apart: the participant row does. Anybody else reads "any
   * of the shops", which is true of them.
   */
  protected readonly ownShops = () => this._me()?.kind === 'OWNER';

  /**
   * How many lines the page is showing, for the footer button.
   *
   * The same number the chip row's count says, because it is the same `computed`:
   * two numbers that agreed until somebody grouped by list would be worse than one.
   */
  protected readonly visibleCount = this._view.visibleCount;

  /**
   * Whether this reader has lists at all, which decides two sections at once.
   *
   * One question rather than two, so the "List" grouping and the LISTS section
   * cannot disagree about whether this reader has households.
   */
  protected readonly hasLists = () => this.sourceLists().length > 0;

  protected setOrder(order: BasketOrder): void {
    this._view.setOrder(order);
  }

  protected setGrouping(grouping: BasketGrouping): void {
    this._view.setGrouping(grouping);
  }

  /**
   * Keep or drop one list, and put the box back when the store refuses.
   *
   * The refusal to uncheck the last kept list has to show up as a checkbox that
   * **does not move**, and binding `[checked]` to the store is not enough on its own.
   * A native checkbox flips itself before `change` fires, so by the time the store
   * says no, the DOM has already moved; and the value `[checked]` binds has not
   * changed, so Angular writes nothing back and the box stays where the browser put
   * it. The element is therefore set from the store by hand, which is a no-op on
   * every toggle the store accepts.
   */
  protected toggleList(listId: string, event: Event): void {
    this._view.toggleList(listId);
    (event.target as HTMLInputElement).checked = this.keptLists().has(listId);
  }

  /**
   * The cheapest of the shopper's shops, which is what every basket opens on.
   *
   * The shop is held on the way out (see {@link _lastShop}) so that the radio beside
   * this one keeps offering it: switching between the two views is the gesture this
   * section exists for, and it must not cost a trip to the picker each time.
   */
  protected setAnyShop(): void {
    this._lastShop.set(this._chosenShop());
    this._view.setShop(null);
  }

  /**
   * Prices from the shop the row names, or the picker when the row names none.
   *
   * A native radio checks itself before `change` fires, so with no shop to choose
   * the control is put back by hand, exactly as {@link toggleList} puts a refused
   * checkbox back: the group must not read as "one shop" while the picker is still
   * open, and if the picker is left without a pick the sheet comes back with the
   * store unchanged and the first radio checked.
   */
  protected setOneShop(event: Event): void {
    const shop = this.shopRow();
    if (shop !== null) {
      this._view.setShop(shop.id);
      return;
    }
    (event.target as HTMLInputElement).checked = false;
    this.openPicker();
  }

  /**
   * Open the shop picker, which is Change, Choose and the empty radio alike.
   *
   * A **push** and not `leaveTo`, and that reverses what this did at first: the
   * picker used to replace this sheet, so the picker's own back control, which pops,
   * landed on the basket rather than here, and a shopper who changed their mind was
   * two screens away from the sheet they had left. Pushed, the picker sits over this
   * sheet's entry: its chevron, the scrim, Escape and the phone's back gesture all
   * pop onto this sheet exactly once, and picking a shop pops the same way. Nothing
   * here is lost by the trip, because every control here has already applied.
   */
  protected openPicker(): void {
    void this._router.navigateByUrl(
      shopPickerPath(this._locale(), this._basePath, this._address())
    );
  }

  protected reset(): void {
    this._view.reset();
  }

  /**
   * Cancel, Escape, the scrim, the back button, and the footer button.
   *
   * `dismiss` and not `leaveTo`: there is nothing to commit, so every way out of
   * this sheet is the same way out. The URL is the fallback for a cold load on the
   * sheet's own address, which is reachable: somebody may have shared it.
   */
  protected close(): void {
    void this._sheet.dismiss(
      basketPath(this._locale(), this._basePath, this._address())
    );
  }
}
