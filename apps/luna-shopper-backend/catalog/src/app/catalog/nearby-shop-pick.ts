import {
  NearbyShopNoPick,
  type NearbyShopPickView,
} from '@portfolio/luna-shopper/contracts';

/**
 * Every number the shops near a point are decided by (plan 0164, section 3),
 * as the user set them on 2026-09-24.
 *
 * In one place so that changing one is one line here and one table of tests in
 * `nearby-shop-pick.spec.ts`. Changing any of them is a decision the plan
 * reserves for the user.
 */
export const NEARBY_SHOP_THRESHOLDS = {
  /** A shop further than this from the point is not a candidate. */
  captureRadiusMetres: 750,
  /** A lone candidate is picked only when it is nearer than this. */
  singleCandidateLimitMetres: 500,
  /** Among several, the nearest is picked only when it is nearer than this... */
  clearNearestLimitMetres: 250,
  /** ...and every other candidate is at least this far away. */
  othersAtLeastMetres: 500,
  /** A point the device is less sure of than this picks nothing. */
  accuracyLimitMetres: 150,
} as const;

/** What the pick reads of a candidate. */
export interface PickCandidate {
  id: string;
  /** Whole metres, as the candidate is served. */
  distanceMetres: number;
  inProfile: boolean;
  excluded: boolean;
}

/** Exactly one of the two is set. */
export interface NearbyPick {
  pick: NearbyShopPickView | null;
  noPick: NearbyShopNoPick | null;
}

/**
 * Whether one of the candidates is clearly the shop the person is standing in
 * (plan 0164, section 3).
 *
 * Pure: the rule is a table and the spec is that table. It decides on the
 * rounded distances the client is shown, so a shop drawn at 500 m is never
 * picked as if it were under 500.
 *
 * The rows, in the order they apply:
 *
 * 1. `accuracyMetres` over the accuracy limit: `LOW_ACCURACY`.
 * 2. No candidate: `NONE_NEARBY`.
 * 3. One candidate under the single limit: that one. At or over it:
 *    `AMBIGUOUS`.
 * 4. Several, the nearest under the clear limit and every other at the others
 *    limit or further: the nearest. Anything else: `AMBIGUOUS`.
 * 5. A shop the rows above pick that the profile refuses is never picked:
 *    `AMBIGUOUS`. This is the assumption plan 0164 names, confirmed by the user.
 * 6. A shop the rows above pick that is outside the profile: `OUTSIDE_PROFILE`.
 *
 * Refused shops still count as candidates in rows 3 and 4: a refused shop next
 * door still makes the nearest one less certain.
 */
export function pickNearbyShop(
  accuracyMetres: number,
  candidates: readonly PickCandidate[]
): NearbyPick {
  const limits = NEARBY_SHOP_THRESHOLDS;
  if (accuracyMetres > limits.accuracyLimitMetres) {
    return noPick(NearbyShopNoPick.LOW_ACCURACY);
  }
  const ordered = [...candidates].sort(
    (a, b) => a.distanceMetres - b.distanceMetres || a.id.localeCompare(b.id)
  );
  const [nearest, ...others] = ordered;
  if (!nearest) {
    return noPick(NearbyShopNoPick.NONE_NEARBY);
  }

  const clear =
    others.length === 0
      ? nearest.distanceMetres < limits.singleCandidateLimitMetres
      : nearest.distanceMetres < limits.clearNearestLimitMetres &&
        others.every(
          (other) => other.distanceMetres >= limits.othersAtLeastMetres
        );
  if (!clear || nearest.excluded) {
    return noPick(NearbyShopNoPick.AMBIGUOUS);
  }
  if (!nearest.inProfile) {
    return noPick(NearbyShopNoPick.OUTSIDE_PROFILE);
  }
  return {
    pick: { locationId: nearest.id, distanceMetres: nearest.distanceMetres },
    noPick: null,
  };
}

function noPick(reason: NearbyShopNoPick): NearbyPick {
  return { pick: null, noPick: reason };
}
