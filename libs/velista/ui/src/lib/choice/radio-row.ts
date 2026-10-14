import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';

/**
 * One row of a list that chooses one thing (velista `0140`, section 2): a radio,
 * then whatever the caller projects, which is the name, a caption and a price.
 *
 * **The whole row is the label**, so the whole row is the touch target, and the
 * radio is the native one with its look taken off: arrow keys move through the
 * group, and a screen reader says "1 of 6, selected" by itself. Rows of one group
 * share a `name`.
 *
 * It draws no rule between rows and no colour of its own beyond the radio: the
 * list around it decides those.
 */
@Component({
  selector: 'lib-radio-row',
  template: `
    <label class="row">
      <input
        (change)="chosen.emit()"
        [checked]="checked()"
        [disabled]="disabled()"
        [name]="name()"
        class="dot"
        type="radio"
      />
      <ng-content />
    </label>
  `,
  styleUrl: './radio-row.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RadioRow {
  /** The group this row belongs to. */
  readonly name = input.required<string>();
  readonly checked = input(false);
  readonly disabled = input(false);

  /** The row was chosen, by a press, a key, or a screen reader. */
  readonly chosen = output<void>();
}
