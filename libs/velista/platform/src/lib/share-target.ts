import { inject, Injectable, InjectionToken } from '@angular/core';
import { BrowserFacade } from './browser-facade';

/** What is handed to the system share sheet. Every field is optional, as in Web Share. */
export interface ShareTargetData {
  readonly title?: string;
  readonly text?: string;
  readonly url?: string;
}

/**
 * How a share went (velista `0166`, D5).
 *
 * `dismissed` is its own answer because the person closed the system sheet on purpose,
 * and showing them the copy fallback after that reads as the app ignoring them.
 * `unavailable` is the one a caller falls back on.
 */
export type ShareOutcome = 'shared' | 'dismissed' | 'unavailable';

/**
 * The operating system's share sheet, behind a seam a native shell can replace.
 *
 * The WebView has no Web Share, so without this every share inside the app would fall
 * back to copying (inventory 2.3).
 */
export interface ShareTargetI {
  /** Whether {@link share} can open anything. Read once by a screen deciding to draw. */
  canShare(): boolean;

  /**
   * Open the share sheet. **Call it first in a click handler**: the browser API needs
   * the gesture, and an `await` before it spends the gesture.
   */
  share(data: ShareTargetData): Promise<ShareOutcome>;
}

/**
 * Web Share, read through `BrowserFacade.window` (plan 0001 D2).
 *
 * `navigator.share` is called synchronously inside {@link share}, before the returned
 * promise exists, so the user activation of the calling click is still live.
 */
@Injectable({ providedIn: 'root' })
export class WebShareTarget implements ShareTargetI {
  private readonly _browser = inject(BrowserFacade);

  canShare(): boolean {
    return this._browser.window?.navigator.share !== undefined;
  }

  share(data: ShareTargetData): Promise<ShareOutcome> {
    const navigator = this._browser.window?.navigator;
    if (navigator?.share === undefined) {
      return Promise.resolve('unavailable');
    }

    let sharing: Promise<void>;
    try {
      sharing = navigator.share(data);
    } catch {
      return Promise.resolve('unavailable');
    }

    return sharing.then(
      () => 'shared' as const,
      // An `AbortError` is the person closing the sheet. Anything else is the browser
      // refusing, a spent gesture or a type it will not share, and the link still has
      // to reach somebody, so the caller's copy fallback is the right answer to it.
      (error: unknown) =>
        isAbort(error) ? ('dismissed' as const) : ('unavailable' as const)
    );
  }
}

function isAbort(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

/**
 * The share sheet this app hands links to. Web Share by default; a native shell
 * provides its own implementation in the application config.
 */
export const SHARE_TARGET = new InjectionToken<ShareTargetI>('SHARE_TARGET', {
  providedIn: 'root',
  factory: () => inject(WebShareTarget),
});
