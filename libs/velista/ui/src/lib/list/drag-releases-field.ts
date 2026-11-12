import {
  afterNextRender,
  DestroyRef,
  Directive,
  ElementRef,
  inject,
  output,
} from '@angular/core';

/**
 * How far a touch or a pen has to travel from where it went down, in CSS px, before
 * it counts as a drag (velista `0189`, section 4). A gesture counts when it goes
 * **further** than this. A TypeScript constant and not a style, because it is a
 * distance a gesture is measured against and nothing is drawn with it.
 */
export const DRAG_RELEASE_PX = 8;

/** The gesture being measured: where it started, and whether it has spoken yet. */
interface Gesture {
  /** The pointer that started it, or null for one a touch event started. */
  readonly pointerId: number | null;
  readonly x: number;
  readonly y: number;
  emitted: boolean;
}

/**
 * Says that a touch or a pen dragged the host, once per gesture (velista `0189`,
 * section 4).
 *
 * It knows nothing about a field. The list pages put it on their scrolling column and
 * take the focus off their search field when it speaks, so a phone puts its keyboard
 * away on the first drag of the results while the words and the results stay.
 *
 * ## Why it listens to two families of events
 *
 * The browser cancels a touch pointer the moment it takes the touch for a scroll, and
 * from then on only the touch events keep coming. So `pointercancel` does not end a
 * gesture, and `touchmove` finishes the count. The pointer events are there for a pen,
 * which a touch event does not report, and to tell a mouse apart, which never counts.
 *
 * ## Why it never stands in the way
 *
 * Every listener is passive, and none calls `preventDefault`, `stopPropagation` or
 * takes pointer capture: the column's own scroll must run as if nothing listened. It
 * reacts to no `scroll` and no `wheel` event, because the page scrolls by itself when
 * the keyboard opens and when it brings a row into view, and a mouse or a hardware
 * keyboard is never affected.
 *
 * A gesture that starts in a popover is not one of the host's, even when the popover
 * is drawn inside the host and its events bubble through it.
 */
@Directive({
  selector: '[libDragReleasesField]',
})
export class DragReleasesField {
  /** A touch or a pen moved more than {@link DRAG_RELEASE_PX} from where it went down. */
  readonly dragged = output<void>();

  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);

  private _gesture: Gesture | null = null;

  constructor() {
    const destroyRef = inject(DestroyRef);

    afterNextRender(() => {
      const host = this._host.nativeElement;
      const listeners: readonly [string, (event: Event) => void][] = [
        ['pointerdown', (event) => this._onPointerDown(event as PointerEvent)],
        ['pointermove', (event) => this._onPointerMove(event as PointerEvent)],
        ['pointerup', (event) => this._onPointerUp(event as PointerEvent)],
        ['touchstart', (event) => this._onTouchStart(event as TouchEvent)],
        ['touchmove', (event) => this._onTouchMove(event as TouchEvent)],
        ['touchend', () => this._clear()],
        ['touchcancel', () => this._clear()],
      ];

      for (const [type, listener] of listeners) {
        host.addEventListener(type, listener, { passive: true });
      }

      destroyRef.onDestroy(() => {
        for (const [type, listener] of listeners) {
          host.removeEventListener(type, listener);
        }
      });
    });
  }

  private _onPointerDown(event: PointerEvent): void {
    if (
      (event.pointerType === 'touch' || event.pointerType === 'pen') &&
      event.isPrimary &&
      !startsOutside(event.target)
    ) {
      this._start(event.pointerId, event.clientX, event.clientY);
      return;
    }

    // A mouse, a second finger, or a press in a popover.
    this._clear();
  }

  private _onPointerMove(event: PointerEvent): void {
    if (this._gesture?.pointerId === event.pointerId) {
      this._measure(event.clientX, event.clientY);
    }
  }

  private _onPointerUp(event: PointerEvent): void {
    if (this._gesture?.pointerId === event.pointerId) {
      this._clear();
    }
  }

  private _onTouchStart(event: TouchEvent): void {
    if (event.touches.length > 1) {
      // A second finger is a pinch, not a drag.
      this._clear();
      return;
    }

    const touch = event.touches[0];
    if (
      this._gesture === null &&
      touch !== undefined &&
      !startsOutside(event.target)
    ) {
      this._start(null, touch.clientX, touch.clientY);
    }
  }

  private _onTouchMove(event: TouchEvent): void {
    const touch = event.touches[0];
    if (touch !== undefined) {
      this._measure(touch.clientX, touch.clientY);
    }
  }

  private _start(pointerId: number | null, x: number, y: number): void {
    this._gesture = { pointerId, x, y, emitted: false };
  }

  private _measure(x: number, y: number): void {
    const gesture = this._gesture;
    if (gesture === null || gesture.emitted) {
      return;
    }

    if (Math.hypot(x - gesture.x, y - gesture.y) > DRAG_RELEASE_PX) {
      gesture.emitted = true;
      this.dragged.emit();
    }
  }

  private _clear(): void {
    this._gesture = null;
  }
}

/** Whether a gesture began in a popover drawn inside the host. */
function startsOutside(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('.cdk-overlay-pane, [popover]') !== null
  );
}
