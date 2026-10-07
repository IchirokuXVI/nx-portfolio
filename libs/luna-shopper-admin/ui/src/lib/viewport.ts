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
 * Where a list and the row that is open fit beside each other.
 *
 * Between `48rem` and this the frame has its rail and the content is still one
 * column, so one pane shows at a time, as on a phone.
 */
export const SPLIT_QUERY = '(min-width: 72rem)';

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
  private readonly _split = signal(false);
  private readonly _query: MediaQueryList | null;
  private readonly _splitQuery: MediaQueryList | null;

  readonly compact = this._compact.asReadonly();

  /**
   * Whether the content has room for two panes side by side (admin plan 0041,
   * the third layout state; admin plan 0042 is the first to split).
   *
   * A signal beside the media query the styles use, because what a pane draws
   * changes with it and not only where it sits: the page that is open beside
   * its list has no way back to draw, and its title is one level down.
   */
  readonly split = this._split.asReadonly();

  constructor() {
    const available =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function';

    this._query = available ? window.matchMedia(COMPACT_QUERY) : null;
    this._splitQuery = available ? window.matchMedia(SPLIT_QUERY) : null;

    if (this._query !== null) {
      this._compact.set(this._query.matches);
      this._query.addEventListener('change', this._onChange);
    }

    if (this._splitQuery !== null) {
      this._split.set(this._splitQuery.matches);
      this._splitQuery.addEventListener('change', this._onSplitChange);
    }
  }

  ngOnDestroy(): void {
    this._query?.removeEventListener('change', this._onChange);
    this._splitQuery?.removeEventListener('change', this._onSplitChange);
  }

  private readonly _onChange = (event: MediaQueryListEvent): void => {
    this._compact.set(event.matches);
  };

  private readonly _onSplitChange = (event: MediaQueryListEvent): void => {
    this._split.set(event.matches);
  };
}
