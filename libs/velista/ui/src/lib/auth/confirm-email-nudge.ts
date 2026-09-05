import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { CloseIcon, MailIcon } from '../icons/icons';
import { ResendSentence, type ResendState } from './resend-sentence';

/**
 * The card on the dashboard that asks somebody to confirm their address.
 *
 * **It is drawn for as long as the address is unconfirmed, not once.** It used to be
 * fed only by `AccountNotice`, which the register screen sets for exactly one
 * navigation and the dashboard clears on destroy, so the card existed for a single
 * visit and then never again: signing in on another day, reloading, or simply leaving
 * the dashboard and coming back all lost it while the address stayed unconfirmed. The
 * dashboard now reads the profile as well and keeps drawing this until the account
 * says the address is confirmed. `occasion` is what keeps the copy honest across the
 * two.
 *
 * **Dismissible, and never a wall.** `register()` issues tokens as its last act and
 * sends the confirmation email outside the transaction, with a comment saying delivery
 * failure must not roll back a successful registration, because verification is
 * optional. `login()` never looks at `emailVerifiedAt` either. So the second Register
 * frame is the dashboard rather than a "check your email" screen, and building a
 * blocking step here would invent a barrier the product does not have and strand
 * everybody whenever mail delivery failed (plan 0009, section 5.2).
 *
 * The body is honest about what confirming buys, for the same reason: it says
 * confirming keeps the account yours, and does not claim it unlocks anything, because
 * today it unlocks nothing observable.
 *
 * The resend sentence is projected in only when there is an endpoint behind it, which
 * the container decides. See `VERIFY_RESEND_AVAILABLE`.
 */
@Component({
  selector: 'lib-confirm-email-nudge',
  imports: [RokuTranslatorPipe, CloseIcon, MailIcon, ResendSentence],
  templateUrl: './confirm-email-nudge.html',
  styleUrl: './confirm-email-nudge.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfirmEmailNudge {
  /** The address the card names back at them. */
  readonly email = input.required<string>();

  /**
   * Which of the two moments this is, which decides what the body may claim.
   *
   * `justRegistered` follows the form by one navigation, so it can say a link was
   * sent. `unconfirmed` is the standing case: the dashboard found an address the
   * account has never confirmed, and the last email may have gone out days ago or
   * never have arrived at all. Saying "we sent a link" there would be a claim about an
   * event this card has no knowledge of, so it does not make one.
   */
  readonly occasion = input<'justRegistered' | 'unconfirmed'>('justRegistered');

  /** Whether to offer another send at all. See `VERIFY_RESEND_AVAILABLE`. */
  readonly resendOffered = input(false);

  readonly bodyKey = computed(() =>
    this.occasion() === 'justRegistered'
      ? 'auth.nudge.body'
      : 'auth.nudge.bodyStanding'
  );

  /**
   * Which question introduces the resend.
   *
   * "Did not get it?" only makes sense beside a body that just said one was sent. The
   * standing card asks whether the person still wants to confirm at all, which is the
   * same question the expired link screen asks and the same copy.
   */
  readonly promptKey = computed<
    'auth.resend.prompt' | 'auth.resend.promptExpired'
  >(() =>
    this.occasion() === 'justRegistered'
      ? 'auth.resend.prompt'
      : 'auth.resend.promptExpired'
  );

  readonly resendState = input<ResendState>('ready');
  readonly resendWaitSeconds = input<number | null>(null);

  readonly resend = output<void>();
  readonly dismiss = output<void>();
}
