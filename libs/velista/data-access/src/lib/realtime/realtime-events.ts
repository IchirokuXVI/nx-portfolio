import type {
  Comment,
  Line,
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
      readonly type:
        | 'member.joined'
        | 'member.approved'
        | 'member.kicked'
        | 'member.banned'
        | 'member.roleChanged';
      readonly membership: Membership;
    }
  | {
      readonly type: 'member.rejected';
      readonly membershipId: string;
      readonly userId: string;
    }
  | {
      readonly type: 'list.created' | 'list.updated';
      readonly list: ShoppingList;
    }
  | { readonly type: 'list.deleted'; readonly listId: string }
  | { readonly type: 'list.accessChanged'; readonly listId: string }
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
  'list.created',
  'list.updated',
  'list.deleted',
  'list.accessChanged',
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

/** The messages the client sends. Each is acknowledged with `{ ok: boolean }`. */
export const REALTIME_CLIENT_MESSAGES = {
  zoneSubscribe: 'zone.subscribe',
  zoneUnsubscribe: 'zone.unsubscribe',
  listSubscribe: 'list.subscribe',
  listUnsubscribe: 'list.unsubscribe',
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
