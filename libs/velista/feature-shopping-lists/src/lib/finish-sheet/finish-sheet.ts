import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import {
  BasketStore,
  GeneratedListStore,
} from '@portfolio/velista/data-access';
import { APP_BASE_PATH } from '@portfolio/velista/models';
import {
  generatedListIdOf,
  SheetNavigation,
} from '@portfolio/velista/platform';
import { SheetShell } from '@portfolio/velista/ui';
import { basketPath } from '../basket-paths';

/**
 * Ending the trip, confirmed (plan 0057, section 5).
 *
 * ## Why this is a real question
 *
 * A confirmation is worth a screen when what it is about cannot be seen from the one
 * it covers (`0031`), and this is exactly that case twice over. Finishing closes the
 * basket **for everybody in it**, including three people who may still be walking
 * around a shop, and none of them are on the owner's screen; and the lines nobody
 * settled are not being bought, not being dropped and not being recorded as anything,
 * which is `0047` section 3's rule and is not inferable from a button labelled Finish
 * shopping.
 *
 * The third line is the one that earns the sheet, so it is stated as a count and a
 * consequence rather than as a warning. It is **absent when nothing is outstanding**,
 * because a sheet in that case would be confirming something with no consequence to
 * warn about.
 *
 * ## What it does not warn about
 *
 * Finality, because there is none: the banner underneath offers Reopen, one tap and
 * no confirmation of its own (section 8). The whole of what this asks about is the
 * people and their unsettled lines.
 *
 * It also does not revoke the link, evict a guest or drop anybody's socket
 * (section 6.1). Somebody in the shop when this lands keeps the basket open and keeps
 * their name on the rows they settled; their screen redraws in place from
 * `generatedList.updated`.
 *
 * ## Two stores, and why
 *
 * The **write** is on `GeneratedListStore`, whose every method is the owner's and
 * whose transport is account authenticated: a guest holding a participant session
 * cannot reach that route with any token they have, which is what makes section 2's
 * "the owner and nobody else" a fact about the server rather than about this
 * template. What is **read** is `BasketStore`, because the count this sheet warns
 * about is a fact about the lines on the screen underneath.
 *
 * `BasketStore.refresh` follows the write rather than waiting for the socket. The
 * broadcast does arrive, coalesced by a second and a half, and a screenful of
 * controls that stayed live for that long after the gesture reads as a button that
 * did not work.
 */
@Component({
  selector: 'lib-finish-sheet',
  imports: [RokuTranslatorPipe, SheetShell],
  templateUrl: './finish-sheet.html',
  styleUrl: './finish-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FinishSheet {
  private readonly _basket = inject(BasketStore);
  private readonly _generated = inject(GeneratedListStore);
  private readonly _sheet = inject(SheetNavigation);
  private readonly _route = inject(ActivatedRoute);
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _locale = inject(RokuLocaleStore).locale;

  /** The basket underneath, which is where closing this sheet goes. */
  private readonly _generatedListId = generatedListIdOf(this._route);

  private readonly _busy = signal(false);
  private readonly _failed = signal(false);

  protected readonly busy = this._busy.asReadonly();
  protected readonly failed = this._failed.asReadonly();

  /**
   * How many lines nobody settled, which is the sentence this sheet is for.
   *
   * Read off the store rather than passed in, and asserted in the spec as this
   * input rather than as rendered text: the copy is a plural rule with a count
   * substituted into it, and a test that read the sentence would be testing the
   * translator (the house rule for every interpolated string in this app).
   */
  protected readonly unsettled = this._basket.unsettled;

  /**
   * End the trip.
   *
   * The sheet closes on success and **stays open on failure**, which is the same
   * split every confirming sheet in this app makes: there is nothing behind this one
   * that could report the failure, and closing onto a basket that is still live with
   * no explanation is the worst of the three things that could happen.
   */
  protected async finish(): Promise<void> {
    this._busy.set(true);
    this._failed.set(false);

    const landed = await this._generated.setStatus(
      this._generatedListId(),
      'COMPLETED'
    );

    if (!landed) {
      this._busy.set(false);
      this._failed.set(true);
      return;
    }

    // The basket screen is drawn from its own store, which knows nothing of the
    // account surface this write went out on. See the class comment for why this
    // does not wait for the socket to say the same thing.
    await this._basket.refresh();
    this._busy.set(false);
    this.close();
  }

  /**
   * Cancel, Escape, the scrim, the back button, and a finish that went through.
   *
   * The basket's whole URL, like every sheet in this app, and here it is load
   * bearing rather than tidy: a sheet reached from a shared link is the **arrival**
   * rather than a step within a session, so there may be nothing behind it to pop
   * (section 5).
   */
  protected close(): void {
    void this._sheet.dismiss(
      basketPath(this._locale(), this._basePath, this._generatedListId())
    );
  }
}
