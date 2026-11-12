import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  DOCUMENT,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import {
  canStepUp,
  LINE_QUANTITY_MAX,
  LINE_QUANTITY_MIN,
  QUANTITY_HOLD_DELAY_MS,
  QUANTITY_HOLD_FACTOR,
  QUANTITY_HOLD_FASTEST_MS,
  QUANTITY_HOLD_FIRST_MS,
  QUANTITY_STEP_QUIET_MS,
  stepAt,
  stepFrom,
  type LineUnit,
  type QuantityStep,
} from '@portfolio/velista/models';
import {
  exactAmount,
  parseTypedAmount,
  shortAmount,
  typedSymbol,
  type AmountWords,
} from '@portfolio/velista/platform';
import { AmountFigure } from './amount-figure';

/** The three forms of the stepper (velista `0188`, section 3.1). */
export type QuantityStepperVariant = 'row' | 'sheet' | 'sheet-narrow';

/**
 * How long a raised amount keeps its {@link QuantityStepper.took} edge (velista
 * `0170`, D4). One value for the list page and the basket, which both decide when it
 * goes.
 */
export const TOOK_DURATION_MS = 2500;

/**
 * An amount, as a minus, the amount and a plus in one outlined capsule (velista
 * `0188`, the owner's D3 Outline).
 *
 * **It draws what it is given and saves nothing** (S12). Every press, every repeat,
 * every key and every typed commit is emitted through {@link valueChange} and
 * {@link stepped}; the caller decides what to draw next, and a feature's logic layer
 * waits for the presses to stop before it writes (`quantityRuns`, `CatalogAddStore`).
 * The only timers here are the hold and the quiet beat after which the amount is
 * announced.
 *
 * **One step per unit** through `stepFrom` and `canStepUp` (S7, S7b): 25 g, 25 ml or
 * one, never less than one hundredth of the name the row shows. **The ends are
 * drawn, not hidden** (decision D): an end carries `aria-disabled` and ignores the
 * press, so focus stays on the button. **A hold repeats** after
 * `QUANTITY_HOLD_DELAY_MS`, from 300 ms down to 100 ms, and never takes an amount to
 * 0 (S8b): at 0 a line with nothing to keep is deleted, and that must take a press.
 *
 * **It never changes size**, whatever it holds: 155, 191 or 168 by 48 CSS px.
 * Typing is possible only in the two sheet variants (S9).
 */
@Component({
  selector: 'lib-quantity-stepper',
  imports: [AmountFigure, RokuTranslatorPipe],
  templateUrl: './quantity-stepper.html',
  styleUrl: './quantity-stepper.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.variant-row]': "variant() === 'row'",
    '[class.variant-sheet]': "variant() === 'sheet'",
    '[class.variant-sheet-narrow]': "variant() === 'sheet-narrow'",
    '[class.is-readonly]': 'readonly()',
    '[class.is-took]': 'took()',
    '[class.is-disabled]': 'disabled()',
    '[attr.data-value]': 'value()',
  },
})
export class QuantityStepper {
  /** The amount drawn, in base units. The caller owns it; a press never changes it here. */
  readonly value = input.required<number>();
  readonly unit = input<LineUnit>('UNIT');
  /** What the amount is of, translated: "Plátano de Canarias IGP", or with its list. */
  readonly name = input.required<string>();
  readonly variant = input<QuantityStepperVariant>('row');
  /**
   * The lowest amount minus reaches. A line's own floor unless the caller needs a
   * higher one: a due row starts at one (velista `0089`), the how many step at one
   * step.
   */
  readonly min = input(LINE_QUANTITY_MIN);
  readonly max = input(LINE_QUANTITY_MAX);
  /** A write is in flight: both buttons and the field ignore input, and say so. */
  readonly disabled = input(false);
  /** A reader: the amount alone, no buttons and no outline (decision I). */
  readonly readonly = input(false);
  /** An add just raised this amount (velista `0170`, decision J). */
  readonly took = input(false);

  /** The next amount, on every press, every repeat, every key and every typed commit. */
  readonly valueChange = output<number>();
  /** The same change with where it came from and whether the hold made it. */
  readonly stepped = output<QuantityStep>();

  private readonly _localeStore = inject(RokuLocaleStore, { optional: true });
  private readonly _document = inject(DOCUMENT);

  readonly locale = computed(() => this._localeStore?.locale() ?? 'en');
  readonly typed = computed(() => this.variant() !== 'row');

  /** The words of the amount, in the form this variant reads. */
  readonly words = computed<AmountWords>(() =>
    this.typed()
      ? exactAmount(this.value(), this.unit(), this.locale())
      : shortAmount(this.value(), this.unit(), this.locale())
  );

  readonly minusAtEnd = computed(() => this.value() <= this.min());
  readonly plusAtEnd = computed(
    () => !canStepUp(this.value(), this.unit(), this.max())
  );

  /** What minus moves at the current amount, in short form words ("25 g", "1", "10"). */
  readonly lessStep = computed(() => {
    const value = this.value();
    const delta = value - this._down(value);
    return this._stepWords(delta > 0 ? delta : stepAt(value, this.unit()));
  });

  /** What plus moves at the current amount. */
  readonly moreStep = computed(() =>
    this._stepWords(stepAt(this.value(), this.unit()))
  );

  /** The amount the presses settled on, which the live region says (decision E). */
  private readonly _settled = signal<number | null>(null);

  /**
   * Whether the polite live region holds the settled amount. It empties when the
   * value moves with no press, so a later change from outside is not read again.
   */
  readonly announcing = computed(() => this._settled() === this.value());

  /** What a person has typed into a sheet's field and not committed yet. */
  readonly draft = signal<string | null>(null);
  private _draftFrom: AmountWords | null = null;

  /** The text of the sheet's field: the typed text, or the exact figure. */
  readonly fieldText = computed(() => this.draft() ?? this.words().figure);

  /** The symbol under the sheet's field, which follows the typing (decision K). */
  readonly fieldSymbol = computed(() => {
    const draft = this.draft();
    const shown = this._draftFrom ?? this.words();
    return draft === null
      ? this.words().symbol
      : typedSymbol(draft, shown, this.unit(), this.locale());
  });

  private _holdTimer: ReturnType<typeof setTimeout> | null = null;
  private _holdCount = 0;
  private _swallowClick = false;
  private _announceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly _onScroll = () => this._stopRepeat();

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.endHold();
      if (this._announceTimer !== null) {
        clearTimeout(this._announceTimer);
      }
    });
  }

  /**
   * A button's `click`: one step, on release. Enter and Space land here too, as a
   * click whose `detail` is 0, and those are never swallowed after a hold.
   */
  press(direction: 1 | -1, event?: MouseEvent): void {
    if (this._swallowClick && (event?.detail ?? 1) !== 0) {
      // The release of a hold that already repeated adds no extra step.
      return;
    }
    if (this.disabled() || this._atEnd(direction)) {
      return;
    }
    if (this._commitDraft()) {
      // A typed amount is the change; the press only moved focus out of the field.
      return;
    }
    if (this._emit(this._next(direction), false)) {
      this._announceLater();
    }
  }

  /** A primary pointer down on a button that is not at an end starts the hold. */
  startHold(direction: 1 | -1, event: PointerEvent): void {
    this._swallowClick = false;
    this._stopRepeat();
    this._holdCount = 0;
    const primary =
      (event as { isPrimary?: boolean }).isPrimary !== false &&
      (event.button === undefined || event.button === 0);
    if (!primary || this.disabled() || this._atEnd(direction)) {
      return;
    }
    this._document.defaultView?.addEventListener('scroll', this._onScroll, {
      capture: true,
      passive: true,
    });
    this._holdTimer = setTimeout(
      () => this._repeat(direction),
      QUANTITY_HOLD_DELAY_MS
    );
  }

  /**
   * The finger leaves the button: a lift, a slide off or a cancel. When the hold
   * repeated, also when the repeat had already stopped at an end or on a scroll,
   * every pointer click is swallowed until the next `pointerdown` on the control:
   * a hold that stopped at the last amount above 0 must not reach 0 on the release
   * (S8b), however late a touch browser sends that click, and also after the
   * finger slid off and back on.
   */
  endHold(): void {
    this._stopRepeat();
    if (this._holdCount > 0) {
      this._swallowClick = true;
      this._holdCount = 0;
    }
  }

  /** Arrow keys, Home and End on the sheet's field (the APG spinbutton pattern). */
  onFieldKey(event: KeyboardEvent): void {
    if (this.disabled()) {
      return;
    }
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowDown': {
        event.preventDefault();
        const direction = event.key === 'ArrowUp' ? 1 : -1;
        if (!this._commitDraft() && !this._atEnd(direction)) {
          this._emit(this._next(direction), false);
        }
        return;
      }
      case 'Home':
        event.preventDefault();
        this.draft.set(null);
        this._emit(this.min(), false);
        return;
      case 'End':
        event.preventDefault();
        this.draft.set(null);
        this._emit(this.max(), false);
        return;
      case 'Enter':
        event.preventDefault();
        this._commitDraft();
        return;
      case 'Escape':
        if (this.draft() !== null) {
          // Typed text goes back to the shown amount and the sheet stays open.
          event.preventDefault();
          event.stopPropagation();
          this.draft.set(null);
          this._draftFrom = null;
          (event.target as HTMLInputElement).value = this.words().figure;
        }
        return;
    }
  }

  onFieldFocus(event: FocusEvent): void {
    (event.target as HTMLInputElement).select();
  }

  onFieldInput(event: Event): void {
    if (this.draft() === null) {
      this._draftFrom = this.words();
    }
    this.draft.set((event.target as HTMLInputElement).value);
  }

  onFieldBlur(event: FocusEvent): void {
    this._commitDraft();
    (event.target as HTMLInputElement).value = this.fieldText();
  }

  /** The repeat stops; the finger may still be down, so the release is still to come. */
  private _stopRepeat(): void {
    if (this._holdTimer !== null) {
      clearTimeout(this._holdTimer);
      this._holdTimer = null;
    }
    this._document.defaultView?.removeEventListener('scroll', this._onScroll, {
      capture: true,
    });
  }

  /** One step of the hold: from the current value, so the caller's answer is the base. */
  private _repeat(direction: 1 | -1): void {
    this._holdTimer = null;
    if (this.disabled()) {
      this._stopRepeat();
      return;
    }
    const value = this.value();
    let next = this._next(direction);
    if (direction === -1) {
      const min = this.min();
      next = min > 0 ? Math.max(min, next) : next;
      if (next <= 0 || next === value) {
        // A repeat never takes an amount to 0 (S8b) and never presses into the floor.
        this._stopRepeat();
        return;
      }
    } else if (this._atEnd(1)) {
      this._stopRepeat();
      return;
    }
    this._holdCount++;
    this._emit(next, true);
    this._announceLater();
    const interval = Math.max(
      QUANTITY_HOLD_FASTEST_MS,
      Math.round(
        QUANTITY_HOLD_FIRST_MS * QUANTITY_HOLD_FACTOR ** (this._holdCount - 1)
      )
    );
    this._holdTimer = setTimeout(() => this._repeat(direction), interval);
  }

  private _atEnd(direction: 1 | -1): boolean {
    return direction === 1 ? this.plusAtEnd() : this.minusAtEnd();
  }

  private _next(direction: 1 | -1): number {
    return direction === 1
      ? stepFrom(this.value(), this.unit(), 1)
      : this._down(this.value());
  }

  private _down(value: number): number {
    return Math.max(this.min(), stepFrom(value, this.unit(), -1));
  }

  private _emit(to: number, repeat: boolean): boolean {
    const from = this.value();
    if (to === from) {
      return false;
    }
    this.valueChange.emit(to);
    this.stepped.emit({ from, to, repeat });
    return true;
  }

  /** Commits typed text, and answers whether there was any. */
  private _commitDraft(): boolean {
    const draft = this.draft();
    if (draft === null) {
      return false;
    }
    const shown = this._draftFrom ?? this.words();
    this.draft.set(null);
    this._draftFrom = null;
    const amount = parseTypedAmount(
      draft,
      shown,
      this.unit(),
      this.min(),
      this.max()
    );
    if (amount !== null) {
      this._emit(amount, false);
    }
    return true;
  }

  /** Empties the live region, and fills it once the presses stop (decision E). */
  private _announceLater(): void {
    this._settled.set(null);
    if (this._announceTimer !== null) {
      clearTimeout(this._announceTimer);
    }
    this._announceTimer = setTimeout(() => {
      this._announceTimer = null;
      this._settled.set(this.value());
    }, QUANTITY_STEP_QUIET_MS);
  }

  private _stepWords(step: number): string {
    const words = shortAmount(step, this.unit(), this.locale());
    return words.symbol ? `${words.figure} ${words.symbol}` : words.figure;
  }
}
