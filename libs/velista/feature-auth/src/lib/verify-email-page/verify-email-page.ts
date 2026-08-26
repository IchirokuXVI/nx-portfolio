import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import {
  AccountNotice,
  AUTH_SERVICE,
  SessionStore,
  VERIFY_RESEND_AVAILABLE,
  type AuthServiceI,
} from '@portfolio/velista/data-access';
import { APP_BASE_PATH } from '@portfolio/velista/models';
import { appPath } from '@portfolio/velista/platform';
import {
  OutcomeScreen,
  ResendSentence,
  SpinnerIcon,
  type ResendState,
} from '@portfolio/velista/ui';

/** Where the page has got to. `working` is a spinner and nothing else. */
type VerifyState = 'working' | 'confirmed' | 'expired';

/**
 * Opening a confirmation link.
 *
 * ## The token is consumed on arrival
 *
 * There is no button to press first (plan 0009, section 3.3). A "confirm my email"
 * button on a page reached **from** a link that said confirm my email asks the same
 * question twice, and the second ask is the one people abandon. The cost is that a
 * prefetching mail client can spend the token, which is a real trade the plan makes
 * knowingly: the link works once either way, and the expired screen is the same screen.
 *
 * ## Expired, used and unknown are one screen
 *
 * Because the server returns one error for all three and cannot distinguish them
 * either. The copy is careful not to alarm: nothing is wrong with the account, and
 * signing in works exactly the same, which is true because `login()` never looks at
 * `emailVerifiedAt`.
 *
 * ## Public
 *
 * No guard. The link is opened wherever the mail app happens to be, which is often a
 * phone that has never signed in. That is also why the resend sentence is conditional
 * on being signed in: resending needs to know whose address to send to.
 */
@Component({
  selector: 'lib-verify-email-page',
  imports: [RokuTranslatorPipe, OutcomeScreen, ResendSentence, SpinnerIcon],
  templateUrl: './verify-email-page.html',
  styleUrl: './verify-email-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VerifyEmailPage {
  private readonly _auth = inject<AuthServiceI>(AUTH_SERVICE);
  private readonly _session = inject(SessionStore);
  private readonly _notice = inject(AccountNotice);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);

  readonly state = signal<VerifyState>('working');

  /**
   * The address, when this browser happens to know it.
   *
   * The link carries only `?token=`: `mail.service.ts` builds it as
   * `${verifyBaseUrl}?token=${rawToken}` and nothing else, and the token pair carries
   * no email. So the address is known only when the person registered in this same
   * session and the notice is still held, which is the same-tab case. The copy has a
   * second form for when it is not, rather than interpolating an empty string into a
   * sentence about "is yours".
   */
  readonly email = computed(() => this._notice.notice()?.email ?? null);

  readonly confirmedBodyKey = computed(() =>
    this.email() === null
      ? 'auth.verify.confirmedBodyNoEmail'
      : 'auth.verify.confirmedBody'
  );

  /**
   * Whether the resend sentence appears at all.
   *
   * Two conditions, and both are the plan's. It needs an endpoint, which does not exist
   * yet (section 5.8), and it needs to know whose address to send to, which an
   * anonymous viewer cannot tell it (section 5.7).
   */
  readonly resendOffered = computed(
    () => VERIFY_RESEND_AVAILABLE && this._session.isAuthenticated()
  );

  readonly resendState = signal<ResendState>('ready');
  readonly resendWaitSeconds = signal<number | null>(null);

  constructor() {
    void this._consume();
  }

  /** Into the app. `authenticatedGuard` sends an anonymous visitor to the front door. */
  goToGroups(): void {
    void this._router.navigateByUrl(
      appPath(this._locale(), this._basePath, 'home')
    );
  }

  async resend(): Promise<void> {
    const outcome = await this._auth.resendVerification();

    if (outcome.state === 'failed') {
      // Nothing is claimed. The sentence stays on Ready, so the person can try again,
      // which is the only useful thing to offer for a send that may not have happened.
      return;
    }

    this.resendWaitSeconds.set(outcome.waitSeconds);
    this.resendState.set(outcome.state);
  }

  /**
   * Spend the token, once, on arrival.
   *
   * A link with no token at all lands on the expired screen rather than a fourth
   * state: to somebody holding a broken link the two are the same event, and a
   * "malformed link" screen would explain a distinction only the developer cares
   * about.
   */
  private async _consume(): Promise<void> {
    const token = this._route.snapshot.queryParamMap.get('token');
    if (token === null || token === '') {
      this.state.set('expired');
      return;
    }

    try {
      await this._auth.verifyEmail(token);
      this.state.set('confirmed');
    } catch {
      // Expired, already used, unknown, and an unusable response body all arrive here,
      // because the person can do exactly one thing about any of them.
      this.state.set('expired');
    }
  }
}
