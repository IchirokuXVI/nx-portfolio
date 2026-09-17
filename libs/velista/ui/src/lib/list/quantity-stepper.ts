import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  model,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  LINE_QUANTITY_MAX,
  LINE_QUANTITY_MIN,
} from '@portfolio/velista/models';

/**
 * How many of something, as two buttons and a number.
 *
 * A stepper and not a number field, for one reason that decides it: this screen is used
 * one handed while walking, and a number input opens a keyboard, moves the layout, and
 * asks somebody to aim at a caret. Two 44px buttons do not.
 *
 * **It cannot be driven out of range.** The buttons disable at each end rather than
 * clamping silently, so the limit is visible before it is hit rather than being a
 * correction after it. `AddLineDto` caps quantity at 100000 and the client's copy of
 * that is never the authority: the gateway validates it again.
 */
@Component({
  selector: 'lib-quantity-stepper',
  imports: [RokuTranslatorPipe],
  template: `
    <div
      [attr.aria-label]="label() ?? ('list.add.quantity' | rokuT)"
      [attr.aria-valuemax]="max"
      [attr.aria-valuemin]="min()"
      [attr.aria-valuenow]="value()"
      class="stepper"
      role="spinbutton"
    >
      <button
        (click)="step(-1)"
        [attr.aria-label]="'list.add.fewer' | rokuT"
        [disabled]="!canDecrease()"
        class="step"
        type="button"
      >
        <span aria-hidden="true">&minus;</span>
      </button>

      <span aria-hidden="true" class="value">{{ value() }}</span>

      <button
        (click)="step(1)"
        [attr.aria-label]="'list.add.more' | rokuT"
        [disabled]="!canIncrease()"
        class="step"
        type="button"
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  `,
  styleUrl: './quantity-stepper.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QuantityStepper {
  readonly value = model.required<number>();

  /** Whether the whole control is out of action, while a submit is in flight. */
  readonly disabled = input(false);

  /**
   * The lowest value the control reaches. A line's own floor unless the caller needs a
   * higher one: a due line's add starts at one, because adding nothing is not an add
   * (velista `0089`, section 2).
   */
  readonly min = input(LINE_QUANTITY_MIN);
  readonly max = LINE_QUANTITY_MAX;

  /**
   * The control's accessible name, already translated, or null for "How many". A row
   * that repeats the control per line names the line in it, because twenty controls
   * called "How many" say nothing apart.
   */
  readonly label = input<string | null>(null);

  readonly canDecrease = computed(
    () => !this.disabled() && this.value() > this.min()
  );
  readonly canIncrease = computed(
    () => !this.disabled() && this.value() < this.max
  );

  step(by: number): void {
    const next = this.value() + by;
    if (next < this.min() || next > this.max) {
      return;
    }

    this.value.set(next);
  }
}
