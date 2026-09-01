import type {
  ListAccessEntry,
  ListPermission,
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
  // Four lists in the one group where the caller is an **ordinary member**, which is
  // the only group where their list permissions are their own rather than derived from
  // being staff. One list per permission state, and the reason each exists is on its
  // access row below.
  'zone-parents': [
    list('list-sunday', 'zone-parents', 'Sunday lunch', 'user-mum', 9, 2),
    list('list-pantry', 'zone-parents', 'Pantry top up', 'user-mum', 4, 1, {
      autoApproveLines: true,
    }),
    list('list-market', 'zone-parents', 'Saturday market', 'user-dad', 4, 1),
    list('list-freezer', 'zone-parents', 'Freezer', SEED_USER_ID, 2, 1),
  ],
};

/**
 * What each membership may do on each seeded list, by membership id.
 *
 * Keyed by **membership** and not by user, because that is what the `PUT` payload names
 * and what the share sheet therefore has to send back. `ListMemory` reads these and
 * **enforces** them, so a refusal here is the refusal the real gateway gives, and the
 * four permission states are reachable with no backend at all. Against a real gateway
 * they need four accounts, a group and a share sheet, which is the whole argument for
 * plan 0030 section 9.
 *
 * ## Group staff have no rows here, on purpose
 *
 * A zone `OWNER` or `ADMIN` holds all four permissions on every list in their zone,
 * derived at check time and never stored (backend plan 0036, section 2.4). So Toni, an
 * admin of `zone-flat`, has no row on `list-weekly` and can still do everything to it,
 * and Mum and Dad have no rows on the lists they created in `zone-parents`.
 *
 * That is the change that makes `zone-parents` carry the interesting states. The seeded
 * caller is an ordinary `MEMBER` there and staff everywhere else they have lists, so it
 * is the only group where their own permissions decide anything.
 *
 * ## One list per state
 *
 * - `list-sunday`: `READ` alone. Every line, no composer, no tick, no overflow, one
 *   banner. Plan 0030 acceptance 1.
 * - `list-pantry`: `WRITE` and no `DECIDE`, which nothing had ever rendered. A full
 *   composer, rows that do not answer a tap, no decision buttons, and edit and delete on
 *   unapproved lines only. It also auto-approves, so a line the caller adds arrives
 *   `APPROVED` with **no** approver, which is the only place rule 2 of backend plan 0037
 *   section 2 is reachable on its own.
 * - `list-market`: `DECIDE` and no `WRITE`, the other state nothing had rendered. Ticks,
 *   approvals, rejections and restores, no composer, no edit entry on an unapproved row,
 *   and the quantity-only edit sheet on an approved one. It does not auto-approve, so it
 *   is where lowering an approved quantity splits.
 * - `list-freezer`: all four, held by somebody who is **not** group staff. The share
 *   sheet opened by a list admin who cannot appoint another one, with every List admin
 *   box drawn, disabled and explained.
 * - `list-weekly` and `list-cleaning` sit in `zone-flat`, which the caller owns, so they
 *   are the everything-permitted case reached the other way, by derivation.
 */
export const SEED_LIST_ACCESS: Readonly<
  Record<string, readonly ListAccessEntry[]>
> = {
  // Created by the seeded caller, whose row got all four in the same transaction
  // (backend plan 0036, section 2.5), plus one member shared in as a plain reader.
  // Toni is an admin of the zone and needs no row.
  'list-weekly': [
    access('m-flat-me', ['READ', 'WRITE', 'DECIDE', 'MANAGE']),
    access('m-flat-marta', ['READ']),
  ],
  // Toni's list. The caller is the zone owner, so their row is beside the point here;
  // it is kept as the ordinary shared-in grant `shareWithZone` writes.
  'list-cleaning': [
    access('m-flat-toni', ['READ', 'WRITE', 'DECIDE', 'MANAGE']),
    access('m-flat-me', ['READ', 'WRITE', 'DECIDE']),
  ],
  // Read only, in a group where the caller is an ordinary member.
  'list-sunday': [
    access('m-parents-me', ['READ']),
    access('m-parents-rosa', ['READ', 'WRITE', 'DECIDE']),
  ],
  // The `WRITE`-only caller. Rosa can decide on the same list, which is what makes the
  // caption naming who does the ticking true rather than decorative.
  'list-pantry': [
    access('m-parents-me', ['READ', 'WRITE']),
    access('m-parents-rosa', ['READ', 'WRITE', 'DECIDE']),
  ],
  // The `DECIDE`-only caller: in the aisle, not writing the list.
  'list-market': [
    access('m-parents-me', ['READ', 'DECIDE']),
    access('m-parents-rosa', ['READ', 'WRITE']),
  ],
  // A list admin who is not group staff, on a list they created themselves.
  'list-freezer': [
    access('m-parents-me', ['READ', 'WRITE', 'DECIDE', 'MANAGE']),
    access('m-parents-rosa', ['READ', 'WRITE', 'DECIDE']),
  ],
};

function access(
  membershipId: string,
  permissions: readonly ListPermission[]
): ListAccessEntry {
  return { membershipId, permissions };
}

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
  wantedCount: number,
  overrides: Partial<ShoppingListSummary> = {}
): ShoppingListSummary {
  return {
    id,
    zoneId,
    name,
    createdByUserId,
    lineCount,
    wantedCount,
    autoApproveLines: false,
    // Shared with the group, which is what every list a household makes together is,
    // and what the settings sheet's switch draws on (velista plan 0036, section 7).
    sharedWithZone: true,
    // Empty here and never read: `myPermissions` is the one field on a list that is
    // about the reader rather than the list, so a fixture cannot hold it. `ListMemory`
    // stamps the caller's real set on every list it hands out, worked out from
    // `SEED_LIST_ACCESS` and the caller's zone role, which is what the gateway does.
    myPermissions: [],
    ...overrides,
  };
}
