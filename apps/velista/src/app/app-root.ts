import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

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
 *
 * The update handling that used to live here is `AppUpdates` in
 * `@portfolio/velista/platform` (plan 0034, section 4). It moved for two reasons:
 * this component exists in one of the two run modes and the schedule wanted to be
 * reachable from the gateway interceptor in both, and a service can be driven by a
 * spec without standing up a component fixture to reach a constructor.
 */
@Component({
  selector: 'app-velista-root',
  imports: [RouterOutlet],
  template: `<router-outlet />`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppRoot {}
