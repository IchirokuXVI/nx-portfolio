import { inject, Injectable, InjectionToken } from '@angular/core';
import { APP_STORE_UPDATES } from './app-store-updates';
import { BrowserFacade } from './browser-facade';
import {
  BUILTIN_BUNDLE,
  LIVE_UPDATES,
  type LiveUpdateFailure,
  type LiveUpdatesInfo,
} from './live-updates';
import {
  OTA_MANIFEST_FILE,
  OTA_SIGNATURE_FILE,
  parseOtaManifest,
  verifyOtaManifest,
  type OtaManifest,
} from './ota-manifest';
import { ReloadBlocker } from './reload-blocker';
import { StorageKeys } from './storage-keys';

/** The shortest gap between two manifest checks that nothing forces (D6). */
export const OTA_CHECK_INTERVAL_MS = 10 * 60 * 1000;

/** How a manifest is judged. A seam so a spec can verify without WebCrypto. */
export type OtaManifestVerifier = (
  bytes: string,
  signature: string,
  publicKeyPem: string
) => Promise<boolean>;

/** The verifier `BundleUpdates` uses. WebCrypto ECDSA P-256 by default (D5). */
export const OTA_MANIFEST_VERIFIER = new InjectionToken<OtaManifestVerifier>(
  'OTA_MANIFEST_VERIFIER',
  {
    providedIn: 'root',
    factory: () => verifyOtaManifest,
  }
);

/**
 * What one check found.
 *
 * - `skipped`: within ten minutes of the last check, and nothing forced this one.
 * - `none`: no channel, no manifest, a bad signature, a refused manifest or download.
 * - `current`: the manifest names the running bundle.
 * - `failed`: the manifest names a bundle this device recorded as failed (D7).
 * - `needs-native`: the bundle needs a newer `nativeApi` than the APK has (D4).
 * - `ready`: a bundle is downloaded, or the built-in one is named, and waits to apply.
 */
export type OtaCheckOutcome =
  | 'skipped'
  | 'none'
  | 'current'
  | 'failed'
  | 'needs-native'
  | 'ready';

/** A bundle waiting to apply. `builtin` applies with `reset()` and not `set()` (D8). */
interface ReadyBundle {
  readonly bundle: string;
  readonly critical: boolean;
  readonly builtin: boolean;
}

/**
 * The rules of the Android app's own web bundle (velista `0180`, D6 to D9), with
 * nothing native in it: the updater and Google Play are reached only through
 * {@link LIVE_UPDATES} and {@link APP_STORE_UPDATES}.
 *
 * `AppUpdates` owns the triggers (a navigation, a resume, a refusal) and calls in
 * here inside the native shell only. On the web nothing injects this, so neither
 * token is ever touched there.
 */
@Injectable({ providedIn: 'root' })
export class BundleUpdates {
  private readonly _live = inject(LIVE_UPDATES);
  private readonly _store = inject(APP_STORE_UPDATES);
  private readonly _verify = inject(OTA_MANIFEST_VERIFIER);
  private readonly _browser = inject(BrowserFacade);
  private readonly _blocker = inject(ReloadBlocker);

  private _info: Promise<LiveUpdatesInfo | null> | null = null;
  private _checkInFlight: Promise<OtaCheckOutcome> | null = null;
  private _lastCheckAt: number | null = null;
  private _ready: ReadyBundle | null = null;
  private _navigated = false;

  /** True when a verified bundle is downloaded and waits to apply. */
  hasReadyBundle(): boolean {
    return this._ready !== null;
  }

  /**
   * A completed navigation (D6).
   *
   * The first one of a cold start asks for the manifest. Every later one applies a
   * waiting bundle when nothing holds a blocker, which is the moment of plan `0013`
   * section 6.4, and completes a downloaded flexible update at the same moment,
   * because it restarts the app (D9).
   */
  navigated(): void {
    if (!this._navigated) {
      this._navigated = true;
      void this.check();
      return;
    }

    if (this._ready !== null) {
      this._blocker.whenIdle(() => void this.applyNow());
      return;
    }

    if (this._store.flexibleReady()) {
      this._blocker.whenIdle(() => void this._completeFlexible());
    }
  }

  /** The app came back (D6). The ten minute floor of {@link check} applies. */
  resumed(): void {
    void this.check();
  }

  /**
   * Ask for the manifest, verify it, and download the bundle it names when this
   * device may apply it. At most one check in flight, and at most one per
   * {@link OTA_CHECK_INTERVAL_MS} unless `force`, which only a refusal passes.
   *
   * Never rejects. A failure anywhere is `none`, the same answer as no update.
   */
  check(options: { force?: boolean } = {}): Promise<OtaCheckOutcome> {
    if (this._checkInFlight !== null) {
      return this._checkInFlight;
    }

    const now = Date.now();
    if (
      options.force !== true &&
      this._lastCheckAt !== null &&
      now - this._lastCheckAt < OTA_CHECK_INTERVAL_MS
    ) {
      return Promise.resolve('skipped');
    }
    this._lastCheckAt = now;

    const running = this._check().catch((): OtaCheckOutcome => 'none');
    this._checkInFlight = running;
    void running.finally(() => {
      this._checkInFlight = null;
    });
    return running;
  }

  /**
   * Apply the waiting bundle now, past any blocker. False when none waits.
   *
   * The updater's `set()`, or `reset()` for the built-in bundle, and never a plain
   * reload, which would load the running bundle again (D6).
   */
  async applyNow(): Promise<boolean> {
    const ready = this._ready;
    if (ready === null) {
      return false;
    }
    this._ready = null;

    try {
      if (ready.builtin) {
        await this._live.resetToBuiltin();
      } else {
        await this._live.apply(ready.bundle);
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * The immediate in-app update, for a build the server refuses and no bundle fits
   * (D9). True when Play took it, false when Play cannot help or the person left it.
   */
  async immediateUpdate(): Promise<boolean> {
    try {
      const info = await this._store.info();
      if (
        info === null ||
        !info.immediateAllowed ||
        !this._newerCode(info.availableVersionCode, info.currentVersionCode)
      ) {
        return false;
      }
      return await this._store.immediate();
    } catch {
      return false;
    }
  }

  private async _check(): Promise<OtaCheckOutcome> {
    const outcome = await this._checkManifest();
    // Whatever the bundle answered, a newer native build on Play gets its one
    // flexible prompt per version code (D9, Q6).
    await this._askFlexibleOnce();
    return outcome;
  }

  private async _checkManifest(): Promise<OtaCheckOutcome> {
    const info = await this._infoOnce();
    if (info === null || info.otaBaseUrl === '' || info.otaPublicKey === '') {
      return 'none';
    }

    const base = info.otaBaseUrl.endsWith('/')
      ? info.otaBaseUrl
      : `${info.otaBaseUrl}/`;
    const [text, signature] = await Promise.all([
      this._live.fetchText(new URL(OTA_MANIFEST_FILE, base).href),
      this._live.fetchText(new URL(OTA_SIGNATURE_FILE, base).href),
    ]);

    // Verified before it is parsed: nothing the signature does not cover is read (D5).
    // An unsigned manifest is ignored.
    if (text === null || signature === null) {
      return 'none';
    }
    if (!(await this._verify(text, signature, info.otaPublicKey))) {
      return 'none';
    }

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return 'none';
    }
    const manifest = parseOtaManifest(raw);
    if (manifest === null) {
      return 'none';
    }

    return this._decide(manifest, info, base);
  }

  private async _decide(
    manifest: OtaManifest,
    info: LiveUpdatesInfo,
    base: string
  ): Promise<OtaCheckOutcome> {
    // D7: a recorded failure is never downloaded again, and the record clears when
    // the manifest names another bundle.
    const failed = await this._recordFailures();
    if (failed.includes(manifest.bundle)) {
      return 'failed';
    }
    if (failed.length > 0) {
      this._browser.removeStorage(StorageKeys.failedBundles);
    }

    if (this._ready?.bundle === manifest.bundle) {
      return 'ready';
    }

    // D8: an id that differs is applied, without ordering the two.
    const current = await this._live.current();
    const running = current === BUILTIN_BUNDLE ? info.builtinBundle : current;
    if (running === null) {
      return 'none';
    }
    if (running === manifest.bundle) {
      this._ready = null;
      return 'current';
    }

    // The APK already holds the bundle the cluster names, so nothing downloads.
    if (manifest.bundle === info.builtinBundle) {
      return this._becomeReady({
        bundle: manifest.bundle,
        critical: manifest.critical,
        builtin: true,
      });
    }

    // D4 and Q8: a bundle the APK cannot run waits for Play. Nothing is broken yet,
    // so the app goes on with its bundle and Play gets a flexible prompt.
    if (manifest.nativeApi > info.nativeApi) {
      return 'needs-native';
    }

    const downloaded = await this._live.download({
      bundle: manifest.bundle,
      url: new URL(manifest.url, base).href,
      sha256: manifest.sha256,
    });
    if (!downloaded) {
      return 'none';
    }

    await this._afterDownload(manifest.bundle);
    return this._becomeReady({
      bundle: manifest.bundle,
      critical: manifest.critical,
      builtin: false,
    });
  }

  private _becomeReady(ready: ReadyBundle): OtaCheckOutcome {
    this._ready = ready;
    // D6: a critical bundle applies as soon as nothing is held, without waiting for
    // a navigation. Through the blocker, never through a plain reload.
    if (ready.critical) {
      this._blocker.whenIdle(() => void this.applyNow());
    }
    return 'ready';
  }

  /**
   * What happens to a bundle the moment its download completes (D6, last
   * paragraph). **Depends on target 1**: if `next()` in manual mode also applies on a
   * move to the background, this moves to a background hook that runs only while the
   * blocker is free. Until then the default: mark it for the next cold start at once.
   */
  private async _afterDownload(bundle: string): Promise<void> {
    try {
      await this._live.applyAtNextStart(bundle);
    } catch {
      // The navigation path still applies it.
    }
  }

  /**
   * The failures the updater reports, added to the record, and the whole record.
   * The record is the device's memory: the updater may delete a failed bundle and
   * forget it (`autoDeleteFailed`), and the id must stay refused after that.
   */
  private async _recordFailures(): Promise<readonly string[]> {
    const stored = this._readFailedRecord();
    let reported: readonly string[] = [];
    try {
      reported = this._failedIdsFrom(await this._live.failedBundles());
    } catch {
      reported = [];
    }

    const merged = [...new Set([...stored, ...reported])];
    if (merged.length !== stored.length) {
      this._browser.writeStorage(
        StorageKeys.failedBundles,
        JSON.stringify(merged)
      );
    }
    return merged;
  }

  /**
   * The bundle ids of the updater's failure records. **Depends on target 1**, which
   * learns what the `updateFailed` event and a `list()` entry in error carry. The
   * default reads the `bundle` the native half maps each one to, and drops the
   * built-in bundle, which is never downloaded and so never refused.
   */
  private _failedIdsFrom(failures: readonly LiveUpdateFailure[]): string[] {
    return failures
      .map((failure) => failure.bundle)
      .filter(
        (bundle): bundle is string =>
          typeof bundle === 'string' &&
          bundle !== '' &&
          bundle !== BUILTIN_BUNDLE
      );
  }

  private _readFailedRecord(): string[] {
    const raw = this._browser.readStorage(StorageKeys.failedBundles);
    if (raw === null) {
      return [];
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === 'string')
        : [];
    } catch {
      return [];
    }
  }

  /** The flexible prompt, once per available version code (D9, Q6). */
  private async _askFlexibleOnce(): Promise<void> {
    try {
      const info = await this._store.info();
      if (
        info === null ||
        !info.flexibleAllowed ||
        info.availableVersionCode === null ||
        !this._newerCode(info.availableVersionCode, info.currentVersionCode)
      ) {
        return;
      }

      const code = String(info.availableVersionCode);
      if (this._browser.readStorage(StorageKeys.flexibleUpdateAsked) === code) {
        return;
      }
      // Recorded before the dialog, so a person who declines is not asked again.
      this._browser.writeStorage(StorageKeys.flexibleUpdateAsked, code);
      await this._store.startFlexible();
    } catch {
      // Play could not help. The app goes on with its bundle.
    }
  }

  private async _completeFlexible(): Promise<void> {
    try {
      await this._store.completeFlexible();
    } catch {
      // The download stays; the next navigation tries again.
    }
  }

  private _newerCode(
    available: number | null,
    current: number | null
  ): boolean {
    return available !== null && current !== null && available > current;
  }

  /** Read once, as it is compiled into the APK. A failed read is asked again. */
  private _infoOnce(): Promise<LiveUpdatesInfo | null> {
    this._info ??= this._live
      .info()
      .catch(() => null)
      .then((info) => {
        if (info === null) {
          this._info = null;
        }
        return info;
      });
    return this._info;
  }
}
