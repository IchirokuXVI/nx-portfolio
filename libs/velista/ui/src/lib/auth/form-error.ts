import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { AlertIcon } from '../icons/icons';

/**
 * The one message a rejected form shows, and the way out of it when there is one.
 *
 * ## Why it takes an id
 *
 * The message has to be **associated** with the fields it is about, not merely near
 * them: `role="alert"` announces it when it appears, and the fields' `aria-describedby`
 * is what lets somebody who tabs back to a field hear it again. Both need the same id,
 * so the caller owns it and passes it in (plan 0009, section 7).
 *
 * ## Why the action is here and not beside it
 *
 * A `conflict` on register means the address already has an account, and the useful
 * thing to offer is not a refusal but a route: the message carries a link to sign in
 * with the typed email already filled in (section 5.5). Putting that inside the alert
 * keeps it in the same announcement as the sentence it answers, rather than as a
 * separate control a screen reader reaches only by tabbing on.
 *
 * The action is an output, because where it leads is routing and rule D1 keeps that
 * out of this library.
 */
@Component({
  selector: 'lib-form-error',
  imports: [AlertIcon],
  template: `
    <p [id]="messageId()" class="error" role="alert">
      <lib-alert-icon aria-hidden="true" class="glyph" />
      <span class="text">
        {{ message() }}
        @if (actionLabel(); as label) {
          <button (click)="action.emit()" class="action" type="button">
            {{ label }}
          </button>
        }
      </span>
    </p>
  `,
  styleUrl: './form-error.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormError {
  /** The id the describing fields point at. Owned by the caller, used by both. */
  readonly messageId = input.required<string>();

  readonly message = input.required<string>();

  /** The way out, when the failure has one. Null for the ones that do not. */
  readonly actionLabel = input<string | null>(null);

  readonly action = output<void>();
}
