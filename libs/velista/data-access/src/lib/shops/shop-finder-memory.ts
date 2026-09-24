import { Injectable } from '@angular/core';
import type { NearbyShops, RecentShop } from '@portfolio/velista/models';
import type { NearbyPoint, ShopFinderServiceI } from './shop-finder-service';

/**
 * An in memory {@link ShopFinderServiceI} (velista `0103`), for specs and for a
 * run with no backend.
 *
 * Answers what it was told to and records **how many** times it was asked and on
 * which route, never the points: a fake that kept coordinates would be the one
 * place in the app that did, and a spec can prove what reached the route by the
 * call count and the answer it drew. Nothing nearby and no recent shops unless a
 * spec says otherwise, which is also what a brand new account sees.
 */
@Injectable()
export class ShopFinderMemory implements ShopFinderServiceI {
  /** What both nearby routes answer. */
  nearby: NearbyShops = { candidates: [], pick: null, noPick: 'NONE_NEARBY' };

  /** What the recent shops route answers, newest first. */
  recent: readonly RecentShop[] = [];

  /** Make the next nearby call fail, as a server that did not answer. */
  failNearby = false;

  /** The calls made, by route, in order. */
  readonly calls: ('basket' | 'profile' | 'recent')[] = [];

  /** The basket ids and profile ids asked about, in order. */
  readonly asked: (string | undefined)[] = [];

  /** Whether each nearby call carried an accuracy, which the server needs. */
  readonly accuracySent: boolean[] = [];

  async nearBasket(basketId: string, point: NearbyPoint): Promise<NearbyShops> {
    this.calls.push('basket');
    this.asked.push(basketId);
    return this._answer(point);
  }

  async nearProfile(
    point: NearbyPoint,
    profileId?: string
  ): Promise<NearbyShops> {
    this.calls.push('profile');
    this.asked.push(profileId);
    return this._answer(point);
  }

  async recentShops(): Promise<readonly RecentShop[]> {
    this.calls.push('recent');
    return this.recent;
  }

  private _answer(point: NearbyPoint): NearbyShops {
    this.accuracySent.push(Number.isFinite(point.accuracyMetres));
    if (this.failNearby) {
      throw new Error('nearby shops did not answer');
    }
    return this.nearby;
  }
}
