import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { RokuLocaleStore } from '@portfolio/localization/rokutranslator-angular';
import { TokenStore, toSessionTokens } from '@portfolio/velista/data-access';
import { APP_BASE_PATH } from '@portfolio/velista/models';
import { appPath } from '@portfolio/velista/platform';
import { SpinnerIcon } from '@portfolio/velista/ui';

/**
 * Where the Google exchange will land, once the gateway redirects instead of
 * answering JSON.
 *
 * ## It is built now and does nothing yet
 *
 * `GoogleController.callback` returns `Promise<AuthTokens>`, so a browser that followed
 * the OAuth redirect lands on a page of JSON with no way back into the app. It needs to
 * **302 to this route with the pair in the URL fragment**. That is a gateway change and
 * the only one this page is waiting on (plan 0009, section 5.6, item 1).
 *
 * Without a fragment it is inert: it reads nothing, stores nothing, and sends the
 * visitor to the front door, which is where somebody who arrived here by accident
 * belongs. Building it now costs one file and means wiring Google later is this page
 * plus removing one condition from a button.
 *
 * ## Why the fragment and not a query string
 *
 * A query string is sent to the server and written into its logs, and these are live
 * credentials. A fragment never leaves the browser. That is also why this page consumes
 * it and navigates away immediately rather than leaving it in the address bar.
 *
 * ## The other half is not this page's problem, and is the dangerous half
 *
 * The callback sends `{ ...profile }` and nothing else, while
 * `GoogleLoginRequest.linkUserId` is what makes `googleLogin` call `upgrade()` and
 * convert the caller in place. Without it a guest tapping Continue with Google is
 * handed a **fresh registered user** and loses every group, exactly as rule C2
 * describes for register. Until that lands the button is not offered to a guest at all,
 * which is a condition on the button and an acceptance criterion of its own.
 */
@Component({
  selector: 'lib-auth-callback-page',
  imports: [SpinnerIcon],
  template: ` <div class="working"><lib-spinner-icon class="spinner" /></div> `,
  styleUrl: './auth-callback-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthCallbackPage {
  private readonly _tokens = inject(TokenStore);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);

  constructor() {
    void this._consume();
  }

  private async _consume(): Promise<void> {
    const tokens = this._fragmentTokens();

    if (tokens === null) {
      await this._router.navigateByUrl(appPath(this._locale(), this._basePath));
      return;
    }

    this._tokens.set(tokens);
    await this._router.navigateByUrl(
      appPath(this._locale(), this._basePath, 'home')
    );
  }

  /**
   * The pair out of the fragment, or null.
   *
   * Read through `ActivatedRoute.fragment` rather than `location.hash`, so no browser
   * global is touched (rule D2) and the value is whatever the router parsed.
   *
   * Rule D4 applies with full force: this is an unauthenticated redirect target, so
   * the fragment is attacker-controllable in the sense that anybody can put anything in
   * it. `toSessionTokens` is what stops a half-formed pair being written, and a pair
   * that cannot be mapped is treated as no pair at all rather than as an error worth a
   * screen.
   */
  private _fragmentTokens() {
    const fragment = this._route.snapshot.fragment;
    if (fragment === null || fragment === '') {
      return null;
    }

    const params = new URLSearchParams(fragment);
    return toSessionTokens(Object.fromEntries(params.entries()));
  }
}
