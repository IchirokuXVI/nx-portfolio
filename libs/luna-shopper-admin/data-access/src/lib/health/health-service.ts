import { inject } from '@angular/core';
import { serviceToken } from '@portfolio/shared/data-access';
import { HealthMemory } from './health-memory';

/**
 * The one question this app asks about the gateway itself: is anything
 * answering? (plan 0008, section 1).
 *
 * Unauthenticated, and deliberately not a read of anything the app displays. It
 * exists to tell "the server is gone" apart from "that one request failed", and
 * a probe that needed a token could not answer it before sign in.
 */
export interface HealthServiceI {
  /**
   * Whether the gateway answered.
   *
   * Total: it never rejects, because every way of not being answered is the same
   * answer and a caller that must remember to catch is a caller that will
   * eventually not. `true` only for a 2xx inside the probe timeout.
   */
  probe(): Promise<boolean>;
}

// Inject THIS token, typed as the interface, never the concrete class.
export const HEALTH_SERVICE = serviceToken<HealthServiceI>(
  'HEALTH_SERVICE',
  () => inject(HealthMemory)
);
