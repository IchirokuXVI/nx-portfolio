import { isPlatformBrowser } from '@angular/common';
import {
  type EnvironmentProviders,
  inject,
  makeEnvironmentProviders,
  PLATFORM_ID,
  provideEnvironmentInitializer,
} from '@angular/core';
import {
  APP_RUNTIME,
  APP_STORE_URL,
  BrowserFacade,
  BrowserGeolocationReader,
  detectNativeShell,
  GEOLOCATION_READER,
  SHARE_TARGET,
  SYSTEM_BARS,
  WebShareTarget,
  WebSystemBars,
} from '@portfolio/velista/platform';
import { NativeBrowserFacade } from './native-browser-facade';
import { NativeGeolocationReader } from './native-geolocation-reader';
import { NativeShareTarget } from './native-share-target';
import { NativeShell, storeUrlFor } from './native-shell';
import { NativeSystemBars } from './native-system-bars';

function isNative(): boolean {
  return inject(APP_RUNTIME) === 'native';
}

/**
 * The native implementations of plan 0166's seams, for the standalone application
 * config only (the mounted build never runs it, so the portfolio never sees them).
 *
 * **Inert on the web.** `APP_RUNTIME` is `native` only in a browser platform whose
 * document a native shell bridged, and every other provider resolves the web default
 * unless it is. A server render, a spec and the PWA therefore get exactly what they
 * got before this was spread in (plan 0166, SSR rules 2 and 3). Nothing here touches a
 * browser global, and Capacitor itself is imported only inside the native branch.
 */
export function provideNativeShell(): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: APP_RUNTIME,
      useFactory: () =>
        isPlatformBrowser(inject(PLATFORM_ID)) && detectNativeShell()
          ? 'native'
          : 'web',
    },
    {
      provide: SHARE_TARGET,
      useFactory: () =>
        isNative() ? inject(NativeShareTarget) : inject(WebShareTarget),
    },
    {
      provide: GEOLOCATION_READER,
      useFactory: () =>
        isNative()
          ? inject(NativeGeolocationReader)
          : new BrowserGeolocationReader(),
    },
    {
      provide: SYSTEM_BARS,
      useFactory: () =>
        isNative() ? inject(NativeSystemBars) : inject(WebSystemBars),
    },
    {
      // Built in the factory, which is an injection context, because the facade
      // injects its dependencies in field initializers.
      provide: BrowserFacade,
      useFactory: () =>
        isNative() ? new NativeBrowserFacade() : new BrowserFacade(),
    },
    {
      provide: APP_STORE_URL,
      useFactory: () =>
        isNative() ? storeUrlFor(inject(NativeShell).appId) : null,
    },
    provideEnvironmentInitializer(() => {
      if (!inject(BrowserFacade).isBrowser || !isNative()) {
        return;
      }
      void inject(NativeShell)
        .start()
        .catch(() => undefined);
    }),
  ]);
}
