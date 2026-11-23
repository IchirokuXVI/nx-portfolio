import {
  afterEveryRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  DOCUMENT,
  effect,
  inject,
  input,
  output,
  signal,
  viewChildren,
  type ElementRef,
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
  QUANTITY_HOLD_DELAY_MS,
  QUANTITY_HOLD_FACTOR,
  QUANTITY_HOLD_FASTEST_MS,
  QUANTITY_HOLD_FIRST_MS,
  QUANTITY_SNAP_POINTS,
  QUANTITY_STEP_QUIET_MS,
  snapPointsWithin,
  stepAt,
  stepFrom,
  type LineUnit,
  type QuantityStep,
} from '@portfolio/velista/models';
import {
  exactAmount,
  followTyped,
  isRefused,
  parseTypedAmount,
  shortAmount,
  typedLimit,
  type AmountWords,
  type TypedRefusal,
} from '@portfolio/velista/platform';
import { TrashIcon } from '../icons/icons';
import { AmountFigure } from './amount-figure';
import { AnchoredPopover, type AnchoredPopoverClose } from './anchored-popover';

/** The three forms of the stepper (velista `0188`, section 3.1). */
export type QuantityStepperVariant = 'row' | 'sheet' | 'sheet-narrow';

/**
 * How long a raised amount keeps its {@link QuantityStepper.took} edge (velista
 * `0170`, D4). One value for the list page and the basket, which both decide when it
 * goes.
 */
export const TOOK_DURATION_MS = 2500;

/**
 * What the field's live region says when a weight's typing turns its unit. Typing
 * only ever turns kilos into grams (decision K as the owner ruled it on 2026-11-17).
 */
const TURNED_KEYS: Readonly<Record<string, string>> = {
  g: 'amount.turned.grams',
  ml: 'amount.turned.milliliters',
};

/**
 * How long the popover that says why a key was not accepted stays by itself (the
 * owner, 2026-11-17): long enough to read one short sentence twice.
 */
export const REFUSED_SHOWN_MS = 4000;

/** The keys on the field that end or move the edit, and so take the popover away. */
const ENDS_THE_EDIT: ReadonlySet<string> = new Set([
  'Enter',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
]);

/** Why the field did not take a key, and the unit it read in then. */
interface Refusal {
  readonly reason: TypedRefusal;
  readonly symbol: string;
}

/** One sentence of the refusal popover, as a translation key and its values. */
export interface RefusalWords {
  readonly key: string;
  readonly values: Readonly<Record<string, unknown>>;
}

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
 * `QUANTITY_HOLD_DELAY_MS`, from 300 ms down to 60 ms, and never takes an amount to
 * 0 (S8b): at 0 a line leaves the list's view, and that must take a press. **A
 * hold goes on until the finger lifts** (velista `0193`): the pointer is captured,
 * and from the first repeat a moving touch no longer scrolls, so a wandering finger
 * keeps stepping. Before the first repeat a swipe still scrolls the list. While a
 * hold is down no text is selected anywhere on the page.
 *
 * **It never changes size**, whatever it holds: 155, 191 or 168 by 48 CSS px.
 * Typing is possible only in the two sheet variants (S9).
 *
 * **A typed weight or volume keeps the unit the edit started under** (the owner,
 * 2026-11-17, decision K): "25000" typed under grams stays "25000 g" until the edit
 * ends, and the field then rests as "25 kg". The one turn while typing: under kilos
 * a whole number over 99 is read in grams at once ("500" g). An empty field reads in
 * grams, and a key the field does not accept is put back (`followTyped`). Every unit
 * goes no higher than 99 999, with the buttons as with typing ({@link ceiling}).
 *
 * **A key the field does not accept says why** (the owner, 2026-11-17): a small
 * popover over the capsule holds one sentence ({@link refusalWords}), and the
 * field's polite live region says it once. It never takes focus, and it goes on the
 * next accepted key, when the edit ends, on Escape, and by itself after
 * {@link REFUSED_SHOWN_MS}. A typed count over the ceiling is held to it when the
 * edit ends, and the same popover says so then.
 */
@Component({
  selector: 'lib-quantity-stepper',
  imports: [AmountFigure, AnchoredPopover, RokuTranslatorPipe, TrashIcon],
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
    '[class.is-locked]': 'locked()',
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
  /**
   * The amounts a press lands on rather than pass (velista `0195`): 1000 by default.
   * A caller that passes its own list replaces the default, so a list that keeps
   * the stop at 1000 names it too. Points at or under {@link min} or over the
   * {@link ceiling} are dropped by `snapPointsWithin`.
   */
  readonly snaps = input<readonly number[]>(QUANTITY_SNAP_POINTS);
  /** What the amount is of, translated: "Plátano de Canarias IGP", or with its list. */
  readonly name = input.required<string>();
  /**
   * The sheet field's accessible name as given, translated, when it is not "Amount
   * of {@link name}": the basket sheet names each list's field "Compra semanal, pide"
   * (velista `0190`, section 5). Null, the default, wraps {@link name}. The buttons
   * and the live region always read {@link name}.
   */
  readonly fieldName = input<string | null>(null);
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
  /**
   * The reader may not change the amount (velista `0200`). Both buttons and the
   * field ignore input and say so with `aria-disabled`, never the `disabled`
   * attribute, so the stepper stays in the tab order. The whole capsule is drawn
   * disabled, minus draws its bar and never the trash, and a press, Enter or Space
   * on it is told through {@link disabledPress}, so a host can say why. A write in
   * flight is {@link disabled}, which draws none of this.
   */
  readonly locked = input(false);
  /**
   * The id of an element that says why the amount may not change, for the
   * controls' `aria-describedby` while {@link locked} (velista `0200`), or null.
   */
  readonly describedBy = input<string | null>(null);
  /** A reader: the amount alone, no buttons and no outline (decision I). */
  readonly readonly = input(false);
  /** An add just raised this amount (velista `0170`, decision J). */
  readonly took = input(false);

  /** The next amount, on every press, every repeat, every key and every typed commit. */
  readonly valueChange = output<number>();
  /** The same change with where it came from and whether the hold made it. */
  readonly stepped = output<QuantityStep>();
  /**
   * A press, Enter or Space on the stepper while it is {@link locked} (velista
   * `0200`): once per gesture, with no {@link stepped} and no {@link valueChange}.
   */
  readonly disabledPress = output<void>();

  private readonly _localeStore = inject(RokuLocaleStore, { optional: true });
  private readonly _document = inject(DOCUMENT);

  readonly locale = computed(() => this._localeStore?.locale() ?? 'en');
  readonly typed = computed(() => this.variant() !== 'row');

  /**
   * The most a plus, End or a typed amount reaches: {@link max}, 99 999 for every
   * unit unless the caller says less (the owner, 2026-11-17). A line that already
   * holds more draws as it is, its plus is at its end, and it steps down.
   */
  readonly ceiling = computed(() => this.max());

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
   * floor above 0 (a due row, the how many step), never at 0 itself, and never on
   * a {@link locked} stepper, whose minus takes no press.
   */
  readonly minusClears = computed(() => {
    const value = this.value();
    return !this.locked() && value > 0 && this._down(value) === 0;
  });

  /** Both buttons and the field ignore input: a write in flight, or a locked amount. */
  readonly blocked = computed(() => this.disabled() || this.locked());

  /** What minus moves at the current amount, in short form words ("25 g", "1", "10"). */
  readonly lessStep = computed(() => {
    const value = this.value();
    const delta = value - this._down(value);
    return this._stepWords(
      delta > 0 ? delta : stepAt(value, this.unit(), this.step())
    );
  });

  /** What plus moves at the current amount: the real difference, as for minus. */
  readonly moreStep = computed(() => {
    const value = this.value();
    const delta = this._up(value) - value;
    return this._stepWords(
      delta > 0 ? delta : stepAt(value, this.unit(), this.step())
    );
  });

  /** The snap points this stepper's range can land on (velista `0195`). */
  private readonly _snaps = computed(() =>
    snapPointsWithin(this.snaps(), this.min(), this.ceiling())
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

  /** Why the field did not take the last key, while its popover shows. */
  private readonly _refusal = signal<Refusal | null>(null);
  private _refusalTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * The sentence of the refusal popover, or null when none shows (the owner,
   * 2026-11-17). The most is said in the unit the field read in, through `Intl`.
   */
  readonly refusalWords = computed<RefusalWords | null>(() => {
    const refusal = this._refusal();
    if (refusal === null) {
      return null;
    }
    switch (refusal.reason) {
      case 'most':
        return {
          key: 'amount.refused.most',
          values: {
            amount: typedLimit(
              this.ceiling(),
              refusal.symbol,
              this.unit(),
              this.locale()
            ),
          },
        };
      case 'whole':
        return {
          key:
            this.unit() === 'MILLILITER'
              ? 'amount.refused.wholeMilliliters'
              : 'amount.refused.wholeGrams',
          values: {},
        };
      case 'decimals':
        return { key: 'amount.refused.decimals', values: {} };
    }
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
  /**
   * The button a primary pointer holds down, from `pointerdown` until it goes up or
   * is cancelled (velista `0193`). Null when no hold is down.
   */
  private _holdButton: HTMLElement | null = null;
  /**
   * The pointer that holds {@link _holdButton}. The end of any other pointer leaves
   * the hold as velista `0188` left it: the repeat stops and the release is
   * swallowed, but the hold keeps its claim and its selection guard.
   */
  private _holdPointer: number | null = null;
  /** The hold repeated, so its touch no longer scrolls the page (velista `0193`, 1). */
  private _holdClaimed = false;
  /** No text was selected when the hold went down, so a selection now is the hold's. */
  private _selectionWasEmpty = true;
  /** The two buttons, which carry the touch listeners below. */
  private readonly _stepButtons =
    viewChildren<ElementRef<HTMLButtonElement>>('step');
  /**
   * A touch that moves while a hold that repeated is down does not pan, so the
   * browser never takes it for a scroll and never cancels the pointer. It sits on
   * the buttons from the start, not on the document from the first repeat: a
   * browser decides at `touchstart` whether a blocking listener is under the
   * finger, and a touch keeps the target it started on, so this sees only a touch
   * that started on the held button and cancels no other touch of the page.
   */
  private readonly _onTouchMove = (event: Event) => {
    if (this._holdClaimed && event.currentTarget === this._holdButton) {
      event.preventDefault();
    }
  };
  /** Nothing to do; it only makes the button a blocking touch target at the start. */
  private readonly _onTouchStart = () => undefined;
  /** A hold that lasts selects no text anywhere on the page (velista `0193`, 5). */
  private readonly _onSelectStart = (event: Event) => event.preventDefault();

  constructor() {
    // A render means the caller has had its chance to redraw; from here its `value`
    // is the base again. A plain field, so the hook writes no signal.
    afterEveryRender(() => {
      this._ahead = null;
    });
    // The touch listeners are added by hand, not bound in the template: a template
    // binding would schedule change detection on every move of every swipe that
    // starts on a stepper, and these do nothing unless a hold is claimed. Added
    // non passive, so a move can still be cancelled once the hold repeats.
    effect((onCleanup) => {
      const buttons = this._stepButtons().map((ref) => ref.nativeElement);
      for (const button of buttons) {
        button.addEventListener('touchstart', this._onTouchStart, {
          passive: false,
        });
        button.addEventListener('touchmove', this._onTouchMove, {
          passive: false,
        });
      }
      onCleanup(() => {
        for (const button of buttons) {
          button.removeEventListener('touchstart', this._onTouchStart);
          button.removeEventListener('touchmove', this._onTouchMove);
        }
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.endHold();
      if (this._announceTimer !== null) {
        clearTimeout(this._announceTimer);
      }
      this._clearRefusal();
    });
  }

  /**
   * A button's `click`: one step, on release. Enter and Space land here too, as a
   * click whose `detail` is 0, and those are never swallowed after a hold.
   */
  press(direction: 1 | -1, event?: MouseEvent): void {
    const pointer = (event?.detail ?? 1) !== 0;
    if (this.locked()) {
      // A press, Enter or Space on a locked stepper steps nothing and is told.
      this.disabledPress.emit();
      return;
    }
    if (!pointer) {
      // A key press of a button; a pointer's press cleared it on pointerdown, before
      // the blur that may have said why a typed count was held.
      this._clearRefusal();
    }
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
    if (this.blocked() || this._atEnd(direction)) {
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
    this._clearRefusal();
    const primary =
      (event as { isPrimary?: boolean }).isPrimary !== false &&
      (event.button === undefined || event.button === 0);
    if (!primary) {
      return;
    }
    this._swallowClick = false;
    this._stopRepeat();
    this._releaseHold();
    this._holdCount = 0;
    // Down comes before the focus moves, so typed text is still a draft here. The
    // owner's rule: this gesture commits the text only, with no step and no repeat.
    this._draftPress = this.draft() !== null;
    if (this._draftPress || this.blocked() || this._atEnd(direction)) {
      return;
    }
    // The pointer stays with the button wherever it goes, for every pointer type:
    // a slide off no longer ends the hold, only a lift or a cancel does.
    const button = event.currentTarget as HTMLElement | null;
    this._holdButton = button;
    if (typeof event.pointerId === 'number') {
      this._holdPointer = event.pointerId;
      try {
        button?.setPointerCapture?.(event.pointerId);
      } catch {
        // The pointer is no longer active; its up or cancel ends the hold as before.
      }
    }
    const selection = this._document.getSelection?.();
    this._selectionWasEmpty =
      !selection || selection.rangeCount === 0 || selection.isCollapsed;
    this._document.addEventListener('selectstart', this._onSelectStart, {
      capture: true,
    });
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
   * The finger or the button goes up, or the pointer is cancelled. A slide off the
   * button ends nothing (velista `0193`): the pointer is captured, so the hold goes
   * on until the lift. When the hold repeated, also when the repeat had already
   * stopped at an end or on a scroll, every pointer click is swallowed until the
   * next `pointerdown` on the control: a hold that stopped at the last amount above
   * 0 must not reach 0 on the release (S8b), however late a touch browser sends that
   * click. A mouse or pen press that did not repeat and is released off the button
   * steps nothing either: with the capture its click now reaches the button, and
   * only a press released on the button steps. A touch is left as before, so a tap
   * whose contact lands a few pixels past the box still steps.
   *
   * The end of a pointer that is not the hold's (a second finger) does what it did
   * before velista `0193`: it stops the repeat and swallows the release, and leaves
   * the hold its claim and its selection guard until its own pointer ends.
   */
  endHold(event?: PointerEvent): void {
    this._stopRepeat();
    if (this._holdCount > 0) {
      this._swallowClick = true;
      this._holdCount = 0;
    } else if (
      event &&
      event.type === 'pointerup' &&
      !this._isOtherPointer(event) &&
      this._releasedOff(event)
    ) {
      this._swallowClick = true;
    }
    if (!event || !this._isOtherPointer(event)) {
      this._releaseHold();
    }
  }

  /** Arrow keys, Home and End on the sheet's field (the APG spinbutton pattern). */
  onFieldKey(event: KeyboardEvent): void {
    if (this.locked() && (event.key === 'Enter' || event.key === ' ')) {
      // The field takes no click from a key, so the press is told here.
      event.preventDefault();
      this.disabledPress.emit();
      return;
    }
    if (event.key === 'Escape' && this._refusal() !== null) {
      // The popover goes, and the Escape goes no further: the sheet stays open.
      event.preventDefault();
      event.stopPropagation();
      this._clearRefusal();
      // Typed text stays: a second Escape puts the shown amount back.
      return;
    }
    if (this.blocked()) {
      return;
    }
    if (ENDS_THE_EDIT.has(event.key)) {
      this._clearRefusal();
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

  /** A press on the sheet's field while {@link locked} is told once. */
  onFieldClick(): void {
    if (this.locked()) {
      this.disabledPress.emit();
    }
  }

  onFieldFocus(event: FocusEvent): void {
    (event.target as HTMLInputElement).select();
  }

  /**
   * A keystroke or a paste. A weight or a volume reads the whole text in the unit
   * the edit holds (decision K): the text stays as typed, a whole number over 99
   * under kilos turns the label into grams and the live region names it, and a key
   * the field does not accept is put back with the caret where it was. A count
   * reads in the symbol the typing started under, as before.
   */
  onFieldInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const before = this.draft() ?? this.words().figure;
    const from =
      this.draft() === null ? this.words() : (this._draftFrom ?? this.words());
    const unit = this.unit();
    const symbol = isMeasured(unit)
      ? (this._draftSymbol() ?? from.symbol)
      : from.symbol;
    const next = followTyped(input.value, symbol, unit, this.locale());
    if (isRefused(next)) {
      // Not accepted: the field keeps the text it had, and the caret its place, and
      // the popover says why.
      const caret = Math.max(
        0,
        (input.selectionStart ?? input.value.length) -
          (input.value.length - before.length)
      );
      input.value = before;
      input.setSelectionRange?.(caret, caret);
      this._refuse(next.refused, symbol);
      return;
    }
    this._clearRefusal();
    this._draftFrom = from;
    this.turnedTo.set(next.turned ? next.symbol : null);
    this._draftSymbol.set(next.symbol);
    this.draft.set(input.value);
  }

  onFieldBlur(event: FocusEvent): void {
    this._clearRefusal();
    this._commitDraft();
    (event.target as HTMLInputElement).value = this.fieldText();
  }

  /**
   * The refusal popover asks to close. Escape and the overlay being taken down close
   * it. A press outside does not: the press that blurs the field and holds a typed
   * count lands after the popover that says so opened, and would close it at once.
   */
  onRefusalClosed(why: AnchoredPopoverClose): void {
    if (why !== 'outside') {
      this._clearRefusal();
    }
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

  /**
   * The hold is over: the touch may scroll again and text may be selected again. A
   * selection that started during the hold anyway is cleared; one the page had
   * before the press is left as it was.
   */
  private _releaseHold(): void {
    this._document.removeEventListener('selectstart', this._onSelectStart, {
      capture: true,
    });
    if (this._holdButton !== null) {
      this._clearHoldSelection();
    }
    this._holdButton = null;
    this._holdPointer = null;
    this._holdClaimed = false;
  }

  /** From the first repeat the hold owns its touch: a move no longer scrolls. */
  private _claimHold(): void {
    if (this._holdButton !== null) {
      this._holdClaimed = true;
    }
  }

  /** Whether an end event belongs to a pointer other than the one that holds. */
  private _isOtherPointer(event: PointerEvent): boolean {
    return (
      this._holdPointer !== null &&
      typeof event.pointerId === 'number' &&
      event.pointerId !== this._holdPointer
    );
  }

  private _clearHoldSelection(): void {
    if (!this._selectionWasEmpty) {
      return;
    }
    const selection = this._document.getSelection?.();
    if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
      selection.removeAllRanges();
    }
  }

  /**
   * Whether a mouse or pen release that has coordinates happened outside the held
   * button. A touch never counts: the browser captured it on its own before
   * velista `0193`, and its tap stepped wherever the contact point landed.
   */
  private _releasedOff(event: PointerEvent): boolean {
    const button = this._holdButton;
    const { clientX: x, clientY: y, pointerType } = event;
    if (pointerType !== 'mouse' && pointerType !== 'pen') {
      return false;
    }
    if (button === null || typeof x !== 'number' || typeof y !== 'number') {
      return false;
    }
    const box = button.getBoundingClientRect();
    return x < box.left || x > box.right || y < box.top || y > box.bottom;
  }

  /** One step of the hold: from the current value, so the caller's answer is the base. */
  private _repeat(direction: 1 | -1): void {
    this._holdTimer = null;
    if (this.blocked()) {
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
    this._claimHold();
    this._clearHoldSelection();
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
    return !canStepUp(
      value,
      this.unit(),
      this.ceiling(),
      this.step(),
      this._snaps()
    );
  }

  private _atEnd(direction: 1 | -1): boolean {
    const value = this._current();
    return direction === 1
      ? this._plusAtEndOf(value)
      : this._minusAtEndOf(value);
  }

  private _next(direction: 1 | -1): number {
    const value = this._current();
    return direction === 1 ? this._up(value) : this._down(value);
  }

  private _up(value: number): number {
    return stepFrom(value, this.unit(), 1, this.step(), this._snaps());
  }

  private _down(value: number): number {
    return Math.max(
      this.min(),
      stepFrom(value, this.unit(), -1, this.step(), this._snaps())
    );
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
    // The draft is read in the symbol the edit held, or turned into while typing.
    const shown = { ...from, symbol: this._draftSymbol() ?? from.symbol };
    this._clearDraft();
    const floor = this.typedMin() ?? this.min();
    const ceiling = this.ceiling();
    const amount = parseTypedAmount(draft, shown, this.unit(), floor, ceiling);
    if (amount !== null) {
      this._emit(amount, false, true);
      if (
        amount === ceiling &&
        (parseTypedAmount(draft, shown, this.unit(), floor, Infinity) ?? 0) >
          ceiling
      ) {
        // A typed count over the most was held to it: the popover says so now.
        this._refuse('most', shown.symbol);
      }
    }
    return true;
  }

  /** Shows why a key was not taken, and starts the beat after which it goes. */
  private _refuse(reason: TypedRefusal, symbol: string): void {
    this._refusal.set({ reason, symbol });
    if (this._refusalTimer !== null) {
      clearTimeout(this._refusalTimer);
    }
    this._refusalTimer = setTimeout(() => {
      this._refusalTimer = null;
      this._refusal.set(null);
    }, REFUSED_SHOWN_MS);
  }

  private _clearRefusal(): void {
    if (this._refusalTimer !== null) {
      clearTimeout(this._refusalTimer);
      this._refusalTimer = null;
    }
    this._refusal.set(null);
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
