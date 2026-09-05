import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import {
  AccountNotice,
  AUTH_SERVICE,
  SessionStore,
  type AuthServiceI,
} from '@portfolio/velista/data-access';
import { APP_BASE_PATH } from '@portfolio/velista/models';
import { appPath, PageNavigation } from '@portfolio/velista/platform';
import {
  AuthScreen,
  EmailField,
  FormError,
  GoogleOption,
  PASSWORD_MIN_LENGTH,
  PasswordField,
  SpinnerIcon,
} from '@portfolio/velista/ui';
import { authErrorCopy, type AuthErrorCopy } from '../auth-error-copy';

const ERROR_ID = 'register-error';

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
 * ## Three fields
 *
 * No display name: the backend generates a username regardless of what is sent, and
 * nothing in the app renders a display name. No strength meter either, because nothing
 * the server checks is behind one.
 *
 * There **is** a confirm password field, and section 5.1 argued against one on the
 * grounds that the server does not check it. That is the wrong test: the server cannot
 * check it, because only this screen ever sees the password twice. A typo in the one
 * field nobody can read back produces an account whose password is not the one its
 * owner believes they chose, and the product has no way out of that worth having:
 * signing in fails with the deliberately incurious "that email and password do not
 * match", and the reset flow this app cannot reach yet is what would be needed to
 * recover. Typing it twice is the only check available anywhere, which is why it
 * belongs here rather than nowhere.
 *
 * The mismatch is checked **on submit** rather than as the second field is typed. A
 * password that does not match yet while it is being entered is not wrong, it is
 * unfinished, which is the same reasoning that makes the length rule a rule rather
 * than an error.
 */
@Component({
  selector: 'lib-register-page',
  imports: [
    RokuTranslatorPipe,
    AuthScreen,
    EmailField,
    FormError,
    GoogleOption,
    PasswordField,
    SpinnerIcon,
  ],
  templateUrl: './register-page.html',
  styleUrl: './register-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RegisterPage {
  private readonly _auth = inject<AuthServiceI>(AUTH_SERVICE);
  private readonly _session = inject(SessionStore);
  private readonly _notice = inject(AccountNotice);
  private readonly _router = inject(Router);
  private readonly _pages = inject(PageNavigation);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly errorId = ERROR_ID;
  readonly minPasswordLength = PASSWORD_MIN_LENGTH;

  readonly email = signal('');
  readonly password = signal('');
  readonly confirmPassword = signal('');
  readonly submitting = signal(false);
  readonly error = signal<AuthErrorCopy | null>(null);

  /**
   * All three fields non empty, and nothing else.
   *
   * Neither the length rule nor the match is a condition on the button. The rule is
   * stated on screen from the start and enforced by the server, and disabling the
   * button until either is met would leave somebody staring at a control that will not
   * press with no message saying why. A short password comes back as a
   * `validation_failed` against the password field and a mismatch is answered by
   * `submit`, and both are sentences somebody can act on (section 5.5).
   */
  readonly canSubmit = computed(
    () =>
      this.email() !== '' &&
      this.password() !== '' &&
      this.confirmPassword() !== '' &&
      !this.submitting()
  );

  /** Never to a guest. See the same computed on `SignInPage` for why it matters. */
  readonly googleOffered = computed(() => !this._session.isGuest());

  /** See `SignInPage.onSubmit` for why this is `(submit)` and not `(ngSubmit)`. */
  onSubmit(event: Event): void {
    event.preventDefault();
    void this.submit();
  }

  async submit(): Promise<void> {
    if (!this.canSubmit()) {
      return;
    }

    // Before the request, because there is nothing to ask the server: it sees one
    // password and cannot know it was typed wrong. Compared exactly, with no trimming
    // and no case folding, since both of those are characters somebody may genuinely
    // have meant and a check that ignored them would pass a pair that does not match.
    if (this.password() !== this.confirmPassword()) {
      this.error.set({
        key: 'auth.error.passwordMismatch',
        placement: 'password',
      });
      this._focusConfirmField();
      return;
    }

    const email = this.email().trim();
    this.submitting.set(true);
    this.error.set(null);

    try {
      await this._auth.register(email, this.password());

      // The address the dashboard's nudge names back at them. It is the only place
      // the app knows it: the token pair carries no email and `GET /v1/account/me` is
      // out of scope for this plan.
      this._notice.set('registered', email);

      await this._router.navigateByUrl(
        appPath(this._locale(), this._basePath, 'home')
      );
    } catch (error) {
      this.submitting.set(false);
      this.error.set(authErrorCopy(error, 'auth.register'));
      this._focusFirstField();
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
    const email = this.email().trim();
    void this._router.navigate(
      [appPath(this._locale(), this._basePath, 'auth', 'login')],
      email === '' ? {} : { queryParams: { email } }
    );
  }

  readonly pendingRoutes = signal<readonly string[]>([]);

  continueWithGoogle(): void {
    this.pendingRoutes.update((current) => [...current, 'auth.google']);
  }

  private _focusFirstField(): void {
    this._host.nativeElement
      .querySelector<HTMLInputElement>('input[type="email"]')
      ?.focus();
  }

  /**
   * The second password box, which is the one a mismatch is about.
   *
   * By id rather than by type, because the reveal toggle swaps a password input's type
   * to `text` and a selector on the type would miss a revealed field. The first box is
   * deliberately not focused: its contents are the ones being confirmed, so sending
   * somebody back to it invites them to change the wrong one.
   */
  private _focusConfirmField(): void {
    this._host.nativeElement
      .querySelector<HTMLInputElement>('#register-confirm-password')
      ?.focus();
  }
}
