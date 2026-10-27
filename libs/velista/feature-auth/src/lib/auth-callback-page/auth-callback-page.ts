import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { RokuLocaleStore } from '@portfolio/localization/rokutranslator-angular';
import {
  AuthApi,
  GOOGLE_VERIFIER_KEY,
  TokenStore,
} from '@portfolio/velista/data-access';
import { APP_BASE_PATH } from '@portfolio/velista/models';
import { appPath, BrowserFacade } from '@portfolio/velista/platform';
import { SpinnerIcon } from '@portfolio/velista/ui';

/**
 * Where a Google sign in comes back (velista `0171`, backend `0230`).
 *
 * The gateway's callback redirects here with `#code=…` on success and `#error=…` on a
 * failure. The code is worth nothing alone: this page trades it, with the verifier that
 * `GoogleSignIn.start()` kept in this tab's session storage, through
 * `POST /v1/auth/google/exchange`, stores the pair from the **body** of that answer,
 * and goes home. Anything else goes to the front door: no fragment, an error, no code,
 * no verifier, or an exchange the server refused.
 *
 * ## It stores nothing from the URL
 *
 * A pair in a fragment is not read, mapped or written, whatever its shape. That is the
 * point of the code and the verifier: a link that somebody else made carries a code
 * their browser was given, lands in a browser that holds no verifier for it, posts
 * nothing, and leaves the session held here as it was. Without that, a link was enough
 * to sign a guest into another account and lose their groups (finding F8 of the session
 * token review of 2026-10-27).
 *
 * ## The verifier is spent before the request
 *
 * It is removed from session storage as soon as it is read, so a reload of this page
 * cannot post the same verifier twice, and it is gone whether the exchange succeeds or
 * fails. The server burns the code on a wrong verifier, so a second try would fail
 * anyway.
 *
 * ## Why the fragment and not a query string
 *
 * A query string is sent to the server and written into its logs. A fragment never
 * leaves the browser. The code is short lived and single use, and it is still read from
 * the fragment and replaced at once: both navigations out of this page replace its
 * history entry, so no back step returns to a URL that held it.
 *
 * The exchange goes out in the ordinary context: a guest who links presents their
 * bearer, and the interceptor sends it, refreshing first when it has expired.
 */
/**
 * Both ways out replace the callback's entry in the history, so no back step returns
 * to a URL that carried a fragment. Without it, the front door's own redirect left the
 * callback URL one step behind home (test 7 of the review battery, on a slot).
 */
const LEAVE = { replaceUrl: true } as const;

@Component({
  selector: 'lib-auth-callback-page',
  imports: [SpinnerIcon],
  template: ` <div class="working"><lib-spinner-icon class="spinner" /></div> `,
  styleUrl: './auth-callback-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthCallbackPage {
  private readonly _tokens = inject(TokenStore);
  private readonly _api = inject(AuthApi);
  private readonly _browser = inject(BrowserFacade);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);

  constructor() {
    void this._consume();
  }

  private async _consume(): Promise<void> {
    const code = this._fragmentCode();
    if (code === null) {
      await this._toFrontDoor();
      return;
    }

    const verifier = this._browser.readSessionStorage(GOOGLE_VERIFIER_KEY);
    this._browser.removeSessionStorage(GOOGLE_VERIFIER_KEY);
    if (verifier === null || verifier === '') {
      await this._toFrontDoor();
      return;
    }

    let tokens;
    try {
      tokens = await this._api.exchangeGoogleCode(code, verifier);
    } catch {
      // A refusal, `not_configured` or a network error. The front door is the floor; a
      // later plan can say why.
      await this._toFrontDoor();
      return;
    }

    this._tokens.set(tokens);
    await this._router.navigateByUrl(
      appPath(this._locale(), this._basePath, 'home'),
      LEAVE
    );
  }

  /**
   * The `code` of the fragment, or null when there is none or the fragment names an
   * `error`. Reads nothing else.
   *
   * Through `ActivatedRoute` rather than `location.hash`, so no browser global is
   * touched (rule D2).
   */
  private _fragmentCode(): string | null {
    const fragment = this._route.snapshot.fragment;
    if (fragment === null || fragment === '') {
      return null;
    }

    const params = new URLSearchParams(fragment);
    if (params.has('error')) {
      return null;
    }

    const code = params.get('code');
    return code === null || code === '' ? null : code;
  }

  private async _toFrontDoor(): Promise<void> {
    await this._router.navigateByUrl(
      appPath(this._locale(), this._basePath),
      LEAVE
    );
  }
}
