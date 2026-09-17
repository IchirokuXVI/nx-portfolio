import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  linkedSignal,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  DUE_LINE_STEP_QUIET_MS,
  type DueLineRowVm,
} from '@portfolio/velista/models';
import { QuantityStepper } from './quantity-stepper';

/**
 * One line the list suggests, under To buy (velista `0089`, section 2).
 *
 * **Quieter than a line and visibly not one**: a dashed hairline in the attention role
 * over the attention tint, and no reel. It is a line at zero drawn early, so a tap on
 * its name opens the line detail sheet as a line row does.
 *
 * ## The amount is chosen here, and the button takes it
 *
 * The stepper starts at the amount the server suggests and stops at one, because adding
 * nothing is not an add. Nothing is written while it moves: the Add button writes the
 * chosen amount, and its words follow the stepper ("Add 3").
 *
 * ## Adding on a step is a switch
 *
 * With `addsOnStep` on, a change that goes quiet for `quietMs` adds the line at the
 * chosen amount by itself. It waits rather than adding on the first press, because the
 * row leaves the section the moment its line is above zero and would take the stepper
 * away from somebody who meant to press three times. The page passes
 * `DUE_LINE_ADDS_ON_STEP`, which is off in this version.
 */
@Component({
  selector: 'lib-due-line-row',
  imports: [RokuTranslatorPipe, QuantityStepper],
  template: `
    @let vm = row();
    <div [attr.data-due-line-id]="vm.lineId" class="row">
      <button (click)="opened.emit(vm.lineId)" class="body" type="button">
        <span class="name">{{ vm.name }}</span>
        <span class="reason">{{ vm.reasonKey | rokuT: vm.reasonArgs }}</span>
      </button>

      <div class="acts">
        <lib-quantity-stepper
          (valueChange)="step($event)"
          [label]="'list.due.quantityLabel' | rokuT: { name: vm.name }"
          [min]="1"
          [value]="amount()"
        />
        <button
          (click)="add()"
          [attr.aria-label]="
            'list.due.addLabel' | rokuT: { count: amount(), name: vm.name }
          "
          class="add"
          type="button"
        >
          {{ 'list.due.add' | rokuT: { count: amount() } }}
        </button>
      </div>
    </div>
  `,
  styleUrl: './due-line-row.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DueLineRow {
  readonly row = input.required<DueLineRowVm>();

  /** Whether a change of the amount adds the line by itself, once it goes quiet. */
  readonly addsOnStep = input(false);

  /** How long a change waits before it adds by itself. */
  readonly quietMs = input(DUE_LINE_STEP_QUIET_MS);

  /** The line and the amount to put on the list. */
  readonly added = output<{ lineId: string; quantity: number }>();

  /** A tap on the name, which opens the line detail sheet. */
  readonly opened = output<string>();

  /**
   * The suggested number alone, so a view model drawn again with the same suggestion is
   * not a change: the page makes new row objects whenever any line moves.
   */
  private readonly _suggested = computed(() => this.row().quantity);

  /**
   * The amount chosen, starting at the suggestion. It starts again when the server's
   * suggestion for the line changes, and never because the row drew again.
   */
  readonly amount = linkedSignal({
    source: this._suggested,
    computation: (suggested) => suggested,
  });

  private _timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this._clearTimer());
  }

  step(value: number): void {
    this.amount.set(value);
    if (!this.addsOnStep()) {
      return;
    }

    this._clearTimer();
    this._timer = setTimeout(() => {
      this._timer = null;
      this.add();
    }, this.quietMs());
  }

  add(): void {
    this._clearTimer();
    this.added.emit({ lineId: this.row().lineId, quantity: this.amount() });
  }

  private _clearTimer(): void {
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }
}
