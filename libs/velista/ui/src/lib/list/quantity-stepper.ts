import {
  afterEveryRender,
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
  isMeasured,
  LINE_QUANTITY_MAX,
  LINE_QUANTITY_MIN,
  lineQuantityMax,
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
  followTyped,
  parseTypedAmount,
  shortAmount,
  type AmountWords,
} from '@portfolio/velista/platform';
import { TrashIcon } from '../icons/icons';
import { AmountFigure } from './amount-figure';

/** The three forms of the stepper (velista `0188`, section 3.1). */
export type QuantityStepperVariant = 'row' | 'sheet' | 'sheet-narrow';

/**
 * How long a raised amount keeps its {@link QuantityStepper.took} edge (velista
 * `0170`, D4). One value for the list page and the basket, which both decide when it
 * goes.
 */
export const TOOK_DURATION_MS = 2500;

/** What the field's live region says when a weight's typing turns its unit. */
const TURNED_KEYS: Readonly<Record<string, string>> = {
  g: 'amount.turned.grams',
  kg: 'amount.turned.kilograms',
  ml: 'amount.turned.milliliters',
  l: 'amount.turned.liters',
};

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
 * one, or the product's {@link step} (velista `0186`), never less than one
 * hundredth of the name the row shows. **The ends are
 * drawn, not hidden** (decision D): an end carries `aria-disabled` and ignores the
 * press, so focus stays on the button. **A hold repeats** after
 * `QUANTITY_HOLD_DELAY_MS`, from 300 ms down to 100 ms, and never takes an amount to
 * 0 (S8b): at 0 a line leaves the list's view, and that must take a press.
 *
 * **It never changes size**, whatever it holds: 155, 191 or 168 by 48 CSS px.
 * Typing is possible only in the two sheet variants (S9).
 *
 * **A typed weight or volume turns between grams and kilos as it is typed** (the
 * owner, 2026-11-17, decision K): 1000 g or more turns into kilos showing the same
 * amount, three whole digits under kilos turn back into grams, and an empty field
 * reads in grams (`followTyped`). A weight or a volume goes no higher than 99 kg or
 * 99 l, with the buttons as with typing ({@link ceiling}).
 */
@Component({
  selector: 'lib-quantity-stepper',
  imports: [AmountFigure, RokuTranslatorPipe, TrashIcon],
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
  /**
   * The product's step in base units, or null for the unit's default (velista
   * `0186`). Read only for a weight or a volume; `stepAt` keeps the hundredth rule
   * over it. A container passes `lineStepOf` of its line, never a step it computed.
   */
  readonly step = input<number | null>(null);
  /** What the amount is of, translated: "Plátano de Canarias IGP", or with its list. */
  readonly name = input.required<string>();
  readonly variant = input<QuantityStepperVariant>('row');
  /**
   * The lowest amount minus reaches. A line's own floor unless the caller needs a
   * higher one: a due row starts at one (velista `0089`), the how many step at one
   * step.
   */
  readonly min = input(LINE_QUANTITY_MIN);
  /**
   * The lowest amount a typed commit keeps, when it is not {@link min}: the owner's
   * ruling 44 of 2026-11-16, "typing accepts any amount; the step only moves the
   * buttons". The how many step floors its buttons at one step and its typing at
   * one base unit. Null, the default, is {@link min}, as before.
   */
  readonly typedMin = input<number | null>(null);
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

  /**
   * The most a plus, End or a typed amount reaches: {@link max}, and no more than
   * 99 000 for a weight or a volume (the owner, 2026-11-17). A line that already
   * holds more draws as it is and steps down.
   */
  readonly ceiling = computed(() => lineQuantityMax(this.unit(), this.max()));

  /** The words of the amount, in the form this variant reads. */
  readonly words = computed<AmountWords>(() =>
    this.typed()
      ? exactAmount(this.value(), this.unit(), this.locale())
      : shortAmount(this.value(), this.unit(), this.locale())
  );

  readonly minusAtEnd = computed(() => this._minusAtEndOf(this.value()));
  readonly plusAtEnd = computed(() => this._plusAtEndOf(this.value()));

  /**
   * Whether one press of minus takes the amount to 0, where the line leaves its list
   * (the owner's S14): minus then draws a red trash in place of its bar. Never with a
   * floor above 0 (a due row, the how many step), and never at 0 itself.
   */
  readonly minusClears = computed(() => {
    const value = this.value();
    return value > 0 && this._down(value) === 0;
  });

  /** What minus moves at the current amount, in short form words ("25 g", "1", "10"). */
  readonly lessStep = computed(() => {
    const value = this.value();
    const delta = value - this._down(value);
    return this._stepWords(
      delta > 0 ? delta : stepAt(value, this.unit(), this.step())
    );
  });

  /** What plus moves at the current amount. */
  readonly moreStep = computed(() =>
    this._stepWords(stepAt(this.value(), this.unit(), this.step()))
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
  /** The symbol the draft is read in, which a weight's typing turns (decision K). */
  private readonly _draftSymbol = signal<string | null>(null);

  /** The text of the sheet's field: the typed text, or the exact figure. */
  readonly fieldText = computed(() => this.draft() ?? this.words().figure);

  /** The symbol under the sheet's field, which follows the typing (decision K). */
  readonly fieldSymbol = computed(() =>
    this.draft() === null
      ? this.words().symbol
      : (this._draftSymbol() ?? this.words().symbol)
  );

  /**
   * The unit a weight's field just turned into, for its polite live region: the
   * digits changed under the caret, so a screen reader hears "Now in kilograms"
   * once. Null when the last keystroke turned nothing.
   */
  readonly turnedTo = signal<string | null>(null);

  /** The words of {@link turnedTo}, as a translation key. */
  readonly turnedKey = computed(() => {
    const symbol = this.turnedTo();
    return symbol === null ? null : (TURNED_KEYS[symbol] ?? null);
  });

  /**
   * The amount the last press emitted, over the `value` it was computed from, until
   * the caller redraws. Presses that arrive before that redraw (a held key on a busy
   * phone, synthetic keys) each build on the one before instead of repeating its
   * step. It is never drawn, and it is dropped as soon as `value` moves away from
   * `over` or any render runs, so the caller's amount wins at once: a refused write,
   * a realtime update or a clamp that leaves `value` where it was.
   */
  private _ahead: { readonly over: number; readonly to: number } | null = null;

  private _holdTimer: ReturnType<typeof setTimeout> | null = null;
  private _holdCount = 0;
  private _swallowClick = false;
  /**
   * A pointer went down on a button while the field held typed text. Its click is
   * consumed until the next pointerdown, like the release of a hold; a key click
   * (`detail` 0) is a new gesture and steps.
   */
  private _draftPress = false;
  private _announceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly _onScroll = () => this._stopRepeat();

  constructor() {
    // A render means the caller has had its chance to redraw; from here its `value`
    // is the base again. A plain field, so the hook writes no signal.
    afterEveryRender(() => {
      this._ahead = null;
    });
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
    const pointer = (event?.detail ?? 1) !== 0;
    if (this._swallowClick && pointer) {
      // The release of a hold that already repeated adds no extra step.
      return;
    }
    if (this._draftPress && pointer) {
      // The press that took focus out of a typed field: the blur committed the
      // text, or it is committed here when the button took no focus. No step.
      this._draftPress = false;
      this._commitDraft();
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

  /**
   * A primary pointer down on a button that is not at an end starts the hold. Any
   * other pointer leaves the hold of the first one as it is, so a second finger
   * cannot undo the swallow of the first finger's release.
   */
  startHold(direction: 1 | -1, event: PointerEvent): void {
    const primary =
      (event as { isPrimary?: boolean }).isPrimary !== false &&
      (event.button === undefined || event.button === 0);
    if (!primary) {
      return;
    }
    this._swallowClick = false;
    this._stopRepeat();
    this._holdCount = 0;
    // Down comes before the focus moves, so typed text is still a draft here. The
    // owner's rule: this gesture commits the text only, with no step and no repeat.
    this._draftPress = this.draft() !== null;
    if (this._draftPress || this.disabled() || this._atEnd(direction)) {
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
        this._clearDraft();
        this._emit(this.min(), false);
        return;
      case 'End':
        event.preventDefault();
        this._clearDraft();
        this._emit(this.ceiling(), false);
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
          this._clearDraft();
          (event.target as HTMLInputElement).value = this.words().figure;
        }
        return;
    }
  }

  onFieldFocus(event: FocusEvent): void {
    (event.target as HTMLInputElement).select();
  }

  /**
   * A keystroke or a paste. A weight or a volume reads the whole text in the unit
   * the field shows now and may turn it (decision K): the field then holds the
   * turned text with the caret at its end, and the live region names the new unit.
   * A count reads in the symbol the typing started under, as before.
   */
  onFieldInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (this.draft() === null) {
      this._draftFrom = this.words();
    }
    const from = this._draftFrom ?? this.words();
    const unit = this.unit();
    const symbol = isMeasured(unit)
      ? (this._draftSymbol() ?? from.symbol)
      : from.symbol;
    const next = followTyped(input.value, symbol, unit, this.locale());
    if (next.text !== input.value) {
      input.value = next.text;
      const end = next.text.length;
      input.setSelectionRange?.(end, end);
    }
    this.turnedTo.set(next.turned ? next.symbol : null);
    this._draftSymbol.set(next.symbol);
    this.draft.set(next.text);
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
    const value = this._current();
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

  /** The base a press builds on: the last emitted amount until the caller redraws. */
  private _current(): number {
    const value = this.value();
    const ahead = this._ahead;
    return ahead !== null && ahead.over === value ? ahead.to : value;
  }

  private _minusAtEndOf(value: number): boolean {
    return value <= this.min();
  }

  private _plusAtEndOf(value: number): boolean {
    return !canStepUp(value, this.unit(), this.ceiling(), this.step());
  }

  private _atEnd(direction: 1 | -1): boolean {
    const value = this._current();
    return direction === 1
      ? this._plusAtEndOf(value)
      : this._minusAtEndOf(value);
  }

  private _next(direction: 1 | -1): number {
    const value = this._current();
    return direction === 1
      ? stepFrom(value, this.unit(), 1, this.step())
      : this._down(value);
  }

  private _down(value: number): number {
    return Math.max(this.min(), stepFrom(value, this.unit(), -1, this.step()));
  }

  private _emit(to: number, repeat: boolean, typed = false): boolean {
    const from = this._current();
    if (to === from) {
      return false;
    }
    // Before the outputs: a caller that redraws inside them has already moved on.
    this._ahead = { over: this.value(), to };
    this.valueChange.emit(to);
    this.stepped.emit(
      typed ? { from, to, repeat, typed: true } : { from, to, repeat }
    );
    return true;
  }

  /** Commits typed text, and answers whether there was any. */
  private _commitDraft(): boolean {
    const draft = this.draft();
    if (draft === null) {
      return false;
    }
    const from = this._draftFrom ?? this.words();
    // The draft is already turned, so it is read in the symbol it ended under.
    const shown = { ...from, symbol: this._draftSymbol() ?? from.symbol };
    this._clearDraft();
    const amount = parseTypedAmount(
      draft,
      shown,
      this.unit(),
      this.typedMin() ?? this.min(),
      this.ceiling()
    );
    if (amount !== null) {
      this._emit(amount, false, true);
    }
    return true;
  }

  private _clearDraft(): void {
    this.draft.set(null);
    this._draftFrom = null;
    this._draftSymbol.set(null);
    this.turnedTo.set(null);
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
