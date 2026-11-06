import { InjectionToken } from '@angular/core';

/**
 * The id the updater gives the bundle the APK was built with (velista `0180`, D1 and
 * D8). `current()` answers it while that bundle runs; the real id of that bundle is
 * {@link LiveUpdatesInfo.builtinBundle}.
 */
export const BUILTIN_BUNDLE = 'builtin';

/** What the native layer knows about itself, compiled into the APK (D4, D5, D8). */
export interface LiveUpdatesInfo {
  /** The native compatibility key of the installed APK (D4). A positive integer. */
  readonly nativeApi: number;
  /**
   * Where this flavor's OTA files live, ending in `/`, for example
   * `https://velista.app/ota/android/`. Empty when the APK was built with no OTA
   * channel (a slot build, or `--no-ota`), and an empty base means no check at all.
   */
  readonly otaBaseUrl: string;
  /** The flavor's public key as a PEM SPKI (D5). Rotation is a native release. */
  readonly otaPublicKey: string;
  /** The id of the built-in bundle, `<version>+<12 characters of the commit>` (D8). */
  readonly builtinBundle: string;
}

/** One bundle to download, named by the manifest that the app already verified. */
export interface LiveUpdateDownload {
  /** The manifest's `bundle`. The updater keeps it as the bundle's version (D8). */
  readonly bundle: string;
  /** The absolute URL of the zip. */
  readonly url: string;
  /** The SHA-256 of the zip, 64 lowercase hex characters. The updater refuses others. */
  readonly sha256: string;
}

/**
 * A bundle that did not confirm its boot and was rolled back (D7).
 *
 * The id is the one the bundle was downloaded under, which is the manifest's
 * `bundle`. `reason` is whatever the updater says, for a log; nothing decides on it.
 */
export interface LiveUpdateFailure {
  readonly bundle: string;
  readonly reason?: string;
}

/**
 * The native updater, behind a seam that `libs/velista/native` provides (velista
 * `0180`, target state item 4).
 *
 * Every method resolves and none throws: a plugin that rejects answers as an
 * unavailable updater would (`null`, `false` or an empty list), so a broken native
 * half degrades to "no OTA" and never into the app. The platform half
 * (`BundleUpdates`) still guards each call, because a double or a future binding may
 * not keep that promise.
 */
export interface LiveUpdatesI {
  /** True when a native updater is bound at all. False on the web and in specs. */
  available(): boolean;

  /** The facts of the installed APK, or null when the native plugin cannot answer. */
  info(): Promise<LiveUpdatesInfo | null>;

  /**
   * The id of the running bundle (D8): the `bundle` that `download()` was given, or
   * {@link BUILTIN_BUNDLE} for the APK's own. Null when the updater cannot say.
   */
  current(): Promise<string | null>;

  /**
   * The body of a URL as text, over native HTTP and never the WebView `fetch` (D3),
   * or null on any failure: no network, a status other than 200, a body that is not
   * text.
   */
  fetchText(url: string): Promise<string | null>;

  /**
   * Download a zip in the background, checked against its SHA-256. True once the
   * bundle is stored and ready to apply, false when the updater refused or failed.
   */
  download(request: LiveUpdateDownload): Promise<boolean>;

  /** Switch to a downloaded bundle now. The updater's `set()`, which reloads (D6). */
  apply(bundle: string): Promise<void>;

  /** Switch to a downloaded bundle at the next cold start. The updater's `next()`. */
  applyAtNextStart(bundle: string): Promise<void>;

  /** Return to the APK's own bundle. The updater's `reset()` (D8). */
  resetToBuiltin(): Promise<void>;

  /** Tell the updater this bundle booted, so it is kept (D7). `notifyAppReady()`. */
  confirmBoot(): Promise<void>;

  /** The bundles the updater rolled back because they never confirmed a boot (D7). */
  failedBundles(): Promise<readonly LiveUpdateFailure[]>;
}

/**
 * The updater of a host with none: everything unavailable, nothing thrown. What the
 * web app, a server render and every spec get without providing anything.
 */
export const UNAVAILABLE_LIVE_UPDATES: LiveUpdatesI = {
  available: () => false,
  info: () => Promise.resolve(null),
  current: () => Promise.resolve(null),
  fetchText: () => Promise.resolve(null),
  download: () => Promise.resolve(false),
  apply: () => Promise.resolve(),
  applyAtNextStart: () => Promise.resolve(),
  resetToBuiltin: () => Promise.resolve(),
  confirmBoot: () => Promise.resolve(),
  failedBundles: () => Promise.resolve([]),
};

/**
 * The live update channel of the host. Unavailable by default from a root factory;
 * `provideNativeShell()` binds the native one when the runtime is `native`.
 */
export const LIVE_UPDATES = new InjectionToken<LiveUpdatesI>('LIVE_UPDATES', {
  providedIn: 'root',
  factory: () => UNAVAILABLE_LIVE_UPDATES,
});
