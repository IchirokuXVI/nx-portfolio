import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import { BasketListStore } from '@portfolio/velista/data-access';
import { APP_BASE_PATH, type BasketAddress } from '@portfolio/velista/models';
import { appPath } from '@portfolio/velista/platform';
import { ClockIcon, RowSkeleton } from '@portfolio/velista/ui';
import { BASKET_PATHS, basketPath } from '../basket-paths';

/**
 * What the third tab opens: always a basket (velista `0111`).
 *
 * ## It is a doorway because the answer is not a URL
 *
 * A tab has to be one address, and the basket it opens has a different address
 * depending on what the account holds. So the tab points here, and here points at the
 * basket: **the newest open generated basket when there is one, and the live basket
 * otherwise.** The redirect uses `replaceUrl`, so the address bar names the basket, a
 * reload lands on it rather than on a screen that redirects again, and back from the
 * basket returns to wherever the tab was pressed rather than to this screen.
 *
 * ## It never draws an empty state
 *
 * The live basket is always there: the server creates it on the first read. So there
 * is no account for which the tab has nothing to open, and the offer that used to sit
 * here, Make my shopping list, lives on the history, one press from every basket's
 * header.
 *
 * ## A failed read goes to the live basket
 *
 * Rather than drawing an error. The listing only decides **which** basket to open, and
 * the live basket needs no listing to be opened, so a failure costs somebody at most
 * the generated basket they were halfway through, which the history still reaches.
 *
 * While the listing is being read the screen draws the rows it is about to become,
 * with the clock in the header so the history stays one press away.
 */
@Component({
  selector: 'lib-basket-current',
  imports: [RokuTranslatorPipe, RouterOutlet, ClockIcon, RowSkeleton],
  templateUrl: './basket-current.html',
  styleUrl: './basket-current.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BasketCurrentPage {
  private readonly _generated = inject(BasketListStore);
  private readonly _router = inject(Router);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);

  /** Whether the redirect has been sent, so a store moving afterwards cannot send two. */
  private _left = false;

  constructor() {
    // The store answers once per app run and hands the same listing to every screen
    // that asks, so this costs nothing on the way back from the basket it just sent
    // somebody to. A listing that failed earlier is read again, because a failure
    // held from an hour ago would send the tab to the live basket for the rest of
    // the run.
    void (this._generated.state() === 'failed'
      ? this._generated.reload()
      : this._generated.load());

    // The redirect. An effect rather than a resolver, because the answer arrives from a
    // store that may already hold it: a resolver would make the tab wait for a request
    // that has often already happened.
    effect(() => {
      const load = this._generated.state();

      // `idle` counts as loading: the first read starts in this constructor, so idle is
      // the instant before it happens.
      if (load === 'idle' || load === 'loading') {
        return;
      }

      // The **newest**, for `selectShoppingList`'s reason: several can be open at once
      // when somebody composes a second run before finishing the first, and the
      // history is one press away in the basket's header for the other.
      const newest =
        load === 'loaded' ? (this._generated.active()[0] ?? null) : null;
      const address: BasketAddress =
        newest === null ? 'live' : { basketId: newest.id };

      untracked(() => this._leaveFor(address));
    });
  }

  /**
   * The history.
   *
   * By absolute URL rather than by a relative climb: this route's path is **two**
   * segments, so `['..']` from here lands on `shopping-lists` and appending the same
   * word again would address `shopping-lists/shopping-lists`.
   */
  openHistory(): void {
    void this._router.navigateByUrl(
      appPath(this._locale(), this._basePath, BASKET_PATHS.list)
    );
  }

  private _leaveFor(address: BasketAddress): void {
    if (this._left) {
      return;
    }
    this._left = true;

    void this._router.navigateByUrl(
      basketPath(this._locale(), this._basePath, address),
      { replaceUrl: true }
    );
  }
}
