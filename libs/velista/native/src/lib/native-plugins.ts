import { InjectionToken } from '@angular/core';

/** What a Capacitor listener registration returns: the way to take it off again. */
export interface NativeListenerHandle {
  remove(): Promise<void>;
}

/**
 * The part of `@capacitor/app` this app calls, declared here so a spec can hand in a
 * double without the package.
 */
export interface NativeAppPlugin {
  getInfo(): Promise<{ readonly id: string }>;
  minimizeApp(): Promise<void>;
  addListener(
    eventName: 'backButton',
    listener: () => void
  ): Promise<NativeListenerHandle>;
  addListener(
    eventName: 'appUrlOpen',
    listener: (event: { readonly url: string }) => void
  ): Promise<NativeListenerHandle>;
}

/** The part of `@capacitor/share` this app calls. */
export interface NativeSharePlugin {
  share(options: {
    title?: string;
    text?: string;
    url?: string;
  }): Promise<unknown>;
}

/** Android's answer about the location permission, as `@capacitor/geolocation` words it. */
export type NativePermissionState =
  | 'prompt'
  | 'prompt-with-rationale'
  | 'granted'
  | 'denied';

/** The part of `@capacitor/geolocation` this app calls. */
export interface NativeGeolocationPlugin {
  checkPermissions(): Promise<{ readonly location: NativePermissionState }>;
  getCurrentPosition(options: {
    enableHighAccuracy: boolean;
    timeout: number;
    maximumAge: number;
  }): Promise<{
    readonly coords: {
      readonly latitude: number;
      readonly longitude: number;
      readonly accuracy: number;
    };
  }>;
}

/** The part of `@capacitor/browser` this app calls. */
export interface NativeBrowserPlugin {
  open(options: { url: string }): Promise<void>;
}

/** The part of the core `SystemBars` plugin this app calls. */
export interface NativeSystemBarsPlugin {
  setStyle(options: { style: 'DARK' | 'LIGHT' }): Promise<void>;
}

/**
 * The codes `VelistaGoogle` rejects with (velista `0177`): the person closed the sheet,
 * no account on the phone can answer, the phone has no Play services, or anything else.
 */
export type NativeGoogleErrorCode =
  | 'cancelled'
  | 'no_credential'
  | 'unavailable'
  | 'failed';

/**
 * The app's own plugin over Android's Credential Manager (velista `0177`, D2), in
 * `apps/velista/android` as `VelistaGooglePlugin.java`. A local plugin and not a
 * package, so no third party code holds the credential.
 */
export interface NativeGooglePlugin {
  getIdToken(options: {
    serverClientId: string;
    nonce: string;
    silent: boolean;
  }): Promise<{ readonly idToken: string }>;
  forget(): Promise<void>;
}

/**
 * The part of `@capgo/capacitor-updater` this app calls, in manual mode (velista
 * `0180`, D11). Answers are typed `unknown` and read field by field (rule D4), because
 * they come from outside the bundle.
 *
 * Never declared here, on purpose: `next()` (it applies at the next move to the
 * background whatever the page holds), `getLatest()` (its promise never settles with
 * an empty `updateUrl`) and every channel and stats method (Capgo's cloud).
 */
export interface NativeUpdaterPlugin {
  /** Confirms the boot of the running bundle, so it is not rolled back (D7). */
  notifyAppReady(): Promise<unknown>;
  /** Downloads a zip checked against `checksum`, a SHA-256, and lists it. */
  download(options: {
    url: string;
    version: string;
    checksum: string;
  }): Promise<unknown>;
  /** Switches to a downloaded bundle by the updater's own id and reloads at once. */
  set(options: { id: string }): Promise<void>;
  /** Returns to the APK's own bundle. */
  reset(): Promise<void>;
  /** The downloaded bundles: `{ bundles: [{ id, version, status, ... }] }`. */
  list(): Promise<unknown>;
  /** The running bundle: `{ bundle: { id, version, ... }, native }`. */
  current(): Promise<unknown>;
  /** The bundle the last rollback dropped, `{ bundle }`, once; then null. */
  getFailedUpdate(): Promise<unknown>;
}

/** The part of `@capawesome/capacitor-app-update` this app calls (velista `0180`, D12). */
export interface NativeAppUpdatePlugin {
  getAppUpdateInfo(): Promise<unknown>;
  startFlexibleUpdate(): Promise<unknown>;
  completeFlexibleUpdate(): Promise<void>;
  performImmediateUpdate(): Promise<unknown>;
  addListener(
    eventName: 'onFlexibleUpdateStateChange',
    listener: (state: unknown) => void
  ): Promise<NativeListenerHandle>;
}

/**
 * The app's own plugin that answers what the APK was built with (velista `0180`,
 * target 2), in `apps/velista/android` as `VelistaNativeInfoPlugin.java`:
 * `{ nativeApi, otaBaseUrl, otaPublicKey, builtinBundle }`.
 */
export interface NativeInfoPlugin {
  info(): Promise<unknown>;
}

/**
 * The part of the core `CapacitorHttp` plugin this app calls: a request made by
 * Android and not by the WebView, so it reaches the network even for the app's own
 * host (velista `0180`, D3).
 */
export interface NativeHttpPlugin {
  request(options: {
    url: string;
    method: 'GET';
    responseType: 'text';
  }): Promise<{ readonly status: number; readonly data: unknown }>;
}

export interface NativePlugins {
  readonly app: NativeAppPlugin;
  readonly share: NativeSharePlugin;
  readonly geolocation: NativeGeolocationPlugin;
  readonly browser: NativeBrowserPlugin;
  readonly systemBars: NativeSystemBarsPlugin;
  readonly google: NativeGooglePlugin;
  readonly updater: NativeUpdaterPlugin;
  readonly appUpdate: NativeAppUpdatePlugin;
  readonly nativeInfo: NativeInfoPlugin;
  readonly http: NativeHttpPlugin;
}

/**
 * The plugins, loaded on first use.
 *
 * A dynamic import and not a static one: importing `@capacitor/core` defines the
 * `Capacitor` global, and nothing may touch a browser global at module load (plan 0166,
 * SSR rule 1). Only the native branch ever calls this, so the web app never fetches
 * the chunk at all.
 */
export async function loadCapacitorPlugins(): Promise<NativePlugins> {
  const [
    { App },
    { Share },
    { Geolocation },
    { Browser },
    core,
    { CapacitorUpdater },
    { AppUpdate },
  ] = await Promise.all([
    import('@capacitor/app'),
    import('@capacitor/share'),
    import('@capacitor/geolocation'),
    import('@capacitor/browser'),
    import('@capacitor/core'),
    import('@capgo/capacitor-updater'),
    import('@capawesome/capacitor-app-update'),
  ]);

  return {
    app: App,
    share: Share,
    geolocation: Geolocation,
    browser: Browser,
    systemBars: {
      setStyle: ({ style }) =>
        core.SystemBars.setStyle({
          style:
            style === 'DARK'
              ? core.SystemBarsStyle.Dark
              : core.SystemBarsStyle.Light,
        }),
    },
    // Registered by name: the Java class is in the APK and has no npm package, so the
    // bridge is the only way to it. `MainActivity` registers the native half.
    google: core.registerPlugin<NativeGooglePlugin>('VelistaGoogle'),
    updater: CapacitorUpdater,
    appUpdate: AppUpdate,
    nativeInfo: core.registerPlugin<NativeInfoPlugin>('VelistaNativeInfo'),
    http: {
      request: (options) => core.CapacitorHttp.request(options),
    },
  };
}

/**
 * How the native providers reach Capacitor: the one DI seam, so every spec replaces
 * the plugins with hand built doubles instead of mocking the packages.
 *
 * One promise per injector, so the chunk is imported once however many providers ask.
 */
export const NATIVE_PLUGINS = new InjectionToken<() => Promise<NativePlugins>>(
  'NATIVE_PLUGINS',
  {
    providedIn: 'root',
    factory: () => {
      let loading: Promise<NativePlugins> | null = null;
      return () => (loading ??= loadCapacitorPlugins());
    },
  }
);
