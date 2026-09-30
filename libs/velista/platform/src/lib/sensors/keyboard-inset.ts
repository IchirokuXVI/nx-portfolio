/** Where the on screen keyboard leaves room, in css pixels. */
export interface KeyboardInset {
  /** How far the visual viewport's bottom sits above the layout viewport's. */
  readonly bottom: number;
  /** The visual viewport's height: what the keyboard leaves. */
  readonly height: number;
}

/**
 * Follows the room the on screen keyboard leaves, through `visualViewport`
 * (velista `0126`, target 3; the walk lab's approach in velista `0127`).
 *
 * Inside WebXR's DOM overlay nothing scrolls, so a button drawn in the flow sits
 * under the keyboard and out of reach. A bar placed at `bottom` from the foot of
 * the layout viewport sits directly above the keyboard instead. Chrome for Android
 * reports the keyboard through `visualViewport` in the overlay too. Without
 * `visualViewport` the callback is told once that nothing covers the page.
 *
 * Answers the function that stops following.
 */
export function watchKeyboardInset(
  win: Window | null,
  changed: (inset: KeyboardInset) => void
): () => void {
  const viewport = win?.visualViewport ?? null;
  if (!win || !viewport) {
    changed({ bottom: 0, height: win?.innerHeight ?? 0 });
    return () => undefined;
  }
  const update = () => {
    const below = win.innerHeight - (viewport.offsetTop + viewport.height);
    changed({
      bottom: Math.max(0, Math.round(below)),
      height: Math.floor(viewport.height),
    });
  };
  viewport.addEventListener('resize', update);
  viewport.addEventListener('scroll', update);
  update();
  return () => {
    viewport.removeEventListener('resize', update);
    viewport.removeEventListener('scroll', update);
  };
}
