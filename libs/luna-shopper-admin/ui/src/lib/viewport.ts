import { Injectable, signal, type OnDestroy } from '@angular/core';

/**
 * Where the table stops fitting.
 *
 * `48rem` is the width at which a five column table with readable text starts
 * wrapping cells, which is the point at which a table is worse than cards
 * rather than merely tighter.
 */
export const COMPACT_QUERY = '(max-width: 47.99rem)';

/**
 * Whether the window is narrow, as a signal.
 *
 * The list draws a table or cards from this rather than from a CSS media query,
 * and that is a testing decision as much as a rendering one. A media query is
 * invisible to jsdom, where `matchMedia` reports every query as unmatched, so a
 * CSS only switch would leave the one piece of per entity judgement in the
 * descriptor, `compact`, asserted by nothing.
 *
 * Answering `false` when there is no `matchMedia` is the right way to be wrong:
 * a table on a narrow screen is cramped, and cards on a wide one throw away the
 * comparison a table exists for.
 */
@Injectable({ providedIn: 'root' })
export class Viewport implements OnDestroy {
  private readonly _compact = signal(false);
  private readonly _query: MediaQueryList | null;

  readonly compact = this._compact.asReadonly();

  constructor() {
    this._query =
      typeof window === 'undefined' || typeof window.matchMedia !== 'function'
        ? null
        : window.matchMedia(COMPACT_QUERY);

    if (this._query !== null) {
      this._compact.set(this._query.matches);
      this._query.addEventListener('change', this._onChange);
    }
  }

  ngOnDestroy(): void {
    this._query?.removeEventListener('change', this._onChange);
  }

  private readonly _onChange = (event: MediaQueryListEvent): void => {
    this._compact.set(event.matches);
  };
}
