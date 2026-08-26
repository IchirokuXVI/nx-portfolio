import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { CheckOutlineIcon } from '../icons/icons';

/**
 * A ticked panel holding one sentence, in the success tone.
 *
 * Two screens use it and they are saying the same kind of thing, which is why it is
 * one component rather than two: something good is already true, and the sentence is
 * the whole of it.
 *
 * - On the upgrade screen, before the form: **your groups stay exactly where they
 *   are**. That sentence is the entire argument for spending thirty seconds on the
 *   form, and it counts the person's groups back at them because the count is what
 *   makes it concrete (plan 0009, section 5.3).
 * - On the dashboard afterwards: the account is secured, and the address to sign in
 *   with.
 *
 * The sentence is passed in already translated. It is the caller that knows whether it
 * needs a count or an address interpolated, and a component that took a key plus a bag
 * of parameters would be reimplementing the pipe.
 */
@Component({
  selector: 'lib-success-note',
  imports: [CheckOutlineIcon],
  template: `
    <p class="note">
      <lib-check-outline-icon aria-hidden="true" class="glyph" />
      <span class="text">{{ message() }}</span>
    </p>
  `,
  styleUrl: './success-note.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SuccessNote {
  readonly message = input.required<string>();
}
