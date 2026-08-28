import { ChangeDetectionStrategy, Component, output } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { AlertIcon } from '../icons/icons';

/**
 * The screen for `guest-account-lost` (plan 0008, section 3.4).
 *
 * Rare, not the person's fault, and not recoverable: their groups were held by a
 * refresh token this device no longer has, and there is no credential anywhere that
 * can reach them again. `ZoneApi` returns it as a first class result rather than
 * sending the request, because sending it would have minted a second guest account and
 * silently orphaned the first (rule D3).
 *
 * **Whole screen, not an inline message**, and that is the design decision worth
 * knowing: an inline message inside the sheet would leave the primary button sitting
 * there offering to make exactly the duplicate account the rule exists to prevent. The
 * one action clears the session and returns to the front door, which is the only path
 * that leads anywhere true.
 *
 * `role="alertdialog"` and `aria-live="assertive"`, matching `ConnectionLost`: both are
 * blocking screens that appear without being asked for.
 */
@Component({
  selector: 'lib-account-lost-panel',
  imports: [RokuTranslatorPipe, AlertIcon],
  template: `
    <div aria-live="assertive" class="blocking" role="alertdialog">
      <div class="panel">
        <lib-alert-icon aria-hidden="true" class="mark" />
        <h2 class="title">{{ 'entry.accountLost.title' | rokuT }}</h2>
        <p class="body">{{ 'entry.accountLost.body' | rokuT }}</p>
        <button (click)="restart.emit()" class="action" type="button">
          {{ 'entry.accountLost.restart' | rokuT }}
        </button>
      </div>
    </div>
  `,
  styleUrl: './account-lost-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountLostPanel {
  readonly restart = output<void>();
}
