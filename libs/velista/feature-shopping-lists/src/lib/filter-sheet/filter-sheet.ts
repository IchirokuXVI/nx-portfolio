import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import { BasketViewStore } from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  type BasketGrouping,
  type BasketOrder,
} from '@portfolio/velista/models';
import {
  generatedListIdOf,
  SheetNavigation,
} from '@portfolio/velista/platform';
import { SheetShell } from '@portfolio/velista/ui';
import { basketPath } from '../basket-paths';

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
 * A guest gets ORDER and GROUP BY and nothing else. There is no `seesZoneData`
 * branch in the template: the LISTS section is drawn from
 * {@link BasketViewStore.sourceLists}, which is empty for a reader the server sent
 * no sources to, and the "List" grouping is drawn from the same emptiness. The data
 * decides, which is the rule `0044` section 4.1 set for the row's "from" caption and
 * the reason a redaction cannot be got wrong in one place and right in another.
 *
 * ## What is not here
 *
 * **PRICES FROM is `0078`'s** and absent until then: it needs one offer per scope,
 * which the basket read does not yet carry (backend `0109`). The GROUP BY radios
 * exist and set the state, and `0077` is what makes category and list cut the lines
 * up; until it lands, choosing one changes the chip row and nothing else. That is
 * deliberate rather than half done: the state has to travel before anything can act
 * on it, and `0076` stores it.
 */
@Component({
  selector: 'lib-filter-sheet',
  imports: [RokuTranslatorPipe, SheetShell],
  templateUrl: './filter-sheet.html',
  styleUrl: './filter-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FilterSheet {
  private readonly _view = inject(BasketViewStore);
  private readonly _sheet = inject(SheetNavigation);
  private readonly _route = inject(ActivatedRoute);
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _locale = inject(RokuLocaleStore).locale;

  /** The basket underneath, which is where closing this sheet goes. */
  private readonly _generatedListId = generatedListIdOf(this._route);

  protected readonly order = this._view.order;
  protected readonly grouping = this._view.grouping;
  protected readonly sourceLists = this._view.sourceLists;
  protected readonly keptLists = this._view.keptLists;

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
      basketPath(this._locale(), this._basePath, this._generatedListId())
    );
  }
}
