import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import {
  DeploymentStore,
  SessionLifecycle,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  ReauthOverlay,
  SessionWarning,
} from '@portfolio/luna-shopper-admin/feature-auth';

/**
 * The app's root, and the element the environment accent lives on.
 *
 * It draws no chrome; `0004` brings that. What it does own is the one thing every
 * screen below it reads: `data-deployment`, which the token stylesheet keys the
 * accent colour off. Putting it here means the colour is settled once, above every
 * route, and a page cannot fail to inherit it.
 *
 * The attribute is **absent** until the read settles and when it fails, rather than
 * being set to some stand-in value. The stylesheet's resting accent is the grey one,
 * so an app that has not established its environment cannot end up wearing
 * production's red or staging's amber (plan 0001, section 6).
 *
 * Unlike the four remotes, this component has a real `<router-outlet>`. The empty
 * template rule exists because a remote served on its own port lacks the shell's
 * global styles and renders differently from production; this app has no shell, is
 * never mounted anywhere, and draws all of its own chrome, so its own origin is
 * production rather than a degraded view of it.
 *
 * ## It is also where the session is drawn (plan 0003)
 *
 * Here and nowhere else, because this is the only component above every route: an
 * expiring session must be answered without unmounting whatever screen is open, and
 * anything rendered inside the outlet would be destroyed by the navigation the
 * overlay exists to avoid.
 *
 * `inert` on the wrapper is what makes the overlay a real cover rather than a
 * picture of one. It takes the routed page out of the tab order **and** out of the
 * accessibility tree, so Tab cannot walk the cursor into a covered form and a screen
 * reader cannot be walked through the content the overlay is hiding. The overlay
 * traps Tab itself as well; this is the half that also answers the screen reader.
 *
 * `feature-auth` is imported statically rather than deferred, and that is not an
 * oversight. The overlay has to be able to appear in the same frame the session
 * ends in, and the library it lives in holds the login screen, which is the first
 * thing this app draws anyway.
 */
@Component({
  selector: 'app-luna-shopper-admin-root',
  imports: [RouterOutlet, ReauthOverlay, SessionWarning],
  template: `
    <div [attr.inert]="locked() ? '' : null" class="app">
      <router-outlet />
    </div>

    @if (warning()) {
      <lib-session-warning />
    }

    @if (locked()) {
      <lib-reauth-overlay />
    }
  `,
  host: {
    '[attr.data-deployment]': 'deployment() ?? null',
  },
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      min-block-size: 100dvh;
      background: var(--admin-surface);
      color: var(--admin-ink);
    }

    .app {
      display: flex;
      flex: 1;
      flex-direction: column;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppRoot {
  private readonly _deployments = inject(DeploymentStore);
  private readonly _lifecycle = inject(SessionLifecycle);

  /** `undefined` while the read is in flight, `null` when it could not be made. */
  readonly deployment = this._deployments.deployment;

  /** The idle session's last few minutes (plan 0003, section 3). */
  readonly warning = this._lifecycle.warning;

  /** The expired session, covered rather than navigated away from (section 5). */
  readonly locked = this._lifecycle.locked;
}
