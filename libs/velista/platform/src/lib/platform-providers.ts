import type { Provider } from '@angular/core';
import { ThemeStore } from './theme-store';

/**
 * The `platform` services the app layer has to install, because they cannot install
 * themselves (rule D5, plan 0004 section 9).
 *
 * `providedIn: 'root'` means "there is one of me and I live at the top". Under module
 * federation the top is the **shell's** injector, which knows nothing about this app,
 * and everything this app provides lives in a child injector below it. A root scoped
 * service is created up there and resolves its own dependencies from up there, so it
 * cannot see a single thing the app provided. `ThemeStore` needs `APP_BRAND`, so it
 * has to be created where `APP_BRAND` is, which is here.
 *
 * The rest of this library stays `providedIn: 'root'` on purpose: `BrowserFacade`,
 * `ConnectionState` and `ReloadBlocker` depend on nothing the app supplies, so they
 * lose nothing by being shared and gain zero setup in tests.
 */
export const VELISTA_PLATFORM_PROVIDERS: Provider[] = [ThemeStore];
