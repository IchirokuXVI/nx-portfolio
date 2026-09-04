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
 * **Read, plus named actions. Not CRUD** (plan 0074, section 1). A list line
 * participates in settlements, generated list bindings, permission sets and
 * realtime broadcasts other clients have already applied, and the invariants live
 * in services rather than in constraints. So the writes here are the five actions
 * of section 1 and each delegates to the code that maintains the invariant. There
 * is no update subject over any core row and, by section 9, there will not be one.
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
} as const;

export const ADMIN_MEMBERSHIP_PATTERNS = {
  /** Kick a member, the write `membership.kick` performs. */
  kick: 'adminMembership.kick',
  /** Ban a member, the write `membership.ban` performs. */
  ban: 'adminMembership.ban',
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
 */
export interface ListAdminZonesRequest extends AdminCredential, PageQuery {
  /** The user whose zones these are, as owner or as member of any status. */
  targetUserId?: string;
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
