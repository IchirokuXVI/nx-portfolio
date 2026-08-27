import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { SpinnerIcon, WarningIcon } from '../icons/icons';

/**
 * A group whose owner deleted their account.
 *
 * `0003` skipped `MARKED_FOR_DELETION` and `0008` inherited the skip. This is where it
 * gets answered, because claiming is the **only** action anywhere in the product that
 * gets a zone out of that state (plan 0010, section 3.5).
 *
 * Two screens in one component, and the difference is a single button:
 *
 * - **An admin** is offered the group. They are the only role core lets claim it.
 * - **Anybody else** is told the same thing and offered nothing, because there is
 *   nothing. The copy asks them to find an admin rather than inventing a way out that
 *   the backend does not have.
 *
 * ## No countdown, ever
 *
 * Core's reaper deletes an unowned zone once a grace period passes, the grace period is
 * core's configuration, and no endpoint reports it. A number invented on the client is
 * exactly the kind of thing people plan around, so this panel says the group will be
 * deleted and refuses to say when.
 */
@Component({
  selector: 'lib-ownerless-panel',
  imports: [RokuTranslatorPipe, SpinnerIcon, WarningIcon],
  template: `
    <section class="panel">
      <lib-warning-icon class="glyph" />

      <h2 class="title">{{ 'zone.ownerless.title' | rokuT }}</h2>
      <p class="body">{{ 'zone.ownerless.body' | rokuT }}</p>

      @if (errorKey(); as key) {
        <p aria-live="polite" class="error" role="status">{{ key | rokuT }}</p>
      }

      @if (canClaim()) {
        <button
          (click)="claim.emit()"
          [attr.aria-busy]="busy()"
          [disabled]="busy()"
          class="primary"
          type="button"
        >
          @if (busy()) {
            <lib-spinner-icon class="spinning" />
          }
          <span>{{ 'zone.ownerless.claim' | rokuT }}</span>
        </button>
      } @else {
        <p class="hint">{{ 'zone.ownerless.askAdmin' | rokuT }}</p>
      }
    </section>
  `,
  styleUrl: './ownerless-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OwnerlessPanel {
  /** True for an ADMIN, and for nobody else. Core refuses everybody else anyway. */
  readonly canClaim = input.required<boolean>();
  readonly busy = input(false);
  /**
   * The **key** of a message when the claim failed, or null for none.
   *
   * A key and not a resolved string, matching `MemberRow`'s action labels: the caller
   * chooses which sentence a failure gets (that is the whole of section 5.6's code
   * plus operation table) and this renders whichever it named. Null renders nothing,
   * which is not the same as an empty string in an `aria-live` region.
   */
  readonly errorKey = input<string | null>(null);

  readonly claim = output<void>();
}
