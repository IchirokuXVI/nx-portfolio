import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  untracked,
  type OnDestroy,
} from '@angular/core';
import { RokuLocaleStore } from '@portfolio/localization/rokutranslator-angular';
import {
  canStepUp,
  isMeasured,
  LINE_QUANTITY_MAX,
  LINE_QUANTITY_MIN,
  QUANTITY_REEL_IDLE_MS,
  QUANTITY_REEL_PAGE_STEP,
  QUANTITY_REEL_PX_PER_UNIT,
  QUANTITY_SNAP_POINTS,
  snapPointsWithin,
  stepFrom,
  type LineUnit,
  type QuantityStep,
} from '@portfolio/velista/models';
import {
  formatAmount,
  handleBackWhile,
  shortAmount,
  type AmountWords,
} from '@portfolio/velista/platform';
import { classifyReelGesture } from './quantity-reel-gesture';

/**
 * How many of something, as a number you drag.
 *
 * The control of the compact view (velista `0203`): the reel of velista plan 0043,
 * which the button stepper replaced in velista `0188`, back where the room is
 * shortest. A thumb lands on it and drags; the number follows it one to one; letting
 * go snaps to the step it is over. It has no hold, no trash and no typing: a reel
 * dragged to 0 hides its line with no warning (the owner, 2026-11-22).
 *
 * ## It is positional, and that is the whole feel of it
 *
 * The reel follows the finger one to one. **No acceleration and no auto repeat**.
 * {@link QUANTITY_REEL_PX_PER_UNIT} is the only number that decides how it feels: at
 * 40px, the ~280px of comfortable travel on a 390px phone covers about seven steps in
 * one drag, which is what makes two to five a single gesture rather than three
 * presses.
 *
 * ## Two gestures, and the whole overlay answers both
 *
 * A drag starts **anywhere inside the reel**, the open overlay included, not only on
 * the pill it grew out of. The overlay is wider than the pill and sits over the row
 * beside it, so a thumb that lands on the number it can see and pulls is doing the
 * ordinary thing.
 *
 * A **tap** on one of the numbers goes straight to it. A tap is a press that neither
 * wandered ({@link QUANTITY_REEL_TAP_SLOP_PX}) nor lingered
 * ({@link QUANTITY_REEL_TAP_MAX_MS}): a hold is how a drag begins, so a hold that
 * ends where it started changes nothing. The number is read off the element that was
 * pressed at the moment it was pressed, not at the moment it was released, because
 * by then the tape may have moved under the finger.
 *
 * ## A press is not yet a gesture
 *
 * The reel sits in a row of a list that scrolls, so a thumb that lands on it and goes
 * up or down is scrolling the list (velista `0079`, section 8). The press is only
 * noted. The overlay opens, and the pointer is claimed, once the press has become a
 * sideways drag or a tap, and a vertical move or a `pointercancel` drops it with
 * nothing drawn and nothing sent. {@link classifyReelGesture} decides which, and the
 * host's `touch-action: pan-y` hands vertical panning to the browser.
 *
 * ## Which way it goes, and why the keys disagree
 *
 * **The tape is a physical object.** Dragging **left** brings the higher numbers, which
 * sit to the right, into the middle; dragging right brings the lower ones back. The
 * arrow keys go the other way round, and deliberately: `ArrowRight` and `ArrowUp`
 * **increase**, because that is what the `spinbutton` role requires.
 *
 * ## The overlay does not close on release, and the close is the commit
 *
 * Letting go snaps and **leaves the overlay up** for {@link QUANTITY_REEL_IDLE_MS}, so
 * a thumb can come straight back and keep going from the snapped number. It closes
 * after that beat of idleness, and that close is what emits {@link stepped}: one step
 * from the amount it opened on to the amount it closed on, however many times the
 * thumb went back for more inside the window.
 *
 * ## It steps by today's rule (velista `0195`, `0203`)
 *
 * Every move of the tape is one `stepFrom` from the number before it, with the
 * product's {@link step} and the {@link snaps} that fall inside the range: a kilo at
 * 950 g reads 925, 950, 975 and goes on to 1000 and 1050. The drag (one step per
 * {@link QUANTITY_REEL_PX_PER_UNIT}), the neighbours and the keys all walk the same
 * steps. The value stays an integer in base units: 750 g is 750.
 *
 * ## One size, the number over its unit
 *
 * The pill is a fixed box of `--app-quantity-width` by `--app-quantity-height`
 * whatever it holds, so every reel of a list sits in one column. The number is drawn
 * over its unit from the short form ("1,5" over "kg"); a count has no unit and its
 * number sits centred. The spinbutton's value text keeps the whole words.
 *
 * ## With a target, a colour is a status and never the selection (velista `0204`)
 *
 * A reel given a {@link target} (the basket row sheet, where it is the list's ask)
 * colours every number it draws by where that number stands: the normal text colour
 * below the target, the success colour at it, the quiet amber above it. That holds
 * for the resting number and for each number on the tape, selected or not, so amber
 * means only "more than asked". The selected number is told apart by its size and its
 * weight alone, larger and bold; its neighbours are smaller and regular. A reel with no
 * target draws as velista `0203` drew it: the selected number in the quiet amber and
 * its neighbours muted.
 */
@Component({
  selector: 'lib-quantity-reel',
  templateUrl: './quantity-reel.html',
  styleUrl: './quantity-reel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    // **The control is the whole host, not the pill inside it.** The row gives this
    // element its full height, which is what the 44 by 44 floor asks for.
    role: 'spinbutton',
    '[attr.tabindex]': '0',
    '[attr.aria-label]': 'label()',
    '[attr.aria-valuenow]': 'shown()',
    // The words of a weight or a volume ("750 g"), where the raw number would read
    // as grams nobody can picture. Absent for a count, whose number is its words.
    '[attr.aria-valuetext]': 'valueText()',
    '[attr.aria-valuemin]': 'min()',
    '[attr.aria-valuemax]': 'max()',
    // `readonly` rather than `disabled`: the number is real and worth reading, and
    // this caller may simply not set it.
    '[attr.aria-readonly]': 'readonly() ? "true" : null',
    '[attr.data-value]': 'value()',
    '(pointerdown)': 'onPointerDown($event)',
    '(pointermove)': 'onPointerMove($event)',
    '(pointerup)': 'onPointerUp($event)',
    '(pointercancel)': 'onPointerCancel($event)',
    '(keydown)': 'onKeydown($event)',
    '(blur)': 'onBlur()',
    '[class.dragging]': 'dragging()',
    '[class.open]': 'open()',
    '[class.readonly]': 'readonly()',
    '[class.took]': 'took()',
    '[class.targeted]': 'target() !== null',
  },
})
export class QuantityReel implements OnDestroy {
  /**
   * The commit is the close, so a control torn off screen mid gesture sends what it
   * was holding: the number moved on screen, and the person saw it move.
   *
   * **`ngOnDestroy`, not a `DestroyRef` callback**, and the difference is whether
   * anybody hears it. The reel's `DestroyRef` belongs to the view that declares it,
   * which is also the view that holds the parent's `(stepped)` listener, and Angular
   * tears a view down in this order: the `ngOnDestroy` hooks of its directives, then
   * its listeners and output subscriptions, then its `DestroyRef` callbacks. A step
   * sent from a callback reaches a listener that is already gone. Sent from here, it
   * reaches the row, and through it the page, because a view is torn down before
   * the views around it.
   */
  ngOnDestroy(): void {
    this._clearTimer();
    this._flush();
  }

  /**
   * The settled quantity, as the store holds it.
   *
   * Read on every change **except while this control is mid gesture**. A realtime
   * echo of somebody else's edit must not yank the number out from under a moving
   * thumb.
   */
  readonly value = input.required<number>();

  /** Names the amount, so the spinbutton announces what it is counting. */
  readonly label = input.required<string>();

  /** What {@link value} counts (velista `0182`). */
  readonly unit = input<LineUnit>('UNIT');

  /**
   * The product's step in base units, or null for the unit's default (velista
   * `0186`). Read only for a weight or a volume, as the stepper reads it.
   */
  readonly step = input<number | null>(null);

  /**
   * The amounts a drag lands on rather than pass (velista `0195`): 1000 by default.
   * A caller that passes its own list replaces the default. Points at or under
   * {@link min} or over {@link max} are dropped by `snapPointsWithin`.
   */
  readonly snaps = input<readonly number[]>(QUANTITY_SNAP_POINTS);

  /**
   * Whether the number may actually be changed. Drawn as `aria-readonly`: the number
   * is real and worth reading, and this caller simply may not set it.
   */
  readonly readonly = input(false);

  /**
   * Whether an add just raised this number (velista `0170`, target 4): the pill takes
   * an amber edge while it is true. The container decides for how long.
   */
  readonly took = input(false);

  /**
   * The amount the numbers are measured against (velista `0204`): on the basket row
   * sheet, what the list asks for. Null for no colour, which is every reel outside
   * that sheet. See the class's "With a target" section for what each number takes.
   */
  readonly target = input<number | null>(null);

  /**
   * The lowest number the reel goes to: a line's floor of 0, or 1 on a due row,
   * where adding nothing is not an add (velista `0089`).
   */
  readonly min = input(LINE_QUANTITY_MIN);

  /** The highest number it goes to, 99 999 for every unit (velista `0188`, S6). */
  readonly max = input(LINE_QUANTITY_MAX);

  /**
   * The adjustment, once, when the overlay closes: from the amount it opened on to
   * the amount it closed on. Never from and to equal: a gesture that ended where it
   * started emits nothing. `repeat` is always false, since the reel has no hold.
   */
  readonly stepped = output<QuantityStep>();

  /**
   * The overlay closed on its own, having waited out {@link QUANTITY_REEL_IDLE_MS}.
   *
   * Only that case. A close that came from somewhere else, a blur or the row asking
   * for it, is somebody's own doing. `LineRow` uses this to stay deaf for a beat,
   * because a finger already falling towards a number does not stop when the thing
   * under it disappears.
   */
  readonly autoClosed = output<void>();

  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);
  /** Optional, so a count drawn where no translator is provided still draws. */
  private readonly _localeStore = inject(RokuLocaleStore, { optional: true });

  private readonly _locale = computed(
    () => this._localeStore?.locale() ?? 'en'
  );

  /** What the control is showing, which is the settled value unless a gesture is on. */
  private readonly _pending = signal<number | null>(null);

  /** The snap points this reel's range can land on (velista `0195`). */
  private readonly _snaps = computed(() =>
    snapPointsWithin(this.snaps(), this.min(), this.max())
  );

  /** The value the current run of adjustments started from, for the step at the end. */
  private _startedFrom = 0;

  /** Where the finger went down, and what the number was when the overlay opened. */
  private _originX = 0;
  private _originY = 0;
  private _originValue = 0;
  private _pointerId: number | null = null;

  /** When the press began, and the number it landed on, for telling a tap from a drag. */
  private _pressedAt = 0;
  private _pressedValue: number | null = null;

  /**
   * Whether a press is down and not yet a tap, a drag or a scroll. Nothing is drawn
   * in that stretch: a thumb setting off to scroll the list must not open anything.
   */
  private _deciding = false;

  private _idleTimer: ReturnType<typeof setTimeout> | null = null;

  readonly dragging = signal(false);

  /** Whether the overlay is up: through the drag, and for a beat after it. */
  readonly open = computed(() => this._pending() !== null);

  /** What to draw and what to announce. */
  readonly shown = computed(() => this._pending() ?? this.value());

  /** The number and its unit apart, as the pill and the tape's middle draw them. */
  readonly figure = computed(() => this.figureOf(this.shown()));

  /** `aria-valuetext`: the whole words of a weight or a volume, nothing for a count. */
  readonly valueText = computed(() =>
    !isMeasured(this.unit())
      ? null
      : formatAmount(this.shown(), this.unit(), this._locale())
  );

  /**
   * The number to the left of the current one, or null at the floor.
   *
   * **Null is the affordance.** Nothing is drawn there, and the gap is what tells a
   * thumb it has reached the end without a disabled control or a bounce.
   */
  readonly previous = computed(() => {
    const shown = this.shown();
    return shown > this.min() ? this._down(shown) : null;
  });

  /** The number to the right, or null where a step up would pass {@link max}. */
  readonly next = computed(() => {
    const shown = this.shown();
    return this._canUp(shown) ? this._up(shown) : null;
  });

  /**
   * A number of the tape in its short form, the figure and the symbol apart: "1,5"
   * and "kg" for 1500 g, "6" and "" for a count of 6, "100" and "K" for 99 999.
   */
  figureOf(value: number): AmountWords {
    return shortAmount(value, this.unit(), this._locale());
  }

  /**
   * Where a number stands against {@link target}: `reached` at it, `over` above it,
   * null below it or with no target. As the stepper reads it (velista `0201`): a
   * target of 0 is never reached, so nothing is green for a list that asks nothing,
   * and any amount above it is over.
   */
  reachOf(value: number): 'reached' | 'over' | null {
    const target = this.target();
    if (target === null) {
      return null;
    }
    return value > target
      ? 'over'
      : value === target && target > 0
        ? 'reached'
        : null;
  }

  constructor() {
    // A settled value arriving from elsewhere ends a gesture that is no longer about
    // the number on screen, unless a thumb is still on it.
    effect(() => {
      this.value();
      untracked(() => {
        if (!this.dragging() && !this._deciding && this._idleTimer === null) {
          this._pending.set(null);
        }
      });
    });

    // A native back press shuts the open overlay and sends what it holds, the same
    // close a tap elsewhere on the row makes (velista `0166`).
    handleBackWhile(this.open, () => this.close());
  }

  // ------------------------------------------------------------------ pointer

  onPointerDown(event: PointerEvent): void {
    if (this.readonly() || !event.isPrimary) {
      return;
    }

    // Only noted (velista `0079`, section 8). Nothing opens and nothing is captured
    // until the press has become a drag or a tap.
    this._pointerId = event.pointerId;
    this._originX = event.clientX;
    this._originY = event.clientY;
    this._pressedAt = Date.now();
    // Read now rather than on release: the tape moves under the finger, and the
    // number somebody aimed at is the one under it now.
    this._pressedValue = this._numberUnder(event.target);
    this._deciding = true;

    // An overlay already up waits for this press rather than closing under it.
    if (this._pending() !== null) {
      this._clearTimer();
    }
  }

  onPointerMove(event: PointerEvent): void {
    if (event.pointerId !== this._pointerId) {
      return;
    }

    // A move with no button down is a press that already ended: a mouse that left the
    // host before the first move, when nothing was captured yet, and let go outside
    // it, where this control never saw the pointerup. Ended here, or the hover that
    // follows would count as a drag with no button held.
    if (event.buttons === 0) {
      if (this._deciding) {
        this._abandon();
      } else if (this.dragging()) {
        this.onPointerUp(event);
      }
      return;
    }

    if (this._deciding) {
      const gesture = this._classify(event, false);
      if (gesture === 'scroll') {
        this._abandon();
        return;
      }
      if (gesture !== 'drag') {
        return;
      }
      this._startDrag();
    }

    if (this.dragging()) {
      this._follow(event.clientX);
    }
  }

  onPointerUp(event: PointerEvent): void {
    if (event.pointerId !== this._pointerId) {
      return;
    }

    if (this._deciding) {
      const gesture = this._classify(event, true);

      if (gesture === 'tap') {
        // A tap opens the overlay, and a tap on one of its numbers goes there.
        const pressed = this._pressedValue;
        this._claim();
        if (pressed !== null) {
          this._pending.set(this._clamp(pressed));
        }
      } else if (gesture === 'drag') {
        // A flick that reached the slop with no move event in between.
        this._startDrag();
        this._follow(event.clientX);
      } else {
        // A scroll, or a hold that never moved: neither asked for anything.
        this._abandon();
        return;
      }
    }

    this._pressedValue = null;
    this.dragging.set(false);
    this._pointerId = null;
    this._restartIdle();
  }

  onPointerCancel(event: PointerEvent): void {
    if (event.pointerId !== this._pointerId) {
      return;
    }

    // Before the press became anything, a cancel is the browser taking it for a
    // scroll, which is exactly the gesture this control must stay out of.
    if (this._deciding) {
      this._abandon();
      return;
    }

    // A drag already under way keeps what it reached, and commits after the beat.
    this._pressedValue = null;
    this.onPointerUp(event);
  }

  private _classify(event: PointerEvent, ended: boolean) {
    return classifyReelGesture({
      dx: event.clientX - this._originX,
      dy: event.clientY - this._originY,
      elapsedMs: Date.now() - this._pressedAt,
      ended,
    });
  }

  /** The press became a gesture: open the overlay and claim the pointer. */
  private _claim(): void {
    this._deciding = false;

    // Whatever is on screen, which is the snapped number when a second drag starts
    // inside the idle window rather than the value the list still holds.
    const from = this.shown();
    if (this._pending() === null) {
      this._startedFrom = from;
    }

    this._clearTimer();
    this._originValue = from;
    this._pending.set(from);

    // Captured on the **host** rather than on whatever was pressed, because a drag can
    // begin on a number inside the overlay and that element is redrawn as the number
    // changes. Captured only now, because a capture at the press would hold the
    // pointer for a scroll as well.
    if (this._pointerId !== null) {
      this._host.nativeElement.setPointerCapture?.(this._pointerId);
    }
  }

  /** A sideways move past the slop, which is never also a tap. */
  private _startDrag(): void {
    this._claim();
    this._pressedValue = null;
    this.dragging.set(true);
  }

  private _follow(clientX: number): void {
    // Leftwards is more: pulling the tape left brings the higher numbers into the
    // middle, which is what the overlay is a picture of.
    const travelled = this._originX - clientX;
    const moved = Math.round(travelled / QUANTITY_REEL_PX_PER_UNIT);
    this._pending.set(this._walk(this._originValue, moved));
  }

  /**
   * Drop a press that did not become a drag or a tap: nothing opens, nothing changes,
   * nothing is sent. An overlay already up starts its beat again.
   */
  private _abandon(): void {
    this._deciding = false;
    this._pointerId = null;
    this._pressedValue = null;
    if (this._pending() !== null) {
      this._restartIdle();
    }
  }

  /** The number the pressed element stands for, or null if it was not one. */
  private _numberUnder(target: EventTarget | null): number | null {
    const element = (target as Element | null)?.closest?.('[data-reel-value]');
    const raw = element?.getAttribute('data-reel-value');
    if (raw === null || raw === undefined || raw === '') {
      return null;
    }

    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }

  // ----------------------------------------------------------------- keyboard

  /**
   * The non pointer path: a gesture is never the only way to do anything. Arrows
   * step once, page keys {@link QUANTITY_REEL_PAGE_STEP} times, and a run of presses
   * commits as **one** step on the same idle beat a drag uses.
   */
  onKeydown(event: KeyboardEvent): void {
    if (this.readonly()) {
      return;
    }

    const steps = this._stepsFor(event.key);
    if (steps === null) {
      return;
    }

    event.preventDefault();

    if (this._pending() === null) {
      this._startedFrom = this.value();
    }
    this._clearTimer();
    this._pending.set(this._walk(this.shown(), steps));
    this._restartIdle();
  }

  /** Leaving the control commits what is on it, rather than waiting out the beat. */
  onBlur(): void {
    if (this._pending() !== null && !this.dragging()) {
      this._flush();
    }
  }

  /**
   * Shut it now and send what it is holding.
   *
   * For the row above, which closes the reel when a tap lands elsewhere on the same
   * line. On a touch screen a tap on a span that cannot take focus moves focus
   * nowhere, and the blur that would have closed it never fires.
   */
  close(): void {
    this._clearTimer();
    this._pointerId = null;
    this._pressedValue = null;
    this._deciding = false;
    this._flush();
  }

  /** How many steps a key moves the number, signed, or null for none. */
  private _stepsFor(key: string): number | null {
    switch (key) {
      case 'ArrowUp':
      case 'ArrowRight':
        return 1;
      case 'ArrowDown':
      case 'ArrowLeft':
        return -1;
      case 'PageUp':
        return QUANTITY_REEL_PAGE_STEP;
      case 'PageDown':
        return -QUANTITY_REEL_PAGE_STEP;
      default:
        return null;
    }
  }

  // ------------------------------------------------------------------ commit

  private _restartIdle(): void {
    this._clearTimer();
    this._idleTimer = setTimeout(() => {
      this._idleTimer = null;
      const wasOpen = this.open();
      this._flush();
      if (wasOpen) {
        this.autoClosed.emit();
      }
    }, QUANTITY_REEL_IDLE_MS);
  }

  private _clearTimer(): void {
    if (this._idleTimer !== null) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }
  }

  /**
   * Close the overlay and send what the whole run came to: one step from where the
   * **run** started, so three drags inside one idle window are a single change. A
   * run that ended where it began sends nothing.
   */
  private _flush(): void {
    const settled = this._pending();
    this._pending.set(null);
    this.dragging.set(false);

    if (settled === null || settled === this._startedFrom) {
      return;
    }

    this.stepped.emit({ from: this._startedFrom, to: settled, repeat: false });
  }

  private _clamp(value: number): number {
    return Math.min(this.max(), Math.max(this.min(), value));
  }

  /**
   * `steps` steps from `value`, each one `stepFrom` from the number before it, and
   * stopping at the end of the range: under {@link min} is never reached, and a step
   * up that would pass {@link max} is not taken.
   */
  private _walk(value: number, steps: number): number {
    // Not clamped first: a line stored above the ceiling draws as it is and steps
    // down from there, as the stepper's does.
    let at = value;
    for (let i = 0; i < Math.abs(steps); i++) {
      if (steps > 0) {
        if (!this._canUp(at)) {
          break;
        }
        at = this._up(at);
      } else {
        if (at <= this.min()) {
          break;
        }
        at = this._down(at);
      }
    }
    return at;
  }

  private _canUp(value: number): boolean {
    return canStepUp(
      value,
      this.unit(),
      this.max(),
      this.step(),
      this._snaps()
    );
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
}
