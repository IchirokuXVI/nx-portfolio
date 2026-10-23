import { effect, inject, Injectable, untracked } from '@angular/core';

/**
 * Something on screen that can answer a back press. True means it did, and nothing
 * older is asked.
 */
export type BackHandler = () => boolean;

/**
 * Who answers a back press that is not a browser navigation (velista `0166`, D4).
 *
 * A native shell's hardware back button arrives as one event with no target. The
 * screens already know what back means for themselves: a sheet dismisses through its
 * container, a page header emits `back` and the page names its fallback, a menu
 * closes. This only orders them, newest first, because the thing opened last is the
 * thing on top.
 *
 * A stack of closures rather than a route concept, so an overlay that is not a route
 * takes part on the same terms as a sheet that is. The web app never reads it today;
 * `AppBack` is the one caller, and only a native listener calls that.
 */
@Injectable({ providedIn: 'root' })
export class BackStack {
  private readonly _handlers: BackHandler[] = [];

  /**
   * Add a handler on top. The returned function removes it, and calling it twice is
   * harmless, because a component releases on close and again on destroy.
   */
  register(handler: BackHandler): () => void {
    // Wrapped so the same closure registered twice is still two entries, each removed
    // by its own release.
    const entry: BackHandler = () => handler();
    this._handlers.push(entry);

    return () => {
      const at = this._handlers.indexOf(entry);
      if (at !== -1) {
        this._handlers.splice(at, 1);
      }
    };
  }

  /**
   * Offer the press to each handler, newest first, and stop at the first that takes
   * it. False when none did.
   *
   * Iterates over a copy, because a handler that closes its overlay releases itself
   * during the walk.
   */
  handle(): boolean {
    for (const handler of [...this._handlers].reverse()) {
      if (handler()) {
        return true;
      }
    }

    return false;
  }
}

/**
 * Register `act` with {@link BackStack} for as long as `active()` is true, from a
 * component's injection context.
 *
 * An effect, so the registration follows the component's own open state and is
 * released when that state turns false and when the component is destroyed, with no
 * bookkeeping repeated in every overlay. The handler checks `active()` again when it fires,
 * because a press can land between a close and the next change detection, and a
 * closed menu must pass the press on rather than swallow it.
 */
export function handleBackWhile(active: () => boolean, act: () => void): void {
  const stack = inject(BackStack);

  effect((onCleanup) => {
    if (!active()) {
      return;
    }

    onCleanup(
      stack.register(() => {
        if (!untracked(active)) {
          return false;
        }
        untracked(act);
        return true;
      })
    );
  });
}
