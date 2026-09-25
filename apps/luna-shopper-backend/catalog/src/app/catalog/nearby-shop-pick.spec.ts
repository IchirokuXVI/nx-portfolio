import { NearbyShopNoPick } from '@portfolio/luna-shopper/contracts';
import {
  NEARBY_SHOP_THRESHOLDS,
  pickNearbyShop,
  type PickCandidate,
} from './nearby-shop-pick';

/** A candidate in the profile and not refused, unless the row says otherwise. */
function shop(
  id: string,
  distanceMetres: number,
  flags: Partial<Pick<PickCandidate, 'inProfile' | 'excluded'>> = {}
): PickCandidate {
  return {
    id,
    distanceMetres,
    inProfile: flags.inProfile ?? true,
    excluded: flags.excluded ?? false,
  };
}

/**
 * The table of plan 0164, section 3, one row per case, plus the edges of every
 * threshold. `picked` is the id picked, or null when `noPick` is the answer.
 */
describe('pickNearbyShop (plan 0164, section 3)', () => {
  it('holds the thresholds the user set', () => {
    expect(NEARBY_SHOP_THRESHOLDS).toEqual({
      captureRadiusMetres: 750,
      singleCandidateLimitMetres: 500,
      clearNearestLimitMetres: 250,
      othersAtLeastMetres: 500,
      accuracyLimitMetres: 150,
    });
  });

  it.each<
    [string, number, PickCandidate[], string | null, NearbyShopNoPick | null]
  >([
    // accuracyMetres over 150: no pick, LOW_ACCURACY
    [
      'accuracy over 150',
      151,
      [shop('a', 20)],
      null,
      NearbyShopNoPick.LOW_ACCURACY,
    ],
    [
      'accuracy over 150, even with no candidate',
      400,
      [],
      null,
      NearbyShopNoPick.LOW_ACCURACY,
    ],
    ['accuracy of exactly 150 is not over it', 150, [shop('a', 20)], 'a', null],
    // no candidate: no pick, NONE_NEARBY
    ['no candidate', 10, [], null, NearbyShopNoPick.NONE_NEARBY],
    // one candidate, under 500 m: pick it
    ['one candidate under 500 m', 10, [shop('a', 499)], 'a', null],
    // one candidate, 500 m or more: no pick, AMBIGUOUS
    [
      'one candidate at 500 m',
      10,
      [shop('a', 500)],
      null,
      NearbyShopNoPick.AMBIGUOUS,
    ],
    [
      'one candidate at 750 m',
      10,
      [shop('a', 750)],
      null,
      NearbyShopNoPick.AMBIGUOUS,
    ],
    // several, the nearest under 250 m and every other at 500 m or more
    [
      'several, nearest under 250 m, others at 500 m or more',
      10,
      [shop('a', 249), shop('b', 500), shop('c', 700)],
      'a',
      null,
    ],
    [
      'several, given out of order',
      10,
      [shop('c', 700), shop('a', 120), shop('b', 510)],
      'a',
      null,
    ],
    // several, any other case: no pick, AMBIGUOUS
    [
      'several, nearest at 250 m',
      10,
      [shop('a', 250), shop('b', 600)],
      null,
      NearbyShopNoPick.AMBIGUOUS,
    ],
    [
      'several, another under 500 m',
      10,
      [shop('a', 100), shop('b', 499)],
      null,
      NearbyShopNoPick.AMBIGUOUS,
    ],
    [
      'several at the same distance',
      10,
      [shop('a', 100), shop('b', 100)],
      null,
      NearbyShopNoPick.AMBIGUOUS,
    ],
    // the shop the rows above pick has inProfile false: OUTSIDE_PROFILE
    [
      'the lone pick is outside the profile',
      10,
      [shop('a', 100, { inProfile: false })],
      null,
      NearbyShopNoPick.OUTSIDE_PROFILE,
    ],
    [
      'the clear nearest is outside the profile',
      10,
      [shop('a', 100, { inProfile: false }), shop('b', 600)],
      null,
      NearbyShopNoPick.OUTSIDE_PROFILE,
    ],
    [
      'an unclear nearest outside the profile is AMBIGUOUS, not OUTSIDE_PROFILE',
      10,
      [shop('a', 100, { inProfile: false }), shop('b', 300)],
      null,
      NearbyShopNoPick.AMBIGUOUS,
    ],
    // assumption confirmed by the user: a refused shop is never picked
    [
      'the lone candidate is refused by the profile',
      10,
      [shop('a', 100, { excluded: true })],
      null,
      NearbyShopNoPick.AMBIGUOUS,
    ],
    [
      'the clear nearest is refused by the profile',
      10,
      [shop('a', 100, { excluded: true }), shop('b', 600)],
      null,
      NearbyShopNoPick.AMBIGUOUS,
    ],
    [
      'a refused shop near the nearest still makes it unclear',
      10,
      [shop('a', 100), shop('b', 300, { excluded: true })],
      null,
      NearbyShopNoPick.AMBIGUOUS,
    ],
    [
      'a refused shop far enough away leaves the nearest clear',
      10,
      [shop('a', 100), shop('b', 600, { excluded: true })],
      'a',
      null,
    ],
    [
      'refused and outside the profile reads as refused',
      10,
      [shop('a', 100, { excluded: true, inProfile: false })],
      null,
      NearbyShopNoPick.AMBIGUOUS,
    ],
  ])('%s', (_case, accuracy, candidates, picked, reason) => {
    const answer = pickNearbyShop(accuracy, candidates);

    expect(answer.noPick).toBe(reason);
    expect(answer.pick?.locationId ?? null).toBe(picked);
    // Exactly one of the two is set.
    expect((answer.pick === null) !== (answer.noPick === null)).toBe(true);
    if (answer.pick) {
      const chosen = candidates.find((c) => c.id === answer.pick?.locationId);
      expect(answer.pick.distanceMetres).toBe(chosen?.distanceMetres);
    }
  });
});
