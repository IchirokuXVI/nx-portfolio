import type { AnchoredPopoverSide } from './anchored-popover';

/** A band of the screen, in the viewport's pixels. */
export interface Band {
  readonly top: number;
  readonly bottom: number;
}

/**
 * How far from the edge of the visible area a control brought back into it stops,
 * so its question has room on that side (velista `0207`, target 11): `--app-space-5`.
 */
const ROOM = 16;

/**
 * What of a scroll container can be seen: its own box, inside the window. A head
 * block above it or a bar below it sits outside it, so neither is counted.
 */
export function visibleBand(area: Element, windowHeight: number): Band {
  const rect = area.getBoundingClientRect();
  return {
    top: Math.max(0, rect.top),
    bottom: Math.min(windowHeight, rect.bottom),
  };
}

/**
 * How far to scroll so the box is wholly inside the band, or 0 when it already
 * is. A box above it stops near the top, with room for the question under it; a
 * box below it stops near the bottom, with room above it.
 */
export function scrollToShow(band: Band, box: Band): number {
  if (box.top >= band.top && box.bottom <= band.bottom) {
    return 0;
  }
  return box.top < band.top
    ? box.top - (band.top + ROOM)
    : box.bottom - (band.bottom - ROOM);
}

/** Below a box in the upper half of the band, above one in the lower half. */
export function sideIn(band: Band, box: Band): AnchoredPopoverSide {
  const middle = (band.top + band.bottom) / 2;
  return (box.top + box.bottom) / 2 < middle ? 'below' : 'above';
}

/**
 * The nearest element around `element` that scrolls vertically, or the document's
 * scrolling element. velista's pages and sheets scroll inside a container of their
 * own, which is the one a question's scroll moves.
 */
export function scrollAreaOf(element: Element): Element {
  const view = element.ownerDocument.defaultView;
  for (
    let at: Element | null = element.parentElement;
    at !== null;
    at = at.parentElement
  ) {
    const overflow = view?.getComputedStyle(at).overflowY ?? '';
    if (
      (overflow === 'auto' || overflow === 'scroll') &&
      at.scrollHeight > at.clientHeight
    ) {
      return at;
    }
  }
  return (
    element.ownerDocument.scrollingElement ??
    element.ownerDocument.documentElement
  );
}

/** Not fields a person types in: a press, a choice or a file. */
const NOT_TYPED = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

/** Whether focus is in a field a person types in: the composer, any field. */
export function typingIn(element: Element | null): boolean {
  if (element === null) {
    return false;
  }
  if (element.tagName === 'INPUT') {
    return !NOT_TYPED.has((element as HTMLInputElement).type);
  }
  return element.matches(
    'textarea, [contenteditable]:not([contenteditable="false"])'
  );
}
