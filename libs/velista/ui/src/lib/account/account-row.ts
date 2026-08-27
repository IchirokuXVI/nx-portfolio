import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ChevronRightIcon } from '../icons/icons';

/**
 * How a chip beside a value is tinted.
 *
 * `ok` is the confirmed address and `pending` is the one that never was. Neither is the
 * whole message: the chip's own text says which it is, and the tint only agrees with it
 * (section 7).
 */
export type AccountChipTone = 'ok' | 'pending';

/**
 * One line of the account screen: a label, a value, and sometimes somewhere to go.
 *
 * Every row on that screen is this component, including the two that do something
 * destructive, which is what makes the screen a list rather than six bespoke blocks.
 *
 * ## Why one component and not three
 *
 * The rows differ in three ways and in nothing else: whether they are tappable, whether
 * they carry a small caps label above the value, and whether they read as destructive.
 * Splitting them would mean three copies of a 44px target, a hairline, an ellipsis
 * rule and a focus ring, and the members list in this app already shows what happens
 * when a row's geometry is written twice.
 *
 * ## Tappable is derived, not declared
 *
 * A row is a `<button>` when somebody is listening to `activate` and a `<div>`
 * otherwise, which is the only version of this that cannot lie: a focusable element
 * with an accessible name that does nothing is exactly the defect section 4.4 found on
 * the app bar. `hasAction` is an input rather than a look at the output because Angular
 * gives a component no way to ask whether an output is subscribed, so the caller says
 * so, and saying so is the same gesture as binding the handler.
 *
 * ## Destructive is a style, never the meaning
 *
 * The label on a destructive row always says what it does ("Delete your account"), so
 * removing the colour removes nothing. Rule D1 holds throughout: no store, no service,
 * no router. `activate` leaves and the container decides where it goes.
 */
@Component({
  selector: 'lib-account-row',
  imports: [NgTemplateOutlet, ChevronRightIcon],
  templateUrl: './account-row.html',
  styleUrl: './account-row.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountRow {
  /**
   * The small caps label above the value, already translated, or empty for none.
   *
   * A resolved string rather than a key, unlike `SectionHeading`, because two of these
   * rows have no label at all and one interpolates an email address into its body. A
   * component that took keys would need a values bag beside them, which is the caller's
   * template written twice.
   */
  readonly label = input('');

  /** The row's main line. A name, an address, or an action's own words. */
  readonly value = input.required<string>();

  /** The quiet sentence under the value, or empty for none. */
  readonly detail = input('');

  /**
   * Whether pressing this row does anything.
   *
   * False renders a plain element with no tab stop and no chevron, which is what the
   * email row is: it is information, and the confirmation state beside it is not a
   * control.
   */
  readonly hasAction = input(false);

  /** Whether a chevron is drawn. Only for a row that opens something else. */
  readonly chevron = input(false);

  /** Coral, and never coral alone. See the class comment. */
  readonly destructive = input(false);

  /** Whether a hairline is drawn under the row. False on the last of a group. */
  readonly divided = input(true);

  /**
   * A short word beside the value, already translated, or empty for none.
   *
   * One row uses it: the email's confirmation state. It is a word rather than an icon
   * or a dot because that is the only version that reads correctly for somebody who
   * cannot see the colour.
   */
  readonly chip = input('');

  readonly chipTone = input<AccountChipTone>('ok');

  /**
   * An accessible name for the row, when the visible text is not enough on its own.
   *
   * The name row reads "Name / Marta" visually, which a screen reader would announce as
   * two unrelated strings followed by "button". Empty means the visible text is the
   * name, which is true of every action row.
   */
  readonly actionLabel = input('');

  readonly activate = output<void>();

  /** Only ever set on the element that is actually a button. */
  protected readonly ariaLabel = computed(() =>
    this.actionLabel() === '' ? null : this.actionLabel()
  );

  protected press(): void {
    if (this.hasAction()) {
      this.activate.emit();
    }
  }
}
