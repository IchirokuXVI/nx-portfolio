import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { CloseIcon, MailIcon } from '../icons/icons';
import { ResendSentence, type ResendState } from './resend-sentence';

/**
 * The card on the dashboard that asks somebody to confirm the address they just gave.
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
  /** The address the person just typed, which the body names back at them. */
  readonly email = input.required<string>();

  /**
   * Whether to offer another send at all.
   *
   * False until the section 5.8 endpoint lands, and the card is the screen plan 0009
   * would have shipped anyway without its last sentence.
   */
  readonly resendOffered = input(false);

  readonly resendState = input<ResendState>('ready');
  readonly resendWaitSeconds = input<number | null>(null);

  readonly resend = output<void>();
  readonly dismiss = output<void>();
}
