import { Injectable } from '@angular/core';

/** What the page under a line's sheet hears from it (velista `0192`). */
export interface LineSheetListener {
  /** A save from the sheet was accepted and took the line from above 0 to 0 or less. */
  lowered(lineId: string): void;
  /** The sheet went away, however it closed. */
  closed(lineId: string): void;
}

/**
 * The line sheet telling the list page under it what it did (velista `0192`, owner
 * ruling of 2026-11-16): a save that lowered the line to 0 is said on the page, and
 * focus that went back to the line's row when the sheet closed goes where it goes for
 * any row that left.
 *
 * Plain calls rather than a signal, because two saves in one turn are two events and
 * a signal would keep only the last. A sheet with no page listening, over the line
 * page for example, tells nobody.
 */
@Injectable({ providedIn: 'root' })
export class LineSheetEvents {
  private readonly _listeners = new Set<LineSheetListener>();

  /** Listen until the returned function is called. */
  listen(listener: LineSheetListener): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  lowered(lineId: string): void {
    for (const listener of [...this._listeners]) {
      listener.lowered(lineId);
    }
  }

  closed(lineId: string): void {
    for (const listener of [...this._listeners]) {
      listener.closed(lineId);
    }
  }
}
