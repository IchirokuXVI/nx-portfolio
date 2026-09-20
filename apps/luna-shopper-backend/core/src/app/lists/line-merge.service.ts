import { Injectable } from '@nestjs/common';
import {
  LINE_ITEM_SET_MAX,
  LINE_QUANTITY_MAX,
  LineApprovalStatus,
  LineItemSource,
  type LineMergeTooManyProductsDetails,
} from '@portfolio/luna-shopper/contracts';
import { LineMergeTooManyProductsException } from '@portfolio/luna-shopper/platform';
import { In, type EntityManager } from 'typeorm';
import {
  BasketTripRow,
  LineComment,
  LineSettlement,
  ListLine,
  ListLineGroupRemoval,
  ListLineItem,
} from '../entities';
import { itemSetHash } from './item-set-hash';

/**
 * The products two lines hold together, the survivor's first and in its own
 * order, then the absorbed line's that the survivor lacks (plan 0112, section 4).
 */
export function mergedItemIds(
  survivor: readonly string[],
  absorbed: readonly string[]
): string[] {
  return [...new Set([...survivor, ...absorbed])];
}

/**
 * Refuse a merge whose product set would pass the bound (plan 0112, section 2).
 *
 * The bound is `max(LINE_ITEM_SET_MAX, the larger line's own count)`, which is
 * the rule an edit is held to (plan 0070, section 7) applied to two lines rather
 * than one. A line its group carried past the cap is allowed to stay that size,
 * and merging a smaller line into it that adds nothing new is not a request to
 * grow it. A union that grows past both is refused whole.
 */
export function assertMergeFits(
  survivorCount: number,
  absorbedCount: number,
  unionCount: number
): void {
  const max = Math.max(LINE_ITEM_SET_MAX, survivorCount, absorbedCount);
  if (unionCount > max) {
    const details: LineMergeTooManyProductsDetails = {
      max,
      offered: unionCount,
    };
    throw new LineMergeTooManyProductsException(
      `the merged line would hold ${unionCount} products, and a line can hold at most ${max}`,
      {
        details: { ...details },
        messageArgs: { max },
      }
    );
  }
}

/**
 * Whether `a` is the earlier of two lines of one list: by `position`, then by
 * `id` (plan 0112, section 3; plan 0091, section 3.1).
 *
 * The id comparison is a plain string one on purpose. Postgres orders a `uuid`
 * by its bytes, which is the order of the lowercase hex text, and a locale aware
 * comparison would disagree with the `ORDER BY position, id` every other reader
 * of the list uses.
 */
export function isEarlierLine(
  a: Pick<ListLine, 'position' | 'id'>,
  b: Pick<ListLine, 'position' | 'id'>
): boolean {
  if (a.position !== b.position) {
    return a.position < b.position;
  }
  return a.id < b.id;
}

/**
 * Two lines of one list become one (plan 0112).
 *
 * A service of its own rather than a private method on `LineService`, because a
 * basket rename merges list lines too (plan 0113) and has to write exactly this
 * and nothing else. It holds no repositories: every read and write goes through
 * the caller's manager, so the merge is inside the caller's transaction and
 * under the caller's list lock, and it draws no second connection from the pool
 * (`line.service.ts` explains why that deadlocks).
 *
 * It decides nothing about **whether** two lines may merge. Permissions, the
 * approval refusal and the confirmation are the caller's, because they are about
 * the request. What it does check is the product bound, because that is about
 * the rows and a caller cannot state it without reading them.
 */
@Injectable()
export class LineMergeService {
  /**
   * Move everything `absorbed` owns onto `survivor`, delete `absorbed`, and
   * save `survivor` as the one line.
   *
   * Both rows must be locked by the caller and belong to one list. `survivor`
   * arrives carrying the content it keeps, which after a rename is the new
   * spelling when the renamed line is the survivor. Both arrive carrying their
   * approval **as it stood before the edit**, because section 3 decides the
   * merged approval from those.
   *
   * Returns the saved survivor. It is not a view: the caller reads the line again
   * before answering, since the product set, the settlements and the claim all
   * moved underneath it.
   */
  async merge(
    manager: EntityManager,
    survivor: ListLine,
    absorbed: ListLine
  ): Promise<ListLine> {
    const items = manager.getRepository(ListLineItem);
    const order = { position: 'ASC', id: 'ASC' } as const;
    const survivorRows = await items.find({
      where: { lineId: survivor.id },
      order,
    });
    const absorbedRows = await items.find({
      where: { lineId: absorbed.id },
      order,
    });
    const union = mergedItemIds(
      survivorRows.map((row) => row.itemId),
      absorbedRows.map((row) => row.itemId)
    );
    // Before anything is written, so a refusal moves nothing (section 9, 6).
    assertMergeFits(survivorRows.length, absorbedRows.length, union.length);

    await this.moveItems(
      manager,
      survivor,
      absorbed,
      survivorRows,
      absorbedRows
    );
    await this.moveGroupRemovals(manager, survivor, absorbed, union);

    // Comments and settlements keep their own `listId`: a line never moves
    // between lists, and both lines are on this one.
    await manager
      .getRepository(LineComment)
      .update({ lineId: absorbed.id }, { lineId: survivor.id });
    await manager
      .getRepository(LineSettlement)
      .update({ lineId: absorbed.id }, { lineId: survivor.id });

    const version = survivor.version + 1;
    // Before the delete below: `basket_trip_rows` names the line by a foreign
    // key, so a row still pointing at the absorbed line would go with it (plan
    // 0135, section 5). It used to be done beside the basket origins, and there
    // are none since plan 0136: an open basket reads the list, so a merged line
    // is one row on its next read with both lines' purchases, with nothing to
    // move.
    await this.moveTripRows(manager, survivor.id, absorbed.id);

    survivor.quantity = Math.min(
      survivor.quantity + absorbed.quantity,
      LINE_QUANTITY_MAX
    );
    this.mergeApproval(survivor, absorbed);
    survivor.itemSetHash = itemSetHash(union);
    survivor.version = version;

    // Last, once nothing the absorbed line owned still points at it. Most of
    // those tables cascade on this delete, which is why the order matters.
    //
    // A **real** delete, on purpose, although plan 0132 made a line soft
    // deletable: `repo.delete` stays real on a soft deletable entity, and
    // everything the absorbed line owned has moved onto the survivor by this
    // point, its settlements included. There is nothing left for a row to keep,
    // and a tombstone per merge would leave a ghost behind every rename.
    await manager.getRepository(ListLine).delete({ id: absorbed.id });
    return manager.getRepository(ListLine).save(survivor);
  }

  /**
   * The absorbed line's products the survivor lacks, appended after the
   * survivor's own (section 4).
   *
   * A product keeps `GROUP` only when both lines follow the same group, since
   * only then is that group still responsible for it. Otherwise it arrives as
   * `USER`: the survivor's group, or the absence of one, never claimed it, and a
   * sync that believed it had would take it off again (section 3).
   *
   * A product both lines hold keeps the survivor's row and its provenance.
   */
  private async moveItems(
    manager: EntityManager,
    survivor: ListLine,
    absorbed: ListLine,
    survivorRows: readonly ListLineItem[],
    absorbedRows: readonly ListLineItem[]
  ): Promise<void> {
    const held = new Set(survivorRows.map((row) => row.itemId));
    const sameGroup = this.followSameGroup(survivor, absorbed);
    let position = survivorRows.reduce(
      (max, row) => Math.max(max, row.position),
      -1
    );
    const added = absorbedRows
      .filter((row) => !held.has(row.itemId))
      .map((row) => ({
        lineId: survivor.id,
        itemId: row.itemId,
        position: (position += 1),
        source:
          sameGroup && row.source === LineItemSource.GROUP
            ? LineItemSource.GROUP
            : LineItemSource.USER,
      }));
    if (added.length > 0) {
      await manager.getRepository(ListLineItem).insert(added);
    }
  }

  /**
   * The group's products a person took off either line, as one set (section 4).
   *
   * Carried only when both lines follow the same group, because a tombstone is a
   * refusal of one group's product and means nothing on a line bound to another
   * group or to none. Then every tombstone for a product the survivor now holds
   * is cleared, which is the rule a hand edit already follows (plan 0070,
   * section 3): the product is on the line, so the refusal no longer stands.
   */
  private async moveGroupRemovals(
    manager: EntityManager,
    survivor: ListLine,
    absorbed: ListLine,
    union: readonly string[]
  ): Promise<void> {
    const removals = manager.getRepository(ListLineGroupRemoval);
    if (this.followSameGroup(survivor, absorbed)) {
      const carried = await removals.find({ where: { lineId: absorbed.id } });
      if (carried.length > 0) {
        await removals
          .createQueryBuilder()
          .insert()
          .values(
            carried.map((row) => ({ lineId: survivor.id, itemId: row.itemId }))
          )
          .orIgnore()
          .execute();
      }
    }
    if (union.length > 0) {
      await removals.delete({ lineId: survivor.id, itemId: In([...union]) });
    }
  }

  /**
   * The trip rows that point at the absorbed line (plan 0135, section 5).
   *
   * A finished basket that asked for both lines ends with one row, the
   * survivor's, holding both asks, because `uq_basket_trip_rows_line` allows one
   * row per basket and zone line. The two lines are one line now, and the trip
   * asked for it.
   *
   * It carries no version, because a trip row has none: it is written once and
   * this is the one edit it ever takes. `listId` does not move either, since
   * both lines are on one list.
   *
   * It does not make a finished trip follow its list. A merge changes which line
   * the household calls milk, not how much milk the trip asked for.
   */
  private async moveTripRows(
    manager: EntityManager,
    survivorId: string,
    absorbedId: string
  ): Promise<void> {
    const rows = manager.getRepository(BasketTripRow);
    const moving = await rows.find({
      where: { lineId: absorbedId },
      order: { id: 'ASC' },
    });
    if (moving.length === 0) {
      return;
    }
    const staying = await rows.find({ where: { lineId: survivorId } });
    const byBasket = new Map(staying.map((row) => [row.basketId, row]));
    for (const row of moving) {
      const shared = byBasket.get(row.basketId);
      if (shared) {
        // Deleted first, so the pair never exists twice under the unique key.
        await rows.delete({ id: row.id });
        await rows.update(
          { id: shared.id },
          { asked: shared.asked + row.asked }
        );
      } else {
        await rows.update({ id: row.id }, { lineId: survivorId });
      }
    }
  }

  /**
   * Approved if either line was, otherwise pending (section 3).
   *
   * The survivor's approver stands when it was the approved one, and the
   * absorbed line's otherwise. "Pending" is what the survivor's own status comes
   * to after an edit when neither line was approved: the other line of a
   * collision is never `REJECTED`, and a rejected renamed line reopens on the
   * edit that renamed it.
   */
  private mergeApproval(survivor: ListLine, absorbed: ListLine): void {
    if (survivor.approvalStatus === LineApprovalStatus.APPROVED) {
      return;
    }
    if (absorbed.approvalStatus === LineApprovalStatus.APPROVED) {
      survivor.approvalStatus = LineApprovalStatus.APPROVED;
      survivor.approvedByUserId = absorbed.approvedByUserId;
      return;
    }
    survivor.approvalStatus = LineApprovalStatus.PENDING;
    survivor.approvedByUserId = null;
  }

  private followSameGroup(survivor: ListLine, absorbed: ListLine): boolean {
    return (
      survivor.productGroupId !== null &&
      survivor.productGroupId === absorbed.productGroupId
    );
  }
}
