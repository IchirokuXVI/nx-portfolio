import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
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
  QUANTITY_REEL_TAP_MAX_MS,
  QUANTITY_REEL_TAP_SLOP_PX,
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
 * ## Two gestures, and the whole overlay answers both
 *
 * A drag starts **anywhere inside the reel**, the open overlay included, not only on
 * the pill it grew out of. The overlay is wider than the pill and sits over the row
 * beside it, so a thumb that lands on the number it can see and pulls is doing the
 * ordinary thing; refusing that and only listening under the pill made the control
 * feel like it had a hidden edge.
 *
 * A **tap** on one of the numbers goes straight to it, which is the short way to
 * ±1 without travelling {@link QUANTITY_REEL_PX_PER_UNIT} for it. A tap is a press
 * that neither wandered ({@link QUANTITY_REEL_TAP_SLOP_PX}) nor lingered
 * ({@link QUANTITY_REEL_TAP_MAX_MS}): a hold is how a drag begins, so a hold that
 * ends where it started changes nothing. The number is read off the element that was
 * pressed at the moment it was pressed, not at the moment it was released, because
 * by then the tape may have moved under the finger.
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
    '[attr.aria-valuemin]': 'min()',
    '[attr.aria-valuemax]': 'max()',
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
   * The lowest number the reel will go to.
   *
   * An input rather than the constant it defaults to, because the same control now
   * counts two different things. A line's quantity floors at zero, which is the
   * household saying it is stocked; a contribution to a line floors at what has
   * **already been bought** against that list, and dragging under it is refused by
   * the server. A control that could reach a number the server refuses is a gesture
   * that fails after it has already happened on screen.
   */
  readonly min = input(LINE_QUANTITY_MIN);

  /** The highest number it will go to. See {@link min} for why it is an input. */
  readonly max = input(LINE_QUANTITY_MAX);

  /**
   * One settled adjustment, as a signed delta, when the overlay closes.
   *
   * Never zero: a gesture that ended where it started emits nothing, because there is
   * nothing to tell the server and a delta of zero is a 400.
   */
  readonly committed = output<number>();

  /**
   * The number under the thumb while the overlay is open, and null once it closes.
   *
   * What a caller draws a caption or a running total from: "buying 20 instead of 5"
   * has to be said **while the thumb is still moving**, and the delta on
   * {@link committed} arrives a beat after the gesture is over.
   *
   * Null the moment the overlay closes, however it closed: a flush, a blur, a
   * {@link close}, or the settled value arriving from elsewhere. Null means "nothing
   * is being previewed", so the caption goes away rather than freezing at the last
   * number a finger was over.
   */
  readonly preview = output<number | null>();

  /**
   * The same commit as {@link committed}, in absolute numbers.
   *
   * `from` is where the run started and `to` is where it ended, which is what the
   * two writes behind this control actually take: `{ outstanding: to, from }` and
   * `{ quantity: to, from }`. Both refuse a `from` that no longer matches, because
   * a gesture whose meaning depends on where it started must not be applied to a
   * number that moved underneath it.
   *
   * Emitted beside the delta rather than instead of it. The list page's row still
   * sends a delta and is not part of either plan, and a control that changed what it
   * emitted would be a change to that screen made in passing.
   */
  readonly committedTo = output<{ from: number; to: number }>();

  /**
   * The overlay closed on its own, having waited out {@link QUANTITY_REEL_IDLE_MS}.
   *
   * Only that case. A close that came from somewhere else, a blur or the row asking
   * for it, is somebody's own doing and needs no announcement. `LineRow` uses this to
   * stay deaf for a beat, because a finger already falling towards a number does not
   * stop when the thing under it disappears.
   */
  readonly autoClosed = output<void>();

  private readonly _destroyRef = inject(DestroyRef);
  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** What the control is showing, which is the settled value unless a gesture is on. */
  private readonly _pending = signal<number | null>(null);

  /** The value the current run of adjustments started from, for the delta at the end. */
  private _startedFrom = 0;

  /** Where the finger went down, and what the number was then. */
  private _originX = 0;
  private _originValue = 0;
  private _pointerId: number | null = null;

  /** When the press began, and the number it landed on, for telling a tap from a drag. */
  private _pressedAt = 0;
  private _pressedValue: number | null = null;
  private _wandered = false;

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
    this.shown() > this.min() ? this.shown() - 1 : null
  );

  readonly next = computed(() =>
    this.shown() < this.max() ? this.shown() + 1 : null
  );

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

    // The pending value, out loud, for whoever is drawing a caption from it. An
    // effect rather than an emit at each of the five places `_pending` is written,
    // because the five would eventually be six and the one that forgot would leave a
    // caption reading a number the thumb had already left.
    effect(() => {
      const pending = this._pending();
      untracked(() => this.preview.emit(pending));
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
    this._pressedAt = Date.now();
    // Read now rather than on release: the tape moves under the finger, so the number
    // that was pressed and the number that ends up in that spot are two different
    // things, and the one somebody aimed at is this one.
    this._pressedValue = this._numberUnder(event.target);
    this._wandered = false;
    this.dragging.set(true);
    this._pending.set(from);

    // The row is inside a scroller and the list itself answers a drag on the grip, so
    // the gesture has to be claimed explicitly or a horizontal drag becomes a scroll
    // the moment the finger wanders vertically.
    //
    // Captured on the **host** rather than on whatever was pressed, because a drag can
    // now begin on a number inside the overlay and that element is redrawn as the
    // number changes. The host outlives the gesture; the span under the finger does
    // not have to.
    this._host.nativeElement.setPointerCapture?.(event.pointerId);
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

    if (Math.abs(travelled) > QUANTITY_REEL_TAP_SLOP_PX) {
      this._wandered = true;
    }

    this._pending.set(this._clamp(this._originValue + moved));
  }

  onPointerUp(event: PointerEvent): void {
    if (event.pointerId !== this._pointerId) {
      return;
    }

    // A tap on a number, which is the other half of the gesture: it goes there rather
    // than making somebody drag the whole unit for it. A press that wandered was a
    // drag and has already said what it wants; one that lingered was a hold, which is
    // how a drag begins and not a request for the number it happened to rest on.
    if (
      this._pressedValue !== null &&
      !this._wandered &&
      Date.now() - this._pressedAt <= QUANTITY_REEL_TAP_MAX_MS
    ) {
      this._pending.set(this._clamp(this._pressedValue));
    }

    this._pressedValue = null;
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
    // what was reached still stands and still commits after the usual beat. It is not
    // a tap, though: nobody lifted their finger, so there is no press to complete.
    this._pressedValue = null;
    this.onPointerUp(event);
  }

  /**
   * The number the pressed element stands for, or null if it was not one.
   *
   * Read off the DOM rather than bound per span, because the three numbers are drawn
   * by one template each and the component would otherwise need a handler apiece for
   * a value it can simply be told.
   */
  private _numberUnder(target: EventTarget | null): number | null {
    const element = (target as Element | null)?.closest?.('[data-reel-value]');
    const raw = element?.getAttribute('data-reel-value');
    if (raw === null || raw === undefined) {
      return null;
    }

    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
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

  /**
   * Shut it now and send what it is holding.
   *
   * For the row above, which closes the reel when a tap lands elsewhere on the same
   * line. Doing it here rather than leaving it to the blur is what makes the rule hold
   * on a touch screen, where a tap on a span that cannot take focus moves focus
   * nowhere and the blur that would have closed it never fires.
   */
  close(): void {
    this._clearTimer();
    this._pointerId = null;
    this._pressedValue = null;
    this._flush();
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
      const wasOpen = this._pending() !== null;
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
      // Beside it, never instead of it. The two say the same thing to two different
      // kinds of caller: one sends a delta, and one sends where it started and where
      // it ended, because the server refuses a start that no longer matches.
      this.committedTo.emit({ from: this._startedFrom, to: settled });
    }
  }

  private _clamp(value: number): number {
    return Math.min(this.max(), Math.max(this.min(), value));
  }
}
