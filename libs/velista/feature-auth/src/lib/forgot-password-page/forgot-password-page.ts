import {
  afterNextRender,
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
  type AuthServiceI,
} from '@portfolio/velista/data-access';
import { APP_BASE_PATH } from '@portfolio/velista/models';
import { appPath, PageNavigation } from '@portfolio/velista/platform';
import {
  AuthScreen,
  EmailField,
  FormError,
  ResendSentence,
  SpinnerIcon,
  type ResendState,
} from '@portfolio/velista/ui';
import { authErrorCopy, type AuthErrorCopy } from '../auth-error-copy';

/** The id the message carries, and the id the field is described by. */
const ERROR_ID = 'forgot-password-error';

/**
 * Asking for a reset link, from the sign in page (velista `0148`).
 *
 * ## It never says whether the address has an account
 *
 * `forgot-password` answers the same for every address, on purpose, so the page cannot
 * know and says what it did rather than what arrived: "if that address has an account
 * with us, we have sent it a mail". It never claims delivery.
 *
 * ## The wait is the server's number
 *
 * Rule C3, as on the resend line: after a send, the sentence counts down the wait the
 * server named, and a refusal names the server's wait too. Neither is a hardcoded
 * minute.
 *
 * ## Focus goes to the field
 *
 * The page exists to type one value, so the field takes focus on arrival. The address
 * usually comes from the sign in page already typed, and focus then puts the person
 * one tap from sending it.
 */
@Component({
  selector: 'lib-forgot-password-page',
  imports: [
    RokuTranslatorPipe,
    AuthScreen,
    EmailField,
    FormError,
    ResendSentence,
    SpinnerIcon,
  ],
  templateUrl: './forgot-password-page.html',
  styleUrl: './forgot-password-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ForgotPasswordPage {
  private readonly _auth = inject<AuthServiceI>(AUTH_SERVICE);
  private readonly _router = inject(Router);
  private readonly _pages = inject(PageNavigation);
  private readonly _route = inject(ActivatedRoute);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly errorId = ERROR_ID;

  /** Prefilled from `?email=`, which the sign in page sends with whatever was typed. */
  readonly email = signal(
    this._route.snapshot.queryParamMap.get('email') ?? ''
  );

  readonly submitting = signal(false);

  /** The address a link was asked for, or null while the form is showing. */
  readonly askedFor = signal<string | null>(null);

  /** How the last ask went, for the sentence under the explanation. */
  readonly resendState = signal<ResendState>('sent');
  readonly resendWaitSeconds = signal<number | null>(null);

  /** A key and its values, never a string from the server. */
  readonly error = signal<{
    readonly copy: AuthErrorCopy;
    readonly wait: string | null;
  } | null>(null);

  readonly canSubmit = computed(
    () => this.email().trim() !== '' && !this.submitting()
  );

  constructor() {
    afterNextRender(() => this._focusField());
  }

  /** See `SignInPage.onSubmit` for why this is `(submit)` and not `(ngSubmit)`. */
  onSubmit(event: Event): void {
    event.preventDefault();
    void this.submit();
  }

  async submit(): Promise<void> {
    if (!this.canSubmit()) {
      return;
    }

    const email = this.email().trim();
    this.submitting.set(true);
    this.error.set(null);

    const outcome = await this._auth.forgotPassword(email);
    this.submitting.set(false);

    switch (outcome.state) {
      case 'sent':
        this.resendState.set('sent');
        this.resendWaitSeconds.set(outcome.waitSeconds);
        this.askedFor.set(email);
        return;

      case 'refused':
        // Nothing was sent, so the page stays on the form and says why, with the
        // server's wait and never an invented one.
        this.error.set({
          copy: {
            key:
              outcome.waitSeconds === null
                ? 'auth.resend.refusedNoWait'
                : 'auth.resend.refused',
            placement: 'email',
          },
          wait: clock(outcome.waitSeconds),
        });
        return;

      case 'failed':
        this.error.set({
          copy: authErrorCopy(outcome.error, 'auth.forgotPassword'),
          wait: null,
        });
        this._focusField();
        return;
    }
  }

  /** "Nothing yet? Send another link", once the server's wait has run out. */
  async sendAgain(): Promise<void> {
    const email = this.askedFor();
    if (email === null) {
      return;
    }

    const outcome = await this._auth.forgotPassword(email);
    if (outcome.state === 'failed') {
      // Nothing is claimed, and the sentence stays on Ready so the person can try again.
      this.resendState.set('ready');
      return;
    }

    this.resendWaitSeconds.set(outcome.waitSeconds);
    this.resendState.set(outcome.state);
  }

  /** "Wrong email? Change it": back to the form, with the address still in it. */
  changeEmail(): void {
    this.askedFor.set(null);
    this.error.set(null);
    // After the form is drawn again. Only ever from a tap, so never during a server
    // render.
    setTimeout(() => this._focusField());
  }

  signIn(): void {
    const email = this.email().trim();
    void this._router.navigate(
      [appPath(this._locale(), this._basePath, 'auth', 'login')],
      email === '' ? {} : { queryParams: { email } }
    );
  }

  back(): void {
    void this._pages.back(
      appPath(this._locale(), this._basePath, 'auth', 'login')
    );
  }

  private _focusField(): void {
    this._host.nativeElement
      .querySelector<HTMLInputElement>('input[type="email"]')
      ?.focus();
  }
}

/** The server's wait as `m:ss`, the way the resend line writes it. */
function clock(seconds: number | null): string | null {
  if (seconds === null) {
    return null;
  }

  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}
