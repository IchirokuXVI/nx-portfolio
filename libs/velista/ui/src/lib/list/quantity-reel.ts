import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import {
  LINE_QUANTITY_MAX,
  LINE_QUANTITY_MIN,
  QUANTITY_REEL_IDLE_MS,
  QUANTITY_REEL_PAGE_STEP,
  QUANTITY_REEL_PX_PER_UNIT,
} from '@portfolio/velista/models';

/**
 * How many of something, as a number you drag.
 *
 * The primary gesture of the list page (velista plan 0043, section 4). A thumb lands
 * anywhere on the row and drags; the number follows it one to one; letting go snaps to
 * the nearest whole one. It replaced a checkbox, and the replacement is the plan: a
 * tick is a fact about one shopping trip written onto a record that outlives every
 * trip, and a quantity is a fact about now.
 *
 * It lives in `velista/ui` rather than beside the row because it is a general control
 * over a number, and the basket in `0044` needs the same one.
 *
 * ## It is positional, and that is the whole feel of it
 *
 * The reel follows the finger one to one. **No acceleration and no auto repeat**, which
 * are the two things that make a stepper held down feel like a machine rather than a
 * thing being moved. {@link QUANTITY_REEL_PX_PER_UNIT} is the only number that decides
 * how it feels: at 40px, the ~280px of comfortable travel on a 390px phone covers about
 * seven units in one drag, which is what makes two to five a single gesture rather than
 * three presses.
 *
 * ## Which way it goes, and why the keys disagree
 *
 * **The tape is a physical object.** Dragging **left** brings the higher numbers, which
 * sit to the right, into the middle; dragging right brings the lower ones back. That is
 * what the overlay is a picture of, and it is why "the previous number to the left,
 * the current one in the middle, the next to the right" describes both the overlay and
 * the direction of travel at once.
 *
 * The arrow keys go the other way round, and deliberately: `ArrowRight` and `ArrowUp`
 * **increase**, because that is what the `spinbutton` role requires and what every
 * keyboard user already knows. The two are not inconsistent so much as different
 * mechanisms wearing the same control, exactly as a physical wheel and the stepper
 * beside it are. Nobody uses both at once.
 *
 * ## The overlay does not close on release, and the close is the commit
 *
 * Letting go snaps and **leaves the overlay up** for {@link QUANTITY_REEL_IDLE_MS}, so
 * a thumb can come straight back and keep going from the snapped number. It closes
 * after that beat of idleness, and that close is what emits {@link committed}: one
 * signed delta for the whole adjustment, however many times the thumb went back for
 * more inside the window.
 *
 * That is the reason this component holds a value of its own rather than writing
 * through on every frame. A run of increments from a moving control races itself over
 * the wire, and one delta at the end cannot.
 */
@Component({
  selector: 'lib-quantity-reel',
  templateUrl: './quantity-reel.html',
  styleUrl: './quantity-reel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    // **The control is the whole host, not the pill inside it.** The row gives this
    // element its full height, which is what section 7's 44 by 44 floor asks for: the
    // target is the row's height rather than the width of two digits, because a thumb
    // walking down a supermarket aisle cannot aim at a number.
    role: 'spinbutton',
    '[attr.tabindex]': '0',
    '[attr.aria-label]': 'label()',
    '[attr.aria-valuenow]': 'shown()',
    '[attr.aria-valuemin]': 'min',
    '[attr.aria-valuemax]': 'max',
    // `readonly` rather than `disabled`: the number is real and worth reading, and
    // this caller may simply not set it.
    '[attr.aria-readonly]': 'readonly() ? "true" : null',
    '(pointerdown)': 'onPointerDown($event)',
    '(pointermove)': 'onPointerMove($event)',
    '(pointerup)': 'onPointerUp($event)',
    '(pointercancel)': 'onPointerCancel($event)',
    '(keydown)': 'onKeydown($event)',
    '(blur)': 'onBlur()',
    '[class.dragging]': 'dragging()',
    '[class.open]': 'open()',
    '[class.readonly]': 'readonly()',
  },
})
export class QuantityReel {
  /**
   * The settled quantity, as the store holds it.
   *
   * Read on every change **except while this control is mid gesture**, which is the
   * one subtlety in the component. A realtime echo of somebody else's edit must not
   * yank the number out from under a moving thumb, and the store's optimistic overlay
   * already claims `quantity` for exactly that window; this is the same rule applied
   * one layer up, where the pending value lives.
   */
  readonly value = input.required<number>();

  /** Names the line, so the spinbutton announces what it is counting. */
  readonly label = input.required<string>();

  /**
   * Whether the number may actually be changed.
   *
   * Drawn as `aria-readonly` rather than `aria-disabled`, and the difference is the
   * honest one: the number is real, current and worth reading, and this caller simply
   * may not set it. A disabled control says "not right now" about something that will
   * never be permitted for them.
   */
  readonly readonly = input(false);

  /**
   * One settled adjustment, as a signed delta, when the overlay closes.
   *
   * Never zero: a gesture that ended where it started emits nothing, because there is
   * nothing to tell the server and a delta of zero is a 400.
   */
  readonly committed = output<number>();

  private readonly _destroyRef = inject(DestroyRef);

  /** What the control is showing, which is the settled value unless a gesture is on. */
  private readonly _pending = signal<number | null>(null);

  /** The value the current run of adjustments started from, for the delta at the end. */
  private _startedFrom = 0;

  /** Where the finger went down, and what the number was then. */
  private _originX = 0;
  private _originValue = 0;
  private _pointerId: number | null = null;

  private _idleTimer: ReturnType<typeof setTimeout> | null = null;

  readonly dragging = signal(false);

  /** Whether the overlay is up: through the drag, and for a beat after it. */
  readonly open = computed(() => this._pending() !== null);

  /** What to draw and what to announce. */
  readonly shown = computed(() => this._pending() ?? this.value());

  /**
   * The number to the left of the current one, or null at zero.
   *
   * **Null is the affordance.** There is no minus one, so nothing is drawn there, and
   * the gap is what tells a thumb it has reached the end without a disabled control or
   * a bounce to explain it (section 4).
   */
  readonly previous = computed(() =>
    this.shown() > LINE_QUANTITY_MIN ? this.shown() - 1 : null
  );

  readonly next = computed(() =>
    this.shown() < LINE_QUANTITY_MAX ? this.shown() + 1 : null
  );

  readonly min = LINE_QUANTITY_MIN;
  readonly max = LINE_QUANTITY_MAX;

  constructor() {
    // A settled value arriving from elsewhere ends a gesture that is no longer about
    // the number on screen. It cannot land mid drag without the pending value being
    // wrong, and the safe reading of "somebody else changed this while my thumb was
    // down" is to show what the list now says rather than to keep arguing with it.
    effect(() => {
      this.value();
      untracked(() => {
        if (!this.dragging() && this._idleTimer === null) {
          this._pending.set(null);
        }
      });
    });

    this._destroyRef.onDestroy(() => {
      // The commit is the close, so a control torn off screen mid gesture has to send
      // what it was holding. Leaving the page is not a cancellation: the number moved
      // on screen, the person saw it move, and a silent discard would be the list
      // disagreeing with what they watched happen.
      this._flush();
      this._clearTimer();
    });
  }

  // ------------------------------------------------------------------ pointer

  onPointerDown(event: PointerEvent): void {
    if (this.readonly() || !event.isPrimary) {
      return;
    }

    // Whatever is on screen, which is the snapped number when a second drag starts
    // inside the idle window rather than the value the list still holds.
    const from = this.shown();
    if (this._pending() === null) {
      this._startedFrom = from;
    }

    this._clearTimer();
    this._originX = event.clientX;
    this._originValue = from;
    this._pointerId = event.pointerId;
    this.dragging.set(true);
    this._pending.set(from);

    // The row is inside a scroller and the list itself answers a drag on the grip, so
    // the gesture has to be claimed explicitly or a horizontal drag becomes a scroll
    // the moment the finger wanders vertically.
    (event.target as Element | null)?.setPointerCapture?.(event.pointerId);
  }

  onPointerMove(event: PointerEvent): void {
    if (!this.dragging() || event.pointerId !== this._pointerId) {
      return;
    }

    // Leftwards is more. The tape holds ascending numbers left to right and the
    // window over it does not move, so pulling the tape left brings the higher ones
    // into the middle, which is what the overlay is a picture of.
    const travelled = this._originX - event.clientX;
    const moved = Math.round(travelled / QUANTITY_REEL_PX_PER_UNIT);

    this._pending.set(this._clamp(this._originValue + moved));
  }

  onPointerUp(event: PointerEvent): void {
    if (event.pointerId !== this._pointerId) {
      return;
    }

    this.dragging.set(false);
    this._pointerId = null;
    // Already whole: the pending value has been rounded on every move, so the snap is
    // a transition rather than an arithmetic step. The animation is the only
    // confirmation the gesture gives, which is why it is in the stylesheet and not
    // conditional on anything here.
    this._restartIdle();
  }

  onPointerCancel(event: PointerEvent): void {
    // A cancel is the system taking the gesture away, not the person abandoning it, so
    // what was reached still stands and still commits after the usual beat.
    this.onPointerUp(event);
  }

  // ----------------------------------------------------------------- keyboard

  /**
   * The non pointer path, and it is a real one (section 7).
   *
   * `0012`'s rule holds unchanged: a gesture is never the only way to do anything.
   * Arrows step by one, page keys by five, and a run of presses commits as **one**
   * delta on the same idle beat a drag uses, so holding an arrow down does not become
   * a request per repeat.
   */
  onKeydown(event: KeyboardEvent): void {
    if (this.readonly()) {
      return;
    }

    const step = this._stepFor(event.key);
    if (step === null) {
      return;
    }

    event.preventDefault();

    if (this._pending() === null) {
      this._startedFrom = this.value();
    }
    this._clearTimer();
    this._pending.set(this._clamp(this.shown() + step));
    this._restartIdle();
  }

  /**
   * Leaving the control commits what is on it, rather than waiting out the beat.
   *
   * Focus moving away is a clearer end to the gesture than a timer is, and a person
   * who tabs on and sees the old number a second later would reasonably conclude it
   * had not worked.
   */
  onBlur(): void {
    if (this._pending() !== null && !this.dragging()) {
      this._flush();
    }
  }

  private _stepFor(key: string): number | null {
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
      this._flush();
    }, QUANTITY_REEL_IDLE_MS);
  }

  private _clearTimer(): void {
    if (this._idleTimer !== null) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }
  }

  /**
   * Close the overlay and send what the whole run came to.
   *
   * The delta is measured from where the **run** started rather than from the last
   * snap, which is what makes three drags inside one idle window a single request.
   * A run that ended where it began sends nothing at all.
   */
  private _flush(): void {
    const settled = this._pending();
    this._pending.set(null);
    this.dragging.set(false);

    if (settled === null) {
      return;
    }

    const delta = settled - this._startedFrom;
    if (delta !== 0) {
      this.committed.emit(delta);
    }
  }

  private _clamp(value: number): number {
    return Math.min(LINE_QUANTITY_MAX, Math.max(LINE_QUANTITY_MIN, value));
  }
}
