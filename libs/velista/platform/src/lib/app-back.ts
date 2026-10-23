import { inject, Injectable } from '@angular/core';
import { BackStack } from './back-stack';
import { PageNavigation } from './page-navigation';

/**
 * What a back press came to.
 *
 * - `handled`: something on screen answered it, a sheet, a header or an overlay.
 * - `popped`: nothing did, and the entry behind was one of ours, so it was popped.
 * - `floor`: nothing did and nothing of ours is behind. The caller decides what the
 *   floor means; a native shell minimizes rather than exits.
 */
export type AppBackOutcome = 'handled' | 'popped' | 'floor';

/**
 * The answer to a back press that arrives without a target (velista `0166`, target 7).
 *
 * The browser's own back button never comes here: it is a popstate, and `AppHistory`
 * and the sheet fall guard already handle it. This is for a native shell's hardware
 * button, whose listener calls {@link request} and acts on `floor`. The web app does
 * not call it.
 */
@Injectable({ providedIn: 'root' })
export class AppBack {
  private readonly _stack = inject(BackStack);
  private readonly _pages = inject(PageNavigation);

  request(): AppBackOutcome {
    if (this._stack.handle()) {
      return 'handled';
    }

    return this._pages.popIfOurs() ? 'popped' : 'floor';
  }
}
