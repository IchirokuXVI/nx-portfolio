import { inject, Injectable } from '@angular/core';
import type { CanDeactivateFn } from '@angular/router';

/**
 * What a sheet has to be able to do for its exit to be animated from the outside.
 *
 * Narrow on purpose. The registry lives here, in `platform`, and `SheetShell` lives in
 * `ui`; naming the component would point the dependency the wrong way round, and the
 * guard only ever needs to ask one thing.
 */
export interface FallingSheet {
  /**
   * Play the exit animation and resolve when the panel has landed.
   *
   * Resolves at once when there is nothing to play: the fall is already running, or
   * motion is off. Never rejects, because a guard that rejected would strand somebody
   * on a sheet they asked to leave.
   */
  fall(): Promise<void>;
}

/**
 * Which sheet is on screen, so a navigation away from it can wait for it to fall.
 *
 * Rule E1 (plan 0008) makes a sheet a child route, which is what gives the back button
 * something to pop, and plan 0011 gave the panel an exit animation by holding the
 * navigation back inside `SheetShell`. That only ever worked for the exits that start
 * **inside** the shell: Cancel, the scrim and Escape. Every other way out changed the
 * route first and the router destroyed the component before a frame could be drawn, so
 * the panel vanished rather than falling.
 *
 * That gap is not a corner: on a phone the system back gesture is the ordinary way to
 * close a bottom sheet, and a successful submit leaves through `SheetNavigation.leaveTo`.
 * Both were instant, which is what made the two entry sheets read as having no close
 * animation at all.
 *
 * So the shell registers itself here while it is on screen and {@link sheetFallGuard}
 * asks it to fall before letting any navigation off the sheet's route through. One
 * registration rather than a per component wiring: the guard has no way to reach the
 * shell from the routed container otherwise, and eleven containers would each have to
 * expose it.
 *
 * Only ever one sheet is registered, because only one sheet route is active at a time.
 * `release` checks identity before clearing so a sheet that is torn down after its
 * successor has registered cannot unregister the new one.
 */
@Injectable({ providedIn: 'root' })
export class OpenSheet {
  private _current: FallingSheet | null = null;

  register(sheet: FallingSheet): void {
    this._current = sheet;
  }

  release(sheet: FallingSheet): void {
    if (this._current === sheet) {
      this._current = null;
    }
  }

  /**
   * Let the sheet on screen fall, and resolve when it has.
   *
   * Resolves at once when nothing is registered, which is the case for a sheet route
   * whose component renders something other than a panel: `CreateGroupSheet` swaps the
   * whole shell for `AccountLostPanel` when the guest account is spent, and leaving
   * that screen has no panel to animate.
   */
  async fall(): Promise<void> {
    await this._current?.fall();
  }
}

/**
 * Hold a navigation off a sheet route until the panel has finished falling.
 *
 * On every sheet route, and deliberately not on the pages: this is the one place that
 * knows a route is drawn as a panel that has to leave the screen before its component
 * is destroyed.
 *
 * It is a `canDeactivate` rather than anything in the component because the back button
 * is the case that matters, and by the time a component could react to a popstate the
 * router has already decided to destroy it. A guard is the only hook that runs early
 * enough to delay that, and delaying is all this does: it always allows.
 *
 * The exits that already animate cost nothing here. `SheetShell.requestDismiss` plays
 * the fall itself and only then navigates, so by the time the guard runs the panel is
 * already down and `fall()` resolves on the spot rather than playing a second one.
 *
 * `inject` is called before anything is awaited, which is not a style choice: a guard
 * runs in an injection context only until its first suspension, so resolving the
 * registry inside the promise chain would throw NG0203 on the back button and nowhere
 * else. Hence a `.then` rather than an `async` function.
 */
export const sheetFallGuard: CanDeactivateFn<unknown> = () =>
  inject(OpenSheet)
    .fall()
    .then(() => true);
