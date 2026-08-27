import type { Provider } from '@angular/core';
import { OdontogramMemory } from './odontogram/odontogram-memory';
import { ToothTreatmentMemory } from './tooth-treatment/tooth-treatment-memory';
import { TreatmentMemory } from './treatment/treatment-memory';

/**
 * The `data-access` services the app layer has to install.
 *
 * All three were `providedIn: 'root'`, and under the shell that root is the
 * *portfolio's* injector, one level above everything odontogram provides. It worked
 * only because none of them reached an app scoped value: each is an in-memory
 * implementation with no configuration to find. That is an accident rather than a
 * design, and it is the same accident velista hit the moment it gained a backend
 * (rule D5).
 *
 * `OdontogramApi` is deliberately **not** here. Choosing to talk to a real backend is
 * the app's call, and it needs this injector's `HttpClient`, so an app that wants it
 * binds it to `ODONTOGRAM_SERVICE` with `provideService` in its own providers, which
 * provides the class in the same breath.
 */
export const ODONTOGRAM_DATA_ACCESS_PROVIDERS: Provider[] = [
  OdontogramMemory,
  ToothTreatmentMemory,
  TreatmentMemory,
];
