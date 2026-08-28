import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { filter } from 'rxjs';

/**
 * The standalone build's bootstrap component, and the one thing the mounted build
 * has no equivalent of (plan 0013 D3).
 *
 * It draws no chrome. `AppLayout`, on the `:locale` child inside `feature-shell`,
 * already owns the header, the navigation, the theme scope and every token, so a
 * root component that drew anything would be drawing it twice. All this supplies is
 * the outlet the shell supplies in the other mode.
 *
 * It replaces `RemoteEntry`, whose template was empty so that hitting port 4205
 * rendered nothing. velista is the one app that rule stops applying to: it borrows
 * no style from the shell, so its own origin is not a degraded view of production,
 * it *is* production.
 */
@Component({
  selector: 'app-velista-root',
  imports: [RouterOutlet],
  template: `<router-outlet />`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppRoot {
  private readonly _router = inject(Router);
  // Optional because the worker is registered only in the production configuration
  // (plan 0013, section 6.3). A development build has no `provideServiceWorker`, so
  // `SwUpdate` resolves to null rather than throwing, and everything below is skipped.
  private readonly _updates = inject(SwUpdate, { optional: true });

  /**
   * A new version is downloaded and ready. It is **not** applied here.
   *
   * velista talks to a moving backend, so a client frozen on a cached shell is a real
   * hazard. But an app that reloads while somebody is typing a list item is worse, so
   * the reload waits for the next completed navigation and lands between two screens
   * rather than in the middle of one (plan 0013, section 6.4).
   */
  private _reloadWhenTheUserLeavesThisScreen = false;

  constructor() {
    if (!this._updates?.isEnabled) return;

    this._updates.versionUpdates
      .pipe(filter((event) => event.type === 'VERSION_READY'))
      .subscribe(() => {
        this._reloadWhenTheUserLeavesThisScreen = true;
      });

    this._router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(() => {
        if (this._reloadWhenTheUserLeavesThisScreen) {
          document.location.reload();
        }
      });

    // Nothing to protect: the cached state is already broken, so waiting for a polite
    // moment only prolongs an app that cannot work.
    this._updates.unrecoverable.subscribe(() => document.location.reload());
  }
}
