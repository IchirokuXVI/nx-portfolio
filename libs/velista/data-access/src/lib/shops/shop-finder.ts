import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import type { NearbyShops, RecentShop } from '@portfolio/velista/models';
import {
  GEOLOCATION_READER,
  type GeolocationReaderI,
  type LocationReadOptions,
} from '@portfolio/velista/platform';
import {
  SHOP_FINDER_SERVICE,
  type NearbyPoint,
  type ShopFinderServiceI,
} from './shop-finder-service';

/**
 * How the shop picker asks the device where it is (velista `0103`).
 *
 * The satellite fix, because the question is which door and not which
 * neighbourhood; fifteen seconds, because a cold fix indoors is slow and a person
 * standing in a shop will wait that long and no longer; nothing cached, because a
 * fix from the street outside the last shop names the last shop. And the accuracy,
 * which the server judges the pick by.
 */
export const SHOP_FINDING_READ: LocationReadOptions = {
  enableHighAccuracy: true,
  timeoutMs: 15_000,
  maximumAgeMs: 0,
  withAccuracy: true,
};

/**
 * What the picker says about "Near me", one state per thing it draws.
 *
 * - `idle`: nothing asked yet. Nothing is drawn but the button.
 * - `locating`: the device, then the server, are being asked. "Finding you".
 * - `answered`: the server's answer, pick or no pick.
 * - `denied`, `timed-out`, `failed`: one line each, and the rest of the picker
 *   works as before. `failed` covers a device that could not place itself and a
 *   server that did not answer, which are the same sentence to the person.
 */
export type ShopFinding =
  | { readonly state: 'idle' }
  | { readonly state: 'locating' }
  | { readonly state: 'answered'; readonly answer: NearbyShops }
  | { readonly state: 'denied' }
  | { readonly state: 'timed-out' }
  | { readonly state: 'failed' };

/**
 * The accuracy sent when a browser reports a position without one.
 *
 * No browser this app runs in does, but a point with no stated accuracy is a
 * point nobody can vouch for, so the server is told it is wide. It then lists the
 * candidates and picks nothing (`LOW_ACCURACY`), which is the server deciding and
 * not this device.
 */
const UNKNOWN_ACCURACY_METRES = 100_000;

/**
 * "Near me" and the recent shops, for one open picker (velista `0103`).
 *
 * Provided on the container that draws the picker, so each opening starts idle and
 * a picker that closes takes its answer with it.
 *
 * ## Nothing is asked until somebody presses
 *
 * The constructor does nothing. {@link find} is called from the button and from
 * nowhere else, so the browser's prompt only ever follows a press, even when the
 * permission was granted long ago (velista `0058`).
 *
 * ## The coordinate is held for one call
 *
 * The point lives in {@link find}'s own variables, from the device's answer to the
 * request that carries it, and is dropped when the call returns. It is never put
 * in a signal, never written to storage and never logged. The answer that comes
 * back holds shops and distances, and no point.
 *
 * ## The server decides
 *
 * The answer is kept as it came. Whether it holds a pick is the server's word, and
 * the container acts on it; nothing here weighs a distance.
 */
@Injectable()
export class ShopFinder {
  private readonly _reader = inject<GeolocationReaderI>(GEOLOCATION_READER);
  private readonly _service = inject<ShopFinderServiceI>(SHOP_FINDER_SERVICE);

  private _destroyed = false;

  private readonly _finding = signal<ShopFinding>({ state: 'idle' });
  private readonly _recent = signal<readonly RecentShop[]>([]);

  /** Where "Near me" stands. See {@link ShopFinding}. */
  readonly finding = this._finding.asReadonly();

  /** The recent shops, newest first, or empty until and unless there are some. */
  readonly recent = this._recent.asReadonly();

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this._destroyed = true;
    });
  }

  /**
   * Ask the device where it is, then the server which shops are near.
   *
   * Resolves the server's answer, or null when there is none to act on: the
   * device refused or failed, the server failed, a search was already running, or
   * the picker closed while this was out. Never rejects.
   *
   * @param ask Which route to ask with the point. The basket's inside a basket,
   *   the catalog's in the get a list sheet.
   */
  async find(
    ask: (point: NearbyPoint) => Promise<NearbyShops>
  ): Promise<NearbyShops | null> {
    if (this._finding().state === 'locating') {
      // Pressing again while it works does nothing: the one search out is the
      // answer the second press was asking for.
      return null;
    }
    this._finding.set({ state: 'locating' });

    const outcome = await this._reader.read(SHOP_FINDING_READ);
    if (this._destroyed) {
      return null;
    }
    if (outcome.state !== 'located') {
      this._finding.set({
        state:
          outcome.state === 'denied'
            ? 'denied'
            : outcome.state === 'timed-out'
              ? 'timed-out'
              : 'failed',
      });
      return null;
    }

    let answer: NearbyShops;
    try {
      answer = await ask({
        latitude: outcome.point.latitude,
        longitude: outcome.point.longitude,
        accuracyMetres: outcome.point.accuracyMetres ?? UNKNOWN_ACCURACY_METRES,
      });
    } catch {
      // Nothing about the failure is logged: the request carried a coordinate,
      // and an error object is where a body ends up printed.
      if (!this._destroyed) {
        this._finding.set({ state: 'failed' });
      }
      return null;
    }

    if (this._destroyed) {
      return null;
    }
    this._finding.set({ state: 'answered', answer });
    return answer;
  }

  /**
   * Read the recent shops, once, for a signed in person.
   *
   * The container decides who is signed in and calls this only for them: a guest
   * never sees recent shops, so a guest is never asked for them either. A failure
   * leaves the section out, which is also what an empty answer does; the picker
   * below it works regardless.
   */
  async loadRecent(): Promise<void> {
    try {
      const shops = await this._service.recentShops();
      if (!this._destroyed) {
        this._recent.set(shops);
      }
    } catch {
      // No section, which is the picker as it was before velista `0103`.
    }
  }
}
