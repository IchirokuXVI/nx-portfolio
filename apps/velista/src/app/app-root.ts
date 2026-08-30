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
  // The one thing this component does draw, and it is not chrome: the vertical space
  // `AppLayout` sizes itself against.
  //
  // `AppLayout` reaches full height by being a stretched flex item of whatever holds
  // it, and mounted in the portfolio that holder is the shell's own root, which is
  // `display: flex` with `min-height: 100dvh` (`apps/shell/src/app/app.scss`). A
  // stretched item of a flex container whose height is settled has a *definite*
  // height, which is what lets `.app-main`'s `height: 100%`, and every page's
  // `block-size: 100%` below it, resolve to something.
  //
  // On velista's own origin this component is that holder, and with no styles it was
  // an inline box: `AppLayout` filled the viewport through its own `min-block-size`,
  // but a minimum is not a definite height, so every percentage below it resolved to
  // `auto` and each page collapsed onto its content. A bottom action bar such as
  // "Get shopping list" then sat directly under the last paragraph rather than at the
  // foot of the screen (plan 0013 D3, the mode split).
  //
  // So the standalone root states the same two declarations the shell's root does.
  // Nothing else about it is shared, and this is the whole of what the mounted build
  // was borrowing.
  styles: `
    :host {
      display: flex;
      min-block-size: 100dvh;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppRoot {}
