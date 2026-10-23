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
  getLaunchUrl(): Promise<{ readonly url: string } | undefined>;
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

export interface NativePlugins {
  readonly app: NativeAppPlugin;
  readonly share: NativeSharePlugin;
  readonly geolocation: NativeGeolocationPlugin;
  readonly browser: NativeBrowserPlugin;
  readonly systemBars: NativeSystemBarsPlugin;
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
  const [{ App }, { Share }, { Geolocation }, { Browser }, core] =
    await Promise.all([
      import('@capacitor/app'),
      import('@capacitor/share'),
      import('@capacitor/geolocation'),
      import('@capacitor/browser'),
      import('@capacitor/core'),
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
