import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import {
  AUTH_SERVICE,
  GoogleSignIn,
  type AuthServiceI,
} from '@portfolio/velista/data-access';
import { APP_BASE_PATH } from '@portfolio/velista/models';
import {
  APP_RUNTIME,
  appPath,
  PageNavigation,
} from '@portfolio/velista/platform';
import {
  AuthScreen,
  EmailField,
  FormError,
  GoogleOption,
  LegalLinks,
  PasswordField,
  SpinnerIcon,
} from '@portfolio/velista/ui';
import { authErrorCopy, type AuthErrorCopy } from '../auth-error-copy';
import { RETURN_URL_PARAM, safeReturnUrl } from '../return-url';

/** The id the rejection carries, and the id both fields are described by. */
const ERROR_ID = 'sign-in-error';

/** The id of the message a refused Google start shows, which the button points at. */
const GOOGLE_ERROR_ID = 'sign-in-google-error';

/**
 * Signing in, for somebody whose account is on another phone.
 *
 * **A destination and not a sheet** (plan 0009, section 4.1): two fields, an
 * alternative path at the bottom, and a Google button, none of which fits the "one
 * field completed in place over a page that keeps its context" that rule E1 made the
 * entry actions sheets for.
 *
 * The container, and the only thing here that touches a service token (rule D1).
 * Everything on screen is `ui`, and everything decided is in this file.
 */
@Component({
  selector: 'lib-sign-in-page',
  imports: [
    RokuTranslatorPipe,
    AuthScreen,
    EmailField,
    FormError,
    GoogleOption,
    LegalLinks,
    PasswordField,
    SpinnerIcon,
  ],
  templateUrl: './sign-in-page.html',
  styleUrl: './sign-in-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SignInPage {
  private readonly _auth = inject<AuthServiceI>(AUTH_SERVICE);
  private readonly _google = inject(GoogleSignIn);
  private readonly _router = inject(Router);
  private readonly _pages = inject(PageNavigation);
  private readonly _route = inject(ActivatedRoute);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);

  /** Where the two legal links at the foot of the screen go (velista `0172`). */
  readonly legalUrls = computed(() => ({
    privacy: appPath(this._locale(), this._basePath, 'privacy'),
    terms: appPath(this._locale(), this._basePath, 'terms'),
  }));
  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly errorId = ERROR_ID;
  readonly googleErrorId = GOOGLE_ERROR_ID;

  /**
   * Prefilled from `?email=`, which is what the register screen's `conflict` message
   * carries when it offers to sign in instead (section 5.5).
   *
   * The whole point of that offer is that the person does not type the address a
   * second time, so arriving without it filled in would make the link decorative.
   */
  readonly email = signal(
    this._route.snapshot.queryParamMap.get('email') ?? ''
  );
  readonly password = signal('');

  /**
   * The page that sent somebody here, when it is one to trust (velista `0154`).
   * The share link page and the basket page send it, so signing in lands back on
   * the link and not on the dashboard.
   */
  private readonly _returnUrl = safeReturnUrl(
    this._route.snapshot.queryParamMap.get(RETURN_URL_PARAM)
  );

  readonly submitting = signal(false);

  /** The rejection, or null. A key and a placement, never a string from the server. */
  readonly error = signal<AuthErrorCopy | null>(null);

  /**
   * Both fields non empty is the whole rule.
   *
   * There is deliberately no inline check of the address's shape while typing
   * (section 3.1): half a typed address is not a wrong one, and the only opinion that
   * matters is the server's.
   */
  readonly canSubmit = computed(
    () => this.email() !== '' && this.password() !== '' && !this.submitting()
  );

  /**
   * Whether to offer Google at all: everywhere except the native shell.
   *
   * Google refuses to sign anybody in from an embedded WebView, so inside the Android
   * app the button and its divider are not drawn (velista `0166`). A guest is offered
   * it like anybody else, because backend `0230` links the guest account in place and
   * keeps its groups.
   */
  readonly googleOffered = inject(APP_RUNTIME) !== 'native';

  /** True from a tap on Google until the document leaves, or until the start fails. */
  readonly googleStarting = signal(false);

  /**
   * A refused Google start, or null. Its own message beside the button and not the
   * form's, because nothing either field holds had anything to do with it.
   */
  readonly googleError = signal<AuthErrorCopy | null>(null);

  /**
   * The form's own submit, which is what makes the phone keyboard's Go key work.
   *
   * `(submit)` and not `(ngSubmit)`: the latter is `NgForm`'s output and needs
   * `FormsModule`, which these pages do not import and do not want, because nothing
   * here uses a form control. Without the module `(ngSubmit)` binds to a DOM event of
   * that name, which no browser ever fires, so the Go key and the button would both
   * do nothing. `preventDefault` is then this handler's job rather than the
   * directive's: without it the browser navigates and the page reloads.
   */
  onSubmit(event: Event): void {
    event.preventDefault();
    void this.submit();
  }

  async submit(): Promise<void> {
    if (!this.canSubmit()) {
      return;
    }

    this.submitting.set(true);
    this.error.set(null);

    try {
      await this._auth.login(this.email().trim(), this.password());

      // The pair is already in `TokenStore`, so the dashboard's own guard passes and
      // its constructor loads the groups. Nothing here needs to fetch anything.
      await this._router.navigateByUrl(
        this._returnUrl ?? appPath(this._locale(), this._basePath, 'home')
      );
    } catch (error) {
      this.submitting.set(false);
      this.error.set(authErrorCopy(error, 'auth.login'));
      this._focusFirstField();
    }
  }

  back(): void {
    void this._pages.back(appPath(this._locale(), this._basePath));
  }

  /**
   * To the forgot password page, with whatever address is typed (velista `0148`).
   *
   * The address goes as `?email=`, the way the register page hands one here. An empty
   * field sends none, so the next page opens empty rather than holding a blank value.
   */
  forgotPassword(): void {
    const email = this.email().trim();
    void this._router.navigate(
      [appPath(this._locale(), this._basePath, 'auth', 'forgot-password')],
      email === '' ? {} : { queryParams: { email } }
    );
  }

  /** To register, carrying the page to come back to on (velista `0154`). */
  createAccount(): void {
    void this._router.navigate(
      [appPath(this._locale(), this._basePath, 'auth', 'register')],
      this._returnUrl === null
        ? {}
        : { queryParams: { [RETURN_URL_PARAM]: this._returnUrl } }
    );
  }

  /**
   * Google, which sends the document to the gateway (velista `0171`).
   *
   * On success the page is leaving, so the busy state stays on. A refusal comes back
   * as a sentence beside the button, and a second tap tries again.
   */
  async continueWithGoogle(): Promise<void> {
    if (this.googleStarting()) {
      return;
    }

    this.googleStarting.set(true);
    this.googleError.set(null);

    try {
      await this._google.start();
    } catch (error) {
      this.googleStarting.set(false);
      this.googleError.set(authErrorCopy(error, 'auth.google'));
    }
  }

  /**
   * After a failure, focus goes back to the first field rather than staying on the
   * button, so the fix begins where the correction is made (section 7).
   */
  private _focusFirstField(): void {
    this._host.nativeElement
      .querySelector<HTMLInputElement>('input[type="email"]')
      ?.focus();
  }
}
