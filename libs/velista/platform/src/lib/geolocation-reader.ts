import { InjectionToken } from '@angular/core';

/**
 * Where the device says it is, in the two numbers this app has any use for.
 *
 * Nothing else off the browser's `GeolocationCoordinates` is carried: no accuracy, no
 * altitude, no heading, no speed. The one thing done with a point is turning it into a
 * postal code, and a field this app cannot spend is a field that ends up in a log line
 * somewhere (plan 0058, section 3.3).
 */
export interface DevicePoint {
  readonly latitude: number;
  readonly longitude: number;
}

/**
 * How a location request ended.
 *
 * Four outcomes and not a `Position | null`, because the screen draws four different
 * things and the difference between them is the whole of section 3.4:
 *
 * | | What the sheet says |
 * | --- | --- |
 * | `located` | the code that came back, and a confirm |
 * | `denied` | that we cannot ask again, and here is the field |
 * | `unavailable` | that the device could not place itself, and here is the field |
 * | `timed-out` | that it took too long, and it can be tried again |
 *
 * **`denied` is the one worth having separately.** It is sticky, the browser will not
 * prompt again, and nothing this app does can change that. Telling somebody to try
 * again there is telling them to press a button that cannot work.
 */
export type LocationOutcome =
  | { readonly state: 'located'; readonly point: DevicePoint }
  | { readonly state: 'denied' }
  | { readonly state: 'unavailable' }
  | { readonly state: 'timed-out' };

/**
 * What the browser will tell us about the permission **before** anybody presses.
 *
 * `unknown` covers both "this browser has no Permissions API" and "it has one and does
 * not answer for geolocation", which are the same thing to a caller: ask and find out.
 * It is never a reason to hide the control, only a reason not to promise what pressing
 * it will do.
 */
export type LocationPermission = 'granted' | 'prompt' | 'denied' | 'unknown';

/**
 * Reading the device's position, behind an interface (plan 0058, section 3.5).
 *
 * A token rather than `navigator.geolocation` reached directly, for the reason
 * `NOTIFICATION_TONE` and `SILENCE_DETECTOR` have one, and with a sharper edge here:
 * **jsdom has no geolocation at all**, so a spec that wants to know what the screen
 * does when permission is denied is otherwise unwritable. Every geolocation spec in
 * this app runs through this token with no browser API present.
 *
 * ## Nothing is read until somebody presses
 *
 * There is no constructor work and no read on injection, which is section 3.1: the
 * permission prompt is raised by `getCurrentPosition`, and raising it because a page
 * rendered is the pattern every browser penalises and every person refuses. {@link read}
 * is called from a press on a control that has already said what it is about to do.
 *
 * {@link permission} is the exception and is deliberately silent: the Permissions API
 * reports the state without prompting, which is what lets the sheet open straight into
 * its denied copy rather than offering a button that cannot work.
 */
export interface GeolocationReaderI {
  /**
   * What the browser already knows, without asking anybody.
   *
   * **Raises no prompt.** It resolves `unknown` rather than rejecting on a browser that
   * cannot answer, because "we could not find out" and "you have refused" must not be
   * the same value: one of them ends the feature.
   */
  permission(): Promise<LocationPermission>;

  /**
   * Ask the device where it is. **This is what raises the browser's prompt.**
   *
   * Never rejects. Every failure is one of the outcomes, because the screen has copy
   * for each of them and a thrown error would collapse four different sentences into
   * one apology.
   */
  read(): Promise<LocationOutcome>;
}

/**
 * How long to wait for a fix, in milliseconds.
 *
 * A phone that has just been asked cold can take several seconds to get a satellite
 * fix, and a person watching a sheet do nothing gives up long before a browser's own
 * default timeout (which is infinity) would fire. Ten seconds is long enough for a
 * cold fix indoors and short enough that the sheet says something rather than spinning.
 */
const TIMEOUT_MS = 10_000;

/**
 * How stale a cached fix may be, in milliseconds.
 *
 * A minute. The answer is turned into a postal code, so a position from a minute ago is
 * the same postal code as the one from now, and taking the cached fix is the difference
 * between an instant answer and ten seconds of waiting for a number that will not
 * change.
 */
const MAX_AGE_MS = 60_000;

/**
 * The real one, over `navigator.geolocation`.
 *
 * Rule D2: nothing happens at construction. It is safe to hold in a server rendered
 * injector and safe to resolve in jsdom, where there is no geolocation and every read
 * answers `unavailable` rather than throwing.
 */
export class BrowserGeolocationReader implements GeolocationReaderI {
  async permission(): Promise<LocationPermission> {
    const permissions = globalThis.navigator?.permissions;
    if (permissions === undefined) {
      return 'unknown';
    }

    try {
      const status = await permissions.query({ name: 'geolocation' });
      return status.state;
    } catch {
      // Safari once refused this query for `geolocation` specifically, and a browser
      // that will not say is not a browser that has refused: the control stays, and
      // pressing it is how we find out.
      return 'unknown';
    }
  }

  read(): Promise<LocationOutcome> {
    const geolocation = globalThis.navigator?.geolocation;
    if (geolocation === undefined) {
      return Promise.resolve({ state: 'unavailable' });
    }

    return new Promise<LocationOutcome>((resolve) => {
      geolocation.getCurrentPosition(
        (position) =>
          resolve({
            state: 'located',
            point: {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
            },
          }),
        (error) => resolve(outcomeOf(error)),
        {
          // Coarse is enough and cheaper: the answer is a postal code, and asking for
          // high accuracy spends the GPS and the battery to sharpen a number that is
          // rounded to a neighbourhood anyway.
          enableHighAccuracy: false,
          timeout: TIMEOUT_MS,
          maximumAge: MAX_AGE_MS,
        }
      );
    });
  }
}

/**
 * The browser's error, as one of ours.
 *
 * Read from the numeric codes rather than from the constants on the instance, because
 * a `GeolocationPositionError` reaching here from a polyfill or an older engine may
 * carry the codes and not the class. An unrecognised code reads as `unavailable`,
 * which is the honest answer and, unlike `denied`, does not end the feature.
 */
function outcomeOf(error: GeolocationPositionError): LocationOutcome {
  switch (error.code) {
    case 1:
      return { state: 'denied' };
    case 3:
      return { state: 'timed-out' };
    default:
      return { state: 'unavailable' };
  }
}

export const GEOLOCATION_READER = new InjectionToken<GeolocationReaderI>(
  'GEOLOCATION_READER',
  {
    providedIn: 'root',
    factory: () => new BrowserGeolocationReader(),
  }
);
