import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import {
  AccountNotice,
  AUTH_SERVICE,
  GoogleSignIn,
  type AuthServiceI,
} from '@portfolio/velista/data-access';
import { APP_BASE_PATH } from '@portfolio/velista/models';
import { appPath, PageNavigation } from '@portfolio/velista/platform';
import { AuthScreen, LegalLinks } from '@portfolio/velista/ui';
import {
  AccountForm,
  type AccountFormValue,
} from '../account-form/account-form';
import { authErrorCopy, type AuthErrorCopy } from '../auth-error-copy';
import { authTerms } from '../auth-terms';
import { RETURN_URL_PARAM, safeReturnUrl } from '../return-url';

/**
 * Making an account, for somebody who has nothing to lose yet.
 *
 * ## Rule C2 is enforced above this, at the route
 *
 * `register()` creates a **new** `User` row. A guest who reached this screen would fill
 * in a perfectly valid form, land on an empty dashboard, and have no way back: their
 * groups still exist, owned by an account whose only credential was the token this call
 * just replaced, and nothing would have warned them. `anonymousOnlyGuard` is what makes
 * that unreachable, and a guard spec is what proves it (plan 0009, section 5.3). This
 * page therefore does not check, because a check here would be a second answer to a
 * question the route has already settled, and the two could disagree.
 *
 * ## There is no wall after this
 *
 * `register()` issues tokens as its last act and sends the confirmation email outside
 * the transaction, with a comment saying delivery failure must not roll back a
 * successful registration. `login()` never looks at `emailVerifiedAt` either. So this
 * lands on the dashboard, signed in, with a dismissible nudge and no blocking step
 * anywhere (section 5.2).
 *
 * ## The form is `AccountForm`
 *
 * The three fields, the checkbox for the terms, the checks before the request and the
 * Google option live in the form register and upgrade share (velista `0173`). The
 * confirmation and the order of the checks are recorded there. This page makes the
 * call, offers sign in on a `conflict`, and draws the footer.
 */
@Component({
  selector: 'lib-register-page',
  imports: [
    RokuTranslatorPipe,
    AccountForm,
    AuthScreen,
    LegalLinks,
    RouterOutlet,
  ],
  templateUrl: './register-page.html',
  styleUrl: './register-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RegisterPage {
  private readonly _auth = inject<AuthServiceI>(AUTH_SERVICE);
  private readonly _google = inject(GoogleSignIn);
  private readonly _notice = inject(AccountNotice);
  private readonly _router = inject(Router);
  private readonly _pages = inject(PageNavigation);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _form = viewChild(AccountForm);

  /** Where the two legal links at the foot of the screen go (velista `0172`). */
  readonly legalUrls = computed(() => ({
    privacy: appPath(this._locale(), this._basePath, 'privacy'),
    terms: appPath(this._locale(), this._basePath, 'terms'),
  }));

  /** The terms over this form, Google, and the version a press accepts (velista `0173`). */
  readonly terms = authTerms(['auth', 'register']);

  /** The page to come back to, carried on from sign in (velista `0154`). */
  private readonly _returnUrl = safeReturnUrl(
    inject(ActivatedRoute).snapshot.queryParamMap.get(RETURN_URL_PARAM)
  );

  readonly submitting = signal(false);
  readonly error = signal<AuthErrorCopy | null>(null);

  /** See `SignInPage.googleStarting`. */
  readonly googleStarting = signal(false);

  /** See `SignInPage.googleError`. */
  readonly googleError = signal<AuthErrorCopy | null>(null);

  /**
   * The form passed its own checks: make the account.
   *
   * The version sent is the one the settings name at this press (velista `0173`,
   * target 3). A refusal about it reads the settings again, and the form clears its box
   * and links the new terms.
   */
  async submit(value: AccountFormValue): Promise<void> {
    if (this.submitting()) {
      return;
    }

    this.submitting.set(true);
    this.error.set(null);

    try {
      await this._auth.register(
        value.email,
        value.password,
        this.terms.version()
      );

      // The address the dashboard's nudge names back at them. It is the only place
      // the app knows it: the token pair carries no email.
      this._notice.set('registered', value.email);

      await this._router.navigateByUrl(
        this._returnUrl ?? appPath(this._locale(), this._basePath, 'home')
      );
    } catch (error) {
      this.submitting.set(false);
      const copy = authErrorCopy(error, 'auth.register');
      this.error.set(copy);
      if (copy.placement === 'terms') {
        this.terms.reload();
      } else {
        this._form()?.focusFirst();
      }
    }
  }

  back(): void {
    void this._pages.back(appPath(this._locale(), this._basePath));
  }

  /**
   * Sign in instead, carrying the address that was already typed.
   *
   * Reached two ways and both end here: the footer, and the `conflict` message's own
   * offer. The message's version is the one that matters, because being told an
   * address is taken and then having to type it again is the moment a person gives up
   * (section 5.5).
   */
  signIn(): void {
    const email = this._form()?.email().trim() ?? '';
    void this._router.navigate(
      [appPath(this._locale(), this._basePath, 'auth', 'login')],
      {
        queryParams: {
          ...(email === '' ? {} : { email }),
          ...(this._returnUrl === null
            ? {}
            : { [RETURN_URL_PARAM]: this._returnUrl }),
        },
      }
    );
  }

  /**
   * See `SignInPage.continueWithGoogle`, which this is the same as. The line under the
   * button names the terms, so the version goes with the start (velista `0173`).
   */
  async continueWithGoogle(): Promise<void> {
    if (this.googleStarting()) {
      return;
    }

    this.googleStarting.set(true);
    this.googleError.set(null);

    try {
      await this._google.start({ acceptedTermsVersion: this.terms.version() });
    } catch (error) {
      this.googleStarting.set(false);
      const copy = authErrorCopy(error, 'auth.google');
      if (copy.placement === 'terms') {
        this.terms.reload();
      }
      this.googleError.set(copy);
    }
  }
}
