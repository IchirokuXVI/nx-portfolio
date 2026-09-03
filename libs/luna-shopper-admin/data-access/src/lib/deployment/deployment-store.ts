import { inject, Injectable, signal } from '@angular/core';
import type { Deployment } from '@portfolio/luna-shopper-admin/models';
import { DEPLOYMENT_SERVICE } from './deployment-service';

/**
 * Which deployment this is, as a signal every screen reads (plan 0001, section 6).
 *
 * One read, once, held for the life of the tab. The answer cannot change under a
 * running app: it is a property of the gateway on the other end of a base URL that
 * is fixed at build time, so re-reading it would cost a request per screen and
 * could only ever confirm what it already said.
 *
 * `undefined` while the read is in flight and `null` when it failed, and the two
 * are told apart on purpose. Not knowing yet is a moment the page renders through
 * without saying anything; not being able to find out is a state it has to show,
 * because an operator who cannot see which environment they are in should be told
 * that rather than shown a default.
 */
@Injectable()
export class DeploymentStore {
  private readonly _service = inject(DEPLOYMENT_SERVICE);
  private readonly _deployment = signal<Deployment | null | undefined>(
    undefined
  );

  /** The deployment, `null` if unknown, `undefined` until the read settles. */
  readonly deployment = this._deployment.asReadonly();

  /**
   * Start the one read.
   *
   * Called from an environment initializer rather than from a component, so the
   * request is in flight from the moment the app injector exists and does not wait
   * on whichever screen happens to render first. Idempotent, so a second caller
   * costs nothing.
   */
  load(): void {
    if (this._loading) {
      return;
    }
    this._loading = true;
    void this._service
      .read()
      .then((deployment) => this._deployment.set(deployment));
  }

  private _loading = false;
}
