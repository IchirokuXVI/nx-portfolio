import {
  afterEveryRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  signal,
  viewChild,
  type ElementRef,
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

/** How close the card may come to the top or bottom edge of the screen. `--app-space-3`. */
const SCREEN_EDGE = 8;

/** Where the card goes: its top edge, or its bottom edge, from the screen's. */
export type TourSlot =
  | { readonly top: number; readonly bottom: null }
  | { readonly top: null; readonly bottom: number };

/**
 * The heights the spotlight works in, in CSS pixels.
 *
 * `visible` is what the person can see. `frame` is the box a fixed element is placed
 * in, which is what a `bottom` offset counts from. They are one number on a desktop and
 * in a phone's browser tab. They can part in an installed app on Android, where the
 * dynamic viewport grows under the system navigation bar while the visible screen does
 * not (see `AppLayout`), and a card placed by `bottom` against the wrong one of them
 * lands that strip lower than the ring it points at.
 */
export interface TourScreen {
  readonly visible: number;
  readonly frame: number;
}

/**
 * Where a card of `cardHeight` goes beside `ring` on `screen`.
 *
 * The preferred side first. **Then the other side**, because a card cut off at the
 * screen's edge hides its own buttons: the groups section on a new account is most of
 * the screen tall, and a card placed below it ended under the bottom edge. With room
 * on neither side the card is kept on screen over part of the control, which still
 * shows round it. A height of zero (not measured yet) fits anywhere.
 *
 * The card is never taller than the screen less both edges: past that it scrolls
 * inside itself (velista `0112`), so the last case always fits.
 */
export function placeCard(
  ring: Box,
  preferred: TourSpotlightPlacement,
  cardHeight: number,
  screen: number | TourScreen
): TourSlot {
  const { visible, frame } =
    typeof screen === 'number' ? { visible: screen, frame: screen } : screen;
  const below = ring.top + ring.height + CARD_GAP;
  const fitsBelow = below + cardHeight <= visible - SCREEN_EDGE;
  const fitsAbove = ring.top - CARD_GAP - cardHeight >= SCREEN_EDGE;
  const asBelow: TourSlot = { top: below, bottom: null };
  const asAbove: TourSlot = {
    top: null,
    bottom: frame - ring.top + CARD_GAP,
  };

  if (preferred === 'below' && fitsBelow) {
    return asBelow;
  }
  if (preferred === 'above' && fitsAbove) {
    return asAbove;
  }
  if (fitsBelow) {
    return asBelow;
  }
  if (fitsAbove) {
    return asAbove;
  }

  return { top: null, bottom: frame - visible + SCREEN_EDGE };
}

/**
 * The ring round `box`, kept inside a screen `width` wide and `visible` tall
 * (velista `0112`).
 *
 * The ring stands off its control on every side, so round a control that reaches the
 * screen's edges it went past them. The first stop lights the bar, which spans the
 * screen and ends at its foot, and its ring lost its bottom edge and both lower
 * corners under the edge of the screen. Clamped, the ring meets the edge instead.
 */
export function ringOnScreen(box: Box, width: number, visible: number): Box {
  const top = Math.max(box.top - RING_GAP, 0);
  const left = Math.max(box.left - RING_GAP, 0);
  const right = Math.min(box.left + box.width + RING_GAP, width);
  const bottom = Math.min(box.top + box.height + RING_GAP, visible);
  return {
    top,
    left,
    width: Math.max(right - left, 0),
    height: Math.max(bottom - top, 0),
  };
}

/** How tall the card may be on a screen `visible` tall before it scrolls inside itself. */
export function cardMaxHeight(visible: number): number {
  return Math.max(visible - SCREEN_EDGE * 2, 0);
}

/** A screen, and how wide it is. */
type Screen = TourScreen & { readonly width: number };

const NO_SCREEN: Screen = { visible: 0, frame: 0, width: 0 };

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
  },
})
export class TourSpotlight {
  /** The control being lit, or null for a screen dimmed all over. */
  readonly target = input<HTMLElement | null>(null);

  /** Above when the control is at the bottom, below when it is at the top. */
  readonly placement = input<TourSpotlightPlacement>('below');

  private readonly _slot = viewChild<ElementRef<HTMLElement>>('cardSlot');

  /** The layer that takes every press: fixed to the screen, so it is the frame. */
  private readonly _layer = viewChild<ElementRef<HTMLElement>>('layer');

  /** How tall the card is, measured after it is drawn. Zero until then. */
  private readonly _cardHeight = signal(0);

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

  private readonly _screen = computed<Screen>(() => {
    this._tick();
    const target = this.target();
    return target === null
      ? NO_SCREEN
      : screenOf(target, this._layer()?.nativeElement);
  });

  /** The ring, or null for none. */
  protected readonly ring = computed(() => {
    const box = this._box();
    const screen = this._screen();
    return box === null
      ? null
      : ringOnScreen(box, screen.width, screen.visible);
  });

  /** Where the card goes. See {@link placeCard}. */
  protected readonly slot = computed<TourSlot | null>(() => {
    const ring = this.ring();
    return ring === null
      ? null
      : placeCard(ring, this.placement(), this._cardHeight(), this._screen());
  });

  /** How tall the card may be before it scrolls inside itself, as a CSS length. */
  protected readonly cardMax = computed(
    () => `${cardMaxHeight(this._screen().visible)}px`
  );

  /**
   * Measure again whenever anything scrolls, heard in the capture phase (velista
   * `0112`).
   *
   * Since `0106` the document never scrolls: the page slot does, or a page's own
   * column. A scroll event does not bubble, so a listener on the window heard none of
   * them, and a lit control carried along by its page left the ring where it had been.
   * In the capture phase the document hears the scroll of every box inside it. The
   * visual viewport is heard as well, because on a phone it changes height without the
   * window resizing.
   */
  private readonly _scrollWatch = effect((onCleanup) => {
    const target = this.target();
    if (target === null) {
      return;
    }
    const document = target.ownerDocument;
    const visual = document.defaultView?.visualViewport ?? null;
    const listener = (): void => this.measure();
    document.addEventListener('scroll', listener, {
      capture: true,
      passive: true,
    });
    visual?.addEventListener('resize', listener);
    onCleanup(() => {
      document.removeEventListener('scroll', listener, { capture: true });
      visual?.removeEventListener('resize', listener);
    });
  });

  constructor() {
    // After every render, because the control can move without this component knowing:
    // a section that loads above it, a banner that goes away. A render that finds it
    // where it was changes nothing, so this settles rather than loops.
    afterEveryRender({ read: () => this.measure() });
  }

  /** Read the control again if it is no longer where the ring says. */
  protected measure(): void {
    const height = Math.round(
      this._slot()?.nativeElement.getBoundingClientRect().height ?? 0
    );
    if (height !== this._cardHeight()) {
      this._cardHeight.set(height);
    }

    const target = this.target();
    const drawn = this._box();
    if (target === null || drawn === null) {
      return;
    }

    const now = boxOf(target);
    const screen = screenOf(target, this._layer()?.nativeElement);
    const held = this._screen();
    if (
      now.top !== drawn.top ||
      now.left !== drawn.left ||
      now.width !== drawn.width ||
      now.height !== drawn.height ||
      screen.visible !== held.visible ||
      screen.frame !== held.frame ||
      screen.width !== held.width
    ) {
      this._tick.update((tick) => tick + 1);
    }
  }
}

/**
 * The screen the tour is drawn on, read from the document `target` is in.
 *
 * The visible height is the least of what the document, the window and the visual
 * viewport report, because each of them can be the one that counts a strip the person
 * cannot see. The frame is the height of the fixed layer itself, which is the box a
 * `bottom` offset counts from; before the layer is drawn it is the visible height.
 */
function screenOf(target: HTMLElement, layer: HTMLElement | undefined): Screen {
  const document = target.ownerDocument;
  const view = document.defaultView;
  const heights = [document.documentElement.clientHeight];
  if (view !== null && view.innerHeight > 0) {
    heights.push(view.innerHeight);
  }
  const visual = view?.visualViewport ?? null;
  if (visual !== null && visual.height > 0) {
    heights.push(Math.round(visual.offsetTop + visual.height));
  }
  const visible = Math.min(...heights.filter((each) => each > 0), Infinity);
  const frame = Math.round(layer?.getBoundingClientRect().height ?? 0);
  const safeVisible = Number.isFinite(visible) ? visible : 0;
  const width = document.documentElement.clientWidth;
  return {
    visible: safeVisible,
    frame: frame > 0 ? frame : safeVisible,
    width: width > 0 ? width : (view?.innerWidth ?? 0),
  };
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
