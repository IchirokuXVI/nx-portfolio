import { inject, Injectable } from '@angular/core';
import { AppHistory } from './app-history';

/**
 * What a page was showing when somebody left it, handed back when they come back.
 *
 * The zone list page and the basket page are long, searched and filtered, and a row
 * on either leads to another page: the line page, the product picker. Coming back
 * from there to a list scrolled to the top, with the search gone, loses the place
 * somebody was standing in. So each of those pages keeps what it showed here as it
 * goes, and asks for it again as it is drawn.
 *
 * ## Only on a return
 *
 * A snapshot is handed back only when the arrival is a history pop: the back button,
 * a back chevron, or forward again. Anything else is a fresh visit, which starts
 * unsearched and at the top, as both pages always have (velista `0076`, section 4.7).
 * Asking forgets the snapshot either way, so a page reached twice by a link and once
 * by back is restored at most once.
 *
 * ## Only for this session
 *
 * Kept in memory and never stored. A reload is a new visit, and so is a second tab.
 *
 * The key is the page's to choose, and it names the thing on screen (`list:<id>`),
 * so another list on the same page component never inherits this one's place.
 */
@Injectable({ providedIn: 'root' })
export class PageReturn {
  private readonly _history = inject(AppHistory);

  private readonly _kept = new Map<string, unknown>();

  /** What the page under `key` is showing now, replacing what it showed before. */
  keep<T>(key: string, snapshot: T): void {
    this._kept.set(key, snapshot);
  }

  /**
   * What the page under `key` showed when it was left, when this arrival is a
   * return to it, or null. Called from the page's constructor, while its arrival is
   * still the navigation in flight.
   */
  recall<T>(key: string): T | null {
    const kept = this._kept.get(key);
    this._kept.delete(key);

    return kept === undefined || !this._history.arrivingByPop()
      ? null
      : (kept as T);
  }
}
