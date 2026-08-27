import type { Provider } from '@angular/core';
import { InfoFactMemory } from './info-fact/info-facts-memory';
import { ProjectMemory } from './project/projects-memory';

/**
 * The `data-access` services the app layer has to install.
 *
 * Both were `providedIn: 'root'`, and under the shell that root is the *portfolio's*
 * injector, one level above everything landingV2 provides. It worked only because
 * neither reaches an app scoped value: both are in-memory implementations with no
 * configuration to find. That is an accident rather than a design, and it is the same
 * accident velista hit the moment it gained a backend (rule D5).
 */
export const LANDING_V2_DATA_ACCESS_PROVIDERS: Provider[] = [
  ProjectMemory,
  InfoFactMemory,
];
