import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import { BasketStore } from '@portfolio/velista/data-access';
import { APP_BASE_PATH } from '@portfolio/velista/models';
import {
  appPath,
  ListSearchNavigation,
  SheetNavigation,
} from '@portfolio/velista/platform';
import {
  ClockIcon,
  FlagIcon,
  PersonIcon,
  PlusIcon,
  SheetShell,
} from '@portfolio/velista/ui';
import { basketDoors, basketMenuEntries, hasFinishSheet } from '../basket-menu';
import { BASKET_PATHS, basketPath, basketSheetPath } from '../basket-paths';

/**
 * The basket's menu (velista `0130`, section 6.1).
 *
 * ## Why there is a menu at all
 *
 * The basket's header held the history, the title, the map, the faces, share and
 * finish, and at 390 wide the title was cut to nothing. A header holds a title and
 * its quick actions, so three stay there, share, the map and the button that opens
 * this, and everything else is a row here: the people, the history, composing a new
 * shopping list, and ending the trip.
 *
 * ## One row per thing the reader may do
 *
 * A row that is not allowed is **absent**, never disabled (`0030`). Which rows those
 * are is {@link basketMenuEntries}, the same function the page asks before it draws
 * the button that opens this, so the button and the rows cannot disagree: no button
 * leads to an empty sheet, and no row appears that its old button would not have.
 *
 * ## Every row leaves with `leaveTo`
 *
 * A row is a way to somewhere else, not a way out of this sheet, so it **replaces**
 * this sheet's history entry instead of pushing over it. Back from the people sheet
 * then lands on the basket, and back from the history lands on the basket too, which
 * is where the history's own button used to send it back to. Pushed, both would land
 * on a menu nobody asked to see again.
 */
@Component({
  selector: 'lib-more-sheet',
  imports: [
    ClockIcon,
    FlagIcon,
    PersonIcon,
    PlusIcon,
    RokuTranslatorPipe,
    SheetShell,
  ],
  templateUrl: './more-sheet.html',
  styleUrl: './more-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MoreSheet {
  private readonly _basket = inject(BasketStore);
  private readonly _sheet = inject(SheetNavigation);
  private readonly _search = inject(ListSearchNavigation);
  private readonly _route = inject(ActivatedRoute);
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _locale = inject(RokuLocaleStore).locale;

  /**
   * The basket underneath, from the **store** and not from `paramMap`: the same page
   * is routed at `shopping-lists/live`, where the URL holds no id (velista `0091`).
   */
  private readonly _address = this._basket.address;

  private readonly _doors = basketDoors(this._basket);

  /**
   * Whether the page underneath has a finish sheet to open. This sheet's parent
   * route is the page's, so the question is asked of the same route the page asks.
   */
  private readonly _finishSheet = hasFinishSheet(this._route.parent);

  /** The rows, in the order they are drawn. */
  protected readonly entries = computed(() =>
    basketMenuEntries(this._doors, this._finishSheet)
  );

  /**
   * How many people can open this basket, beside the People row. Zero draws nothing:
   * the row can be there for somebody holding the basket open whom the list does not
   * name yet.
   */
  protected readonly peopleCount = computed(
    () => this._basket.participants().length
  );

  protected openPeople(): void {
    void this._sheet.leaveTo(this._sheetUrl('people'));
  }

  /** The history page. Replaced and not pushed, so back from it is the basket. */
  protected openHistory(): void {
    void this._sheet.leaveTo(
      appPath(this._locale(), this._basePath, BASKET_PATHS.list)
    );
  }

  /** Compose a new shopping list, over this same basket. */
  protected openCreate(): void {
    void this._sheet.leaveTo(this._sheetUrl('get'));
  }

  protected openFinish(): void {
    void this._sheet.leaveTo(this._sheetUrl('finish'));
  }

  /** Escape, the scrim and the back button. */
  protected close(): void {
    void this._sheet.dismiss(
      basketPath(this._locale(), this._basePath, this._address())
    );
  }

  /**
   * A sibling sheet's URL, keeping the search that was open under this one, as the
   * page does when it opens a sheet itself (velista `0109`).
   */
  private _sheetUrl(...about: readonly string[]): string {
    const path = basketSheetPath(
      this._locale(),
      this._basePath,
      this._address(),
      ...about
    );
    const kept = new URLSearchParams(this._search.kept(this._route)).toString();

    return kept === '' ? path : `${path}?${kept}`;
  }
}
