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
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import {
  DUE_LINE_STEP_QUIET_MS,
  isMeasured,
  type DueLineRowVm,
  type ListRowLayout,
} from '@portfolio/velista/models';
import { formatAmount } from '@portfolio/velista/platform';
import { QuantityReel } from './quantity-reel';
import { QuantityStepper } from './quantity-stepper';

/**
 * One line the list suggests, under To buy (velista `0089`, section 2).
 *
 * **Quieter than a line and visibly not one**: a dashed hairline in the attention role
 * over the attention tint, and a button beside its stepper. It is a line at zero drawn
 * early, so a tap on its name opens the line detail sheet as a line row does.
 *
 * ## The amount is chosen here, and the button takes it
 *
 * The stepper, or the reel in the compact view (velista `0203`), starts at the amount
 * the server suggests and stops at one, because adding nothing is not an add. Nothing
 * is written while it moves: the Add button writes the chosen amount. The button says
 * "Add" alone, and its accessible name says the amount ("Add 3 of Milk to the list").
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
  imports: [RokuTranslatorPipe, QuantityReel, QuantityStepper],
  template: `
    @let vm = row();
    <div [attr.data-due-line-id]="vm.lineId" class="row">
      <button (click)="opened.emit(vm.lineId)" class="body" type="button">
        <span class="name">{{ vm.name }}</span>
        <span class="reason">{{ vm.reasonKey | rokuT: vm.reasonArgs }}</span>
      </button>

      <div class="acts">
        @if (layout() === 'compact') {
          <lib-quantity-reel
            (stepped)="step($event.to)"
            [label]="'amount.group' | rokuT: { name: vm.name }"
            [min]="1"
            [step]="vm.step ?? null"
            [unit]="vm.unit"
            [value]="amount()"
          />
        } @else {
          <lib-quantity-stepper
            (valueChange)="step($event)"
            [min]="1"
            [name]="vm.name"
            [step]="vm.step ?? null"
            [unit]="vm.unit"
            [value]="amount()"
            variant="row"
          />
        }
        <!--
          "Add" alone in both views (velista 0203, target state 7): the amount is on
          the control beside it. The accessible name still says the amount and the
          product, so a screen reader hears what the press adds.
        -->
        <button
          (click)="add()"
          [attr.aria-label]="
            'list.due.addLabel' | rokuT: { count: amountWords(), name: vm.name }
          "
          class="add"
          type="button"
        >
          {{ 'list.due.add' | rokuT }}
        </button>
      </div>
    </div>
  `,
  styleUrl: './due-line-row.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DueLineRow {
  readonly row = input.required<DueLineRowVm>();

  /**
   * How the list draws its rows (velista `0202`): the stepper in the default view,
   * the reel in the compact one (velista `0203`), 52 by 44 like the rows above.
   */
  readonly layout = input<ListRowLayout>('default');

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

  private readonly _localeStore = inject(RokuLocaleStore, { optional: true });

  /**
   * The amount as the button says it: the number for a count, "750 g" for a weight
   * (velista `0182`).
   */
  readonly amountWords = computed<string | number>(() =>
    !isMeasured(this.row().unit)
      ? this.amount()
      : formatAmount(
          this.amount(),
          this.row().unit,
          this._localeStore?.locale() ?? 'en'
        )
  );

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
