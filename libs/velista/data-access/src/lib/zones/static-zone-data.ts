import type { MyZone, Zone } from '@portfolio/velista/models';

/**
 * Seed data for the in-memory zone service.
 *
 * Chosen to make **every state in `0003` section 3 reachable without a backend**, which
 * is the whole argument for the memory implementation existing when a real API does:
 *
 * - a populated zone the caller owns, with a join request waiting, which is the
 *   "needs attention" state and the join request line in section 4.1
 * - a zone the caller is a plain member of, with no attention row
 * - a zone whose membership is still `PENDING`, which renders dashed and is not
 *   tappable through
 * - a zone in `MARKED_FOR_DELETION`, which `0003` open question 2 says the page must
 *   not crash on
 *
 * The summary blocks are populated here even though the gateway cannot serve them yet
 * (plan 0003 section 5.2), which is precisely what lets the page be built to its
 * approved design rather than to the API's current limits.
 *
 * The names are deliberately ordinary. Seed data full of "Test Zone 1" makes a design
 * look fine at sizes real content would break.
 */
export const SEED_ZONES: readonly MyZone[] = [
  {
    id: 'zone-flat',
    name: 'Flat 3B',
    joinCode: 'HK7M2QPD',
    status: 'ACTIVE',
    ownerUserId: 'user-me',
    myRole: 'OWNER',
    myStatus: 'APPROVED',
    counts: {
      memberCount: 3,
      listCount: 2,
      // Three waiting, so the line reads "Ines and 2 more want to join": the plural
      // form, with a count that excludes the named person (plan 0003, section 4.1).
      pendingRequestCount: 3,
      firstPendingRequesterName: 'Ines',
    },
    lists: [
      {
        id: 'list-weekly',
        name: 'Weekly shop',
        lineCount: 12,
        readyCount: 7,
      },
      { id: 'list-cleaning', name: 'Cleaning', lineCount: 4, readyCount: 4 },
    ],
  },
  {
    id: 'zone-parents',
    name: "Mum and Dad's",
    joinCode: 'RQ4TBVCN',
    status: 'ACTIVE',
    ownerUserId: 'user-mum',
    myRole: 'MEMBER',
    myStatus: 'APPROVED',
    counts: {
      memberCount: 4,
      listCount: 1,
      // Null, not zero: this caller is not staff in this zone, so the backend
      // does not tell them who is waiting (backend plan 0017, section 6).
      pendingRequestCount: null,
      firstPendingRequesterName: null,
    },
    lists: [
      {
        id: 'list-sunday',
        name: 'Sunday lunch',
        lineCount: 9,
        readyCount: 2,
      },
    ],
  },
  {
    id: 'zone-climbing',
    // Long enough to check truncation against the role badge at 320px, which plan
    // 0003 section 6 calls out as needing checking in Spanish too.
    name: 'Wednesday climbing crew',
    joinCode: 'M3XKPFHD',
    status: 'ACTIVE',
    ownerUserId: 'user-sam',
    myRole: 'MEMBER',
    myStatus: 'PENDING',
    counts: {
      memberCount: 6,
      listCount: 1,
      // Null, not zero: this caller is not staff in this zone, so the backend
      // does not tell them who is waiting (backend plan 0017, section 6).
      pendingRequestCount: null,
      firstPendingRequesterName: null,
    },
    // A pending member sees no list content, so the preview is empty by design
    // rather than by omission.
    lists: [],
  },
  {
    id: 'zone-old-houseshare',
    name: 'Old houseshare',
    joinCode: 'W9NPTCZR',
    // The owner deleted their account. Plan 0003 open question 2: render it as a
    // plain, non tappable card and do not crash. That is the whole requirement.
    status: 'MARKED_FOR_DELETION',
    ownerUserId: null,
    myRole: 'MEMBER',
    myStatus: 'APPROVED',
    counts: {
      memberCount: 2,
      listCount: 0,
      // Null, not zero: this caller is not staff in this zone, so the backend
      // does not tell them who is waiting (backend plan 0017, section 6).
      pendingRequestCount: null,
      firstPendingRequesterName: null,
    },
    lists: [],
  },
];

/** The user the seed data belongs to, so the memory service can answer consistently. */
export const SEED_USER_ID = 'user-me';

/**
 * A zone the seeded caller is **not** in, so asking to join one can succeed.
 *
 * Every zone in `SEED_ZONES` is one they already belong to, which is the right seed for
 * the dashboard and the wrong one for the join sheet: without this, the only outcomes
 * reachable without a backend would be the failures.
 *
 * A plain `Zone`, because that is all a stranger to it can know. Its name arrives on
 * the reload after the ask, which is the exact behaviour plan 0008 section 5.6 says the
 * screen must not pretend to have earlier.
 */
export const SEED_JOINABLE_ZONE: Zone = {
  id: 'zone-ferrer',
  name: 'Casa Ferrer',
  joinCode: 'GTBN4KRW',
  status: 'ACTIVE',
  ownerUserId: 'user-nuria',
};

/**
 * Codes that make each row of plan 0008 section 5.4 reachable with no gateway running.
 *
 * The acceptance criterion asks that every one of those messages be verified against
 * `ZoneMemory` rather than a live backend, and a fake that can only succeed cannot do
 * that. Each of these is a real code shape, so the field accepts them and the sheet is
 * exercised exactly as a real one would be.
 */
export const SEED_JOIN_CODES = {
  /** Succeeds, and lands PENDING. */
  joinable: SEED_JOINABLE_ZONE.joinCode,
  /** A zone the caller already belongs to, so asking again is a `conflict`. */
  alreadyIn: 'HK7M2QPD',
  /** A zone the caller has already asked to join, which is the same `conflict`. */
  alreadyAsked: 'M3XKPFHD',
  /** A membership that was BANNED, which the gateway answers `forbidden`. */
  banned: 'BNDXQ7VM',
  /** The eleventh attempt in a minute. */
  rateLimited: 'TMNY83WK',
} as const;
