import { ChangeDetectionStrategy, Component, output } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { GoogleIcon, JoinCodeIcon, PlusIcon } from '../icons/icons';

/**
 * The four ways in, on the anonymous screen.
 *
 * Exactly four, and the order is the argument: create and join come first and are the
 * only ones that need no account at all, because the fastest thing this product can do
 * for a stranger is get them into a list. Google and email sit below a divider, for
 * people who already have an account.
 *
 * All four sit in the bottom third, in thumb reach, since the whole app is used one
 * handed on a phone (plan 0003, section 7).
 *
 * The Google button is drawn here rather than by Google's own script: the exchange is
 * owned entirely by the backend, which redirects back with the token pair, and no
 * Google library is loaded into this app (user decision, 2026-08-26).
 */
@Component({
  selector: 'lib-auth-actions',
  imports: [RokuTranslatorPipe, PlusIcon, JoinCodeIcon, GoogleIcon],
  templateUrl: './auth-actions.html',
  styleUrl: './auth-actions.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthActions {
  readonly createZone = output<void>();
  readonly joinZone = output<void>();
  readonly continueWithGoogle = output<void>();
  readonly signInWithEmail = output<void>();
}
