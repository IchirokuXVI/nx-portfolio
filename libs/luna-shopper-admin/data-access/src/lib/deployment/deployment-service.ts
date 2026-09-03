import { inject } from '@angular/core';
import type { Deployment } from '@portfolio/luna-shopper-admin/models';
import { serviceToken } from '@portfolio/shared/data-access';
import { DeploymentMemory } from './deployment-memory';

/**
 * Which deployment the app is talking to (plan 0001, section 6).
 *
 * One call, and it is unauthenticated on purpose: the app has to draw its per
 * environment colour before there is any token to present. From `0002` the same
 * fact also arrives on `GET /v1/admin/auth/me`, and this stays the login screen's
 * source for it.
 */
export interface DeploymentServiceI {
  /**
   * The deployment the gateway reports, or `null` when it will not say.
   *
   * `null` covers both halves of not knowing: a gateway that did not answer, and
   * one that answered with a name this app does not recognise. They are not worth
   * telling apart here, because what the screen does about either is the same, and
   * it is the only safe thing to do — say so, rather than pick a colour.
   */
  read(): Promise<Deployment | null>;
}

// Inject THIS token, typed as the interface, never the concrete class.
export const DEPLOYMENT_SERVICE = serviceToken<DeploymentServiceI>(
  'DEPLOYMENT_SERVICE',
  () => inject(DeploymentMemory)
);
