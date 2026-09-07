import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
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
 *
 * ## Held, while the app cannot reach the backend
 *
 * Landing is the one screen that draws before the startup probe has answered
 * (plan 0071 D4), because it is the front door and must appear at once. All four of
 * these act on a backend that may not be there, and one of them creates an account, so
 * while the app is not ready they are **held**: they keep their handlers, they keep
 * their place in the tab order, and a press answers with a sentence instead of an act.
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

  /** Whether the app can act on any of these yet. See the class comment. */
  readonly held = input(false);

  /** Whether the wait has gone on long enough to say what is wrong, per D8. */
  readonly slow = input(false);

  /** The two sentences a held press answers with, chosen by {@link slow}. */
  readonly connectingMessage = input('');
  readonly slowMessage = input('');

  /**
   * What a held press says, or the empty string when nothing is held.
   *
   * The second sentence says what is wrong rather than asking for more patience,
   * which is the whole reason there are two.
   */
  readonly message = computed(() => {
    if (!this.held()) {
      return '';
    }

    return this.slow() ? this.slowMessage() : this.connectingMessage();
  });

  /**
   * Emits, unless the app is held, in which case the message below the buttons is the
   * whole of the answer.
   *
   * **`aria-disabled` and never `disabled`** (D5), and this method is the reason.
   * A disabled button swallows its own click, so the sentence explaining why it will
   * not act could never be triggered by the thing the user pressed: they would tap a
   * grey control, nothing would happen, and the app would have said nothing. Held, the
   * control still receives the press, still holds focus, and answers.
   */
  act(action: 'createZone' | 'joinZone' | 'google' | 'email'): void {
    if (this.held()) {
      return;
    }

    switch (action) {
      case 'createZone':
        this.createZone.emit();
        break;
      case 'joinZone':
        this.joinZone.emit();
        break;
      case 'google':
        this.continueWithGoogle.emit();
        break;
      case 'email':
        this.signInWithEmail.emit();
        break;
    }
  }
}
