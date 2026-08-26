import type { Provider } from '@angular/core';
import { ApiUrl } from './api-url';
import { SessionStore } from './auth/session-store';
import { TokenStore } from './auth/token-store';
import { ZoneMemory } from './zones/zone-memory';
import { ZoneStore } from './zones/zone-store';

/**
 * The `data-access` services the app layer has to install (rule D5, plan 0004
 * section 9). See `VELISTA_PLATFORM_PROVIDERS` for why root scope is not an option.
 *
 * Three different reasons land the members here, and the difference is worth knowing
 * before adding a fourth:
 *
 * - `ApiUrl` reads `APP_API_CONFIG` directly. `TokenStore` and `SessionStore` reach it
 *   through `ApiUrl`. Transitive counts: the failure is identical.
 * - `ZoneStore` injects no app token at all. It is here because it has to resolve
 *   `ZONE_SERVICE` in the injector where the app **binds** that token. Created at the
 *   root it would resolve the token's own default instead and quietly serve in-memory
 *   data while the app looked like it was talking to the backend. That was the real
 *   bug, and it is the one that would have survived longest unnoticed.
 * - `ZoneMemory` is the in-memory implementation and by rights would stay root scoped.
 *   It cannot, because it injects `TokenStore` to answer as the current caller, and
 *   `TokenStore` reaches `APP_API_CONFIG`. It is no longer any token's default, so it
 *   is only here for the specs and backend-less runs that ask for it by name.
 *
 * `ZoneApi` and `ConnectionRecovery` are deliberately **not** here. Both are the app's
 * choice rather than the library's: one says this deployment talks to a real gateway,
 * the other is a listener the app decides to run. They are provided in `appProviders`,
 * next to the decisions that select them.
 */
export const VELISTA_DATA_ACCESS_PROVIDERS: Provider[] = [
  ApiUrl,
  TokenStore,
  SessionStore,
  ZoneMemory,
  ZoneStore,
];
