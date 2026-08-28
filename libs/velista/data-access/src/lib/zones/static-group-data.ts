import type {
  ListAccessEntry,
  Membership,
  ShoppingListSummary,
} from '@portfolio/velista/models';
import { SEED_USER_ID } from './static-zone-data';

/**
 * Seed memberships and lists, so **every state in `0010` section 3 is reachable with
 * no backend**.
 *
 * The same argument `static-zone-data.ts` makes for the dashboard, and it bites harder
 * here: reproducing "a second admin answered the request first" against a real gateway
 * means two accounts, a third person asking to join, and precise timing. Against these
 * it is one call.
 *
 * The seeded caller is {@link SEED_USER_ID}, and the four zones they can open cover the
 * four ways this screen differs from itself:
 *
 * - `zone-flat`, which they **own**, with three people waiting. Every governance
 *   control, and the only place approve and reject can be exercised.
 * - `zone-parents`, where they are an ordinary member. No governance row, no row menu,
 *   and no pending section.
 * - `zone-lab`, where they are an **admin**: the row menus lose their role controls,
 *   and the owner's row loses its menu entirely (section 5.4).
 * - `zone-rescue`, an ownerless zone they are an admin of, which is the only way to
 *   reach the claim primary.
 *
 * Names are ordinary on purpose. Seed data full of "Member 1" makes a members list look
 * fine at lengths real names would break.
 */

/**
 * The seeded caller's own name, as the other members of a zone see it.
 *
 * Per zone by design: the same person is `username` on each of their memberships, and
 * the API exposes no global display name to any of these screens (plan 0004,
 * section 11 item 2).
 */
export const SEED_MY_USERNAME = 'Dani';

/**
 * Memberships by zone, approved and pending together, in the order the server returns
 * them: `joined`, which is the gateway's default order.
 *
 * The pending ones are in this list rather than a separate one because that is how the
 * API serves them: one route, filtered by `statuses`. Splitting them here would let the
 * fake disagree with the real thing about what a page contains.
 */
export const SEED_MEMBERSHIPS: Readonly<Record<string, readonly Membership[]>> =
  {
    'zone-flat': [
      member('m-flat-me', 'zone-flat', SEED_USER_ID, SEED_MY_USERNAME, 'OWNER'),
      member('m-flat-toni', 'zone-flat', 'user-toni', 'Toni', 'ADMIN'),
      member('m-flat-marta', 'zone-flat', 'user-marta', 'Marta', 'MEMBER'),
      // Three waiting, oldest first, which is the order `firstPendingRequesterName`
      // names Ines by on the zone card.
      pending('m-flat-ines', 'zone-flat', 'user-ines', 'Ines'),
      pending('m-flat-bruno', 'zone-flat', 'user-bruno', 'Bruno'),
      pending('m-flat-lucia', 'zone-flat', 'user-lucia', 'Lucía'),
    ],

    'zone-parents': [
      member('m-parents-mum', 'zone-parents', 'user-mum', 'Mamá', 'OWNER'),
      member('m-parents-dad', 'zone-parents', 'user-dad', 'Papá', 'ADMIN'),
      member(
        'm-parents-me',
        'zone-parents',
        SEED_USER_ID,
        SEED_MY_USERNAME,
        'MEMBER'
      ),
      member('m-parents-rosa', 'zone-parents', 'user-rosa', 'Rosa', 'MEMBER'),
    ],

    'zone-lab': [
      member('m-lab-sam', 'zone-lab', 'user-sam', 'Sam', 'OWNER'),
      member('m-lab-me', 'zone-lab', SEED_USER_ID, SEED_MY_USERNAME, 'ADMIN'),
      member('m-lab-nuria', 'zone-lab', 'user-nuria', 'Núria', 'MEMBER'),
      member('m-lab-pau', 'zone-lab', 'user-pau', 'Pau', 'MEMBER'),
      member('m-lab-iker', 'zone-lab', 'user-iker', 'Iker', 'MEMBER'),
      pending('m-lab-eva', 'zone-lab', 'user-eva', 'Eva'),
    ],

    'zone-rescue': [
      member(
        'm-rescue-me',
        'zone-rescue',
        SEED_USER_ID,
        SEED_MY_USERNAME,
        'ADMIN'
      ),
      member('m-rescue-pau', 'zone-rescue', 'user-pau', 'Pau', 'MEMBER'),
    ],

    'zone-old-houseshare': [
      member(
        'm-old-me',
        'zone-old-houseshare',
        SEED_USER_ID,
        SEED_MY_USERNAME,
        'MEMBER'
      ),
      member('m-old-jan', 'zone-old-houseshare', 'user-jan', 'Jan', 'MEMBER'),
    ],
  };

/**
 * Lists by zone, **already filtered to what the seeded caller may read**, which is what
 * the endpoint returns and therefore what the fake must return.
 *
 * `zone-lab` is deliberately absent rather than empty in spirit: it has five members and
 * no entry here, which is section 3.2's second state, the one that must not say "No
 * lists yet". A fake that gave every member every list would make that state
 * unreachable without a backend, and it is the state most likely to be got wrong.
 */
export const SEED_LISTS: Readonly<
  Record<string, readonly ShoppingListSummary[]>
> = {
  'zone-flat': [
    list('list-weekly', 'zone-flat', 'Weekly shop', SEED_USER_ID, 12, 7),
    list('list-cleaning', 'zone-flat', 'Cleaning', 'user-toni', 4, 4),
  ],
  'zone-parents': [
    list('list-sunday', 'zone-parents', 'Sunday lunch', 'user-mum', 9, 2),
  ],
};

/**
 * Who can read and write each seeded list, by membership id.
 *
 * There is no `GET /v1/lists/:id/access` yet (plan 0012, section 5.5), so nothing
 * against a real gateway can produce this and the share sheet is built entirely
 * against these rows. It is keyed by **membership** and not by user, because that is
 * what the `PUT` payload names and what the sheet therefore has to send back.
 *
 * Note who is missing. Toni is an admin of `zone-flat` and holds **no row on
 * `list-weekly`**, which is the arrangement the plan's read only state is really
 * about: `requireRead` lets a zone admin open any list in their zone, and
 * `requireWrite` has no such bypass, so Toni can open that list and cannot add a line
 * to it. A fixture that gave every admin write access would make that unreachable, and
 * it is the case the screen is most likely to get wrong.
 */
export const SEED_LIST_ACCESS: Readonly<
  Record<string, readonly ListAccessEntry[]>
> = {
  // Created by the seeded caller, who was given WRITER in the same transaction, plus
  // one other member who was shared in.
  'list-weekly': [
    { membershipId: 'm-flat-me', role: 'WRITER' },
    { membershipId: 'm-flat-marta', role: 'READER' },
  ],
  // Toni's list, shared with the caller as a writer.
  'list-cleaning': [
    { membershipId: 'm-flat-toni', role: 'WRITER' },
    { membershipId: 'm-flat-me', role: 'WRITER' },
  ],
  // The caller is a plain member of `zone-parents` and can only read this one, which
  // is the state section 3.2 draws: every line, no composer, one notice on first tap.
  'list-sunday': [{ membershipId: 'm-parents-me', role: 'READER' }],
};

function member(
  id: string,
  zoneId: string,
  userId: string,
  username: string,
  role: Membership['role']
): Membership {
  return { id, zoneId, userId, username, role, status: 'APPROVED' };
}

function pending(
  id: string,
  zoneId: string,
  userId: string,
  username: string
): Membership {
  return {
    id,
    zoneId,
    userId,
    username,
    role: 'MEMBER',
    status: 'PENDING',
  };
}

function list(
  id: string,
  zoneId: string,
  name: string,
  createdByUserId: string,
  lineCount: number,
  readyCount: number
): ShoppingListSummary {
  return { id, zoneId, name, createdByUserId, lineCount, readyCount };
}
