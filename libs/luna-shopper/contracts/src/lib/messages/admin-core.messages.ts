import type { GeneratedListStatus } from '../enums/generated-list.enums';
import type { LineApprovalStatus } from '../enums/list.enums';
import type {
  MembershipStatus,
  ZoneRole,
  ZoneStatus,
} from '../enums/zone.enums';
import type { PageQuery, Paginated } from '../pagination';
import type { AdminCredential } from './admin-auth.messages';
import type { MembershipView } from './zone.messages';

/**
 * The back office's view of core: zones, lists and baskets that belong to
 * somebody else (plan 0074).
 *
 * Every subject in `zone.*`, `list.*` and `generatedList.*` is scoped to the
 * caller, deliberately and from the day each was written. An operator is not a
 * member of the zone they are looking at and never should be, so none of those
 * subjects can answer for them; widening one to accept an operator would put a
 * platform wide bypass inside the authorization path every ordinary request takes.
 * A separate namespace keeps the bypass in files that are entirely about it.
 *
 * **Every write goes through the service, and never through the row** (plan
 * 0077, section 1). A list line participates in settlements, generated list
 * bindings, permission sets and realtime broadcasts other clients have already
 * applied, and the invariants live in services rather than in constraints. So
 * every subject here that writes delegates to the service method the user facing
 * route calls, with the authorization check removed and nothing else changed.
 *
 * Plan 0074 read that same fact as "read, plus named actions, and no update
 * subject, permanently". Plan 0077 reverses the conclusion and keeps the reason.
 * What was ruled out was the **generic row editor**, which offers a way to
 * corrupt state that no code path can repair; an update subject that calls
 * `ZoneService.update` is not one. Three consequences follow and they decide
 * every shape below: a field with no service behind it is not editable, an
 * operator write emits the events a member write emits, and an operator write is
 * refused wherever a member write is refused.
 *
 * Core verifies the operator token for itself, exactly as catalog does. Plan 0072
 * gave catalog and the harvester `ADMIN_JWT_PUBLIC_KEY`; this plan gives core the
 * same key and the same gate, so a gateway route added without its guard still
 * cannot read a stranger's list.
 */
export const ADMIN_ZONE_PATTERNS = {
  /** A page of zones, filtered to one user (section 2). */
  list: 'adminZone.list',
  /** One zone, with its membership and the names of its lists. */
  get: 'adminZone.get',
  /**
   * Delete a zone, performing the write `ZoneReaperService` performs.
   *
   * The reaper is where the definition of deleting a zone lives: the row goes,
   * the cascade takes its memberships, lists, lines and comments, and
   * `zone.deleted` goes out so every client holding it drops it. An operator
   * delete calls that same method rather than restating it, which is what keeps
   * the two from drifting into two different meanings of gone.
   */
  delete: 'adminZone.delete',
  /** Regenerate the join code, the write `zone.regenerateJoinCode` performs. */
  regenerateJoinCode: 'adminZone.regenerateJoinCode',
  /**
   * Hand a zone to one of its members, the write `zone.transferOwnership`
   * performs: two role changes and the zone's `ownerUserId`, in one transaction,
   * with all three events (plan 0029).
   */
  transferOwnership: 'adminZone.transferOwnership',
  /**
   * Change a zone's name or its config, the write `zone.update` performs (plan
   * 0077, section 4.1).
   *
   * Those two columns are the whole of what a zone's own owner may change, and
   * an operator gets exactly the same two. The join code, the owner, the status
   * and the deletion marker are not fields here, each for a reason section 4.1
   * states.
   */
  update: 'adminZone.update',
  /**
   * Mark a zone for deletion, or restore it (plan 0077, section 4.2).
   *
   * `status` and `markedForDeletionAt` are written together and read together,
   * so this writes the pair in one transaction rather than offering either as a
   * field. Typing one alone produces a zone the reaper either never removes or
   * removes anyway, and neither state is reachable through any other code path.
   */
  setDeletionMark: 'adminZone.setDeletionMark',
} as const;

export const ADMIN_MEMBERSHIP_PATTERNS = {
  /** Kick a member, the write `membership.kick` performs. */
  kick: 'adminMembership.kick',
  /** Ban a member, the write `membership.ban` performs. */
  ban: 'adminMembership.ban',
  /**
   * A page of one zone's memberships (plan 0077, section 9).
   *
   * The zone detail read carries its membership as an embedded array and keeps
   * it, because the zone screen renders that without a second call. This
   * collection serves the screens that edit one membership, which read and write
   * a row through its own address rather than through its parent.
   */
  list: 'adminMembership.list',
  /** One membership, read on its own. */
  get: 'adminMembership.get',
  /**
   * A membership's role and its per zone name (plan 0077, section 4.3).
   *
   * Two fields and no third. `status` is not here: it moves along a state
   * machine with a service method per edge, which is the four verbs below rather
   * than a value on this message.
   */
  update: 'adminMembership.update',
  /** Approve a PENDING member, the write `membership.approve` performs. */
  approve: 'adminMembership.approve',
  /** Reject a PENDING member, the write `membership.reject` performs. */
  reject: 'adminMembership.reject',
} as const;

export const ADMIN_LIST_PATTERNS = {
  /** A page of shopping lists, by zone or by the person who made them. */
  list: 'adminList.list',
  /**
   * One list **and its lines**.
   *
   * Reading what a household wrote down is a deliberate click and not a side
   * effect of browsing zones (section 4). The zone read answers with list names
   * and counts; the lines are only here.
   */
  get: 'adminList.get',
  /**
   * Change a list's name and its two flags, the write `list.update` performs
   * (plan 0077, section 5.1).
   *
   * `sharedWithZone` is asymmetric and the screen has to say so: turning it on
   * grants `{READ, WRITE, DECIDE}` to every currently approved non staff member,
   * and turning it off revokes nobody. That is the member facing behaviour and
   * this does not soften it.
   */
  update: 'adminList.update',
  /** Delete a list, the write `list.delete` performs. */
  delete: 'adminList.delete',
  /**
   * A page of one list's lines (plan 0077, section 9).
   *
   * The detail read keeps its embedded array; this collection serves the screen
   * that edits one line.
   */
  listLines: 'adminList.listLines',
  /** One line, read on its own. */
  getLine: 'adminList.getLine',
  /**
   * Edit a line's content, quantity or product set, the write `line.update`
   * performs, **with `MANAGE`** (plan 0077, section 5.2).
   *
   * An operator resolves to no membership and therefore to no permissions, and
   * `LineService.update` uses the caller's permissions twice: once to authorize
   * the edit and once to decide what the edit does to the line's approval. So
   * the operator is resolved as `MANAGE`, which allows the edit and leaves an
   * approved line approved. A correction that silently un-approved the line is a
   * second change nobody asked for, visible to every member in the zone.
   */
  updateLine: 'adminList.updateLine',
  /** Approve or reject a line, the write `line.setApproval` performs. */
  setLineApproval: 'adminList.setLineApproval',
  /** Delete a line, the write `line.delete` performs. */
  deleteLine: 'adminList.deleteLine',
} as const;

export const ADMIN_BASKET_PATTERNS = {
  /** A page of generated shopping lists, by zone or by owner. */
  list: 'adminBasket.list',
  /** One basket and its lines. */
  get: 'adminBasket.get',
} as const;

export type AdminZonePattern =
  (typeof ADMIN_ZONE_PATTERNS)[keyof typeof ADMIN_ZONE_PATTERNS];
export type AdminMembershipPattern =
  (typeof ADMIN_MEMBERSHIP_PATTERNS)[keyof typeof ADMIN_MEMBERSHIP_PATTERNS];
export type AdminListPattern =
  (typeof ADMIN_LIST_PATTERNS)[keyof typeof ADMIN_LIST_PATTERNS];
export type AdminBasketPattern =
  (typeof ADMIN_BASKET_PATTERNS)[keyof typeof ADMIN_BASKET_PATTERNS];

/**
 * A zone as the back office lists them.
 *
 * **No join code.** A listing is a screen an operator leaves open, and the join
 * code is the one field on a zone that grants access to it; it belongs to the
 * detail read, which is a deliberate click. **No owner name**, because core does
 * not have one: `ownerUserId` is an opaque id from another database, and turning
 * it into a name is the gateway's batched second call (section 3).
 *
 * The two counts are the whole reason a zone listing is worth reading, and they
 * are counts rather than contents by section 4: how much is in a household's
 * zone is operational, what is in it is theirs.
 */
export interface AdminZoneView {
  id: string;
  name: string;
  status: ZoneStatus;
  /** Null for a zone whose owner deleted their account (plan 0011, section 2). */
  ownerUserId: string | null;
  /** APPROVED memberships. */
  memberCount: number;
  /** Every list in the zone, not the ones some caller may read. */
  listCount: number;
  /** ISO 8601 UTC, or null unless the zone is MARKED_FOR_DELETION. */
  markedForDeletionAt: string | null;
  /** ISO 8601 UTC. */
  createdAt: string;
  /** ISO 8601 UTC. */
  updatedAt: string;
}

/** One membership, as a zone's detail screen shows it. */
export interface AdminZoneMemberView {
  membershipId: string;
  userId: string;
  /** The per zone name, which is the only personal field a membership holds. */
  username: string;
  role: ZoneRole;
  status: MembershipStatus;
  /** ISO 8601 UTC. */
  createdAt: string;
}

/** A list's name and size on the zone detail screen. Never its lines. */
export interface AdminZoneListView {
  id: string;
  name: string;
  lineCount: number;
}

/**
 * One zone, read on its own (section 4).
 *
 * Membership and list **names**, which is what makes the screen usable, and no
 * list content, which is somebody's shopping. The join code is here because this
 * read is the deliberate click and because the operator's next action is often to
 * regenerate it.
 */
export interface AdminZoneDetailView extends AdminZoneView {
  joinCode: string;
  config: Record<string, unknown>;
  members: AdminZoneMemberView[];
  lists: AdminZoneListView[];
}

/**
 * Zones, filtered by one user (plan 0074, section 2).
 *
 * **`userId` is the whole filter**, and that is the requirement rather than a
 * first version of it: a general zone search with usage statistics is a different
 * feature and section 2 says so. The id is not validated against auth, because
 * core has no way to and no business trying: ids cross the service boundary as
 * opaque values, which is the same seam `catalog-client.service` keeps on the
 * other side. An id belonging to nobody returns an empty page.
 *
 * A member counts, not only an owner. Somebody asking which zones a person is in
 * wants the answer for a person who joined one, and filtering on
 * `zones.ownerUserId` would silently answer a narrower question.
 *
 * The owner **is** askable on its own, beside that filter rather than instead
 * of it (admin plan 0012, section 3), because of its other answer: the zones
 * with no owner are what deleting an owner leaves behind, and an operator
 * looking for what to claim or reap needs to be able to list them.
 */
export interface ListAdminZonesRequest extends AdminCredential, PageQuery {
  /** The user whose zones these are, as owner or as member of any status. */
  targetUserId?: string;
  /** The user who owns these zones. Narrower than `targetUserId` on purpose. */
  ownerUserId?: string;
  /**
   * Only the zones with no owner: `ownerUserId IS NULL`, which is the state a
   * zone is left in when its owner is deleted and nobody has claimed it.
   *
   * A separate flag rather than a null `ownerUserId`, because absent already
   * means "any owner" and a filter cannot spell "no owner" by leaving itself
   * out. `false` is the same as absent. Set beside an `ownerUserId` it asks for
   * the zones somebody owns that nobody owns, which is nothing, and the
   * service answers exactly that rather than picking one of the two.
   */
  withoutOwner?: boolean;
  /** ISO 8601. Inclusive lower bound on `createdAt`. */
  createdAfter?: string;
  /** ISO 8601. Exclusive upper bound on `createdAt`. */
  createdBefore?: string;
}

export type AdminZonePage = Paginated<AdminZoneView>;

/**
 * A zone with its owner's name attached, composed by the gateway (plan 0074,
 * section 3).
 *
 * **The join that does not exist.** Zones are in core's database and users are in
 * auth's, with no foreign key between them and deliberately never one. So the
 * gateway asks core for a page of zones and then asks auth, in **one** batched
 * call, for the names behind the owner ids on it. Not a SQL join, not a call per
 * row, and not something core could do for itself.
 *
 * `ownerName` is a plain string rather than a nullable one for a zone that has an
 * owner, because the fallback is the id: an id auth cannot resolve, a reaped user,
 * or a row that lost its owner mid request, renders as the id it already had.
 * That is section 3's rule stated in the type. A decoration that failed must
 * never fail the listing it decorates, so there is no shape here in which the
 * absence of a name is an error.
 */
export interface AdminZoneRowView extends AdminZoneView {
  /**
   * The owner's username, the owner's id when auth could not resolve it, or null
   * when the zone has no owner at all.
   */
  ownerName: string | null;
}

export type AdminZoneRowPage = Paginated<AdminZoneRowView>;

export interface GetAdminZoneRequest extends AdminCredential {
  zoneId: string;
}

export interface AdminZoneIdRequest extends AdminCredential {
  zoneId: string;
}

/** Kick, ban, or hand the zone to this membership. */
export interface AdminMembershipActionRequest extends AdminCredential {
  zoneId: string;
  membershipId: string;
}

export type AdminMembershipActionResult = MembershipView;

/**
 * Change a zone's name, its config, or both (plan 0077, section 4.1).
 *
 * A field left `undefined` is left alone, which is the same rule
 * `UpdateZoneRequest` carries: a partial edit must not be a way to blank the
 * field the screen did not render.
 */
export interface UpdateAdminZoneRequest extends AdminCredential {
  zoneId: string;
  name?: string;
  config?: Record<string, unknown>;
}

/**
 * Mark a zone for deletion, or restore it (plan 0077, section 4.2).
 *
 * One boolean rather than two nullable columns, because `status` and
 * `markedForDeletionAt` are one decision: a `MARKED_FOR_DELETION` zone with no
 * marker is never removed by the reaper, and an `ACTIVE` zone with one is removed
 * anyway.
 */
export interface SetAdminZoneDeletionMarkRequest extends AdminCredential {
  zoneId: string;
  /** True marks the zone and stamps the moment; false clears both. */
  marked: boolean;
}

/** A page of one zone's memberships (plan 0077, section 9). */
export interface ListAdminMembershipsRequest
  extends AdminCredential, PageQuery {
  zoneId: string;
}

export type AdminMembershipPage = Paginated<AdminZoneMemberView>;

/** One membership, read through its own address. */
export interface GetAdminMembershipRequest extends AdminCredential {
  zoneId: string;
  membershipId: string;
}

/**
 * A membership's role and its per zone name (plan 0077, section 4.3).
 *
 * `role` keeps the refusals `setRole` already carries: assigning `OWNER` is
 * refused, because ownership is a transfer and the transfer is a transaction, and
 * demoting the current owner is refused for the same reason. `status` is absent
 * on purpose; it is the four verbs beside this one.
 */
export interface UpdateAdminMembershipRequest extends AdminCredential {
  zoneId: string;
  membershipId: string;
  role?: ZoneRole;
  /** The per zone name, which is the only personal field a membership holds. */
  username?: string;
}

/** A rejected membership is removed, so the result is the id that is gone. */
export interface AdminMembershipRejectResult {
  id: string;
}

/**
 * A shopping list as the back office lists them.
 *
 * `zoneName` is carried because it is a join core can actually make, unlike the
 * owner's name: the zone is in the same database and the same query. Nothing here
 * is caller relative, which is why this is not `ListView`: that shape's
 * `permissions` field answers "what may **you** do with this list", and for an
 * operator the honest answer is not a permission set.
 */
export interface AdminListView {
  id: string;
  zoneId: string;
  zoneName: string;
  name: string;
  createdByUserId: string;
  autoApproveLines: boolean;
  sharedWithZone: boolean;
  lineCount: number;
  /** ISO 8601 UTC. */
  createdAt: string;
  /** ISO 8601 UTC. */
  updatedAt: string;
}

/** One line, on the list detail read and nowhere else. */
export interface AdminListLineView {
  id: string;
  content: string;
  quantity: number;
  approvalStatus: LineApprovalStatus;
  createdByUserId: string;
  /** ISO 8601 UTC. */
  createdAt: string;
  /** ISO 8601 UTC. */
  updatedAt: string;
}

export interface AdminListDetailView extends AdminListView {
  lines: AdminListLineView[];
}

/** Shopping lists, by the zone they are in or the person who created them. */
export interface ListAdminListsRequest extends AdminCredential, PageQuery {
  zoneId?: string;
  /** The user who created the list, which is not necessarily the zone's owner. */
  createdByUserId?: string;
}

export type AdminListPage = Paginated<AdminListView>;

export interface GetAdminListRequest extends AdminCredential {
  listId: string;
}

/**
 * A list's name and its two flags (plan 0077, section 5.1), which is everything
 * `UpdateListRequest` carries.
 *
 * `sharedWithZone` is a real field and not a trap, and it is asymmetric: turning
 * it on grants `{READ, WRITE, DECIDE}` to every currently approved non staff
 * member, and turning it off revokes nobody. The mistake to prevent is an
 * operator who toggles it off and expects the list to close.
 */
export interface UpdateAdminListRequest extends AdminCredential {
  listId: string;
  name?: string;
  autoApproveLines?: boolean;
  sharedWithZone?: boolean;
}

/** Delete a list, or address one for a read that takes no other argument. */
export interface AdminListIdRequest extends AdminCredential {
  listId: string;
}

/** A page of one list's lines (plan 0077, section 9). */
export interface ListAdminListLinesRequest extends AdminCredential, PageQuery {
  listId: string;
}

export type AdminListLinePage = Paginated<AdminListLineView>;

/** One line, read through its own address. */
export interface GetAdminListLineRequest extends AdminCredential {
  listId: string;
  lineId: string;
}

/**
 * Edit a line's content, quantity or product set (plan 0077, section 5.2).
 *
 * The operator edits with `MANAGE`, so this reaches every field a member holding
 * `MANAGE` reaches and the edit leaves an approved line approved. A `REJECTED`
 * line still reopens, because that rule applies to everyone.
 *
 * Reordering is not here: it is a whole order rather than a field, and it has no
 * meaning outside the screen a member drags rows on. Creating a line is not here
 * either, because `createdByUserId` is not nullable and an operator is not a
 * user (section 6.4).
 */
export interface UpdateAdminListLineRequest extends AdminCredential {
  listId: string;
  lineId: string;
  content?: string;
  quantity?: number;
  /** The whole product set. An empty array returns the line to free text. */
  itemIds?: string[];
}

/** Approve or reject one line. */
export interface SetAdminLineApprovalRequest extends AdminCredential {
  listId: string;
  lineId: string;
  status: LineApprovalStatus;
}

/** Delete one line. */
export interface DeleteAdminListLineRequest extends AdminCredential {
  listId: string;
  lineId: string;
}

/** A deleted line is gone, so the result is the id that was. */
export interface AdminLineDeleteResult {
  id: string;
}

/**
 * A generated shopping list, which is the basket somebody took to the shop
 * (plan 0050).
 *
 * It belongs to a person rather than to a zone, which is why `ownerUserId` is not
 * nullable and there is no `zoneId`. A basket is nevertheless **in** zones, in
 * the sense that its lines came from lists in them, and `zoneIds` reports the
 * distinct zones its line origins name. That is also what the `zoneId` filter
 * matches on, because the alternative, the default target list's zone, is null on
 * every basket nobody chose a destination for.
 */
export interface AdminBasketView {
  id: string;
  ownerUserId: string;
  /** Null is not missing: an unnamed basket displays as its generation date. */
  name: string | null;
  status: GeneratedListStatus;
  /** The distinct zones this basket's lines were drawn from. May be empty. */
  zoneIds: string[];
  lineCount: number;
  /** ISO 8601 UTC. */
  generatedAt: string;
  /** ISO 8601 UTC. */
  createdAt: string;
  /** ISO 8601 UTC. */
  updatedAt: string;
}

/** One basket line, on the detail read only. */
export interface AdminBasketLineView {
  id: string;
  content: string;
  quantity: number;
  /** ISO 8601 UTC. */
  createdAt: string;
}

export interface AdminBasketDetailView extends AdminBasketView {
  lines: AdminBasketLineView[];
}

/** Baskets, by owner or by a zone their lines came from. */
export interface ListAdminBasketsRequest extends AdminCredential, PageQuery {
  ownerUserId?: string;
  /** Baskets with at least one line origin in this zone. */
  zoneId?: string;
}

export type AdminBasketPage = Paginated<AdminBasketView>;

export interface GetAdminBasketRequest extends AdminCredential {
  basketId: string;
}
