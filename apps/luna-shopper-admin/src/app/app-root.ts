import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { DeploymentStore } from '@portfolio/luna-shopper-admin/data-access';

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
 */
@Component({
  selector: 'app-luna-shopper-admin-root',
  imports: [RouterOutlet],
  template: `<router-outlet />`,
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
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppRoot {
  private readonly _deployments = inject(DeploymentStore);

  /** `undefined` while the read is in flight, `null` when it could not be made. */
  readonly deployment = this._deployments.deployment;
}
