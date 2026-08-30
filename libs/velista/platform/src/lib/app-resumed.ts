import {
  DestroyRef,
  effect,
  inject,
  Injectable,
  signal,
  untracked,
  type Signal,
} from '@angular/core';
import { BrowserFacade } from './browser-facade';

/**
 * How close two resumes have to be before they count as one.
 *
 * A phone unlocking onto an installed app can raise `visibilitychange` and a
 * back/forward cache `pageshow` within the same frame, and the reactions to a resume
 * are a reconnect and a probe: doing either twice is waste, and doing the reconnect
 * twice tears down the socket the first one just opened.
 */
const COLLAPSE_MS = 1_000;

/**
 * The app coming back after being away (plan 0035, section 4).
 *
 * Nothing else in the app knows a resume is a thing that happens to it, which is the
 * cause underneath all three of that plan's bugs: the page is frozen in the background,
 * the socket dies, the retry timers stop, and the app comes back holding a screen that
 * will never change again. Something has to notice, and this is it.
 *
 * ## Two event sources, because one does not cover the case that matters
 *
 * - **`visibilitychange`** is the ordinary one: a tab switch, an app switch, a screen
 *   lock. It arrives here as {@link BrowserFacade.visible}, so the browser global is
 *   read in exactly one place, as rule D2 asks.
 * - **`pageshow` with `persisted === true`** is a different thing entirely: the whole
 *   document was evicted into the back/forward cache and put back, timers and all. On
 *   iOS Safari that is what happens to a backgrounded installed app far more often than
 *   a plain visibility change, and a page restored that way can come back with a dead
 *   socket having never fired `visibilitychange` at all.
 *
 * ## Why a counter rather than a boolean
 *
 * A resume is an **edge**, and an edge cannot be read out of a boolean: a consumer that
 * missed the transition has no way to tell "resumed a moment ago" from "has been here
 * all along". {@link resumes} counts them instead, so an effect that reads it runs once
 * per resume, and one that has never seen a resume reads zero. Consumers use that zero:
 * the count starting at zero rather than at one is what stops the app's first frame from
 * looking like a resume.
 *
 * It is root scoped because it reaches nothing the app supplies (see
 * `VELISTA_PLATFORM_PROVIDERS`), and it knows nothing about what a resume is *for*: the
 * reconnect lives in `data-access` beside the socket and the probe beside the recovery,
 * so `platform` gains no knowledge of either (section 4.3).
 */
@Injectable({ providedIn: 'root' })
export class AppResumed {
  private readonly _browser = inject(BrowserFacade);
  private readonly _destroyRef = inject(DestroyRef);

  private readonly _resumes = signal(0);

  /** How many times the app has come back. Zero until the first resume. */
  readonly resumes: Signal<number> = this._resumes.asReadonly();

  private _lastAt = 0;

  constructor() {
    // The false to true edge, and only that one. Going away is not an event anything
    // here reacts to, and `visible` starts true, so a first run never counts.
    let wasVisible = untracked(() => this._browser.visible());
    effect(() => {
      const visible = this._browser.visible();
      untracked(() => {
        const resumed = visible && !wasVisible;
        wasVisible = visible;
        if (resumed) {
          this._resume();
        }
      });
    });

    const win = this._browser.window;
    if (win === null) {
      return;
    }

    const onPageShow = (event: Event) => {
      // A plain `pageshow` also fires on an ordinary load, which is not a resume and
      // must not reconnect a socket that is in the middle of its first connect.
      if ((event as PageTransitionEvent).persisted === true) {
        this._resume();
      }
    };

    win.addEventListener('pageshow', onPageShow);
    this._destroyRef.onDestroy(() =>
      win.removeEventListener('pageshow', onPageShow)
    );
  }

  private _resume(): void {
    const now = Date.now();
    if (this._lastAt !== 0 && now - this._lastAt < COLLAPSE_MS) {
      return;
    }

    this._lastAt = now;
    this._resumes.update((count) => count + 1);
  }
}
