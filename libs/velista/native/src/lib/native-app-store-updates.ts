import { inject, Injectable, signal } from '@angular/core';
import type {
  AppStoreInstallStatus,
  AppStoreUpdateInfo,
  AppStoreUpdatesI,
} from '@portfolio/velista/platform';
import { NATIVE_PLUGINS } from './native-plugins';

/**
 * Play's `UpdateAvailability`, as the plugin passes it through. Only these two mean
 * that Play holds a newer build: available, or an update already in progress.
 */
const UPDATE_AVAILABLE = 2;
const UPDATE_IN_PROGRESS = 3;

/** Play's `InstallStatus` codes, in this app's words. */
const INSTALL_STATUSES: ReadonlyMap<number, AppStoreInstallStatus> = new Map([
  [0, 'unknown'],
  [1, 'pending'],
  [2, 'downloading'],
  [3, 'installing'],
  [4, 'installed'],
  [5, 'failed'],
  [6, 'canceled'],
  [11, 'downloaded'],
]);

/** The plugin's `AppUpdateResultCode.OK`: the person accepted, or the update ran. */
const RESULT_OK = 0;

/**
 * Google Play In-App Updates over `@capawesome/capacitor-app-update` (velista
 * `0180`, D9 and D12).
 *
 * Every method resolves. Play answers an APK it did not install (the staging flavor,
 * a sideloaded build, a phone with no Play services) with a rejection, which is read
 * as "Play cannot help": `info()` null, the flows false.
 */
@Injectable({ providedIn: 'root' })
export class NativeAppStoreUpdates implements AppStoreUpdatesI {
  private readonly _plugins = inject(NATIVE_PLUGINS);
  private readonly _flexibleReady = signal(false);
  private _listening: Promise<void> | null = null;

  readonly flexibleReady = this._flexibleReady.asReadonly();

  constructor() {
    // Listened to from the start, so a download that finishes while the person uses
    // the app is seen at the next idle navigation.
    void this._listen();
  }

  available(): boolean {
    return true;
  }

  async info(): Promise<AppStoreUpdateInfo | null> {
    let answer: unknown;
    try {
      const { appUpdate } = await this._plugins();
      answer = await appUpdate.getAppUpdateInfo();
    } catch {
      return null;
    }
    if (typeof answer !== 'object' || answer === null) {
      return null;
    }

    const raw = answer as Record<string, unknown>;
    const availability = raw['updateAvailability'];
    const offered =
      availability === UPDATE_AVAILABLE || availability === UPDATE_IN_PROGRESS;
    const installStatus = installStatusFrom(raw['installStatus']);
    // A flexible update downloaded in an earlier session waits for its install. Any
    // other status clears the signal, so a stale true does not survive this answer.
    this._flexibleReady.set(installStatus === 'downloaded');

    return {
      availableVersionCode: offered
        ? versionCodeFrom(raw['availableVersionCode'])
        : null,
      currentVersionCode: versionCodeFrom(raw['currentVersionCode']),
      flexibleAllowed: raw['flexibleUpdateAllowed'] === true,
      immediateAllowed: raw['immediateUpdateAllowed'] === true,
      installStatus,
    };
  }

  async startFlexible(): Promise<boolean> {
    try {
      const { appUpdate } = await this._plugins();
      return resultOk(await appUpdate.startFlexibleUpdate());
    } catch {
      return false;
    }
  }

  async completeFlexible(): Promise<void> {
    try {
      const { appUpdate } = await this._plugins();
      await appUpdate.completeFlexibleUpdate();
    } catch {
      // The download stays, and the next idle navigation asks again.
    }
  }

  async immediate(): Promise<boolean> {
    try {
      const { appUpdate } = await this._plugins();
      return resultOk(await appUpdate.performImmediateUpdate());
    } catch {
      return false;
    }
  }

  private _listen(): Promise<void> {
    return (this._listening ??= this._plugins()
      .then(({ appUpdate }) =>
        appUpdate.addListener('onFlexibleUpdateStateChange', (state) => {
          const status = installStatusFrom(
            typeof state === 'object' && state !== null
              ? (state as Record<string, unknown>)['installStatus']
              : undefined
          );
          this._flexibleReady.set(status === 'downloaded');
        })
      )
      .then(() => undefined)
      .catch(() => undefined));
  }
}

function installStatusFrom(value: unknown): AppStoreInstallStatus {
  return typeof value === 'number'
    ? (INSTALL_STATUSES.get(value) ?? 'unknown')
    : 'unknown';
}

/** The plugin passes version codes as strings. A code that does not parse is none. */
function versionCodeFrom(value: unknown): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/.test(value)
        ? Number(value)
        : NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function resultOk(answer: unknown): boolean {
  return (
    typeof answer === 'object' &&
    answer !== null &&
    (answer as Record<string, unknown>)['code'] === RESULT_OK
  );
}
