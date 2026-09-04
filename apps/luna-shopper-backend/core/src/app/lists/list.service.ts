import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  LIST_HOLDING_ITEM_LIMITS,
  ListPermission,
  RealtimeEvent,
  ZoneRole,
  type CreateListRequest,
  type GetListAccessRequest,
  type ListAccessView,
  type ListCounts,
  type ListIdRequest,
  type ListListsRequest,
  type ListMyAccessChangedEvent,
  type ListOrder,
  type ListPage,
  type ListsHoldingItemRequest,
  type ListsHoldingItemResult,
  type ListView,
  type SetListAccessRequest,
  type UpdateListRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  clampPageSize,
  decodeCursor,
  encodeCursor,
  ForbiddenException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import {
  DataSource,
  In,
  Repository,
  type EntityManager,
  type SelectQueryBuilder,
} from 'typeorm';
import { CoreAuditService } from '../audit/core-audit.service';
import { ListAccess, ShoppingList, ZoneMembership } from '../entities';
import { CoreEventsPublisher } from '../events/core-events.publisher';
import { ZoneAuthzService } from '../zones/zone-authz.service';
import { ZoneCountsService } from '../zones/zone-counts.service';
import { LIST_COUNTS_COLUMN, LIST_COUNTS_SQL } from '../zones/zone-summary.sql';
import {
  ALL_LIST_PERMISSIONS,
  isZoneStaff,
  ListAccessService,
} from './list-access.service';
import {
  LISTS_HOLDING_ITEM_SQL,
  type ListHoldingItemRow,
} from './list-holding.sql';
import { EMPTY_LIST_COUNTS, toListView } from './list.mappers';
import {
  SHARED_WITH_ZONE_PERMISSIONS,
  SharedListGrantService,
  type GrantedAccess,
} from './shared-list-grant.service';

/**
 * Canonical UUID shape, for validating the cross-service catalog `itemId` (plan
 * 0053, section 3). The same check `SettlementService` applies to the same field,
 * for the same reason: core does not hold the catalog and cannot ask it.
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ListCursor {
  order: ListOrder;
  value: string;
  id: string;
}

/** The three list fields an edit may name (plan 0077, section 5.1). */
interface ListChanges {
  name?: string;
  autoApproveLines?: boolean;
  sharedWithZone?: boolean;
}

/**
 * Where a list edit is written, and how the row it saves is recorded.
 *
 * The edit's transaction has to hold the grant beside the list (plan 0042,
 * section 2.2) and, on the operator path, the audit row as well (plan 0077,
 * section 8). Handing the body both the manager and the save is what lets one
 * body serve a member's write, which records nothing, and an operator's, which
 * records the row it saved in the transaction that saved it.
 */
type ListWrite = (
  work: (
    manager: EntityManager,
    save: (list: ShoppingList) => Promise<ShoppingList>
  ) => Promise<ShoppingList>
) => Promise<ShoppingList>;

/**
 * The set `setAccess` will actually store for one entry (plan 0036, rule 4).
 *
 * Two implications are applied here, at the write boundary, rather than by every
 * predicate that later asks a question of the stored set. That is what keeps each
 * check in section 4's table a single literal membership test: nothing has to
 * remember to imply anything, and `myPermissions` on the wire is the whole truth
 * about a caller rather than a seed the client has to expand the same way.
 *
 * - **`READ` is added to any non-empty set** (section 2.2).
 * - **`MANAGE` brings `WRITE` and `DECIDE` with it**, because section 2's table
 *   defines it as everything above it plus governing the list, and the
 *   requirement it comes from says a list admin "has all other permissions".
 *   Without this a group admin could grant `{READ, MANAGE}` and create somebody
 *   who may rename the list, delete any line on it and decide who else may use
 *   it, yet may not add a line, which is not a person anybody meant to describe.
 *
 * Duplicates are dropped and the members come out in one fixed order, so a stored
 * row does not depend on the order a client happened to tick four checkboxes in.
 * An empty set stays empty: that is the request to delete the row (section 2.2),
 * not a set to be widened.
 */
function normalizeGrant(
  requested: readonly ListPermission[]
): ListPermission[] {
  if (requested.length === 0) {
    return [];
  }
  const wanted = new Set<ListPermission>([...requested, ListPermission.READ]);
  if (wanted.has(ListPermission.MANAGE)) {
    wanted.add(ListPermission.WRITE);
    wanted.add(ListPermission.DECIDE);
  }
  return ALL_LIST_PERMISSIONS.filter((permission) => wanted.has(permission));
}

@Injectable()
export class ListService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ShoppingList)
    private readonly lists: Repository<ShoppingList>,
    @InjectRepository(ListAccess)
    private readonly access: Repository<ListAccess>,
    private readonly authz: ZoneAuthzService,
    private readonly listAccess: ListAccessService,
    private readonly sharedGrant: SharedListGrantService,
    private readonly zoneCounts: ZoneCountsService,
    private readonly events: CoreEventsPublisher,
    // `@Global()`, so the operator writes below reach the trail without any
    // caller having to hand it one (plan 0077, section 8).
    private readonly audit: CoreAuditService
  ) {}

  /**
   * The line totals for one list (plan 0017, section 3.4), from the same
   * aggregate the zone preview uses. Needed by the single list mutations, which
   * return a `ListView` without having run a listing query.
   */
  private async countsFor(listId: string): Promise<ListCounts> {
    const row = await this.lists
      .createQueryBuilder('l')
      .select(LIST_COUNTS_SQL, LIST_COUNTS_COLUMN)
      .where('l.id = :listId', { listId })
      .getRawOne<Record<string, ListCounts | null>>();
    return row?.[LIST_COUNTS_COLUMN] ?? EMPTY_LIST_COUNTS;
  }

  /**
   * Create a list (plan 0007, section 2): any approved member of the zone.
   *
   * ## The creator holds all four, as a row (plan 0036, section 2.5)
   *
   * `{READ, WRITE, DECIDE, MANAGE}`, written in the same transaction as the list.
   * Their governing power used to be derived from `createdByUserId` inside
   * `isManager`, which made it exactly as irrevocable as a group admin's, and the
   * requirement asks for the opposite: a group admin must be able to revoke a
   * creator's access. So it is an ordinary row a group admin can rewrite, down to
   * and including deleting it. `createdByUserId` stays on the list as the honest
   * answer to who made it, and stops being an authorization input.
   *
   * ## Shared with the group unless the creator says otherwise (plan 0034)
   *
   * `shareWithZone` grants every **other approved** member `{READ, WRITE,
   * DECIDE}` in the same transaction, so a list is never briefly visible to
   * nobody and a failed grant does not leave one behind that only its creator can
   * open.
   *
   * **Those three and not just read**, which is the decision in this method worth
   * arguing about. This app's lists are shopped from: the thing a member does
   * with one is add to it and tick a line off in an aisle, and a reader can do
   * neither. A group of readers watching one person shop is not a household
   * shopping list, it is a document. `0034` made that argument when the only
   * vocabulary available was a role called WRITER; with `DECIDE` split out of it,
   * granting write alone would ship the exact failure `0034` exists to prevent, a
   * newly shared list on which only its creator can tick anything off. A group
   * that wants approval to mean something narrows the grant in the share sheet,
   * once per list, which is where every other exception to a default here lives.
   *
   * `MANAGE` is not in it, because governing the list is the thing the creator
   * kept, and only group staff may hand that bit out afterwards (section 5).
   *
   * Pending and rejected memberships are left out. A member approved **later** is
   * no longer the gap it was: `shareWithZone` is stored on the list as
   * `sharedWithZone` and the approval path reads it (plan 0042, section 2).
   *
   * ## No row is written for a staff membership (plan 0042, section 1.2)
   *
   * Neither the creator's, when the creator is the group's owner or an admin,
   * nor the shared grant's, for the other admins. Such a row is meaningless,
   * because staff hold all four by derivation whether it exists or not, and it is
   * exactly the row `setAccess` rule 2 refuses: the creator of the first list in
   * a new group is that group's owner, so a staff row was in the access table of
   * essentially every list in the product, the read returned it, and the share
   * sheet handed it straight back to a write that rejected it. Nothing is lost by
   * not writing it, and the feature that has never worked starts working.
   */
  async create(req: CreateListRequest): Promise<ListView> {
    const membership = await this.authz.requireApproved(req.zoneId, req.userId);
    // Absent means shared. See `CreateListRequest.shareWithZone`: a client written
    // before this field existed must keep getting what it always got.
    const sharedWithZone = req.shareWithZone !== false;

    const list = await this.dataSource.transaction(async (manager) => {
      const list = await manager.getRepository(ShoppingList).save(
        manager.getRepository(ShoppingList).create({
          zoneId: req.zoneId,
          name: req.name,
          createdByUserId: req.userId,
          sharedWithZone,
        })
      );

      const membershipIds = sharedWithZone
        ? await this.sharedGrant.grantableMembershipIds(
            manager,
            req.zoneId,
            membership.id
          )
        : [];

      const rows = membershipIds.map((membershipId) =>
        manager.getRepository(ListAccess).create({
          listId: list.id,
          membershipId,
          permissions: [...SHARED_WITH_ZONE_PERMISSIONS],
        })
      );
      // The creator's own row, unless the creator is staff and it would say
      // nothing they do not already hold.
      if (!isZoneStaff(membership)) {
        rows.unshift(
          manager.getRepository(ListAccess).create({
            listId: list.id,
            membershipId: membership.id,
            permissions: [...ALL_LIST_PERMISSIONS],
          })
        );
      }
      if (rows.length > 0) {
        await manager.getRepository(ListAccess).save(rows);
      }
      return list;
    });

    // A list with no lines yet, so its counts are known without a query. The
    // creator is the only caller this can be answered for, and they hold
    // everything: either the row just written, or the staff grant on top of it.
    const view = toListView(
      list,
      EMPTY_LIST_COUNTS,
      new Set(ALL_LIST_PERMISSIONS)
    );
    this.events.emit(RealtimeEvent.ListCreated, req.zoneId, view, view.id);
    await this.zoneCounts.emitZoneCounts(req.zoneId);
    return view;
  }

  /**
   * Choose what each named member may do on a list (plan 0036, section 5).
   * `MANAGE` only.
   *
   * Five rules, applied in this order, and the order is load bearing:
   *
   * 1. **The caller holds `MANAGE`.** Unchanged in spirit, narrower in fact: it
   *    is a permission now rather than creator-or-staff.
   * 2. **An entry naming a zone OWNER or ADMIN is rejected.** Their grant is
   *    derived and there is nothing stored to change, so the row would be
   *    meaningless whoever wrote it, including a caller who is staff themselves.
   *    Refused rather than quietly dropped, so the caller is told rather than
   *    left believing they did something.
   * 3. **Only a zone OWNER or ADMIN may change the `MANAGE` bit**, in either
   *    direction, compared against what the stored row already holds. `MANAGE`
   *    is not a stronger version of the permissions beside it: the other three
   *    say what you may do to the list's contents and this one says who else may
   *    do anything at all, so a permission that could grant itself would have no
   *    ceiling. Symmetric on purpose, because revoking it is the same power as
   *    granting it.
   * 4. **`READ` is added to any non-empty set**, which is what lets every
   *    predicate elsewhere ask for `READ` literally (section 2.2).
   * 5. **An empty set deletes the row.** No row is the single representation of
   *    no access, and revoking is therefore the same call as granting, so a share
   *    sheet has one save button rather than a save and a remove.
   *
   * Rule 3 is checked before rule 5 applies, which is why a non-staff list admin
   * clearing a row that holds `MANAGE` is refused: an empty set is a `MANAGE`
   * change like any other, and checking them the other way round would be an
   * obvious hole (section 5.1).
   *
   * It replaces each named membership's set outright and leaves unnamed
   * memberships alone. Not `PATCH` semantics on the set, because a share sheet
   * holds the whole answer for a row in front of the person pressing save, and
   * two ways to express one change is two ways to express it wrongly.
   */
  async setAccess(req: SetListAccessRequest): Promise<{ listId: string }> {
    const { list, permissions, membership } = await this.listAccess.resolve(
      req.listId,
      req.userId
    );
    // Rule 1.
    if (!permissions.has(ListPermission.MANAGE)) {
      throw new ForbiddenException(
        'You need to be an admin of this list to change who may use it'
      );
    }
    // Holding MANAGE and being group staff are different questions, and rule 3
    // is the whole of the asymmetry between them. The membership came back with
    // the permissions, so asking costs nothing.
    const callerIsStaff = isZoneStaff(membership);

    /** Each affected membership's user and new effective set, for the events. */
    const affected: { userId: string; permissions: ListPermission[] }[] = [];

    await this.dataSource.transaction(async (manager) => {
      const accessRepo = manager.getRepository(ListAccess);
      for (const entry of req.entries) {
        // The entry names a membership rather than a user, so the zone it belongs
        // to is checked here: a membership id from another group would otherwise
        // write a row on this list that nothing in this group can see or revoke.
        const target = await manager
          .getRepository(ZoneMembership)
          .findOne({ where: { id: entry.membershipId } });
        if (!target || target.zoneId !== list.zoneId) {
          throw new ForbiddenException(
            'That member does not belong to this group'
          );
        }
        // Rule 2.
        if (isZoneStaff(target)) {
          throw new ForbiddenException(
            'Group admins always have full access to every list in the group, so their access cannot be changed here'
          );
        }

        const existing = await accessRepo.findOne({
          where: { listId: req.listId, membershipId: entry.membershipId },
        });

        // Rule 4, before rule 3 reads the requested set, so that adding READ can
        // never be mistaken for a MANAGE change and an empty set stays empty.
        const requested = normalizeGrant(entry.permissions);

        // Rule 3.
        const held = (existing?.permissions ?? []).includes(
          ListPermission.MANAGE
        );
        const wanted = requested.includes(ListPermission.MANAGE);
        if (held !== wanted && !callerIsStaff) {
          throw new ForbiddenException(
            'Only a group admin can make somebody an admin of this list, or take it away'
          );
        }

        // Rule 5.
        if (requested.length === 0) {
          if (existing) {
            await accessRepo.delete({ id: existing.id });
          }
        } else if (existing) {
          existing.permissions = requested;
          await accessRepo.save(existing);
        } else {
          await accessRepo.save(
            accessRepo.create({
              listId: req.listId,
              membershipId: entry.membershipId,
              permissions: requested,
            })
          );
        }

        affected.push({ userId: target.userId, permissions: requested });
      }
    });

    // The room event, unchanged: it still correctly says "the access table for
    // this list changed" to the people watching it, and the room sweeps use it to
    // re-evaluate rooms (plan 0036, section 8).
    this.events.emit(
      RealtimeEvent.ListAccessChanged,
      list.zoneId,
      {
        listId: req.listId,
      },
      req.listId
    );

    // ...and one event per affected person, on their own channel, because the
    // room event names nobody and by construction cannot reach the one person it
    // most needs to: somebody just **granted** access was never in the room to
    // hear it. One event each rather than one for all of them, since the payload
    // is that person's own new set and no two need be the same. The audience
    // carries the zone and the list as well as the user, so the event reaches
    // them whether or not they hold either room.
    for (const member of affected) {
      const payload: ListMyAccessChangedEvent = {
        listId: req.listId,
        zoneId: list.zoneId,
        permissions: member.permissions,
      };
      this.events.emitTo(
        RealtimeEvent.ListMyAccessChanged,
        { userIds: [member.userId], zoneId: list.zoneId, listId: req.listId },
        payload
      );
    }
    return { listId: req.listId };
  }

  /**
   * Read a list's stored access table (plan 0036, section 6). `MANAGE` only.
   *
   * Stored rows only, and **never a row for a staff membership** (plan 0042,
   * section 1.2). Plan 0036 said staff were absent by construction, which was
   * true of what the checks read and not of what the table contains: creation
   * wrote the creator's row whoever they were, and the shared grant wrote one for
   * every other approved member including the other admins. So the read returned
   * rows the write refuses, and the share sheet, which sent back what it was
   * given, could not be saved on any list in a group that has an owner, which is
   * every group.
   *
   * The filter is on the membership's **current** role rather than on anything
   * recorded on the access row, and that is the part worth reading twice. A
   * member with an ordinary stored row who is promoted to admin has an inert row:
   * the derived grant is wider than anything it says, so returning it would offer
   * to change something that cannot change. Demoted again, the same row becomes
   * meaningful and comes back holding exactly what they held before, which is the
   * best available answer and is free. Nothing deletes those rows for the same
   * reason.
   *
   * `MANAGE` rather than `READ`, though `READ` is otherwise genuinely everything
   * else on a list: who else can write to a list is governance, not content.
   *
   * It is the missing half of a share sheet that already exists. A sheet that
   * could write the access table but not read it would revoke everybody it did
   * not happen to include.
   */
  async getAccess(req: GetListAccessRequest): Promise<ListAccessView> {
    await this.listAccess.requireManage(req.listId, req.userId);
    const rows = await this.access
      .createQueryBuilder('a')
      .innerJoin(ZoneMembership, 'm', 'm.id = a."membershipId"')
      .where('a."listId" = :listId', { listId: req.listId })
      .andWhere('m.role NOT IN (:...staff)', {
        staff: [ZoneRole.OWNER, ZoneRole.ADMIN],
      })
      .orderBy('a.createdAt', 'ASC')
      .addOrderBy('a.id', 'ASC')
      .getMany();
    return {
      listId: req.listId,
      entries: rows.map((row) => ({
        membershipId: row.membershipId,
        permissions: row.permissions,
      })),
    };
  }

  /**
   * Rename a list, or change its configuration (plan 0007, section 2; plan 0037,
   * section 3). `MANAGE`.
   *
   * `autoApproveLines` is configuration rather than a preference, which is
   * exactly what gating it on `MANAGE` means. It does not act retroactively:
   * turning it on leaves existing pending lines pending, because they are
   * somebody's outstanding question and a settings toggle is not an answer to it.
   *
   * ## `sharedWithZone` is the same kind of field and not the same kind of change
   *
   * It is list configuration gated on `MANAGE` like everything else here, but the
   * two directions are deliberately asymmetric (plan 0042, section 2.2):
   *
   * - **off to on** grants `{READ, WRITE, DECIDE}` to every currently approved
   *   non staff member, exactly as creation does, widening rather than replacing
   *   what anybody already holds. Somebody who had `MANAGE` keeps it.
   * - **on to off revokes nobody.** It stops the *next* person being granted, and
   *   every existing row stays. Somebody who turns it off to keep new members out
   *   and thereby silently removes eight people from a list they have been using
   *   all week has been handed a control that does something other than what it
   *   says. Removing one person is one row in the share sheet.
   *
   * The write and the grant share one transaction, so a list is never briefly
   * marked shared with nobody granted, or granted with the flag unset.
   */
  async update(req: UpdateListRequest): Promise<ListView> {
    const { list, permissions } = await this.listAccess.resolve(
      req.listId,
      req.userId
    );
    if (!permissions.has(ListPermission.MANAGE)) {
      throw new ForbiddenException(
        'You need to be an admin of this list to change it'
      );
    }
    return this.applyListUpdate(list, req, permissions, (work) =>
      this.dataSource.transaction((manager) =>
        work(manager, (row) => manager.getRepository(ShoppingList).save(row))
      )
    );
  }

  /**
   * Rename a list, or change its configuration, for an operator (plan 0077,
   * section 5.1).
   *
   * The three fields are everything `UpdateListRequest` carries, and
   * `sharedWithZone` keeps its asymmetry exactly: turning it **on** grants
   * `{READ, WRITE, DECIDE}` to every currently approved non staff member, and
   * turning it **off revokes nobody**. That is the member facing behaviour rather
   * than an omission, and it is not something an operator write gets to correct:
   * a control that silently removed eight people from a list they have been using
   * all week does something other than what it says. The back office carries that
   * sentence beside the field.
   *
   * The answer the caller gets says `MANAGE`, because that is what the operator
   * did, and the alternative is a view whose `myPermissions` claims the writer of
   * the change could not have made it.
   */
  async updateAsOperator(
    listId: string,
    changes: ListChanges,
    actorId: string
  ): Promise<ListView> {
    const list = await this.listAccess.getList(listId);
    const before = { ...list };
    return this.applyListUpdate(
      list,
      changes,
      new Set(ALL_LIST_PERMISSIONS),
      (work) =>
        this.audit.write(actorId, (tx) =>
          work(tx.manager, (row) => tx.update(ShoppingList, before, row))
        )
    );
  }

  /**
   * The fields an edit assigns, the grant a flip performs and the events both
   * announce, with the authorization already decided.
   *
   * One body, so an operator's edit is the same write as a list admin's. The
   * grant is the half that makes it matter: a `sharedWithZone` column write on
   * its own would mark a list shared with nobody granted, and nothing later
   * reconciles the two.
   */
  private async applyListUpdate(
    list: ShoppingList,
    changes: ListChanges,
    permissions: Set<ListPermission>,
    write: ListWrite
  ): Promise<ListView> {
    if (changes.name !== undefined) {
      list.name = changes.name;
    }
    if (changes.autoApproveLines !== undefined) {
      list.autoApproveLines = changes.autoApproveLines;
    }
    // Only the transition matters. Sending `true` on a list that is already
    // shared re-grants nobody, because the grant skips a row that already says
    // everything it would say.
    const opening = changes.sharedWithZone === true && !list.sharedWithZone;
    if (changes.sharedWithZone !== undefined) {
      list.sharedWithZone = changes.sharedWithZone;
    }

    let granted: GrantedAccess[] = [];
    const saved = await write(async (manager, save) => {
      const saved = await save(list);
      if (opening) {
        granted = await this.sharedGrant.grantListToZone(manager, saved);
      }
      return saved;
    });

    const view = toListView(saved, await this.countsFor(list.id), permissions);
    this.events.emit(RealtimeEvent.ListUpdated, list.zoneId, view, view.id);
    // One event per person the flip actually reached. Unlike the approval grant
    // (plan 0042, section 2.3), nothing else tells them: they are already members
    // looking at a zone they have no reason to refetch, and this is precisely the
    // case plan 0036 section 8 names, access changing under somebody who is
    // already looking.
    for (const member of granted) {
      const payload: ListMyAccessChangedEvent = {
        listId: list.id,
        zoneId: list.zoneId,
        permissions: member.permissions,
      };
      this.events.emitTo(
        RealtimeEvent.ListMyAccessChanged,
        { userIds: [member.userId], zoneId: list.zoneId, listId: list.id },
        payload
      );
    }
    return view;
  }

  /** Delete a list (plan 0007, section 2; plan 0036, section 4). `MANAGE`. */
  async delete(req: ListIdRequest): Promise<{ id: string }> {
    const list = await this.listAccess.requireManage(req.listId, req.userId);
    return this.applyListDeletion(list, async (row) => {
      await this.lists.delete({ id: row.id });
    });
  }

  /**
   * Delete a list, for an operator (plan 0077, section 5.1).
   *
   * The row goes and the cascade takes its lines, their comments and the access
   * table with it, which is what a list admin's delete does. The zone's counts
   * are recomputed either way: a list removed from under a zone card that still
   * counts it is the half a row delete would skip.
   */
  async deleteAsOperator(
    listId: string,
    actorId: string
  ): Promise<{ id: string }> {
    const list = await this.listAccess.getList(listId);
    return this.applyListDeletion(list, (row) =>
      this.audit.write(actorId, (tx) => tx.delete(ShoppingList, row))
    );
  }

  private async applyListDeletion(
    list: ShoppingList,
    remove: (list: ShoppingList) => Promise<void>
  ): Promise<{ id: string }> {
    // Read before the removal: the trail's delete strips the primary key off the
    // object it is handed, so an id read afterwards is undefined.
    const { id, zoneId } = list;
    await remove(list);
    this.events.emit(RealtimeEvent.ListDeleted, zoneId, { id }, id);
    await this.zoneCounts.emitZoneCounts(zoneId);
    return { id };
  }

  /**
   * List the shopping lists in a zone the caller can see (plan 0007, section 3):
   * group staff see every list in the zone; everybody else sees the lists they
   * hold `READ` on. Cursor paginated and orderable by name, created, or updated.
   */
  async list(req: ListListsRequest): Promise<ListPage> {
    const membership = await this.authz.requireApproved(req.zoneId, req.userId);
    const staff = isZoneStaff(membership);
    const order = this.resolveOrder(req.order);
    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor(req.cursor) as ListCursor | undefined;

    const qb = this.lists
      .createQueryBuilder('l')
      .addSelect(LIST_COUNTS_SQL, LIST_COUNTS_COLUMN)
      .where('l."zoneId" = :zoneId', { zoneId: req.zoneId })
      .take(limit + 1);

    if (!staff) {
      // The same predicate as `READABLE_LIST` in `zone-summary.sql.ts`, in the
      // one place a query builder rather than raw SQL owns it. Both lost the
      // `createdByUserId` clause with plan 0036 section 2.5, and both ask for
      // READ literally rather than for the mere existence of a row: a set is
      // what a row holds now, and every non-empty one contains READ.
      qb.andWhere(
        `EXISTS (
           SELECT 1 FROM "list_access" a
           WHERE a."listId" = l.id
             AND a."membershipId" = :membershipId
             AND 'READ' = ANY(a."permissions"))`,
        { membershipId: membership.id }
      );
    }

    this.applyOrder(qb, order, cursor);

    // The counts ride this query as a raw column, so the page costs one round
    // trip whatever its size (plan 0017, section 4.2).
    const { entities: rows, raw } = await qb.getRawAndEntities();
    const countsById = this.indexCounts(raw);
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const permissionsById = await this.permissionsForPage(
      membership,
      staff,
      page.map((list) => list.id)
    );
    const items = page.map((list) =>
      toListView(
        list,
        countsById.get(list.id) ?? EMPTY_LIST_COUNTS,
        permissionsById.get(list.id) ?? new Set()
      )
    );
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({
            order,
            value: this.cursorValue(order, last),
            id: last.id,
          })
        : null;

    return { items, nextCursor };
  }

  /**
   * Which lists still want this product (plan 0053, section 3).
   *
   * The read behind a line screen's "also on Weekly shop" indicator, which until
   * now was computed from whatever lists the client happened to have loaded and
   * therefore under reported without being able to say so.
   *
   * **Not paginated, and capped instead.** What it feeds is a caption, and a
   * cursor would turn it into a listing of every readable list that happens to
   * want milk, which is the search plan 0049 section 3 stopped the catalog being.
   * One row past the cap is read so the answer can say the cap bit.
   *
   * **No zone membership is required up front**, unlike every other read here:
   * the question spans zones by definition, and there is no one zone to be
   * approved in. The filtering is the whole of the authorization, applied per
   * candidate row at request time, so a zone the caller has left contributes
   * nothing the moment they leave it.
   *
   * The item id is checked for shape rather than existence. Core does not hold
   * the catalog and asking it would be a round trip to learn nothing this read
   * needs: an id that names no product simply matches no line. What the check
   * does buy is that a caller with **no** product cannot ask this question by
   * accident and read an empty array as "on no other list" (velista `0047`
   * section 5 draws the two differently and has to be able to tell).
   */
  async holdingItem(
    req: ListsHoldingItemRequest
  ): Promise<ListsHoldingItemResult> {
    if (!UUID_PATTERN.test(req.itemId ?? '')) {
      throw new ValidationException('itemId must be a valid item reference', {
        messageArgs: { field: 'itemId' },
      });
    }

    const cap = LIST_HOLDING_ITEM_LIMITS.maxLists;
    const rows = await this.lists.query<ListHoldingItemRow[]>(
      LISTS_HOLDING_ITEM_SQL,
      [req.itemId, req.userId, req.excludeListId ?? null, cap + 1]
    );

    return {
      lists: rows.slice(0, cap).map((row) => ({
        listId: row.listId,
        name: row.name,
        zoneId: row.zoneId,
        zoneName: row.zoneName,
        quantity: row.quantity,
      })),
      hasMore: rows.length > cap,
    };
  }

  /**
   * The caller's own permissions on each list of a page (plan 0036, section 7).
   *
   * `ListView.myPermissions` is per caller data on every row, which is exactly
   * the shape that becomes an N+1 if each row asks for it. It does not, for two
   * reasons that between them cover every caller:
   *
   * - the membership was resolved **once** for the whole page, before the listing
   *   query ran, so nothing here looks a member up again;
   * - group staff hold all four on every list in the zone by derivation, so their
   *   answer costs no query at all.
   *
   * Everybody else takes one more query: the caller's `list_access` rows for the
   * page's list ids, which is a single index read on `uq_list_access` per row of
   * a page that is at most `clampPageSize` long. A list on the page with no row
   * cannot happen for a non-staff caller, since the same `EXISTS` is what put the
   * list on the page, but an empty set is returned rather than assumed away.
   */
  private async permissionsForPage(
    membership: ZoneMembership,
    staff: boolean,
    listIds: string[]
  ): Promise<Map<string, Set<ListPermission>>> {
    const byListId = new Map<string, Set<ListPermission>>();
    if (listIds.length === 0) {
      return byListId;
    }
    if (staff) {
      for (const listId of listIds) {
        byListId.set(listId, new Set(ALL_LIST_PERMISSIONS));
      }
      return byListId;
    }
    const rows = await this.access.find({
      where: { membershipId: membership.id, listId: In(listIds) },
    });
    for (const row of rows) {
      byListId.set(row.listId, new Set(row.permissions));
    }
    return byListId;
  }

  /** Keys the raw count rows by list id (`l_id` in the raw result). */
  private indexCounts(raw: unknown[]): Map<string, ListCounts> {
    const byId = new Map<string, ListCounts>();
    for (const row of raw as Record<string, unknown>[]) {
      const id = row['l_id'];
      const counts = row[LIST_COUNTS_COLUMN] as ListCounts | null | undefined;
      if (typeof id === 'string' && counts) {
        byId.set(id, counts);
      }
    }
    return byId;
  }

  private resolveOrder(order?: string): ListOrder {
    return order === 'name' || order === 'created' ? order : 'updated';
  }

  private applyOrder(
    qb: SelectQueryBuilder<ShoppingList>,
    order: ListOrder,
    cursor?: ListCursor
  ): void {
    if (order === 'name') {
      qb.orderBy('l.name', 'ASC').addOrderBy('l.id', 'ASC');
      if (cursor) {
        qb.andWhere('(l.name, l.id) > (:cv, :cid)', {
          cv: cursor.value,
          cid: cursor.id,
        });
      }
    } else if (order === 'created') {
      qb.orderBy('l.createdAt', 'DESC').addOrderBy('l.id', 'DESC');
      if (cursor) {
        qb.andWhere('(l."createdAt", l.id) < (:cv, :cid)', {
          cv: cursor.value,
          cid: cursor.id,
        });
      }
    } else {
      qb.orderBy('l.updatedAt', 'DESC').addOrderBy('l.id', 'DESC');
      if (cursor) {
        qb.andWhere('(l."updatedAt", l.id) < (:cv, :cid)', {
          cv: cursor.value,
          cid: cursor.id,
        });
      }
    }
  }

  private cursorValue(order: ListOrder, list: ShoppingList): string {
    if (order === 'name') {
      return list.name;
    }
    if (order === 'created') {
      return list.createdAt.toISOString();
    }
    return list.updatedAt.toISOString();
  }
}
