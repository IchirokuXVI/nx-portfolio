import { inject, Injectable, signal } from '@angular/core';
import { BrowserFacade } from './browser-facade';

/**
 * Holds off an automatic page reload while the user has something worth losing.
 *
 * `0003` section 3.1 is explicit: when the connection returns the app reloads
 * itself, and that reload "must not fire while a dialog or an unsaved field is open,
 * or it discards what someone typed". Since the app has no offline queue in this
 * phase (plan 0001, D6), a reload at the wrong moment is unrecoverable data loss for
 * the user, not an inconvenience.
 *
 * Any component holding unsaved state registers here and releases on destroy. A
 * reload requested while at least one blocker is held is deferred, not cancelled: it
 * fires as soon as the last blocker is released.
 */
@Injectable({ providedIn: 'root' })
export class ReloadBlocker {
  private readonly _browser = inject(BrowserFacade);

  private readonly _blockers = signal<ReadonlySet<symbol>>(new Set());
  /**
   * The action waiting for the last blocker, if any. One slot and not a queue: every
   * action here replaces the document, so only the latest request can still matter,
   * except that a plain reload never replaces an action of {@link whenIdle}.
   */
  private _pending: (() => void) | null = null;
  /** True while {@link _pending} is the plain reload of {@link reloadWhenIdle}. */
  private _pendingIsReload = false;

  /** True while at least one component holds unsaved state. */
  readonly isBlocked = () => this._blockers().size > 0;

  /**
   * Register a blocker. The returned function releases it, and is safe to call more
   * than once, because a `DestroyRef` callback plus an explicit release in a submit
   * handler is a normal and correct thing for a component to do.
   */
  block(): () => void {
    const handle = Symbol('reload-blocker');
    this._blockers.update((current) => new Set(current).add(handle));

    return () => {
      let released = false;
      this._blockers.update((current) => {
        const next = new Set(current);
        released = next.delete(handle);
        return next;
      });

      if (released) {
        this._flushIfIdle();
      }
    };
  }

  /**
   * Reload the page, now if nothing is held and otherwise as soon as everything is
   * released.
   *
   * The quiet "Reload now" button in `0003` goes through here too, and bypasses
   * nothing: a user tapping it has not stopped caring about the form behind the
   * blocking screen.
   */
  reloadWhenIdle(): void {
    // A waiting action that is not a reload is kept: inside the native shell it is
    // the apply of a new bundle, and a reload in its place would load the running
    // bundle again (velista `0180`, D6). On the web nothing else waits here.
    if (this._pending !== null && !this._pendingIsReload) {
      this._flushIfIdle();
      return;
    }
    this._pending = () => this._browser.reload();
    this._pendingIsReload = true;
    this._flushIfIdle();
  }

  /**
   * Run `action` now if nothing is held, and otherwise as soon as everything is
   * released (velista `0180`, D6).
   *
   * For the ways of replacing the document that are not a plain reload. Inside the
   * native shell a reload loads the running bundle again, so a new bundle applies
   * through the updater instead, and it still must not land on a held form. A later
   * request here replaces one that is still waiting, and a later
   * {@link reloadWhenIdle} does not.
   */
  whenIdle(action: () => void): void {
    this._pending = action;
    this._pendingIsReload = false;
    this._flushIfIdle();
  }

  private _flushIfIdle(): void {
    const action = this._pending;
    if (action !== null && !this.isBlocked()) {
      this._pending = null;
      this._pendingIsReload = false;
      action();
    }
  }
}
