import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import { ListViewStore } from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  NO_CATEGORY,
  type ListCategoryPick,
  type ListViewMode,
  type ListViewOrder,
} from '@portfolio/velista/models';
import {
  appPath,
  listIdOf,
  SheetNavigation,
  zoneIdOf,
} from '@portfolio/velista/platform';
import { SheetShell } from '@portfolio/velista/ui';

/**
 * How a zone list is ordered, and which of its categories is shown (velista `0082`,
 * section 4).
 *
 * ## Nothing is confirmed here, because nothing is pending
 *
 * Every control applies the moment it is tapped, as the basket's filter sheet does, so
 * there is no Apply. The footer button is a way out that says what it leaves behind.
 *
 * ## One category asks before it changes anything
 *
 * Choosing "One category" reveals the categories present on this list and changes
 * nothing on the page until one is picked. Leaving the sheet with the question
 * unanswered puts the view back to "All lines", and that happens in this component's
 * teardown rather than in a close handler, because the scrim, Escape, the back
 * gesture and the footer all leave, and only the teardown is certain to run for all
 * of them.
 */
@Component({
  selector: 'lib-list-filter-sheet',
  imports: [RokuTranslatorPipe, SheetShell],
  templateUrl: './list-filter-sheet.html',
  styleUrl: './list-filter-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ListFilterSheet {
  private readonly _view = inject(ListViewStore);
  private readonly _sheet = inject(SheetNavigation);
  private readonly _route = inject(ActivatedRoute);
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _locale = inject(RokuLocaleStore).locale;

  private readonly _zoneId = zoneIdOf(this._route);
  private readonly _listId = listIdOf(this._route);

  protected readonly noCategory = NO_CATEGORY;

  protected readonly order = this._view.order;
  protected readonly view = this._view.view;
  protected readonly category = this._view.category;
  protected readonly categories = this._view.categoryCounts;
  protected readonly visibleCount = this._view.visibleCount;

  constructor() {
    inject(DestroyRef).onDestroy(() => this._view.settle());
  }

  protected setOrder(order: ListViewOrder): void {
    this._view.setOrder(order);
  }

  protected setView(view: ListViewMode): void {
    this._view.setView(view);
  }

  protected pickCategory(category: ListCategoryPick): void {
    this._view.pickCategory(category);
  }

  /** Both sections back to their defaults. */
  protected reset(): void {
    this._view.reset();
  }

  /**
   * Cancel, Escape, the scrim, the back button, and the footer button.
   *
   * `dismiss` and not `leaveTo`: there is nothing to commit. The URL is the fallback
   * for a cold load on the sheet's own address.
   */
  protected close(): void {
    void this._sheet.dismiss(
      appPath(
        this._locale(),
        this._basePath,
        'zones',
        this._zoneId(),
        'lists',
        this._listId()
      )
    );
  }
}
