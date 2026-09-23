import {
  afterEveryRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
} from '@angular/core';

/** Where the card sits beside the lit control. */
export type TourSpotlightPlacement = 'above' | 'below';

/** The part of a rectangle this component reads. */
interface Box {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

/** How far the ring stands off the control, in CSS pixels. `--app-space-2`. */
const RING_GAP = 4;

/** How far the card stands off the ring. `--app-space-3`. */
const CARD_GAP = 8;

/**
 * The dimming, the ring round the lit control, and the place the card goes (velista
 * `0099`, section 4).
 *
 * ## Nothing behind it responds
 *
 * A transparent layer covers the whole screen and takes every press, including one on
 * the lit control: a tour that half works is worse than none, and a person who taps
 * the dimmed app and gets half a navigation is lost in a way the tour cannot recover
 * from. `AppLayout` makes the app `inert` besides, which is the keyboard's half.
 *
 * ## The control is lit by what is not dimmed
 *
 * The ring is a box over the control whose shadow is the scrim, spread past every edge
 * of the screen, so the control shows through at full brightness and nothing is drawn
 * over it. With no control to light (between stops, while the app moves) the whole
 * screen is dimmed and no card is drawn.
 *
 * The positions are measured, so they are inline styles in pixels; everything else is
 * a token. Rule D1 holds: the element comes in as an input and nothing is injected.
 */
@Component({
  selector: 'lib-tour-spotlight',
  templateUrl: './tour-spotlight.html',
  styleUrl: './tour-spotlight.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(window:resize)': 'measure()',
    '(window:scroll)': 'measure()',
  },
})
export class TourSpotlight {
  /** The control being lit, or null for a screen dimmed all over. */
  readonly target = input<HTMLElement | null>(null);

  /** Above when the control is at the bottom, below when it is at the top. */
  readonly placement = input<TourSpotlightPlacement>('below');

  /** Bumped when the control may have moved, which re-reads it. */
  private readonly _tick = signal(0);

  /**
   * Where the control is, read during the render that draws the ring.
   *
   * A read and not a stored copy, so the first render already has the ring and the
   * card in place. A card placed one render late takes the focus while it is still
   * nowhere, and keeps it there.
   */
  private readonly _box = computed<Box | null>(() => {
    this._tick();
    const target = this.target();
    return target === null ? null : boxOf(target);
  });

  private readonly _viewport = computed(() => {
    this._tick();
    return this.target()?.ownerDocument.documentElement.clientHeight ?? 0;
  });

  /** The ring, or null for none. */
  protected readonly ring = computed(() => {
    const box = this._box();
    return box === null || this.target() === null
      ? null
      : {
          top: box.top - RING_GAP,
          left: box.left - RING_GAP,
          width: box.width + RING_GAP * 2,
          height: box.height + RING_GAP * 2,
        };
  });

  /** Where the card goes: its top edge below the ring, or its bottom edge above it. */
  protected readonly slot = computed(() => {
    const ring = this.ring();
    if (ring === null) {
      return null;
    }

    return this.placement() === 'below'
      ? { top: ring.top + ring.height + CARD_GAP, bottom: null }
      : { top: null, bottom: this._viewport() - ring.top + CARD_GAP };
  });

  constructor() {
    // After every render, because the control can move without this component knowing:
    // a section that loads above it, a banner that goes away. A render that finds it
    // where it was changes nothing, so this settles rather than loops.
    afterEveryRender({ read: () => this.measure() });
  }

  /** Read the control again if it is no longer where the ring says. */
  protected measure(): void {
    const target = this.target();
    const drawn = this._box();
    if (target === null || drawn === null) {
      return;
    }

    const now = boxOf(target);
    if (
      now.top !== drawn.top ||
      now.left !== drawn.left ||
      now.width !== drawn.width ||
      now.height !== drawn.height ||
      target.ownerDocument.documentElement.clientHeight !== this._viewport()
    ) {
      this._tick.update((tick) => tick + 1);
    }
  }
}

/**
 * The box round an element and its children.
 *
 * The children as well, because an anchor may be a component host that is inline by
 * default: its own rectangle is then the line it sits on rather than the panel it
 * draws, and lighting that would ring a sliver above the thing being explained.
 */
function boxOf(element: HTMLElement): Box {
  const rects = [element, ...Array.from(element.children)]
    .map((each) => each.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0);

  if (rects.length === 0) {
    const rect = element.getBoundingClientRect();
    return { top: rect.top, left: rect.left, width: 0, height: 0 };
  }

  const top = Math.min(...rects.map((rect) => rect.top));
  const left = Math.min(...rects.map((rect) => rect.left));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  const right = Math.max(...rects.map((rect) => rect.right));
  return { top, left, width: right - left, height: bottom - top };
}
