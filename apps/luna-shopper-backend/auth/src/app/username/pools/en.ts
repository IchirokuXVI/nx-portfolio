import type { AdjectiveEntry, NounEntry, UsernamePool } from '../pool';

/**
 * The English name pool (plan 0018, section 3.2). Nautical by meaning: parts of a
 * boat, sailing actions, sea and weather, navigation, knots and sea creatures.
 *
 * Written independently of the Spanish pool rather than translated from it, which
 * is what keeps the two disjoint: a generated name is never translated at read
 * time, so a word that exists in both pools would make the name's language depend
 * on who drew it. A spec asserts the disjointness, because a translated word
 * slipping in is the one mistake that breaks the invariant silently.
 */

const nouns: NounEntry[] = [
  { word: 'Sail' },
  { word: 'Helm' },
  { word: 'Keel' },
  { word: 'Mast' },
  { word: 'Rudder' },
  { word: 'Anchor' },
  { word: 'Bowline' },
  { word: 'Compass' },
  { word: 'Beacon' },
  { word: 'Harbor' },
  { word: 'Lantern' },
  { word: 'Cove' },
  { word: 'Tide' },
  { word: 'Current' },
  { word: 'Squall' },
  { word: 'Gale' },
  { word: 'Breeze' },
  { word: 'Horizon' },
  { word: 'Lagoon' },
  { word: 'Reef' },
  { word: 'Sextant' },
  { word: 'Spinnaker' },
  { word: 'Rigging' },
  { word: 'Galley' },
  { word: 'Bosun' },
  { word: 'Voyage' },
  { word: 'Wake' },
  { word: 'Drift' },
  { word: 'Crossing' },
  { word: 'Landfall' },
  { word: 'Fathom' },
  { word: 'Knot' },
  { word: 'Hitch' },
  { word: 'Halyard' },
  { word: 'Dolphin' },
  { word: 'Marlin' },
  { word: 'Albatross' },
  { word: 'Narwhal' },
  { word: 'Petrel' },
  { word: 'Otter' },
];

// English adjectives do not inflect, so each entry carries a single form.
const adjectives: AdjectiveEntry[] = [
  { m: 'Swift' },
  { m: 'Steady' },
  { m: 'Bright' },
  { m: 'Bold' },
  { m: 'Calm' },
  { m: 'Deep' },
  { m: 'Silver' },
  { m: 'Golden' },
  { m: 'Restless' },
  { m: 'Distant' },
  { m: 'Nimble' },
  { m: 'Fearless' },
  { m: 'Quiet' },
  { m: 'Roaming' },
  { m: 'Salty' },
  { m: 'Stormy' },
  { m: 'Sunlit' },
  { m: 'Tidal' },
  { m: 'Windward' },
  { m: 'Wandering' },
  { m: 'Clever' },
  { m: 'Lucky' },
  { m: 'Patient' },
  { m: 'Brave' },
  { m: 'Northern' },
];

export const enPool: UsernamePool = {
  nouns,
  adjectives,
  /** English puts the adjective first and never agrees with the noun. */
  compose: (noun, adjective) => `${adjective.m} ${noun.word}`,
};
