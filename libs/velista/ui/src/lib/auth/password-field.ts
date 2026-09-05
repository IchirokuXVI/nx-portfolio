import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  model,
  signal,
} from '@angular/core';
import { CheckOutlineIcon, EyeIcon, EyeOffIcon } from '../icons/icons';

/** The DTO's own minimum, stated up front rather than only on rejection. */
export const PASSWORD_MIN_LENGTH = 8;

/** The DTO's maximum, so the field cannot produce a body the gateway will reject. */
export const PASSWORD_MAX_LENGTH = 200;

/**
 * A password, with the one genuinely new input in this app: the reveal toggle.
 *
 * ## The toggle is a button, not an icon that changes
 *
 * Its `aria-label` swaps between Show password and Hide password, so somebody who
 * cannot see the glyph is told what pressing it will do rather than what state it is
 * in (plan 0009, section 7). It never removes `autocomplete`, which some
 * implementations of this control do when they swap the input's `type`, and which
 * quietly stops a password manager offering to save what was just typed.
 *
 * ## Why the rule is shown before it is broken
 *
 * At least 8 characters is the DTO's rule, and section 5.1 asks that the form say so
 * up front. A person choosing a password they are about to be told is too short has
 * been made to do the work twice.
 *
 * There is deliberately no strength meter, because nothing the server checks is behind
 * one. A **confirm** field is a different case and the register screen has one: the
 * server sees one string and cannot know it was mistyped, so typing it twice is the
 * only check that exists anywhere. This component is rendered twice there rather than
 * growing a mode, and the rule sentence is passed to the first of the two only.
 */
@Component({
  selector: 'lib-password-field',
  imports: [CheckOutlineIcon, EyeIcon, EyeOffIcon],
  templateUrl: './password-field.html',
  styleUrl: './password-field.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PasswordField {
  readonly value = model.required<string>();

  readonly fieldId = input.required<string>();
  readonly label = input.required<string>();
  readonly placeholder = input.required<string>();

  /**
   * `current-password` on sign in, `new-password` on register and upgrade.
   *
   * Required rather than defaulted, because the wrong one is silent: a password
   * manager offers to fill on one and offers to generate and save on the other, and a
   * register screen that says `current-password` simply never offers to save.
   */
  readonly autocomplete = input.required<'current-password' | 'new-password'>();

  /** The two accessible names for the toggle, translated by the caller. */
  readonly showLabel = input.required<string>();
  readonly hideLabel = input.required<string>();

  /** The minimum, as a sentence. Null on sign in, where the rule is not the user's. */
  readonly rule = input<string | null>(null);

  readonly describedBy = input<string | null>(null);
  readonly invalid = input(false);
  readonly readOnly = input(false);

  readonly maxLength = PASSWORD_MAX_LENGTH;

  /** Local, and it starts hidden. Nothing outside this component needs to know. */
  readonly revealed = signal(false);

  readonly toggleLabel = computed(() =>
    this.revealed() ? this.hideLabel() : this.showLabel()
  );

  /**
   * Whether the rule is met yet.
   *
   * Drives a tick and a colour beside the sentence, never an error: a password that is
   * six characters long while it is being typed is not wrong, it is unfinished.
   */
  readonly ruleMet = computed(() => this.value().length >= PASSWORD_MIN_LENGTH);

  toggleReveal(): void {
    this.revealed.update((current) => !current);
  }

  onInput(event: Event): void {
    this.value.set((event.target as HTMLInputElement).value);
  }
}
