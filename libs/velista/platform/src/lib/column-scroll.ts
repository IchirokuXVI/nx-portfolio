/**
 * How long a returning page keeps trying to reach its old scroll, from the first
 * render that had its content.
 *
 * The rows land before everything inside them does: names, prices and folds can add
 * height for a moment after, and a column too short for the old position clamps it.
 * Long enough for those, short enough that nobody is reading by the time it gives up.
 */
export const COLUMN_SCROLL_RETURN_MS = 1500;

/** What somebody does to scroll by hand, which ends a restore still trying. */
const HAND_SCROLLS = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;

/**
 * A page's scrolling column, read as it moves and put back on a return
 * (`PageReturn`).
 *
 * Read from the `scroll` event, passively, and never at teardown: by the time a page
 * is destroyed its element may already be out of the document, where the offset
 * reads zero. A listener and not a template binding, because a template event marks
 * the view for change detection on every frame of a scroll.
 */
export class ColumnScroll {
  private _column: HTMLElement | null = null;
  private _top = 0;
  private _target: number | null;
  private _deadline: number | null = null;
  private _frame: number | null = null;

  private readonly _onScroll = (): void => {
    this._top = this._column?.scrollTop ?? this._top;
  };

  private readonly _onHand = (): void => {
    this._target = null;
  };

  /** `target` is the offset to return to, or null for a fresh visit. */
  constructor(target: number | null) {
    this._target = target;
  }

  /**
   * How far down the column is, for the page's snapshot. An offset still being put
   * back counts as reached, so a page left mid restore keeps the place it was given.
   */
  get top(): number {
    return this._target ?? this._top;
  }

  /** Whether an old offset is still being put back, which other scrolls give way to. */
  get returning(): boolean {
    return this._target !== null;
  }

  /**
   * Watch this column, or none. Called from an `afterRenderEffect`, so it follows the
   * element when a page draws a different one.
   */
  attach(column: HTMLElement | null): void {
    if (column === this._column) {
      return;
    }
    this.detach();
    this._column = column;
    if (column === null) {
      return;
    }
    column.addEventListener('scroll', this._onScroll, { passive: true });
    for (const kind of HAND_SCROLLS) {
      column.addEventListener(kind, this._onHand, { passive: true });
    }
  }

  /**
   * Put the old offset back, once the page has drawn what it scrolls over. Called from
   * an `afterRenderEffect`; the first call with `ready` starts trying, once a frame,
   * until the column reaches the offset, somebody scrolls by hand, or
   * {@link COLUMN_SCROLL_RETURN_MS} passes. Frames rather than renders, because what
   * still grows the column (a name, a price) is not something the page's effect reads.
   */
  settle(ready: boolean): void {
    if (
      this._column === null ||
      this._target === null ||
      !ready ||
      this._deadline !== null
    ) {
      return;
    }
    this._deadline = Date.now() + COLUMN_SCROLL_RETURN_MS;
    this._step();
  }

  private readonly _step = (): void => {
    this._frame = null;
    const column = this._column;
    const target = this._target;
    if (column === null || target === null || this._deadline === null) {
      return;
    }

    column.scrollTop = target;
    this._top = column.scrollTop;

    if (
      Math.abs(column.scrollTop - target) <= 1 ||
      Date.now() >= this._deadline ||
      typeof requestAnimationFrame !== 'function'
    ) {
      this._target = null;
      return;
    }
    this._frame = requestAnimationFrame(this._step);
  };

  /** Stop watching, from the page's teardown. */
  detach(): void {
    if (this._frame !== null) {
      cancelAnimationFrame(this._frame);
      this._frame = null;
    }
    const column = this._column;
    if (column === null) {
      return;
    }
    column.removeEventListener('scroll', this._onScroll);
    for (const kind of HAND_SCROLLS) {
      column.removeEventListener(kind, this._onHand);
    }
    this._column = null;
  }
}
