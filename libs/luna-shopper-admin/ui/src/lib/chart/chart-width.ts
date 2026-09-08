import {
  DestroyRef,
  ElementRef,
  inject,
  signal,
  type Signal,
} from '@angular/core';

/**
 * What a chart is drawn at when nothing has measured it (plan 0015, section 4).
 *
 * A `viewBox` that stretches would avoid the measurement entirely and would also
 * distort every letter in the chart, so the width is a real number of pixels and
 * something has to supply it before the first frame. 640 is a desktop card, wide
 * enough that a thirty day axis is legible in a spec's serialized output.
 */
export const DEFAULT_CHART_WIDTH = 640;

/**
 * The host element's width, as a signal, from a `ResizeObserver`.
 *
 * Called from a field initializer, so it runs in an injection context and takes
 * its host and its teardown from there. Everything derived from it is a
 * `computed`, which is why there is no lifecycle hook here that recalculates and
 * no subscription to unsubscribe from: the observer writes one signal and the
 * scales fall out of it.
 *
 * jsdom has no `ResizeObserver`, and a spec that renders a chart must get a drawn
 * chart rather than an exception, so the absence is guarded exactly the way
 * `Viewport` guards `matchMedia`. A chart drawn at the default width in a spec is
 * the right way to be wrong: every tick, path and label is computed from a real
 * number, so the geometry a spec reads is the geometry a browser would draw at
 * that width.
 */
export function hostWidth(): Signal<number> {
  const host = inject(ElementRef<HTMLElement>);
  const destroyRef = inject(DestroyRef);
  const width = signal(DEFAULT_CHART_WIDTH);

  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width ?? 0;
      // A host that is laid out at zero (a collapsed section, a tab that is not
      // showing) would otherwise divide the whole chart by nothing. Keeping the
      // last usable width means the chart is already correct when it is shown
      // again.
      if (measured > 0) {
        width.set(measured);
      }
    });

    observer.observe(host.nativeElement);
    destroyRef.onDestroy(() => observer.disconnect());
  }

  return width.asReadonly();
}
