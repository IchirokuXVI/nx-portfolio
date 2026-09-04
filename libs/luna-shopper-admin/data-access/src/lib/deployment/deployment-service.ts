import { inject } from '@angular/core';
import type { AdminEnvironment } from '@portfolio/luna-shopper-admin/models';
import { serviceToken } from '@portfolio/shared/data-access';
import { DeploymentMemory } from './deployment-memory';

/**
 * The unauthenticated read the app makes before anything renders (plan 0001,
 * section 6; plan 0002, section 5).
 *
 * One call answering two questions, because they come from one endpoint and are
 * both needed at the same moment: which deployment this is, and whether the
 * server will sign the operator in without a password.
 *
 * Unauthenticated on purpose. The app has to draw its per environment colour
 * before there is any token to present, and it has to know whether to draw the
 * login screen at all. From `0002` the environment half also arrives on `GET
 * /v1/admin/auth/me`, and this stays the login screen's source for it.
 */
export interface DeploymentServiceI {
  /**
   * What the gateway says about itself.
   *
   * A gateway that answered something unreadable produces `UNKNOWN_ENVIRONMENT`
   * rather than a rejection, because both halves of the answer have a safe value
   * for "was not told" and the page has to be able to draw either way.
   *
   * It rejects for one case only: a request that produced no response at all
   * (plan 0008, section 3). That is not an unknown environment, it is an absent
   * server, and the app answers the two differently.
   */
  read(): Promise<AdminEnvironment>;
}

// Inject THIS token, typed as the interface, never the concrete class.
export const DEPLOYMENT_SERVICE = serviceToken<DeploymentServiceI>(
  'DEPLOYMENT_SERVICE',
  () => inject(DeploymentMemory)
);
