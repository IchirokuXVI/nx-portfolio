import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';

/** Ids for the title and the hint, unique on the page. */
let nextSwitchId = 0;

/**
 * One switch on the account screen: a title, a quiet sentence under it, and the
 * switch at the trailing edge (velista `0191`). The first is "Compact rows".
 *
 * ## The whole row is the label
 *
 * A `<label>` holds the words and a native `<input type="checkbox" role="switch">`,
 * so a tap anywhere on the row flips it, Space flips it from the keyboard, and a
 * screen reader hears a switch named by its title, with the hint as its description.
 * The look is drawn over the native control, which stays the control.
 *
 * ## It changes nothing by itself
 *
 * Rule D1: no store. `changed` says what the person chose and the page writes it, and
 * `checked` is what the page holds. The two agree because the page answers at once.
 */
@Component({
  selector: 'lib-account-switch',
  template: `
    <label [class.divided]="divided()" class="row">
      <span class="body">
        <span [id]="titleId" class="title">{{ label() }}</span>
        @if (hint() !== '') {
          <span [id]="hintId" class="hint">{{ hint() }}</span>
        }
      </span>
      <input
        (change)="onChange($event)"
        [attr.aria-describedby]="hint() === '' ? null : hintId"
        [attr.aria-labelledby]="titleId"
        [checked]="checked()"
        class="switch"
        role="switch"
        type="checkbox"
      />
    </label>
  `,
  styleUrl: './account-switch.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountSwitch {
  /** The title, already translated. */
  readonly label = input.required<string>();

  /** The quiet sentence under it, already translated, or empty for none. */
  readonly hint = input('');

  /** Whether the switch is on. */
  readonly checked = input(false);

  /** Whether a hairline is drawn under the row, as on `lib-account-row`. */
  readonly divided = input(true);

  /** The person flipped the switch: true for on. */
  readonly changed = output<boolean>();

  private readonly _id = nextSwitchId++;
  protected readonly titleId = `account-switch-${this._id}-title`;
  protected readonly hintId = `account-switch-${this._id}-hint`;

  protected onChange(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLInputElement) {
      this.changed.emit(target.checked);
    }
  }
}
