import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import { BasketStore, BasketTargetStore } from '@portfolio/velista/data-access';
import { APP_BASE_PATH, type BasketListRef } from '@portfolio/velista/models';
import { SheetNavigation } from '@portfolio/velista/platform';
import { SheetShell } from '@portfolio/velista/ui';
import { basketPath } from '../basket-paths';

/** One group's lists, under the group's name. */
interface ListGroup {
  readonly zoneId: string;
  readonly zoneName: string;
  readonly lists: readonly BasketListRef[];
}

/**
 * Which list is this for? (velista `0092`, section 7.3.)
 *
 * Every line added from the basket names a list now, so somebody adding
 * "batteries" in an aisle has to have said where it goes. This is where they say
 * it, once: the chip above the field remembers the answer for this basket, and
 * the next six things go to the same place without anybody being asked again.
 *
 * ## It writes nothing
 *
 * Choosing a target is not an act on a list, on a basket or on anything the
 * server holds. It is a setting on the composer, kept on this device, and the
 * only thing it changes is where the **next** add goes. So this sheet has no busy
 * state, no failure and no confirmation: it picks and dismisses.
 *
 * ## Grouped, because a list alone is ambiguous
 *
 * Two households both keep one called "Groceries". The group's name is what tells
 * them apart, and it is the heading rather than a suffix on each row, so a basket
 * covering four of one household's lists says that household's name once.
 *
 * The **server's order** in both dimensions, and never re-sorted here: the refs
 * arrive in the order `Basket.lists` names them, which is the same order every
 * other list of lists on this screen uses.
 *
 * ## One radio group and not one per household
 *
 * There is one question — which list — and the headings are that group's option
 * groups rather than four groups of one option each. A reader moving by arrow key
 * travels the whole set, which is what they would expect of a choice between
 * seven lists.
 */
@Component({
  selector: 'lib-target-list-sheet',
  imports: [RokuTranslatorPipe, SheetShell],
  templateUrl: './target-list-sheet.html',
  styleUrl: './target-list-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TargetListSheet {
  private readonly _store = inject(BasketStore);
  private readonly _target = inject(BasketTargetStore);
  private readonly _sheet = inject(SheetNavigation);
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _locale = inject(RokuLocaleStore).locale;

  /**
   * The basket underneath, which is what the way out of here is built on.
   *
   * From the **store** and not from `paramMap` since velista `0091`: the same
   * page is routed at `shopping-lists/live`, where there is no id in the URL at
   * all, and a sheet that read one there would dismiss to `/shopping-lists/`.
   */
  private readonly _address = this._store.address;

  protected readonly chosenId = computed(
    () => this._target.target()?.listId ?? null
  );

  /**
   * The lists this reader may write, under their households' names.
   *
   * `Basket.lists` is already exactly that set (backend `0130`, section 6): it is
   * the redaction rather than a filter applied here, so a guest is served none
   * and this sheet draws nothing. The page never opens it for them, because a
   * guest gets no composer at all.
   */
  protected readonly groups = computed<readonly ListGroup[]>(() => {
    const groups: ListGroup[] = [];
    for (const list of this._store.basket()?.lists ?? []) {
      const held = groups.find((group) => group.zoneId === list.zoneId);
      if (held === undefined) {
        groups.push({
          zoneId: list.zoneId,
          zoneName: list.zoneName,
          lists: [list],
        });
        continue;
      }
      (held.lists as BasketListRef[]).push(list);
    }
    return groups;
  });

  /**
   * Whether a list was chosen here, rather than the sheet being dismissed
   * without an answer (velista `0113`).
   *
   * Read by the basket page as the sheet's route goes, because that is the one
   * moment focus can be handed to the composer's field: the sheet hands focus back
   * only on Escape and the scrim, and a choice is neither.
   */
  get chose(): boolean {
    return this._chose;
  }

  private _chose = false;

  /** Say where the next add goes, and get out of the way. */
  protected choose(list: BasketListRef): void {
    this._target.choose(list);
    this._chose = true;
    this.close();
  }

  /**
   * Cancel, Escape, the scrim and the back button.
   *
   * The basket's **whole** URL rather than a relative `..`, which is the rule
   * every sheet in this app follows (plan 0031): a relative climb lands on a
   * segment no route declares and dismisses onto the app's own 404.
   */
  protected close(): void {
    void this._sheet.dismiss(
      basketPath(this._locale(), this._basePath, this._address())
    );
  }
}
