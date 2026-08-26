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
  SessionStore,
  type AuthServiceI,
} from '@portfolio/velista/data-access';
import { APP_BASE_PATH } from '@portfolio/velista/models';
import { appPath } from '@portfolio/velista/platform';
import {
  AuthScreen,
  EmailField,
  FormError,
  GoogleOption,
  PasswordField,
  SpinnerIcon,
} from '@portfolio/velista/ui';
import { authErrorCopy, type AuthErrorCopy } from '../auth-error-copy';

/** The id the rejection carries, and the id both fields are described by. */
const ERROR_ID = 'sign-in-error';

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
    PasswordField,
    SpinnerIcon,
  ],
  templateUrl: './sign-in-page.html',
  styleUrl: './sign-in-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SignInPage {
  private readonly _auth = inject<AuthServiceI>(AUTH_SERVICE);
  private readonly _session = inject(SessionStore);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly errorId = ERROR_ID;

  /**
   * Prefilled from `?email=`, which is what the register screen's `conflict` message
   * carries when it offers to sign in instead (section 5.5).
   *
   * The whole point of that offer is that the person does not type the address a
   * second time, so arriving without it filled in would make the link decorative.
   */
  readonly email = signal(this._route.snapshot.queryParamMap.get('email') ?? '');
  readonly password = signal('');

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
   * Whether to offer Google at all.
   *
   * Never to a guest, and that is not defensive tidiness: until the gateway passes
   * `linkUserId`, `googleLogin` takes the create branch and mints a **fresh registered
   * user**, so a guest who tapped it would lose every group exactly as rule C2
   * describes for register (section 5.6). `anonymousOnlyGuard` already keeps a guest
   * off this route, and this is the second lock on the same door, on the button
   * itself, where the plan asks for it.
   */
  readonly googleOffered = computed(() => !this._session.isGuest());

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
        appPath(this._locale(), this._basePath, 'home')
      );
    } catch (error) {
      this.submitting.set(false);
      this.error.set(authErrorCopy(error, 'auth.login'));
      this._focusFirstField();
    }
  }

  back(): void {
    void this._router.navigateByUrl(appPath(this._locale(), this._basePath));
  }

  createAccount(): void {
    void this._router.navigateByUrl(
      appPath(this._locale(), this._basePath, 'auth', 'register')
    );
  }

  /**
   * Google, which records rather than navigates until section 5.6 lands.
   *
   * Observable rather than an empty body, exactly as `0008` left the entry actions: a
   * test can assert the button is wired to the right destination, which is the half of
   * this that stays true once the gateway redirects properly.
   */
  readonly pendingRoutes = signal<readonly string[]>([]);

  continueWithGoogle(): void {
    this.pendingRoutes.update((current) => [...current, 'auth.google']);
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
