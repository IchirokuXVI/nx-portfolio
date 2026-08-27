import type { Provider } from '@angular/core';
import { provideService } from '@portfolio/shared/data-access';
import { InfoFactMemory } from './info-fact/info-facts-memory';
import { INFO_FACT_SERVICE } from './info-fact/info-facts-service';
import { ProjectMemory } from './project/projects-memory';
import { PROJECT_SERVICE } from './project/projects-service';

/**
 * The `data-access` services the app layer has to install.
 *
 * Both implementations were `providedIn: 'root'`, and under the shell that root is the
 * *portfolio's* injector, one level above everything landingV2 provides. It worked only
 * because neither reaches an app scoped value: both are in-memory implementations with
 * no configuration to find. That is an accident rather than a design, and it is the
 * same accident velista hit the moment it gained a backend (rule D5).
 *
 * **`provideService`, not the bare classes.** Listing `ProjectMemory` here would provide
 * it, but `PROJECT_SERVICE` is a root provided token, so a consumer injecting the token
 * resolves it in the **root** injector, where its default factory's `inject(ProjectMemory)`
 * finds nothing. `provideService` binds the token *and* provides the class at this
 * injector, so the root default is never reached. `service-token.ts` documents this trap
 * at length; taking `providedIn: 'root'` off an implementation is exactly what springs it.
 */
export const LANDING_V2_DATA_ACCESS_PROVIDERS: Provider[] = [
  provideService(PROJECT_SERVICE, ProjectMemory),
  provideService(INFO_FACT_SERVICE, InfoFactMemory),
];
