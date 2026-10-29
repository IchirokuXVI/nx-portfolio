import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { AlertIcon, SpinnerIcon } from '../icons/icons';
import { LinkedText } from './linked-text';

/**
 * The terms to accept before the app goes on (velista `0173`, target 8).
 *
 * `AppLayout` draws it **in place of the page**, as it draws the update screen (D3): a
 * cover over a live page would let presses reach the page below. It is drawn while the
 * account must accept the current version, never in a support session, and never on a
 * page somebody must read first, which is where its two links go.
 *
 * ## No checkbox
 *
 * The press is the acceptance (D1), and the button says what it does. The only other
 * way forward is "Sign out", offered to an account with credentials and never to a
 * guest, who would lose the account with it.
 *
 * Presentational: the state, the addresses and whether sign out is offered all come
 * from `AppLayout`, which reads `TermsGate`.
 */
@Component({
  selector: 'lib-terms-prompt',
  imports: [AlertIcon, LinkedText, RokuTranslatorPipe, SpinnerIcon],
  template: `
    <section aria-labelledby="terms-prompt-title" class="prompt">
      <div class="content">
        <h2 class="title" id="terms-prompt-title" tabindex="-1">
          {{
            (acceptedBefore()
              ? 'legal.prompt.titleChanged'
              : 'legal.prompt.title'
            ) | rokuT
          }}
        </h2>
        <p class="body">
          <lib-linked-text
            [href]="termsUrl()"
            [text]="
              (acceptedBefore()
                ? 'legal.prompt.bodyChanged'
                : 'legal.prompt.body'
              ) | rokuT
            "
          />
        </p>
        <p class="body">
          <lib-linked-text
            [href]="privacyUrl()"
            [text]="'legal.accept.privacy' | rokuT"
          />
        </p>
      </div>

      <div class="actions">
        @if (state() === 'failed') {
          <p class="error" id="terms-prompt-error" role="alert">
            <lib-alert-icon aria-hidden="true" class="glyph" />
            {{ 'legal.prompt.failed' | rokuT }}
          </p>
        }

        <!-- Keeps its name while busy and gains aria-busy, so what is happening is
             announced and not only drawn (plan 0009, section 7). -->
        <button
          (click)="accepted.emit()"
          [attr.aria-busy]="state() === 'accepting'"
          [attr.aria-describedby]="
            state() === 'failed' ? 'terms-prompt-error' : null
          "
          class="primary"
          type="button"
        >
          @if (state() === 'accepting') {
            <lib-spinner-icon aria-hidden="true" class="glyph" />
          }
          {{ 'legal.prompt.accept' | rokuT }}
        </button>

        @if (canSignOut()) {
          <button (click)="signedOut.emit()" class="quiet" type="button">
            {{ 'account.signOut.action' | rokuT }}
          </button>
        }
      </div>
    </section>
  `,
  styleUrl: './terms-prompt.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TermsPrompt {
  /** Whether an older version was accepted, which picks the heading and the body. */
  readonly acceptedBefore = input(false);

  /** The terms' page, built with `appPath` by the container. */
  readonly termsUrl = input.required<string>();

  /** The privacy policy's page, built the same way. */
  readonly privacyUrl = input.required<string>();

  /** Where the press stands: `TermsGate.state()`. */
  readonly state = input<'idle' | 'accepting' | 'failed'>('idle');

  /** Whether "Sign out" is offered. Never for a guest. */
  readonly canSignOut = input(false);

  readonly accepted = output<void>();
  readonly signedOut = output<void>();
}
