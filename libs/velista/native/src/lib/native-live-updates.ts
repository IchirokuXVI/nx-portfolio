import { inject, Injectable } from '@angular/core';
import {
  BUILTIN_BUNDLE,
  type LiveUpdateDownload,
  type LiveUpdateFailure,
  type LiveUpdatesI,
  type LiveUpdatesInfo,
} from '@portfolio/velista/platform';
import { NATIVE_PLUGINS, type NativeUpdaterPlugin } from './native-plugins';

/** One entry of the updater's `list()`, read from `unknown` (rule D4). */
interface HeldBundle {
  /** The updater's own random id, which `set()` and `delete()` take. */
  readonly id: string;
  /** The `version` given to `download()`, which is the manifest's `bundle` (D8). */
  readonly version: string;
  readonly status: string;
}

/**
 * The states in which a listed bundle is whole on disk and can be switched to. A
 * bundle in `error` was rolled back (D7), and `downloading`, `deleting` and `deleted`
 * are not there to apply.
 */
const USABLE_STATUSES: ReadonlySet<string> = new Set(['pending', 'success']);

/**
 * The live update channel over `@capgo/capacitor-updater` in manual mode, Capacitor's
 * native HTTP and the app's own `VelistaNativeInfo` plugin (velista `0180`, target 5).
 *
 * Every method resolves and none throws: a plugin that rejects answers what an
 * unavailable updater answers, so a broken native half is "no OTA" and never an error
 * in the app. The rules (which bundle, when to apply) live in `BundleUpdates`; this
 * only translates.
 *
 * Measured on the emulator (the plan's "What the build decided"): `current()` names
 * the APK's own bundle by `id === 'builtin'`, with the APK's `versionName` as its
 * version; a downloaded bundle keeps the `version` it was downloaded under and gets
 * a random `id`. So the contract's bundle id is the updater's version, and `set()`
 * is given the id that `list()` pairs with it.
 */
@Injectable({ providedIn: 'root' })
export class NativeLiveUpdates implements LiveUpdatesI {
  private readonly _plugins = inject(NATIVE_PLUGINS);
  private _otaOff = false;
  private _confirmed: Promise<void> | null = null;

  /**
   * True inside the native shell until `info()` has said the APK has no OTA channel
   * (an empty `otaBaseUrl`) or could not answer. `BundleUpdates` reads `info()`
   * itself and checks nothing when the base is empty, so this only mirrors it.
   */
  available(): boolean {
    return !this._otaOff;
  }

  async info(): Promise<LiveUpdatesInfo | null> {
    let answer: unknown;
    try {
      const { nativeInfo } = await this._plugins();
      answer = await nativeInfo.info();
    } catch {
      this._otaOff = true;
      return null;
    }

    const info = infoFrom(answer);
    this._otaOff = info === null || info.otaBaseUrl === '';
    return info;
  }

  async current(): Promise<string | null> {
    try {
      const { updater } = await this._plugins();
      const answer = field(await updater.current(), 'bundle');
      const id = field(answer, 'id');
      if (id === BUILTIN_BUNDLE) {
        // Its `version` is the APK's versionName, not the bundle id (D8): the
        // orchestrator reads `info().builtinBundle` for it.
        return BUILTIN_BUNDLE;
      }
      const version = field(answer, 'version');
      return typeof version === 'string' && version !== '' ? version : null;
    } catch {
      return null;
    }
  }

  /**
   * Over `CapacitorHttp`, never the WebView `fetch`, which Capacitor's local server
   * answers from the bundle for the app's own host (D3).
   *
   * The signature covers exact bytes (D5), and two Android behaviors measured on the
   * emulator change them. `responseType: 'text'` reads the body line by line and drops
   * the manifest's final line break, so the body is asked for as `arraybuffer`, which
   * Android answers as base64 of the exact bytes, and decoded here as UTF-8. And
   * Android parses every body whose `Content-Type` names JSON, whatever the response
   * type asks; no re-serialization gives the signed bytes back, so such a body answers
   * null. velista's nginx serves the manifest as `text/plain` for that reason.
   */
  async fetchText(url: string): Promise<string | null> {
    try {
      const { http } = await this._plugins();
      const response = await http.request({
        url,
        method: 'GET',
        responseType: 'arraybuffer',
      });
      if (response.status !== 200 || typeof response.data !== 'string') {
        return null;
      }
      return utf8FromBase64(response.data);
    } catch {
      return null;
    }
  }

  async download(request: LiveUpdateDownload): Promise<boolean> {
    try {
      const { updater } = await this._plugins();
      // A bundle already on disk answers at once, with no second download: the app
      // queues nothing with the updater, so a new document asks for it again (D6).
      if ((await usableBundle(updater, request.bundle)) !== null) {
        return true;
      }
      // A wrong checksum rejects ("Failed to download from"), and the updater deletes
      // the zip before it is listed.
      await updater.download({
        url: request.url,
        version: request.bundle,
        checksum: request.sha256,
      });
      return true;
    } catch {
      return false;
    }
  }

  async apply(bundle: string): Promise<void> {
    try {
      const { updater } = await this._plugins();
      const held = await usableBundle(updater, bundle);
      if (held === null) {
        return;
      }
      // Reloads into the bundle at once.
      await updater.set({ id: held.id });
    } catch {
      // The running bundle stays.
    }
  }

  async resetToBuiltin(): Promise<void> {
    try {
      const { updater } = await this._plugins();
      await updater.reset();
    } catch {
      // The running bundle stays.
    }
  }

  /** `notifyAppReady()`, once per document however many callers ask (D7). */
  confirmBoot(): Promise<void> {
    return (this._confirmed ??= this._confirm());
  }

  /**
   * The updater answers the last rollback once and then null, and the platform
   * records it on first read, so nothing is cached here. `list()` is not read: an
   * entry in `error` lives only until `autoDeleteFailed` removes it, about 20 s.
   */
  async failedBundles(): Promise<readonly LiveUpdateFailure[]> {
    try {
      const { updater } = await this._plugins();
      const version = field(
        field(await updater.getFailedUpdate(), 'bundle'),
        'version'
      );
      return typeof version === 'string' && version !== ''
        ? [{ bundle: version }]
        : [];
    } catch {
      return [];
    }
  }

  private async _confirm(): Promise<void> {
    try {
      const { updater } = await this._plugins();
      await updater.notifyAppReady();
    } catch {
      // Without the call the updater rolls back, which is the safe side.
    }
  }
}

/** The listed bundle downloaded under `version` and whole on disk, or null. */
async function usableBundle(
  updater: NativeUpdaterPlugin,
  version: string
): Promise<HeldBundle | null> {
  const bundles = field(await updater.list(), 'bundles');
  if (!Array.isArray(bundles)) {
    return null;
  }
  for (const entry of bundles) {
    const held = heldFrom(entry);
    if (
      held !== null &&
      held.version === version &&
      USABLE_STATUSES.has(held.status)
    ) {
      return held;
    }
  }
  return null;
}

function heldFrom(entry: unknown): HeldBundle | null {
  const id = field(entry, 'id');
  const version = field(entry, 'version');
  const status = field(entry, 'status');
  return typeof id === 'string' &&
    id !== '' &&
    typeof version === 'string' &&
    typeof status === 'string'
    ? { id, version, status }
    : null;
}

/** The answer of `VelistaNativeInfo.info()`, or null when any field is off. */
function infoFrom(answer: unknown): LiveUpdatesInfo | null {
  const nativeApi = field(answer, 'nativeApi');
  const otaBaseUrl = field(answer, 'otaBaseUrl');
  const otaPublicKey = field(answer, 'otaPublicKey');
  const builtinBundle = field(answer, 'builtinBundle');
  if (
    typeof nativeApi !== 'number' ||
    !Number.isInteger(nativeApi) ||
    nativeApi < 1 ||
    typeof otaBaseUrl !== 'string' ||
    typeof otaPublicKey !== 'string' ||
    typeof builtinBundle !== 'string' ||
    builtinBundle === ''
  ) {
    return null;
  }
  return { nativeApi, otaBaseUrl, otaPublicKey, builtinBundle };
}

/**
 * The text of a body that Android sent as base64 (with a line break every 76
 * characters), or null when it is not base64 or not UTF-8.
 */
function utf8FromBase64(encoded: string): string | null {
  try {
    const binary = atob(encoded.replace(/\s+/g, ''));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      bytes
    );
  } catch {
    return null;
  }
}

function field(value: unknown, name: string): unknown {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)[name]
    : undefined;
}
