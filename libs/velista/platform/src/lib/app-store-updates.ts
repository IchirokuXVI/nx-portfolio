import { InjectionToken, signal, type Signal } from '@angular/core';

/** Where a flexible update stands, in this app's words and not the plugin's. */
export type AppStoreInstallStatus =
  | 'unknown'
  | 'pending'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'installed'
  | 'failed'
  | 'canceled';

/** What Google Play says about a newer native build (velista `0180`, D9). */
export interface AppStoreUpdateInfo {
  /** The version code Play offers, or null when it offers none. */
  readonly availableVersionCode: number | null;
  /** The version code of the installed APK, or null when Play cannot say. */
  readonly currentVersionCode: number | null;
  readonly flexibleAllowed: boolean;
  readonly immediateAllowed: boolean;
  readonly installStatus: AppStoreInstallStatus;
}

/**
 * Google Play In-App Updates, behind a seam that `libs/velista/native` provides
 * (velista `0180`, D9 and D12).
 *
 * Every method resolves and none throws. A phone with no Play services, a sideloaded
 * APK and the staging flavor all answer `info()` with null, and the app goes on to the
 * dead end face of plan `0072` when it has to.
 */
export interface AppStoreUpdatesI {
  /** True when a native implementation is bound at all. */
  available(): boolean;

  /** What Play offers, or null when Play cannot help. */
  info(): Promise<AppStoreUpdateInfo | null>;

  /**
   * Start a flexible update: Play's own dialog, then a download in the background.
   * True when the person accepted, false when they declined or Play refused.
   */
  startFlexible(): Promise<boolean>;

  /** Install a downloaded flexible update. Play restarts the app. */
  completeFlexible(): Promise<void>;

  /**
   * The immediate flow, a full screen the person cannot leave without updating. True
   * when the update went through, false when they cancelled or Play refused.
   */
  immediate(): Promise<boolean>;

  /** True once a flexible update finished downloading and waits for `completeFlexible()`. */
  readonly flexibleReady: Signal<boolean>;
}

/** Play of a host with none. What the web app and every spec get. */
export function unavailableAppStoreUpdates(): AppStoreUpdatesI {
  return {
    available: () => false,
    info: () => Promise.resolve(null),
    startFlexible: () => Promise.resolve(false),
    completeFlexible: () => Promise.resolve(),
    immediate: () => Promise.resolve(false),
    flexibleReady: signal(false).asReadonly(),
  };
}

/**
 * The store's in-app updates of the host. Unavailable by default from a root factory;
 * `provideNativeShell()` binds the native one when the runtime is `native`.
 */
export const APP_STORE_UPDATES = new InjectionToken<AppStoreUpdatesI>(
  'APP_STORE_UPDATES',
  {
    providedIn: 'root',
    factory: () => unavailableAppStoreUpdates(),
  }
);
