import {
  ChangeDetectionStrategy,
  Component,
  input,
  model,
} from '@angular/core';

/**
 * An email address, as a real email field.
 *
 * `type="email"` with `inputmode="email"` and `autocomplete="email"`, which between
 * them get the phone keyboard's `@` onto the first layer and let a password manager
 * offer the address it already knows (plan 0009, section 7). None of that is
 * decoration: this form is filled one handed, often on a phone that already has the
 * answer stored.
 *
 * **It does not validate the shape while typing.** Section 3.1 is explicit about it,
 * and the reason is that half a typed address is not a wrong address. The check
 * happens on submit, where `validation_failed` comes back keyed to this field.
 *
 * It renders its own `<label for>` rather than letting each screen write one, so the
 * association cannot be got wrong in four places independently.
 */
@Component({
  selector: 'lib-email-field',
  templateUrl: './email-field.html',
  styleUrl: './email-field.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmailField {
  /** The address. Two way, so a screen can prefill it from a link or an error. */
  readonly value = model.required<string>();

  /** The input's id, so the caller's own message can address it. */
  readonly fieldId = input.required<string>();

  readonly label = input.required<string>();
  readonly placeholder = input.required<string>();

  /**
   * The ids of anything describing this field, space separated, or null.
   *
   * On sign in this is the id of the one message under **both** fields, because the
   * rejection is about the pair (section 5.4). On register and upgrade it is a message
   * about this field alone.
   */
  readonly describedBy = input<string | null>(null);

  readonly invalid = input(false);

  /**
   * True while the request is in flight.
   *
   * Read only rather than disabled: a disabled input is removed from the accessible
   * tree and loses focus, so the person is thrown to the top of the form at the exact
   * moment they are waiting to hear something.
   */
  readonly readOnly = input(false);

  onInput(event: Event): void {
    this.value.set((event.target as HTMLInputElement).value);
  }
}
