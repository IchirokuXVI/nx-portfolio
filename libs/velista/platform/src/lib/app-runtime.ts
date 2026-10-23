import { InjectionToken } from '@angular/core';

/**
 * What kind of host the bundle is running in (velista `0166`, D1).
 *
 * `web` is a browser tab, the installed PWA and the portfolio's mounted copy alike:
 * they differ by mount, which `APP_BASE_PATH` already says, and not by host. `native`
 * is the same standalone bundle inside a native shell's WebView, where the service
 * worker, the install prompt and a reload that fetches a newer bundle mean nothing.
 */
export type AppRuntime = 'web' | 'native';

/**
 * The one place a screen or a service asks which host it runs in.
 *
 * Defaults to `web` from a root factory, so a server render, a spec and the mounted
 * build all get the web app without providing anything (SSR rule 3). The native build
 * provides `native` in its application config, decided once from
 * {@link detectNativeShell}. Nothing else reads the global (D2).
 */
export const APP_RUNTIME = new InjectionToken<AppRuntime>('APP_RUNTIME', {
  providedIn: 'root',
  factory: () => 'web',
});

/**
 * Where the native app's store listing is, or null when there is none to offer.
 *
 * Read by the dead end face of a refused build (plan 0072): inside a native shell a
 * newer bundle only ever arrives as a newer app, so the face links to the listing
 * instead of reloading the same bundle (D3). Null on the web and wherever nobody
 * configured a listing, and a null draws the face as it always was.
 */
export const APP_STORE_URL = new InjectionToken<string | null>(
  'APP_STORE_URL',
  {
    providedIn: 'root',
    factory: () => null,
  }
);

/** The part of the Capacitor global this asks about, declared so nothing is imported. */
interface NativeShellGlobal {
  readonly Capacitor?: { readonly isNativePlatform?: () => boolean };
}

/**
 * Whether a native shell injected its bridge into this document.
 *
 * Pure, and safe anywhere, including `app.config.ts` before an injector exists and a
 * server with no `window` (SSR rule 4): it reads `globalThis` and never `window`, and
 * the try/catch covers a bridge whose method throws. Only a bridge that says it is
 * native counts, because Capacitor also defines its global on the web, where
 * `isNativePlatform()` is false.
 *
 * Everything except the service worker condition reads {@link APP_RUNTIME} instead.
 */
export function detectNativeShell(): boolean {
  try {
    const bridge = (globalThis as NativeShellGlobal).Capacitor;
    return bridge?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}
