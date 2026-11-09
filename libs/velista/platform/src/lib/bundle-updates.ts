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
  private _applying: Promise<boolean> | null = null;
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
   * The document went hidden (D6, last paragraph). A waiting bundle applies now when
   * nothing holds a blocker: a `set()` while hidden drops nothing the person sees, so
   * a resume lands on the new bundle and never on a dropped form. A held blocker
   * skips it, and the bundle waits for the next idle navigation.
   */
  hidden(): void {
    if (this._ready !== null && !this._blocker.isBlocked()) {
      void this.applyNow();
    }
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

    const force = options.force === true;
    const running = this._check(force).catch((): OtaCheckOutcome => 'none');
    this._checkInFlight = running;
    void running.finally(() => {
      this._checkInFlight = null;
    });
    return running;
  }

  /**
   * Apply the waiting bundle now, past any blocker. False when none waits or the
   * updater could not switch to it, so a caller can go on to another way out.
   *
   * The updater's `set()`, or `reset()` for the built-in bundle, and never a plain
   * reload, which would load the running bundle again (D6). A call while an apply is
   * in flight starts none and answers what that apply answers, so a second caller
   * never reads "none waits" from the moment between the two.
   */
  applyNow(): Promise<boolean> {
    if (this._applying !== null) {
      return this._applying;
    }
    const ready = this._ready;
    if (ready === null) {
      return Promise.resolve(false);
    }
    this._ready = null;

    const applying = this._apply(ready);
    this._applying = applying;
    void applying.finally(() => {
      this._applying = null;
    });
    return applying;
  }

  private async _apply(ready: ReadyBundle): Promise<boolean> {
    try {
      const applied = ready.builtin
        ? await this._live.resetToBuiltin()
        : await this._live.apply(ready.bundle);
      return applied === true;
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

  /**
   * One check. `force` is a refusal's: its caller applies what it finds and goes on
   * to Play's immediate flow, so nothing here schedules an apply or a dialog for it.
   */
  private async _check(force: boolean): Promise<OtaCheckOutcome> {
    const outcome = await this._checkManifest(force);
    // Whatever the bundle answered, a newer native build on Play gets its one
    // flexible prompt per version code, when nothing forces the update (D9, Q6).
    if (!force) {
      await this._askFlexibleOnce();
    }
    return outcome;
  }

  private async _checkManifest(force: boolean): Promise<OtaCheckOutcome> {
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

    const outcome = await this._decide(manifest, info, base, force);
    // D8, follow the cluster: a bundle that this manifest does not name never applies.
    if (outcome !== 'ready') {
      this._ready = null;
    }
    return outcome;
  }

  private async _decide(
    manifest: OtaManifest,
    info: LiveUpdatesInfo,
    base: string,
    force: boolean
  ): Promise<OtaCheckOutcome> {
    // D7: a recorded failure is never downloaded again, and the record clears when
    // the manifest names another bundle. The native half answers each failure once,
    // so the record is written here before anything else is decided.
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
      return 'current';
    }

    // The APK already holds the bundle the cluster names, so nothing downloads.
    if (manifest.bundle === info.builtinBundle) {
      return this._becomeReady(
        { bundle: manifest.bundle, critical: manifest.critical, builtin: true },
        force
      );
    }

    // A bundle of an older manifest is not what the cluster names any more (D8).
    this._ready = null;

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

    // Nothing is queued with the updater's `next()`: on the device it applies at the
    // next move to the background with no regard for a held form (D6). The bundle
    // waits here for a navigation, a hidden document or, when critical, the blocker.
    // A process that dies loses it, and the next check downloads it again, which the
    // native half answers at once for a bundle it already holds.
    return this._becomeReady(
      { bundle: manifest.bundle, critical: manifest.critical, builtin: false },
      force
    );
  }

  private _becomeReady(ready: ReadyBundle, force: boolean): OtaCheckOutcome {
    this._ready = ready;
    // D6: a critical bundle applies as soon as nothing is held, without waiting for
    // a navigation. Through the blocker, never through a plain reload. A forced
    // check is a refusal's, whose caller applies past the blocker itself.
    if (ready.critical && !force) {
      this._blocker.whenIdle(() => void this.applyNow());
    }
    return 'ready';
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
