import type { MyZone } from '@portfolio/velista/models';

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
    joinCode: 'FLAT3B',
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
    joinCode: 'PARENT',
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
    joinCode: 'CLIMB7',
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
    joinCode: 'OLDHSE',
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
