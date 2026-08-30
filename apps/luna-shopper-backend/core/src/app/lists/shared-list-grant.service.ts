import { Injectable } from '@nestjs/common';
import {
  ListPermission,
  MembershipStatus,
  ZoneRole,
} from '@portfolio/luna-shopper/contracts';
import type { EntityManager } from 'typeorm';
import { ListAccess, ShoppingList, ZoneMembership } from '../entities';
import { ALL_LIST_PERMISSIONS } from './list-access.service';

/**
 * What a member gets on a list their group shares (plan 0036, section 2.6; plan
 * 0042, section 2.2). Read, add, and tick off; not govern.
 *
 * The same three whether the grant happens at creation, when somebody flips the
 * switch on, or when a new member is approved, because those are three moments of
 * one rule rather than three rules.
 */
export const SHARED_WITH_ZONE_PERMISSIONS: readonly ListPermission[] = [
  ListPermission.READ,
  ListPermission.WRITE,
  ListPermission.DECIDE,
];

/** One membership and what it now holds, for the caller's events. */
export interface GrantedAccess {
  membershipId: string;
  userId: string;
  permissions: ListPermission[];
}

/**
 * The three moments a list open to its zone hands somebody access (plan 0042).
 *
 * It exists as its own service, in its own module, because two slices need it
 * and neither may import the other: `ListService` grants when a list is created
 * or the switch is flipped on, and `MembershipService` grants when somebody is
 * approved into the zone. Putting it in either one would make `ZonesModule` and
 * `ListsModule` import each other.
 *
 * Every method takes an `EntityManager` rather than opening its own transaction.
 * The approval grant has to be in the same transaction as the status change, and
 * the creation grant in the same transaction as the insert, so the transaction is
 * the caller's to own and this service only ever joins one.
 *
 * ## A grant is a union, never a replacement
 *
 * Somebody who already holds `MANAGE` on a list and is then granted the shared
 * set because the switch was flipped on keeps `MANAGE` (section 2.2). Widening is
 * the only thing any of these three moments is entitled to do: none of them is
 * somebody deciding what one person may do, which is what the share sheet is for.
 * So an existing row is unioned with the shared set and a row that already
 * contains it is left completely alone, down to not being written.
 *
 * ## Group staff are skipped everywhere
 *
 * They hold all four by derivation, so a row for them says nothing, and writing
 * one is what filled the access table with entries `setAccess` then refused to
 * accept (section 1.1). Nothing here writes one.
 */
@Injectable()
export class SharedListGrantService {
  /**
   * Every approved, non staff membership of a zone, as ids.
   *
   * Ids rather than entities, because that is all a grant needs and a zone should
   * not load a row's worth of columns per member to write one uuid each.
   *
   * The staff filter is the half added by plan 0042: an admin's row was
   * meaningless the moment it was written, and it is the row `setAccess` refuses,
   * so the sheet could not be saved on any list whose group had one. Excluding
   * them loses nothing at all, since their derived grant is wider than the row.
   */
  async grantableMembershipIds(
    manager: EntityManager,
    zoneId: string,
    exceptMembershipId?: string
  ): Promise<string[]> {
    const qb = manager
      .getRepository(ZoneMembership)
      .createQueryBuilder('m')
      .select('m.id', 'id')
      .where('m.zoneId = :zoneId', { zoneId })
      .andWhere('m.status = :status', { status: MembershipStatus.APPROVED })
      .andWhere('m.role NOT IN (:...staff)', {
        staff: [ZoneRole.OWNER, ZoneRole.ADMIN],
      });
    if (exceptMembershipId) {
      qb.andWhere('m.id != :exceptMembershipId', { exceptMembershipId });
    }
    const rows = await qb.getRawMany<{ id: string }>();
    return rows.map((row) => row.id);
  }

  /**
   * Open an existing list to everybody currently in the group (plan 0042,
   * section 2.2), which is what flipping `sharedWithZone` on does.
   *
   * Exactly what creation does, on a list that already exists, which is why both
   * go through {@link grant}: "shared with the zone" has to mean the same thing
   * whenever it becomes true, or a list would carry a different access table
   * depending on which minute the switch was set in.
   */
  async grantListToZone(
    manager: EntityManager,
    list: ShoppingList
  ): Promise<GrantedAccess[]> {
    const membershipIds = await this.grantableMembershipIds(
      manager,
      list.zoneId
    );
    return this.grant(
      manager,
      membershipIds.map((membershipId) => ({ listId: list.id, membershipId }))
    );
  }

  /**
   * Everything one new member gets on the way in (plan 0042, section 2).
   *
   * Approval is the only door: `join` always writes a `PENDING` membership
   * whoever is joining, so there is no second path by which somebody becomes an
   * approved member without passing through the call site of this method.
   *
   * A staff membership is not asked about here, because the one place that makes
   * somebody staff without an approval is `transferOwnership`, and its target is
   * by definition about to hold everything by derivation.
   */
  async grantZoneSharedLists(
    manager: EntityManager,
    zoneId: string,
    membershipId: string
  ): Promise<GrantedAccess[]> {
    const lists = await manager.getRepository(ShoppingList).find({
      where: { zoneId, sharedWithZone: true },
      select: { id: true },
    });
    return this.grant(
      manager,
      lists.map((list) => ({ listId: list.id, membershipId }))
    );
  }

  /**
   * The union itself, for a set of (list, membership) pairs.
   *
   * A pair whose row already contains all three is skipped rather than rewritten,
   * so a grant over a zone where nothing changed writes nothing and reports
   * nobody. That is what lets a caller emit one event per person genuinely
   * affected instead of one per member of the group.
   *
   * The stored set comes out in `ALL_LIST_PERMISSIONS` order, the same order
   * `setAccess` normalizes to, so a row does not record which of the two paths
   * last touched it.
   */
  private async grant(
    manager: EntityManager,
    pairs: { listId: string; membershipId: string }[]
  ): Promise<GrantedAccess[]> {
    if (pairs.length === 0) {
      return [];
    }
    const accessRepo = manager.getRepository(ListAccess);
    const memberships = manager.getRepository(ZoneMembership);
    const granted: GrantedAccess[] = [];

    for (const pair of pairs) {
      const existing = await accessRepo.findOne({ where: pair });
      const wanted = new Set<ListPermission>([
        ...(existing?.permissions ?? []),
        ...SHARED_WITH_ZONE_PERMISSIONS,
      ]);
      const permissions = ALL_LIST_PERMISSIONS.filter((p) => wanted.has(p));
      if (existing && existing.permissions.length === permissions.length) {
        // A superset by construction, so an equal size is an equal set: this row
        // already says everything the grant would say and is left untouched.
        continue;
      }
      if (existing) {
        existing.permissions = permissions;
        await accessRepo.save(existing);
      } else {
        await accessRepo.save(accessRepo.create({ ...pair, permissions }));
      }
      const membership = await memberships.findOne({
        where: { id: pair.membershipId },
      });
      if (membership) {
        granted.push({
          membershipId: pair.membershipId,
          userId: membership.userId,
          permissions,
        });
      }
    }
    return granted;
  }
}
