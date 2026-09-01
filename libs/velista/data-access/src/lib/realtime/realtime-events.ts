import type {
  Comment,
  GeneratedListSummary,
  Line,
  LineSettlement,
  ListPermission,
  ListPresence,
  Membership,
  ShoppingList,
  ShoppingProfile,
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
 * - `line.updated` also fires for an approval decision, so there is no separate
 *   "approval changed" event to listen for. It no longer fires for a trip status,
 *   because there is no longer one: what a shopper found is `line.settled`.
 */
/** One line named by a claim change, with the list that holds it. */
export interface LineClaimRef {
  readonly lineId: string;
  readonly listId: string;
}

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
  /**
   * A line was settled: bought, or found missing from the shop (backend plan 0047,
   * section 8).
   *
   * It carries **both halves**, and both are needed. The line has a new quantity and
   * two moved indicators on it, so a phone in the shop and a phone at home agree
   * without a refetch; the settlement carries an id and a time nothing else can
   * produce, which is the row an open history should grow.
   *
   * Distinct from `line.updated` on purpose, though the line inside it did change.
   * "Somebody bought two of these" is a different sentence from "the number moved",
   * which a quantity edit says too, and only one of them belongs in a history.
   */
  | {
      readonly type: 'line.settled';
      readonly line: Line;
      readonly settlement: LineSettlement;
    }
  /**
   * Some lines are, or are no longer, in somebody's live basket (backend plan
   * 0052), on the **zone** room.
   *
   * The one zone event a generated list emits, so a line can show that somebody is out
   * buying it. The payload says **that** those lines are claimed and **whose**, and
   * nothing else: not what else is in the basket, not where they are shopping, not
   * what it costs, and never which basket.
   *
   * `claimed` is false when the claim is released, which is what makes one event serve
   * both directions rather than needing a second one to undo it. `claimedByUserId` is
   * null on a release, and also null on a claim whose owner has since left the zone:
   * the line is still claimed and the name is no longer this reader's to have.
   *
   * **Many lines and not one.** A run takes every wanted line of every list it drew
   * from, so the server sends one event per zone rather than a hundred into a
   * household room (backend plan 0052, section 3.1). The single line transitions use
   * the same shape carrying one entry, so there is one payload to read and not two.
   */
  | {
      readonly type: 'line.claimChanged';
      readonly zoneId: string;
      readonly claimed: boolean;
      readonly claimedByUserId: string | null;
      readonly lines: readonly LineClaimRef[];
    }
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
  /**
   * A comment changed after it was created (backend plan 0045, section 4).
   *
   * Exactly one thing can change one: a voice comment's transcript arriving, or
   * failing to. A comment is not editable and neither is its recording, so this is
   * not a general "somebody edited a comment" event and should not become one.
   *
   * It carries the whole comment and is upserted, which is the same shape
   * `comment.added` already has and the reason nothing new was needed to receive
   * it. It must **not** move a comment count: the comment already exists.
   */
  | { readonly type: 'comment.updated'; readonly comment: Comment }
  | {
      readonly type: 'merge.requested' | 'merge.approved' | 'merge.rejected';
      readonly mergeId: string;
      readonly zoneId: string;
    }
  | {
      /**
       * The caller's **shopping profiles** changed (backend plan 0049, section 6), on
       * their own sessions and on nothing else.
       *
       * Profiles are private, so this is the one audience it can have: no zone room
       * hears it, not even one the caller owns.
       *
       * It carries the **whole list** rather than the profile that moved, and that is
       * the payload rather than an oversight: every rule it exists to propagate is
       * about the set, namely which one is the default, how many are left, and what a
       * deleted one was replaced by. A single profile could not say any of them.
       *
       * An empty array is therefore not a malformed payload either, but it is one this
       * client will never see: the server creates the default profile on the first
       * read and refuses to delete the last one.
       */
      readonly type: 'profiles.changed';
      readonly profiles: readonly ShoppingProfile[];
    }
  | {
      /**
       * A generated shopping list of the caller's was composed, or one of them moved
       * (backend `0050` section 9), on their own sessions and on nothing else.
       *
       * A basket is private, so the owner's room is the only audience it can have: not
       * the zones it drew from, not the admins of those zones, nobody. What it buys is
       * the one thing a private resource still needs from realtime, which is that the
       * same basket stays in sync between the phone in the shop and the laptop at home.
       *
       * The payload is the **whole** basket, lines included, and this app keeps the
       * summary out of it: the dashboard card and the history draw a name, a date and
       * two counts, and the screen that wants the lines fetches them itself.
       */
      readonly type: 'generatedList.created' | 'generatedList.updated';
      readonly list: GeneratedListSummary;
    }
  | {
      /**
       * A line of one of the caller's baskets was settled (backend `0051` section 6).
       *
       * It reaches this client on the **owner's own sessions**, which is what makes it
       * useful to a dashboard: the person watching the card is usually not the person
       * in the shop. It also goes to the basket's own room, which this app cannot hold
       * yet, since every socket here authenticates with an account token and a guest
       * has none (`0044`'s participant connection).
       *
       * Only the id is kept. The payload carries the line, redacted to the least
       * privileged reader in the room because a broadcast cannot be projected per
       * socket, and **the counts this app draws cannot be derived from one line**: a
       * summary holds how many lines are finished, and knowing that one of them moved
       * says nothing about whether it had already been counted. So the id is what the
       * store needs and the line is the basket screen's business.
       */
      readonly type: 'generatedList.lineSettled';
      readonly generatedListId: string;
    }
  | {
      /**
       * A generated shopping list of the caller's was deleted.
       *
       * No screen in this app deletes one (plan 0045, section 3.3), so this only ever
       * arrives from somewhere else: another client, or a future screen. It is applied
       * anyway, because a card pointing at a basket the server no longer has is worse
       * than a card that quietly goes away.
       */
      readonly type: 'generatedList.deleted';
      readonly generatedListId: string;
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
  'line.settled',
  'line.claimChanged',
  'line.reordered',
  'line.deleted',
  'comment.added',
  'comment.updated',
  'merge.requested',
  'merge.approved',
  'merge.rejected',
  'profiles.changed',
  'generatedList.created',
  'generatedList.updated',
  'generatedList.lineSettled',
  'generatedList.deleted',
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
