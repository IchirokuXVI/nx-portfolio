import type { Provider } from '@angular/core';
import {
  APP_API_CONFIG,
  APP_BASE_PATH,
  APP_BRAND,
  type AppApiConfig,
  type AppBrand,
} from '@portfolio/velista/models';
import { BrowserFacade } from '../browser-facade';
import {
  GEOLOCATION_READER,
  type GeolocationReaderI,
  type LocationOutcome,
  type LocationPermission,
} from '../geolocation-reader';
import { VELISTA_PLATFORM_PROVIDERS } from '../platform-providers';

/**
 * One place for what a velista spec needs provided globally.
 *
 * ## Why this exists
 *
 * Before it, four specs wrote out their own `AppBrand` literal and six wrote their own
 * `BrowserFacade` double. That duplication is not only noise: it is what let the app
 * and the tests disagree about **where** providers live without anybody noticing. Every
 * spec set the app tokens up in the TestBed, which is root scoped, while the app set
 * them up on a route injector, which is not. See plan `0005`.
 *
 * ## Why it lives in `platform` rather than a `velista/testing` library
 *
 * A separate library would have to depend on `platform` to type a `BrowserFacade`
 * double, and `platform`'s own specs want these helpers too, which is a cycle in the
 * project graph. Everything in this app already depends on `platform`, so putting them
 * here reaches every spec with no cycle anywhere. It also matches what this workspace
 * already does with `RokuTranslatorTestingModule`, which ships from the library it
 * tests rather than from a testing-only package.
 *
 * Nothing under `src` imports this file, so it is never bundled.
 *
 * ## Why a function and not a global jest setup
 *
 * A `beforeEach` in `test-setup.ts` looks tidier and does not survive contact with
 * `TestBed.resetTestingModule()`, which `home-page.spec.ts` calls so one test can
 * render twice, and `theme-store.spec.ts` calls to simulate a reload. A reset discards
 * whatever a global hook configured. A spec that opts in by calling a function is
 * immune to that, and reads at the point of use.
 */

/**
 * The brand every spec runs against.
 *
 * Deliberately **not** Velista. Rule N1 says the product name is data, and a spec that
 * asserts on the real name has quietly turned it back into a constant. If a rename
 * would break a test then that test is wrong, and this fixture is what makes it fail
 * now rather than during the rename.
 */
export const TEST_BRAND: AppBrand = {
  name: 'Test Product',
  shortName: 'Test',
  wordmarkSrc: 'mark.svg',
  iconSrc: 'icon.svg',
};

/** Gateway configuration for specs. Absolute, because `ApiUrl` builds absolute URLs. */
export const TEST_API_CONFIG: AppApiConfig = {
  gatewayBaseUrl: 'https://gateway.test',
  realtimeBaseUrl: 'https://realtime.test',
};

/** What a spec can vary without rebuilding the whole list. */
export interface VelistaTestingOptions {
  readonly brand?: Partial<AppBrand>;
  readonly api?: Partial<AppApiConfig>;
  readonly basePath?: string;
}

/**
 * Everything the app layer supplies, with test values.
 *
 * This mirrors `appProviders` deliberately, including the `VELISTA_*_PROVIDERS` array,
 * so a service that moves under rule D5 is picked up by the app and by every spec from
 * the same place. That is the only version of this that stays true as the app grows.
 *
 * `data-access` is not here, because `platform` may not depend on it. A spec that needs
 * those services spreads `VELISTA_DATA_ACCESS_PROVIDERS` alongside this call.
 *
 * `BrowserFacade` is deliberately **not** faked here either. `theme-store.spec.ts` and
 * `browser-facade.spec.ts` test against the real one, and a helper that silently
 * replaced it would make those specs assert on nothing. Ask for the double explicitly
 * with {@link fakeBrowserFacade} when the spec wants it.
 */
export function provideVelistaTesting(
  options: VelistaTestingOptions = {}
): Provider[] {
  return [
    { provide: APP_BRAND, useValue: { ...TEST_BRAND, ...options.brand } },
    {
      provide: APP_API_CONFIG,
      useValue: { ...TEST_API_CONFIG, ...options.api },
    },
    { provide: APP_BASE_PATH, useValue: options.basePath ?? '' },
    ...VELISTA_PLATFORM_PROVIDERS,
  ];
}

/**
 * A `BrowserFacade` double backed by a plain `Map`.
 *
 * Pass the same `Map` in to assert on what the code under test wrote. The defaults are
 * the quiet answers the real facade gives when an API is missing, which is what most
 * specs want: online, no `window`, storage that works, every media query false.
 *
 * `matchMedia` returning false for everything is not laziness, it is the contract:
 * callers must phrase a query so the answer they want by default is the false one.
 */
export function fakeBrowserFacade(
  storage: Map<string, string> = new Map(),
  overrides: Partial<BrowserFacade> = {}
): BrowserFacade {
  return {
    isBrowser: true,
    onLine: () => true,
    // Visible, like every other default here: a spec that wants a resume drives it
    // with a writable signal of its own rather than starting the app hidden.
    visible: () => true,
    window: null,
    location: null,
    document: globalThis.document,
    matchMedia: () => () => false,
    readStorage: (key: string) => storage.get(key) ?? null,
    writeStorage: (key: string, value: string) => void storage.set(key, value),
    removeStorage: (key: string) => void storage.delete(key),
    ...overrides,
  } as unknown as BrowserFacade;
}

/**
 * A `GeolocationReaderI` double, with the calls it was given (plan 0058, section 3.5).
 *
 * `reads` is what proves the acceptance criterion that **the prompt never fires on
 * load**: a spec renders the page and asserts the count is still zero. That is a fact
 * about a call rather than about a browser dialog, which is the only form in which it
 * can be asserted at all.
 *
 * The defaults are the happy path, so a spec about denial, about a device that cannot
 * place itself, or about a timeout says so and says nothing else.
 */
export function fakeGeolocationReader(
  options: {
    readonly permission?: LocationPermission;
    readonly outcome?: LocationOutcome;
  } = {}
) {
  const state = {
    /** How many times {@link GeolocationReaderI.read} was called. */
    reads: 0,
    /** How many times the permission was asked about, which prompts nobody. */
    queries: 0,
  };

  const reader: GeolocationReaderI = {
    permission: async () => {
      state.queries++;
      return options.permission ?? 'prompt';
    },
    read: async () => {
      state.reads++;
      return (
        options.outcome ?? {
          state: 'located',
          point: { latitude: 37.88, longitude: -4.78 },
        }
      );
    },
  };

  return { reader, state };
}

/** {@link fakeGeolocationReader} as a provider, bound to its token. */
export function provideFakeGeolocationReader(
  fake = fakeGeolocationReader()
): Provider {
  return { provide: GEOLOCATION_READER, useValue: fake.reader };
}

/** {@link fakeBrowserFacade} as a provider, which is how specs usually want it. */
export function provideFakeBrowserFacade(
  storage?: Map<string, string>,
  overrides?: Partial<BrowserFacade>
): Provider {
  return {
    provide: BrowserFacade,
    useValue: fakeBrowserFacade(storage, overrides),
  };
}
