import { Injectable } from '@angular/core';
import type { HealthServiceI } from './health-service';

/**
 * The default behind {@link HEALTH_SERVICE}: no backend, and it says the server
 * is there.
 *
 * Answering `true` is the right default for a spec and for a run with no
 * gateway, and it is the safe direction. A memory default that reported the
 * server down would cover every screen in every spec with an outage nobody
 * asked for. A test about the outage provides its own double and says so.
 */
@Injectable({ providedIn: 'root' })
export class HealthMemory implements HealthServiceI {
  async probe(): Promise<boolean> {
    return true;
  }
}
