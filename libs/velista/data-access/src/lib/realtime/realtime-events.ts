import type {
  Comment,
  Line,
  ListPermission,
  ListPresence,
  Membership,
  ShoppingList,
  Zone,
  ZonePresence,
} from '@portfolio/velista/models';

/**
 * The realtime events this app understands, as **its own** discriminated union.
 *
 * Rule D4 (plan 0004, section 4.1) covers events as well as response bodies, and this
 * is the half of the rule that is easiest to forget because an event does not look
 * like a request. It is in fact the **less** trustworthy of the two: it arrives on a
 * connection that was authenticated once, minutes ago, and it is not correlated with
 * anything the app asked for.
 *
 * Three payloads are not the shape their name suggests, and each has burned someone:
 *
 * - `member.rejected` carries `{ id, userId }`, **not** a membership.
 * - `line.reordered` carries a permutation, not a set of rows.
 * - `line.updated` also fires for approval and status changes, so there is no separate
 *   "status changed" event to listen for.
 */
export type RealtimeEvent =
  | {
      /**
       * A zone the caller has just created (backend plan 0030, section 4.2).
       *
       * Addressed to the creator's own sessions rather than broadcast into the new
       * zone's room, which at that moment contains nobody: the tab that created it
       * has not subscribed, and no other member exists yet.
       *
       * The payload is the `ZoneView` the create endpoint answers, so it is the same
       * shape `zone.updated` carries and deliberately **not** a `MyZoneView`. It has
       * no counts and no list preview, and the store loads the zone rather than
       * inventing them.
       */
      readonly type: 'zone.created';
      readonly zone: Zone;
    }
  | { readonly type: 'zone.updated'; readonly zone: Zone }
  | { readonly type: 'zone.ownershipChanged'; readonly zone: Zone }
  | { readonly type: 'zone.markedForDeletion'; readonly zone: Zone }
  | { readonly type: 'zone.deleted'; readonly zoneId: string }
  | {
      /**
       * The counts changed (backend plan 0017, section 9).
       *
       * Deliberately **not** the whole `ZoneCounts`: `listCount` is filtered per
       * caller and a room broadcast has no single asker, so it is absent here and
       * the store keeps its own from the list events it already receives.
       *
       * The governance fields are filled only in the `zone:{id}:staff` room; the
       * plain zone room gets the same event with both of them null.
       */
      readonly type: 'zone.countsUpdated';
      readonly zoneId: string;
      readonly memberCount: number;
      readonly pendingRequestCount: number | null;
      readonly firstPendingRequesterName: string | null;
    }
  | {
      /**
       * `member.usernameChanged` joins its five siblings because it carries the same
       * payload they do: core emits `toMembershipView(row)` from both places it fires,
       * the per zone rename in `membership.service.ts` and the global rename's
       * propagation in `username-propagation.service.ts`.
       *
       * It was missing from this union entirely until plan 0015, which is what made
       * `MATCHING_ZONES` a change nothing could observe: the server renamed the
       * memberships and every open members screen kept the old name until it was
       * reloaded, including the renamer's own on a second device.
       */
      readonly type:
        | 'member.joined'
        | 'member.approved'
        | 'member.kicked'
        | 'member.banned'
        | 'member.roleChanged'
        | 'member.usernameChanged';
      readonly membership: Membership;
    }
  | {
      readonly type: 'member.rejected';
      readonly membershipId: string;
      readonly userId: string;
    }
  | {
      /**
       * The caller's **global** username changed (backend plan 0030, section 4.3),
       * addressed to their own sessions.
       *
       * Its sibling `member.usernameChanged` is the per zone name and stays a separate
       * event, because the two names are deliberately two (backend plan 0018). This is
       * the one that reaches a user who is in no zone at all, and it is the reason a
       * second tab no longer holds the old name for as long as it stays open.
       *
       * The id and the name, and deliberately not a `UserProfile`: the payload carries
       * those two fields and nothing else, so mapping it into a profile would invent an
       * email verification state and a created date the wire never sent (rule D4).
       */
      readonly type: 'user.usernameChanged';
      readonly userId: string;
      readonly username: string;
    }
  | {
      readonly type: 'list.created' | 'list.updated';
      readonly list: ShoppingList;
    }
  | { readonly type: 'list.deleted'; readonly listId: string }
  | { readonly type: 'list.accessChanged'; readonly listId: string }
  | {
      /**
       * The **caller's own** effective permissions on one list changed, on the user
       * channel (backend plan 0036, section 8).
       *
       * Its sibling `list.accessChanged` goes to the list room and names nobody, so
       * every client in the room re-syncs. That is adequate for people who kept access
       * and useless for the two it is actually about: the person who lost it, and the
       * person who gained it and was therefore never in the room to hear about it.
       *
       * `zoneId` rides along because the client needs it and the list id alone does not
       * yield it: there is no `GET /v1/lists/:id`, so a list this client has never
       * loaded cannot be placed in a zone from its id.
       *
       * An **empty `permissions` array is not a malformed payload**, it is somebody
       * being removed from the list, and it is the one payload here where the empty case
       * carries the meaning.
       */
      readonly type: 'list.myAccessChanged';
      readonly listId: string;
      readonly zoneId: string;
      readonly permissions: readonly ListPermission[];
    }
  | { readonly type: 'line.added' | 'line.updated'; readonly line: Line }
  | {
      readonly type: 'line.reordered';
      readonly listId: string;
      readonly orderedLineIds: readonly string[];
    }
  | {
      readonly type: 'line.deleted';
      readonly lineId: string;
      readonly listId: string;
    }
  | { readonly type: 'comment.added'; readonly comment: Comment }
  | {
      readonly type: 'merge.requested' | 'merge.approved' | 'merge.rejected';
      readonly mergeId: string;
      readonly zoneId: string;
    }
  | { readonly type: 'presence.zoneUpdated'; readonly presence: ZonePresence }
  | { readonly type: 'presence.listUpdated'; readonly presence: ListPresence };

/** Every event name the server can send. Used to filter before mapping. */
export const REALTIME_EVENT_NAMES = [
  'zone.created',
  'zone.updated',
  'zone.deleted',
  'zone.countsUpdated',
  'zone.markedForDeletion',
  'zone.ownershipChanged',
  'member.joined',
  'member.approved',
  'member.rejected',
  'member.kicked',
  'member.banned',
  'member.roleChanged',
  'member.usernameChanged',
  'user.usernameChanged',
  'list.created',
  'list.updated',
  'list.deleted',
  'list.accessChanged',
  'list.myAccessChanged',
  'line.added',
  'line.updated',
  'line.reordered',
  'line.deleted',
  'comment.added',
  'merge.requested',
  'merge.approved',
  'merge.rejected',
  'presence.zoneUpdated',
  'presence.listUpdated',
] as const;

/**
 * The messages the client sends. Each is acknowledged with `{ ok: boolean }`.
 *
 * The four presence intents (plan 0017) are peers of the subscriptions on the wire and
 * not on the client: the server refuses `presence.view` and `presence.edit` from a
 * socket that is not already in `list:{id}`, since it trusts the membership
 * `list.subscribe` established rather than paying a second round trip to core. So an
 * intent is always sent after the subscription that permits it, never beside it.
 *
 * There is no zone presence intent, and that is not an omission: `zone.subscribe` calls
 * `presence.joinZone` inside its own handler, the same way it joins the staff room, so
 * being subscribed to a zone **is** being present in it.
 */
export const REALTIME_CLIENT_MESSAGES = {
  zoneSubscribe: 'zone.subscribe',
  zoneUnsubscribe: 'zone.unsubscribe',
  listSubscribe: 'list.subscribe',
  listUnsubscribe: 'list.unsubscribe',
  zoneEnter: 'presence.enterZone',
  zoneLeave: 'presence.leaveZone',
  listView: 'presence.view',
  listUnview: 'presence.unview',
  lineEdit: 'presence.edit',
  lineStopEdit: 'presence.stopEdit',
} as const;

/** Room names, built the same way the server builds them. */
export function zoneRoom(zoneId: string): string {
  return `zone:${zoneId}`;
}

/**
 * The staff room, `zone:{id}:staff` (backend plan 0017, section 9).
 *
 * Derived from {@link zoneRoom} rather than written out, so the two cannot drift.
 * Subscribing is what fills the governance fields on `zone.countsUpdated`; the server
 * refuses the room for a caller who is not an OWNER or ADMIN, which the refused-room
 * handling already surfaces.
 */
export function zoneStaffRoom(zoneId: string): string {
  return `${zoneRoom(zoneId)}:staff`;
}

export function listRoom(listId: string): string {
  return `list:${listId}`;
}
