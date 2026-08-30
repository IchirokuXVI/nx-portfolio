import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { OpenSheet, type FallingSheet } from '@portfolio/velista/platform';

/** The motion tokens this component reads, by name, so a typo is one place wrong. */
const MOTION_BASE = '--app-motion-base';
const MOTION_FAST = '--app-motion-fast';

/**
 * How much of the panel has to be pulled down before letting go closes it.
 *
 * A quarter, which is what a drag has to look like to be one. Less and a sheet is lost
 * to a thumb resting on the handle while reading; more and the gesture stops feeling
 * like it is holding the sheet at all.
 */
const DISMISS_FRACTION = 0.25;

/**
 * The floor under that fraction, in pixels.
 *
 * The confirm sheets are two lines and a pair of buttons, and a quarter of one of those
 * is under 40px, which a thumb crosses without meaning anything by it.
 */
const MIN_DISMISS_DISTANCE = 56;

/**
 * Downward pixels per millisecond that count as a flick regardless of distance.
 *
 * The fast gesture is the short one: somebody throwing a sheet away moves perhaps 40px
 * and lets go. Distance alone would spring that back, which reads as the sheet refusing
 * the most natural way there is to dismiss it.
 */
const FLICK_SPEED = 0.5;

/**
 * How much of the end of a drag the speed is measured over, in milliseconds.
 *
 * Long enough to average out the jitter between individual pointer events, and short
 * enough that only the end of the gesture counts: a sheet dragged down quickly, held,
 * and then released was not thrown anywhere.
 */
const SPEED_WINDOW = 120;

/**
 * The panel a mutation is asked for in: scrim, rounded panel, grab handle, and the
 * modal behaviour that makes it a dialog rather than a box that happens to be on top.
 *
 * Rule E1 (plan 0008) makes each sheet a **child route** of the page it covers, so
 * this component never decides whether it is open: it exists when its route is
 * active and is destroyed when it is not. That is what makes the Android back button
 * close it, which is the behaviour the whole decision turns on. `dismiss` therefore
 * means "go back", and the container is the thing that knows where back is.
 *
 * It means it literally: every container answers this output through `SheetNavigation`,
 * which pops the entry the sheet was opened with rather than navigating to the page
 * underneath. Navigating there pushes, which left the sheet's URL in the stack with the
 * page on top of it, and the next back press opened the panel again (plan 0031).
 *
 * ## What it owns, and why it is not four components
 *
 * Everything here is modal behaviour, and modal behaviour that is split up stops
 * working: a focus trap without a scrim traps focus behind something clickable, and a
 * scrim without a focus trap is a dialog a screen reader walks straight out of. The
 * body is projected, so the two sheets share all of it and share none of their copy.
 *
 * ## Semantics
 *
 * `role="dialog"`, `aria-modal="true"` and a label from the title the caller renders,
 * addressed by id. Focus moves inside on open and returns to the control that opened
 * it on close, which the browser does for free here: the sheet is a route, so closing
 * it restores the page beneath with its focus intact, and the explicit restore below
 * covers the case where it does not.
 *
 * ## Nothing browser-only at construction
 *
 * `afterNextRender` runs in the browser and never on the server (plan 0001, D2), and
 * the document is reached through the host element rather than through a global.
 */
@Component({
  selector: 'lib-sheet-shell',
  templateUrl: './sheet-shell.html',
  styleUrl: './sheet-shell.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(keydown.escape)': 'requestDismiss()',
    // Plain `keydown` rather than `keydown.tab`, because Angular treats Shift+Tab as a
    // different binding (`keydown.shift.tab`) and the trap has to see both to know
    // which end it is at. The host binding hands over an `Event`, so it is narrowed
    // here rather than typed optimistically.
    '(keydown)': 'wrapFocus($event)',
  },
})
export class SheetShell implements FallingSheet {
  /** The id of the title the caller rendered, so the dialog is named by it. */
  readonly labelledBy = input.required<string>();

  /**
   * Whether the sheet may be closed right now.
   *
   * False while a mutation is in flight, which is the one state where dismissal is
   * genuinely wrong: the request has already gone, so closing would leave the person
   * unable to see what happened to a group that may well now exist (plan 0008,
   * section 3.1).
   */
  readonly dismissible = input(true);

  readonly dismiss = output<void>();

  /**
   * Set while the panel is falling, between the gesture and the navigation.
   *
   * The exit animation has nowhere else to live. Rule E1 makes a sheet a route, so
   * `dismiss` is a navigation and the router destroys this component before a frame
   * of an exit animation could be drawn. So the shell delays the navigation rather
   * than the destruction: the panel falls first, and `dismiss` is emitted when it
   * has landed.
   *
   * That covers the exits that start in here. The rest — the back button, the back
   * gesture, and a submit that succeeded and leaves for somewhere else — change the
   * route first, so they are held open from the outside instead: `sheetFallGuard`
   * awaits {@link fall} on the way off the sheet's route. The animation is the same
   * one either way, because both go through `_afterFall`.
   */
  readonly closing = signal(false);

  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly _openSheet = inject(OpenSheet);

  /** Whatever had focus when the sheet opened, so it can be handed back. */
  private _returnFocusTo: HTMLElement | null = null;

  /** Whether a fall has been started, so a second ask cannot restart it. */
  private _fallStarted = false;

  /** Whether the panel is already down, so a later ask resolves at once. */
  private _landed = false;

  /**
   * Who is waiting for the panel to land, run from the timer itself.
   *
   * A list of callbacks rather than a promise the whole class hangs off, because the
   * two things that wait are not the same shape. `dismiss` has to be emitted **in** the
   * timer: a `.then` would move it to a microtask, which no spec advancing fake timers
   * would ever see, and the emission is what the sheet's whole contract is written
   * around. `fall` wraps the same list for the guard, which is happy with a promise.
   */
  private readonly _onLanded: Array<() => void> = [];

  /**
   * How far the panel has been pulled down by the handle, in pixels, or null when
   * nothing is holding it.
   *
   * Bound to the panel's own `transform`, so the sheet tracks the finger rather than
   * waiting to find out where it ended up. Null rather than zero when idle, so the
   * declaration is absent entirely and the rise and the fall animate against nothing.
   */
  readonly dragOffset = signal<number | null>(null);

  /** Set while a finger is on the handle, which is what suspends the snap back. */
  readonly dragging = signal(false);

  /** Set while the panel is springing back to closed, for the one transition it has. */
  readonly settling = signal(false);

  /** Where the finger went down, in viewport coordinates. */
  private _dragFrom = 0;

  /**
   * The recent history of the drag, newest last, for the speed at release.
   *
   * A window rather than the last pair of events, because the last pair is noise: a
   * phone delivers a move every 8ms or so, and whether the final one happens to have
   * covered 2px or 12px says nothing about how fast the sheet was thrown. Trimmed to
   * {@link SPEED_WINDOW}, so a drag that was held still and then released reads as
   * still, which is what it was.
   */
  private _dragTrail: Array<{ offset: number; at: number }> = [];

  constructor() {
    // Registered for the whole life of the component rather than from the first
    // render, because a navigation can be decided before the first frame is drawn and
    // an unregistered sheet is one the guard cannot animate.
    this._openSheet.register(this);
    inject(DestroyRef).onDestroy(() => this._openSheet.release(this));

    afterNextRender(() => {
      const doc = this._host.nativeElement.ownerDocument;
      const active = doc.activeElement;
      this._returnFocusTo = active instanceof HTMLElement ? active : null;

      // The field, in practice: it is the first focusable thing the caller projects.
      // Focusing the panel itself instead would announce the dialog and then leave
      // the person a tab away from the only control that matters.
      this._focusable()[0]?.focus();
    });
  }

  /**
   * Escape, and a tap on the scrim. Both are the same gesture as the back button.
   *
   * Guarded on `closing` as well as on `dismissible`, so a second gesture during the
   * fall cannot queue a second navigation.
   */
  requestDismiss(): void {
    if (!this.dismissible() || this.closing()) {
      return;
    }

    this._returnFocusTo?.focus();
    this._afterFall(() => this.dismiss.emit());
  }

  /**
   * A finger, or a mouse, goes down on the handle.
   *
   * The handle has advertised a downward drag since the sheet existed and has never
   * answered one: it was decorative, and the gesture it drew went to the browser, which
   * read a pull at the top of the document as a request to reload the page. So the
   * sheet lost its own gesture *and* the page came back from the network.
   *
   * The pointer is captured so the rest of the drag arrives here even once the finger
   * has left the strip, which it does immediately: the whole gesture is a move away
   * from where it started.
   */
  startDrag(event: PointerEvent): void {
    if (!this.dismissible() || this.closing()) {
      return;
    }

    const strip = event.currentTarget;
    if (strip instanceof Element) {
      strip.setPointerCapture(event.pointerId);
    }

    this._dragFrom = event.clientY;
    this._dragTrail = [{ offset: 0, at: event.timeStamp }];
    this.settling.set(false);
    this.dragging.set(true);
    this.dragOffset.set(0);
  }

  /**
   * The panel follows the finger, downward only.
   *
   * Upward is not a gesture a bottom sheet has: it is already against the bottom of
   * the screen, there is nothing above it to reveal, and following the finger up would
   * open a strip of scrim beneath the panel where the sheet's own padding should be.
   * `max` rather than an early return, so a finger that overshoots upward and comes
   * back down is still dragging the same sheet.
   */
  onDrag(event: PointerEvent): void {
    if (!this.dragging()) {
      return;
    }

    const offset = Math.max(0, event.clientY - this._dragFrom);

    this._dragTrail.push({ offset, at: event.timeStamp });
    // Drop everything older than the window, but never the sample the window is
    // measured from: a flick can be three events long, and an empty trail has no speed.
    while (
      this._dragTrail.length > 2 &&
      event.timeStamp - this._dragTrail[1].at > SPEED_WINDOW
    ) {
      this._dragTrail.shift();
    }

    this.dragOffset.set(offset);
  }

  /**
   * The finger comes off, and the sheet either goes or comes back.
   *
   * Two ways to mean it, because they are two different gestures. A deliberate pull
   * past a quarter of the panel is one, and a flick is the other: on a phone the fast
   * gesture barely moves, so distance alone would ignore the most natural way anybody
   * throws a sheet away. Either one continues into the same fall the scrim plays, from
   * wherever the panel currently is, so letting go never looks like a separate event
   * from the drag.
   *
   * Anything short of both springs back. `pointercancel` arrives here too, which is
   * what the browser sends when it takes the gesture over, and a cancelled drag is a
   * drag that did not happen.
   */
  endDrag(event: PointerEvent): void {
    if (!this.dragging()) {
      return;
    }

    this.dragging.set(false);

    const offset = this.dragOffset() ?? 0;
    const dismissed =
      event.type !== 'pointercancel' &&
      (offset >= this._dismissDistance() || this._dragSpeed() >= FLICK_SPEED);

    if (dismissed) {
      // The offset stays put. A CSS animation outranks an inline declaration, so the
      // fall's implicit first frame is wherever the finger left the panel and the two
      // read as one movement rather than as a jump back up and a drop.
      this.requestDismiss();
      return;
    }

    this.settling.set(true);
    this.dragOffset.set(0);

    const view = this._host.nativeElement.ownerDocument.defaultView;
    view?.setTimeout(() => {
      this.settling.set(false);
      this.dragOffset.set(null);
    }, this._motionDuration(MOTION_FAST));
  }

  /**
   * How fast the panel was moving downward when the finger came off, in px per ms.
   *
   * Measured across the trail rather than between the last two events, so a real flick
   * is not missed because its final sample happened to be short, and a drag that was
   * parked for half a second before release does not inherit the speed it had on the
   * way there. Zero when there is nothing to measure across.
   */
  private _dragSpeed(): number {
    const first = this._dragTrail[0];
    const last = this._dragTrail[this._dragTrail.length - 1];
    if (first === undefined || last === undefined) {
      return 0;
    }

    const elapsed = last.at - first.at;

    return elapsed > 0 ? (last.offset - first.offset) / elapsed : 0;
  }

  /**
   * How far down counts as meaning it: a quarter of the panel, and never less than
   * {@link MIN_DISMISS_DISTANCE}.
   *
   * A fraction on its own is wrong at both ends. The confirm sheets are short enough
   * that a quarter of them is an accident, and the comments sheet is tall enough that a
   * quarter is most of a screen. The floor fixes the first; the flick fixes the second.
   */
  private _dismissDistance(): number {
    const panel = this._host.nativeElement.querySelector('.panel');
    const height = panel?.getBoundingClientRect().height ?? 0;

    return Math.max(MIN_DISMISS_DISTANCE, height * DISMISS_FRACTION);
  }

  /**
   * Play the fall, and resolve when the panel has landed.
   *
   * The exit animation offered as something an outsider can await, rather than only as
   * a side effect of `requestDismiss`, so the exits that do **not** start in here can
   * have one too. `sheetFallGuard` calls it on the way out of the sheet's route, which
   * is what gives the back button and the back gesture the same animation Cancel has
   * always had, and what stops a successful submit blinking the panel out of existence.
   *
   * Resolves at once when there is nothing to play: motion is off (`--app-motion-base`
   * is `0ms` under `prefers-reduced-motion`, and unreadable in jsdom, so a spec never
   * waits on a timer), or the panel is already down.
   */
  fall(): Promise<void> {
    return new Promise<void>((resolve) => this._afterFall(resolve));
  }

  /**
   * Run something once the panel is down, starting the fall if it is not falling yet.
   *
   * The one place that decides whether there is an animation at all, so `dismiss` and
   * `fall` cannot disagree about it. Runs its callback immediately when there is
   * nothing to wait for, which is what keeps a zero duration exit synchronous.
   */
  private _afterFall(then: () => void): void {
    if (this._landed) {
      then();
      return;
    }

    if (this._fallStarted) {
      this._onLanded.push(then);
      return;
    }

    const duration = this._motionDuration();
    const view = this._host.nativeElement.ownerDocument.defaultView;
    if (duration === 0 || view === null) {
      then();
      return;
    }

    this._fallStarted = true;
    this.closing.set(true);
    this._onLanded.push(then);

    view.setTimeout(() => {
      this._landed = true;
      for (const waiting of this._onLanded.splice(0)) {
        waiting();
      }
    }, duration);
  }

  /**
   * A motion token in ms, or 0 when there is no stylesheet to read it from.
   *
   * Reading the token rather than holding a number here buys two things. Under
   * `prefers-reduced-motion` every one of them is already `0ms`, so the sheet closes
   * at once with no second code path to keep in step. And in jsdom no stylesheet is
   * loaded, so the property resolves to an empty string, the parse fails, the duration
   * is zero and `dismiss` is emitted synchronously: a spec never has to know about the
   * timer.
   *
   * Takes the token's name because the snap back is not the fall: springing a panel
   * that did not go anywhere back into place is a correction, and a correction that
   * takes as long as a dismissal reads as hesitation.
   */
  private _motionDuration(token = MOTION_BASE): number {
    const view = this._host.nativeElement.ownerDocument.defaultView;
    if (view === null) {
      return 0;
    }

    const raw = view
      .getComputedStyle(this._host.nativeElement)
      .getPropertyValue(token);
    const ms = Number.parseFloat(raw);

    return Number.isFinite(ms) ? ms : 0;
  }

  /**
   * Keeps Tab inside the sheet.
   *
   * Without this the next Tab lands on the front door behind the scrim, which is
   * visible, focusable and covered: the person is then typing into a page they cannot
   * see. `aria-modal` tells a screen reader the same thing, but it does nothing for a
   * keyboard, and the two have to agree.
   */
  wrapFocus(event: Event): void {
    if (!(event instanceof KeyboardEvent) || event.key !== 'Tab') {
      return;
    }

    const focusable = this._focusable();
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (first === undefined || last === undefined) {
      return;
    }

    const doc = this._host.nativeElement.ownerDocument;
    const active = doc.activeElement;

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
      return;
    }

    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /**
   * The focusable elements inside the panel, in document order.
   *
   * Queried per use rather than cached, because the set changes as the sheet does: the
   * cancel row disappears while a request is in flight, and a rejected code adds
   * nothing focusable but could. A stale list would trap focus on a removed element.
   */
  private _focusable(): HTMLElement[] {
    const panel = this._host.nativeElement.querySelector('.panel');
    if (panel === null) {
      return [];
    }

    return Array.from(
      panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );
  }
}
