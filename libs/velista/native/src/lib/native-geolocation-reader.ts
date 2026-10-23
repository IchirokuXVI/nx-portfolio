import { inject, Injectable } from '@angular/core';
import type {
  GeolocationReaderI,
  LocationOutcome,
  LocationPermission,
  LocationReadOptions,
} from '@portfolio/velista/platform';
import { NATIVE_PLUGINS } from './native-plugins';

/** The web reader's defaults (`geolocation-reader.ts`), so a call means the same in both. */
const TIMEOUT_MS = 10_000;
const MAX_AGE_MS = 60_000;

/**
 * The device's position through `@capacitor/geolocation` (plan 0167, D7).
 *
 * The WebView's Permissions API is not trusted to mirror the Android grant, and the
 * shop picker opens straight into its denied copy on what {@link permission} says.
 */
@Injectable({ providedIn: 'root' })
export class NativeGeolocationReader implements GeolocationReaderI {
  private readonly _plugins = inject(NATIVE_PLUGINS);

  async permission(): Promise<LocationPermission> {
    try {
      const { geolocation } = await this._plugins();
      const status = await geolocation.checkPermissions();
      switch (status.location) {
        case 'granted':
          return 'granted';
        case 'denied':
          return 'denied';
        default:
          return 'prompt';
      }
    } catch {
      // Thrown when the device has location turned off entirely: the grant is not
      // known, and pressing is how the person finds out.
      return 'unknown';
    }
  }

  async read(options: LocationReadOptions = {}): Promise<LocationOutcome> {
    try {
      const { geolocation } = await this._plugins();
      const position = await geolocation.getCurrentPosition({
        enableHighAccuracy: options.enableHighAccuracy ?? false,
        timeout: options.timeoutMs ?? TIMEOUT_MS,
        maximumAge: options.maximumAgeMs ?? MAX_AGE_MS,
      });
      return {
        state: 'located',
        point: {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          ...(options.withAccuracy === true
            ? { accuracyMetres: position.coords.accuracy }
            : {}),
        },
      };
    } catch (error: unknown) {
      return outcomeOf(error);
    }
  }
}

/**
 * The plugin's error codes, as the web reader's outcomes. A refused prompt (0003) and
 * an iOS restriction (0008) are `denied`; running out of time (0010) is `timed-out`;
 * everything else, location services off included, is `unavailable`, which unlike
 * `denied` does not end the feature.
 */
function outcomeOf(error: unknown): LocationOutcome {
  const code =
    typeof error === 'object' && error !== null
      ? (error as { code?: unknown }).code
      : undefined;
  switch (code) {
    case 'OS-PLUG-GLOC-0003':
    case 'OS-PLUG-GLOC-0008':
      return { state: 'denied' };
    case 'OS-PLUG-GLOC-0010':
      return { state: 'timed-out' };
    default:
      return { state: 'unavailable' };
  }
}
