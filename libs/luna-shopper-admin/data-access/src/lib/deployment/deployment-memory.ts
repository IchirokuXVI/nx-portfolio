import { Injectable } from '@angular/core';
import type { AdminEnvironment } from '@portfolio/luna-shopper-admin/models';
import type { DeploymentServiceI } from './deployment-service';

/**
 * The default behind {@link DEPLOYMENT_SERVICE}: no backend, and it says
 * `development`.
 *
 * This is what every spec and every run without a gateway gets, and answering
 * `development` is the honest answer for both of them. It is also the one answer
 * that is safe to be wrong about: a screen that says development when it is
 * really talking to production is impossible to reach through this class,
 * because nothing binds it once the app provides `DeploymentApi`.
 *
 * It reports **no** autologin, despite naming the environment autologin belongs
 * to (plan 0002, section 5). Skipping authentication is a decision only a real
 * server may make, and a memory default that made it would mean every spec of
 * the login screen started by navigating away from it.
 */
@Injectable({ providedIn: 'root' })
export class DeploymentMemory implements DeploymentServiceI {
  async read(): Promise<AdminEnvironment> {
    return { deployment: 'development', devAutologin: false };
  }
}
