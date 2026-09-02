import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { RokuLocaleStore } from '@portfolio/localization/rokutranslator-angular';
import { BasketStore } from '@portfolio/velista/data-access';
import { APP_BASE_PATH, type BasketLine } from '@portfolio/velista/models';
import {
  generatedListIdOf,
  SheetNavigation,
} from '@portfolio/velista/platform';
import { SheetShell } from '@portfolio/velista/ui';
import { settleSheetPath } from '../basket-paths';

/**
 * Changing what each list asked for (velista `0055`).
 *
 * **A shell and nothing else yet.** The route, the URL, the title and the way out
 * are here so that everything around this sheet can be built and tested against it;
 * the body of it is `0055`'s to fill, from `BasketStore.loadLineOrigins` and
 * `setOriginQuantity`.
 *
 * ## Where it goes back to
 *
 * The **settle sheet**, not the basket. This one is reached from there, so leaving
 * it onto the basket would take somebody two screens back from one gesture. Through
 * {@link SheetNavigation} like every other dismissal in the app, so back does not
 * reopen what was just closed, and naming the URL in full because a relative climb
 * makes this component's correctness depend on how many segments its own route
 * happens to have (plan 0031).
 */
@Component({
  selector: 'lib-line-units-sheet',
  imports: [SheetShell],
  templateUrl: './line-units-sheet.html',
  styleUrl: './line-units-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LineUnitsSheet {
  private readonly _store = inject(BasketStore);
  private readonly _sheet = inject(SheetNavigation);
  private readonly _route = inject(ActivatedRoute);
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _locale = inject(RokuLocaleStore).locale;

  /** The basket underneath, which is what the way back is composed from. */
  private readonly _generatedListId = generatedListIdOf(this._route);
  private readonly _lineId = this._route.snapshot.paramMap.get('lineId') ?? '';

  /** The line this sheet is about, read live so a write updates it under us. */
  protected readonly line = computed<BasketLine | null>(
    () => this._store.lines().find((row) => row.id === this._lineId) ?? null
  );

  /** The sheet's accessible title, which is the line's own words. */
  protected readonly title = computed(() => this.line()?.content ?? '');

  protected close(): void {
    void this._sheet.dismiss(
      settleSheetPath(
        this._locale(),
        this._basePath,
        this._generatedListId(),
        this._lineId
      )
    );
  }
}
