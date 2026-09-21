import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
} from '@angular/core';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import {
  BasketListStore,
  GatewayError,
  NetworkError,
} from '@portfolio/velista/data-access';
import { APP_BASE_PATH } from '@portfolio/velista/models';
import {
  appPath,
  BrowserFacade,
  sheetSegments,
} from '@portfolio/velista/platform';
import {
  BasketIcon,
  ClockIcon,
  ErrorState,
  RowSkeleton,
} from '@portfolio/velista/ui';
import { BASKET_PATHS, basketPath } from '../basket-paths';

/** The three things this screen can be doing. There is no fourth. */
export type BasketCurrentState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'empty' }
  | { readonly kind: 'error'; readonly correlationId: string | null };

/**
 * What the third tab opens: the basket being shopped, or the offer to make one
 * (velista `0097`, section 7).
 *
 * ## It is a screen because the answer is not a URL
 *
 * A tab has to be one address, and the basket being shopped has a different address
 * every time one is composed. So the tab points here, and here points at the basket:
 * **with a live basket this redirects to that basket's own URL**, so the address bar
 * names the basket and a reload lands on it rather than on a screen that redirects
 * again. `replaceUrl` is what makes that true in both directions: back from the basket
 * returns to wherever the tab was pressed, rather than to this screen, which would
 * redirect forward and trap the gesture.
 *
 * ## With no basket it is the offer that used to sit on home
 *
 * Home's button row went with `0097`, and both of its halves are here: **Make my
 * shopping list** opens the generation sheet over this page, and the clock in the
 * header opens the history. The clock is in the header in **both** states rather than
 * only in the empty one, because the history is the one screen that answers "what did I
 * shop before" and it must stay one press from the tab while this screen is deciding.
 *
 * ## The failure is the history's failure
 *
 * This reads the same listing the history page reads, out of the same app scoped store,
 * so it says what that screen says when the read fails rather than inventing a second
 * vocabulary for one request. An empty state drawn over a failed read would tell
 * somebody with a basket in progress that they have nothing to shop.
 */
@Component({
  selector: 'lib-basket-current',
  imports: [
    RokuTranslatorPipe,
    RouterOutlet,
    BasketIcon,
    ClockIcon,
    ErrorState,
    RowSkeleton,
  ],
  templateUrl: './basket-current.html',
  styleUrl: './basket-current.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BasketCurrentPage {
  private readonly _generated = inject(BasketListStore);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _browser = inject(BrowserFacade);

  /**
   * The newest basket being shopped, or null.
   *
   * `BasketListStore.active` and not a status comparison, so this screen and the
   * dashboard card cannot disagree about what "being shopped" means: the server
   * composes a run as `DRAFT` and never promotes it, which is the whole reason that
   * signal reads the live pair.
   *
   * The **newest**, for `selectShoppingList`'s reason: several can be live at once when
   * somebody composes a second run before finishing the first, and guessing which one
   * they mean would be wrong for somebody. The history is one press away in the header.
   */
  private readonly _live = computed(() => this._generated.active()[0] ?? null);

  readonly state = computed<BasketCurrentState>(() => {
    const load = this._generated.state();

    if (load === 'failed') {
      return {
        kind: 'error',
        correlationId: correlationIdOf(this._generated.error()),
      };
    }

    // `idle` counts as loading, for the history's reason: the first read starts in this
    // component's constructor, so idle is the instant before it happens and drawing
    // "nothing to shop yet" in it would flash the empty state at somebody who is
    // halfway round a shop.
    if (load === 'idle' || load === 'loading') {
      return { kind: 'loading' };
    }

    return { kind: 'empty' };
  });

  constructor() {
    // The store answers once per app run and hands the same listing to every screen
    // that asks, so this costs nothing on the way back from the basket it just sent
    // somebody to.
    void this._generated.load();

    // The redirect. An effect rather than a resolver, because the answer arrives from a
    // store that may already hold it: a resolver would make the tab wait for a request
    // that has often already happened.
    effect(() => {
      const live = this._live();
      if (live === null) {
        return;
      }

      void this._router.navigateByUrl(
        basketPath(this._locale(), this._basePath, { basketId: live.id }),
        { replaceUrl: true }
      );
    });
  }

  /**
   * The generation sheet, over **this** page (rule E1, plan 0008).
   *
   * A child route and so a bare relative path, exactly as the dashboard's and the
   * history's copies are. Cancel comes back here, because the sheet's `returnTo` names
   * this page.
   */
  makeList(): void {
    void this._router.navigate(sheetSegments('get'), {
      relativeTo: this._route,
    });
  }

  /**
   * The history.
   *
   * By absolute URL rather than by a relative climb, and that is not a preference: this
   * route's path is **two** segments, so `['..']` from here lands on `shopping-lists`
   * and appending the same word again would address `shopping-lists/shopping-lists`.
   * `appPath` writes down neither the mount nor the locale, which is what the relative
   * form was protecting (the extraction contract, item 5).
   */
  openHistory(): void {
    void this._router.navigateByUrl(
      appPath(this._locale(), this._basePath, BASKET_PATHS.list)
    );
  }

  retry(): void {
    void this._generated.reload();
  }

  /**
   * Copies the support reference. Best effort, exactly as the history's is: the
   * Clipboard API needs a secure context and a gesture, and the reference is selectable
   * text besides (plan 0003, section 7).
   */
  copyReference(reference: string): void {
    void this._browser.window?.navigator.clipboard
      ?.writeText(reference)
      .catch(() => undefined);
  }
}

function correlationIdOf(error: unknown): string | null {
  return error instanceof GatewayError || error instanceof NetworkError
    ? error.correlationId
    : null;
}
