import type { Provider } from '@angular/core';
import { provideService } from '@portfolio/shared/data-access';
import { OdontogramMemory } from './odontogram/odontogram-memory';
import { ODONTOGRAM_SERVICE } from './odontogram/odontogram-service';
import { ToothTreatmentMemory } from './tooth-treatment/tooth-treatment-memory';
import { TOOTH_TREATMENT_SERVICE } from './tooth-treatment/tooth-treatment-service';
import { TreatmentMemory } from './treatment/treatment-memory';
import { TREATMENT_SERVICE } from './treatment/treatment-service';

/**
 * The `data-access` services the app layer has to install.
 *
 * All three implementations were `providedIn: 'root'`, and under the shell that root is
 * the *portfolio's* injector, one level above everything odontogram provides. It worked
 * only because none of them reaches an app scoped value: each is an in-memory
 * implementation with no configuration to find. That is an accident rather than a
 * design, and it is the same accident velista hit the moment it gained a backend
 * (rule D5).
 *
 * **`provideService`, not the bare classes.** Listing `OdontogramMemory` here would
 * provide it, but `ODONTOGRAM_SERVICE` is a root provided token, so a consumer injecting
 * the token resolves it in the **root** injector, where its default factory's
 * `inject(OdontogramMemory)` finds nothing. `provideService` binds the token *and*
 * provides the class at this injector, so the root default is never reached.
 * `service-token.ts` documents this trap at length; taking `providedIn: 'root'` off an
 * implementation is exactly what springs it.
 *
 * `OdontogramApi` is deliberately **not** here. Choosing to talk to a real backend is
 * the app's call, and it needs this injector's `HttpClient`, so an app that wants it
 * binds it to `ODONTOGRAM_SERVICE` with `provideService` in its own providers instead.
 */
export const ODONTOGRAM_DATA_ACCESS_PROVIDERS: Provider[] = [
  provideService(ODONTOGRAM_SERVICE, OdontogramMemory),
  provideService(TOOTH_TREATMENT_SERVICE, ToothTreatmentMemory),
  provideService(TREATMENT_SERVICE, TreatmentMemory),
];
