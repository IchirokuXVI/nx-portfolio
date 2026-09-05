import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import {
  AUTH_SERVICE,
  ProfileStore,
  type AuthServiceI,
} from '@portfolio/velista/data-access';
import { APP_BASE_PATH } from '@portfolio/velista/models';
import { appPath, SheetNavigation } from '@portfolio/velista/platform';
import {
  MailIcon,
  ResendSentence,
  SheetShell,
  type ResendState,
} from '@portfolio/velista/ui';

/**
 * What an unconfirmed address opens, and the one place in the product that can send
 * another confirmation email.
 *
 * ## Why the row leads anywhere at all
 *
 * It did not. `0015` drew the address as a statement with a Confirmed or Not confirmed
 * chip beside it, and said so in a comment: there is no screen behind an email address
 * because it cannot be changed anywhere in this product. That is still true of a
 * **confirmed** address, and that row is still a statement. An unconfirmed one is a
 * different thing: it is the only actionable state on this screen that had no action,
 * so somebody whose confirmation email never arrived read "Not confirmed" on their own
 * account page with nothing to press. The resend endpoint has existed since
 * luna-shopper plan 0021 and no screen called it, because `VERIFY_RESEND_AVAILABLE`
 * was never turned over.
 *
 * ## A sheet rather than an action on the row
 *
 * The row beside it, Change password, does act on a tap and mails something. This one
 * does not follow it, and the difference is what the person needs to be told. A reset
 * link explains itself from the row's own detail line. Confirming does not: the useful
 * answer to "Not confirmed" is what confirming is for, whether it is required, and
 * where the last email went, and none of that fits under a row. So this is one decision
 * with its context around it, which is what a sheet is for, and rule E1 (`0008`) makes
 * it a child route so the account screen keeps its scroll and Android's back button
 * dismisses it.
 *
 * ## Nothing here is a wall
 *
 * Confirming is optional in this product: `register()` sends the email outside its
 * transaction so a delivery failure cannot roll back an account, and `login()` never
 * looks at `emailVerifiedAt`. So this sheet has no consequence to warn about and no
 * primary action to complete. It explains, it offers another send, and Close is a
 * perfectly good way to leave it.
 *
 * ## Rule C3 lives in `ResendSentence`, not here
 *
 * The bucket is one per minute, and how much of it is left is the server's to say: the
 * same sentence is drawn on the dashboard and on the expired link screen, so an ask
 * made on one of those may already have spent the window this one is looking at. This
 * hands over whatever `retryAfterSeconds` came back and never a number of its own.
 */
@Component({
  selector: 'lib-confirm-email-sheet',
  imports: [RokuTranslatorPipe, MailIcon, ResendSentence, SheetShell],
  templateUrl: './confirm-email-sheet.html',
  styleUrl: './confirm-email-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfirmEmailSheet {
  private readonly _profile = inject(ProfileStore);
  private readonly _auth = inject<AuthServiceI>(AUTH_SERVICE);
  private readonly _sheet = inject(SheetNavigation);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);

  /** How the last ask went, and the wait the server named for it. */
  readonly resendState = signal<ResendState>('ready');
  readonly resendWait = signal<number | null>(null);

  /**
   * The address, or null while it is being read.
   *
   * Null is a real state here rather than a missing value: this URL is reachable cold,
   * by a reload or a shared link, and then the profile has not landed yet. The body
   * that names the address is held back until it can, because a sentence with a blank
   * where the email should be is worse than a sentence that arrives a moment later.
   */
  readonly email = computed(() => this._profile.profile()?.email ?? null);

  /**
   * Whether the address has already been confirmed.
   *
   * It can become true while this sheet is open, which is the ordinary way this ends:
   * the link is opened on a laptop and the profile is re-read. It is also the state a
   * cold arrival can land in, since nothing guards this route on the answer. Either
   * way the sheet says so and stops offering a send.
   */
  readonly confirmed = computed(
    () => this._profile.profile()?.emailVerified === true
  );

  constructor() {
    // A cold arrival: this sheet can be the first thing a reload draws, and then
    // nothing has read the profile. Warm, it makes no request, which is what makes
    // this safe to call unconditionally from a screen the account page usually opens.
    if (this._profile.profile() === null) {
      void this._profile.load();
    }
  }

  /**
   * Ask for another confirmation email.
   *
   * A failure is not reported as a refusal. Nothing is claimed and the sentence stays
   * on Ready, which is the only useful offer for a send that may or may not have
   * happened; the dashboard's copy of this does the same.
   */
  async resend(): Promise<void> {
    const outcome = await this._auth.resendVerification();
    if (outcome.state === 'failed') {
      this.resendState.set('ready');
      return;
    }

    this.resendState.set(outcome.state);
    this.resendWait.set(outcome.waitSeconds);
  }

  /** Close, Escape and the scrim, all of them back to the account screen. */
  async dismiss(): Promise<void> {
    await this._sheet.dismiss(
      appPath(this._locale(), this._basePath, 'account')
    );
  }
}
