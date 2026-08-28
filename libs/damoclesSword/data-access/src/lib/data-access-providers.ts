import type { Provider } from '@angular/core';
import { provideService } from '@portfolio/shared/data-access';
import { AssetMemory } from './asset/asset-memory';
import { ASSET_SERVICE } from './asset/asset-service';
import { ContactMock } from './contact/contact-mock';
import { CONTACT_SERVICE } from './contact/contact-service';
import { NewsMemory } from './news/news-memory';
import { NEWS_SERVICE } from './news/news-service';
import { ProjectMemory } from './project/project-memory';
import { PROJECT_SERVICE } from './project/project-service';

/**
 * The `data-access` services the app layer has to install.
 *
 * All four implementations were `providedIn: 'root'`, and under the shell that root is
 * the *portfolio's* injector, one level above everything damoclesSword provides. It
 * worked only because none of them reaches an app scoped value: every one is an
 * in-memory or mock implementation with no configuration to find. That is an accident
 * rather than a design, and it is the same accident velista hit the moment it gained a
 * backend (rule D5).
 *
 * **`provideService`, not the bare classes.** Listing `AssetMemory` here would provide
 * it, but `ASSET_SERVICE` is a root provided token, so a consumer injecting the token
 * resolves it in the **root** injector, where its default factory's `inject(AssetMemory)`
 * finds nothing. `provideService` binds the token *and* provides the class at this
 * injector, so the root default is never reached. `service-token.ts` documents this trap
 * at length; taking `providedIn: 'root'` off an implementation is exactly what springs
 * it. It matters twice here: `NewsMemory` itself injects `ASSET_SERVICE`, so the binding
 * has to be reachable from the same injector that constructs it.
 */
export const DAMOCLES_DATA_ACCESS_PROVIDERS: Provider[] = [
  provideService(ASSET_SERVICE, AssetMemory),
  provideService(CONTACT_SERVICE, ContactMock),
  provideService(NEWS_SERVICE, NewsMemory),
  provideService(PROJECT_SERVICE, ProjectMemory),
];
