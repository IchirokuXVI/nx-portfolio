import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ListPermission, ZoneRole } from '@portfolio/luna-shopper/contracts';
import {
  ForbiddenException,
  NotFoundException,
} from '@portfolio/luna-shopper/platform';
import { Repository } from 'typeorm';
import { ListAccess, ListLine, ShoppingList } from '../entities';
import { ZoneAuthzService } from '../zones/zone-authz.service';
import { ZONE_READABLE_LIST_IDS_SQL } from '../zones/zone-summary.sql';

/** Everything a zone OWNER or ADMIN holds on every list in their zone. */
export const ALL_LIST_PERMISSIONS: readonly ListPermission[] = [
  ListPermission.READ,
  ListPermission.WRITE,
  ListPermission.DECIDE,
  ListPermission.MANAGE,
];

/**
 * The part of a membership row the permission answer actually reads.
 *
 * Structural rather than the `ZoneMembership` entity so the resolver states what
 * it depends on, and so a caller holding a membership from a query that selected
 * two columns can pass it without loading the rest of the row.
 */
export interface ResolvedMembership {
  id: string;
  role: ZoneRole;
}

/**
 * A list and what the caller may do on it, resolved together.
 *
 * Several call sites need the set itself rather than a yes or no: `line.update`
 * branches on which of `WRITE`, `DECIDE` and `MANAGE` the caller holds (plan
 * 0036, section 4.1), and every path returning a `ListView` has to fill
 * `myPermissions` (section 7). Handing both back from one call is what stops
 * those sites resolving the same membership twice.
 */
export interface ListWithPermissions {
  list: ShoppingList;
  permissions: Set<ListPermission>;
  /**
   * The caller's membership in the list's zone, always APPROVED.
   *
   * It rides along because `setAccess` has to know whether the caller is group
   * staff, which is a different question from whether they hold `MANAGE`, and
   * asking for it separately would be the second membership lookup this whole
   * interface exists to avoid.
   */
  membership: ResolvedMembership;
}

/**
 * Authorization for lists, lines and comments (plan 0007 section 4; plan 0036).
 *
 * Every check runs against core's own membership and list access tables using
 * the token `userId`, and every one of them is now the same two steps: resolve
 * the caller's effective permission set once, then ask whether one member is in
 * it. There is exactly one place that knows a zone OWNER or ADMIN is special,
 * {@link permissionsFor}, and one place that knows an unapproved member is
 * refused before any of it, `ZoneAuthzService.requireApproved`.
 *
 * The old shape had three checks with three different ideas of who was in
 * charge: reading admitted "manager" status, writing admitted only an exact
 * `WRITER` row and no manager at all, and managing admitted the list's creator
 * but never a row. Plan 0036 section 1 lists the four things that model could
 * not say, each of which somebody had already hit.
 */
@Injectable()
export class ListAccessService {
  constructor(
    @InjectRepository(ShoppingList)
    private readonly lists: Repository<ShoppingList>,
    @InjectRepository(ListAccess)
    private readonly access: Repository<ListAccess>,
    @InjectRepository(ListLine)
    private readonly lines: Repository<ListLine>,
    private readonly zoneAuthz: ZoneAuthzService
  ) {}

  async getList(listId: string): Promise<ShoppingList> {
    const list = await this.lists.findOne({ where: { id: listId } });
    if (!list) {
      throw new NotFoundException('List not found');
    }
    return list;
  }

  async getLine(lineId: string): Promise<ListLine> {
    const line = await this.lines.findOne({ where: { id: lineId } });
    if (!line) {
      throw new NotFoundException('Line not found');
    }
    return line;
  }

  /**
   * The caller's effective permissions on a list (plan 0036, section 4). Empty
   * means no access at all.
   *
   * It resolves the membership once and answers from one of three sources, in
   * this order:
   *
   * 1. a zone OWNER or ADMIN holds all four, derived and never stored, so a
   *    promotion is one `UPDATE` on one membership row that is instantly correct
   *    on every list rather than a write per list that can drift halfway (section
   *    2.4);
   * 2. otherwise the stored `list_access` row's set, which already contains
   *    `READ` because `setAccess` puts it there (section 2.2);
   * 3. otherwise nothing.
   *
   * A caller with no approved membership never reaches any of that: the
   * membership check throws first, and its exception is what the frontend keys
   * off to tell "you are not in this group" apart from "you are, but not on this
   * list".
   */
  async permissionsFor(
    list: ShoppingList,
    userId: string
  ): Promise<Set<ListPermission>> {
    const membership = await this.zoneAuthz.requireApproved(
      list.zoneId,
      userId
    );
    return this.permissionsForMembership(list.id, membership);
  }

  /**
   * The same answer as {@link permissionsFor} for a membership already in hand.
   *
   * `ListService.list` resolves the caller's membership once for a whole page and
   * must not resolve it again per row, so the half of the resolver that does not
   * need the membership lookup is reachable on its own.
   */
  async permissionsForMembership(
    listId: string,
    membership: ResolvedMembership
  ): Promise<Set<ListPermission>> {
    if (isZoneStaff(membership)) {
      return new Set(ALL_LIST_PERMISSIONS);
    }
    const access = await this.access.findOne({
      where: { listId, membershipId: membership.id },
    });
    return new Set(access?.permissions ?? []);
  }

  /**
   * The list plus the caller's set, for the callers that need both.
   *
   * The `require*` methods below are this method with a membership test and a
   * message attached, and they still return the `ShoppingList` because that is
   * what every call site went on to use.
   */
  async resolve(listId: string, userId: string): Promise<ListWithPermissions> {
    const list = await this.getList(listId);
    const membership = await this.zoneAuthz.requireApproved(
      list.zoneId,
      userId
    );
    return {
      list,
      membership,
      permissions: await this.permissionsForMembership(list.id, membership),
    };
  }

  /**
   * Every list in a zone this caller may read (plan 0032, section 4.1).
   *
   * The set behind {@link requireRead}, asked once for a whole zone instead of
   * once per list. The realtime service turns it into a presence room per list at
   * `zone.subscribe` time, which is the only way a group page can show who is
   * shopping from each of its rows without opening a room per row.
   *
   * It is the query the zone summary already runs, without the preview's limit
   * and selecting only ids, so the rooms and the card a client is looking at
   * cannot disagree. A caller with no approved membership matches nothing and
   * gets an empty set rather than an error, because the zone check beside it is
   * what answers whether they belong here at all.
   */
  async readableListIds(zoneId: string, userId: string): Promise<string[]> {
    const rows = await this.lists.query<{ id: string }[]>(
      ZONE_READABLE_LIST_IDS_SQL,
      [zoneId, userId]
    );
    return rows.map((row) => row.id);
  }

  /** Requires `READ`: see the list and everything on it (plan 0036). */
  async requireRead(listId: string, userId: string): Promise<ShoppingList> {
    return (await this.requireAccess(listId, userId, ListPermission.READ)).list;
  }

  /** Requires `WRITE`: add lines, edit unapproved ones, reorder, comment. */
  async requireWrite(listId: string, userId: string): Promise<ShoppingList> {
    return (await this.requireAccess(listId, userId, ListPermission.WRITE))
      .list;
  }

  /**
   * Requires `DECIDE`: approve, reject, set the item status, and change an
   * approved line's quantity (plan 0036, section 1.2).
   *
   * New with the permission set. Approving used to be a property of the **group**
   * rather than of the list, so the person who actually walks the aisle could
   * only be allowed to say "yes, that one goes in" by being made an admin of the
   * whole group.
   */
  async requireDecide(listId: string, userId: string): Promise<ShoppingList> {
    return (await this.requireAccess(listId, userId, ListPermission.DECIDE))
      .list;
  }

  /** Requires `MANAGE`: govern the list, its access table and any of its lines. */
  async requireManage(listId: string, userId: string): Promise<ShoppingList> {
    return (await this.requireAccess(listId, userId, ListPermission.MANAGE))
      .list;
  }

  /**
   * One membership test against {@link permissionsFor}, keeping the whole set.
   *
   * The four `require*` methods above are this method and a field access, and
   * they still hand back the `ShoppingList` because that is what their call sites
   * went on to use. Callers that need the set as well ask here instead: `line.add`
   * has to know whether the writer also holds `DECIDE` (plan 0037, section 2),
   * `line.update` branches three ways on `WRITE`, `DECIDE` and `MANAGE` (plan
   * 0036, section 4.1), and both would otherwise resolve the same membership
   * twice to learn something the first resolution already knew.
   */
  async requireAccess(
    listId: string,
    userId: string,
    permission: ListPermission
  ): Promise<ListWithPermissions> {
    const resolved = await this.resolve(listId, userId);
    if (!resolved.permissions.has(permission)) {
      throw new ForbiddenException(REFUSALS[permission]);
    }
    return resolved;
  }
}

/**
 * What a caller is told when they lack a permission.
 *
 * One message per permission, in one place, because these reach a person: a
 * refusal that says "you do not have access to this list" to somebody looking at
 * the list they can plainly see is the frontend's problem to explain away
 * forever.
 */
const REFUSALS: Record<ListPermission, string> = {
  [ListPermission.READ]: 'You do not have access to this list',
  [ListPermission.WRITE]: 'You need write access to this list',
  [ListPermission.DECIDE]: 'You need approval rights on this list',
  [ListPermission.MANAGE]: 'You need to be an admin of this list to do that',
};

/**
 * Whether a membership carries the derived grant of all four permissions.
 *
 * Exported as a plain function because `ListService.list` asks the same question
 * of the one membership it resolved for the page, and answering it twice in two
 * shapes is how the two would eventually disagree.
 */
export function isZoneStaff(membership: { role: ZoneRole }): boolean {
  return (
    membership.role === ZoneRole.OWNER || membership.role === ZoneRole.ADMIN
  );
}
