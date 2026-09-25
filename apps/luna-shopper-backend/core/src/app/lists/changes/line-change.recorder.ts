import { Injectable } from '@nestjs/common';
import {
  LineApprovalStatus,
  LineChangeKind,
  type LineWriteVia,
} from '@portfolio/luna-shopper/contracts';
import type { EntityManager } from 'typeorm';
import { ListLine, ListLineChange } from '../../entities';

/**
 * Writing down what a change to a list line was (plan 0138, sections 3 and 4).
 *
 * ## It holds no repository, on purpose
 *
 * Every insert goes through the `EntityManager` its caller hands it, so a change
 * row is written **inside the transaction of the write that caused it**. It
 * cannot draw a second connection from the pool while its caller holds one, which
 * is the deadlock `line.service.ts` explains at length, and it cannot commit
 * apart from its caller: a record that is sometimes written and sometimes not is
 * worse than no record, which is the rule `core_audit` states about itself.
 *
 * ## A caller never chooses a kind
 *
 * {@link edited} compares two snapshots and derives the kind from what actually
 * moved, in the order of section 2. That is what stops two of the eleven record
 * sites disagreeing about whether an edit that renamed a line and changed its
 * quantity is a rename or a quantity change.
 *
 * ## `createdAt` is left to the database
 *
 * The insert omits the column, so `DEFAULT now()` writes it: the transaction's
 * start time. Every row one act writes therefore shares one value, which is what
 * lets an acknowledgement of one row of a basket rename acknowledge all of them.
 */
@Injectable()
export class LineChangeRecorder {
  /** A line the list did not hold before. Only the `after` values are filled. */
  async added(
    manager: EntityManager,
    list: ListRef,
    line: Pick<ListLine, 'id' | 'content' | 'quantity' | 'approvalStatus'>,
    actor: LineChangeActor
  ): Promise<void> {
    await this.write(manager, list, line.id, actor, {
      kind: LineChangeKind.ADDED,
      contentAfter: line.content,
      quantityAfter: line.quantity,
      approvalAfter: line.approvalStatus,
    });
  }

  /**
   * Whatever an edit moved, as one row.
   *
   * **Nothing is written when the snapshots are equal.** An edit that names the
   * same values it found changed nothing, and a row saying so would put a mark on
   * a basket over a request that did nothing.
   */
  async edited(
    manager: EntityManager,
    list: ListRef,
    lineId: string,
    before: LineSnapshot,
    after: LineSnapshot,
    actor: LineChangeActor
  ): Promise<void> {
    const moved = movedBetween(before, after);
    if (!moved) {
      return;
    }
    await this.write(manager, list, lineId, actor, moved);
  }

  /**
   * Two lines became one (plan 0112).
   *
   * The change names the line that **went**, and `mergedIntoLineId` the one that
   * stayed. The `after` values are the survivor's as it now stands, so a rename
   * that produced the merge rides in this row's `contentAfter` and there is no
   * second row for it.
   */
  async merged(
    manager: EntityManager,
    list: ListRef,
    absorbed: LineSnapshot & { id: string },
    survivor: Pick<ListLine, 'id' | 'content' | 'quantity' | 'approvalStatus'>,
    actor: LineChangeActor
  ): Promise<void> {
    await this.write(manager, list, absorbed.id, actor, {
      kind: LineChangeKind.MERGED,
      contentBefore: absorbed.content,
      contentAfter: survivor.content,
      quantityBefore: absorbed.quantity,
      quantityAfter: survivor.quantity,
      approvalBefore: absorbed.approvalStatus,
      approvalAfter: survivor.approvalStatus,
      mergedIntoLineId: survivor.id,
    });
  }

  /**
   * The line was taken off the list.
   *
   * Only the `before` values are filled: there is no state after, which is the
   * whole of what a removal says. The basket read draws the text from
   * `contentBefore` when it builds the disabled row.
   */
  async deleted(
    manager: EntityManager,
    list: ListRef,
    line: Pick<ListLine, 'id' | 'content' | 'quantity' | 'approvalStatus'>,
    actor: LineChangeActor
  ): Promise<void> {
    await this.write(manager, list, line.id, actor, {
      kind: LineChangeKind.DELETED,
      contentBefore: line.content,
      quantityBefore: line.quantity,
      approvalBefore: line.approvalStatus,
    });
  }

  /** One insert, through the caller's manager, with the columns it was given. */
  private async write(
    manager: EntityManager,
    list: ListRef,
    lineId: string,
    actor: LineChangeActor,
    moved: MovedColumns
  ): Promise<void> {
    await manager.insert(ListLineChange, {
      zoneId: list.zoneId,
      listId: list.id,
      lineId,
      kind: moved.kind,
      contentBefore: moved.contentBefore ?? null,
      contentAfter: moved.contentAfter ?? null,
      quantityBefore: moved.quantityBefore ?? null,
      quantityAfter: moved.quantityAfter ?? null,
      approvalBefore: moved.approvalBefore ?? null,
      approvalAfter: moved.approvalAfter ?? null,
      mergedIntoLineId: moved.mergedIntoLineId ?? null,
      actorUserId: actor.userId,
      actorParticipantId: actor.participantId,
      basketId: actor.basketId,
    });
  }
}

/** The list a change happened on, with the zone it copies onto the row. */
export interface ListRef {
  id: string;
  zoneId: string;
}

/**
 * Who made a change, as much of them as core knows.
 *
 * All three may be null at once, which is what an operator's write looked like
 * before plan 0077 gave it an actor id, and what a background write would look
 * like if one ever made a change.
 */
export interface LineChangeActor {
  userId: string | null;
  participantId: string | null;
  basketId: string | null;
}

/** The three things about a line a change is ever about. */
export interface LineSnapshot {
  content: string;
  quantity: number;
  approvalStatus: LineApprovalStatus;
}

/**
 * The three values, read **before** the line object is mutated.
 *
 * Called at the top of every edit path, which is the move `updateAsOperator`
 * already makes with `const before = { ...line }` for the audit trail.
 */
export function snapshotOf(
  line: Pick<ListLine, 'content' | 'quantity' | 'approvalStatus'>
): LineSnapshot {
  return {
    content: line.content,
    quantity: line.quantity,
    approvalStatus: line.approvalStatus,
  };
}

/** The columns a change row carries beyond the line, the list and the actor. */
interface MovedColumns {
  kind: LineChangeKind;
  contentBefore?: string | null;
  contentAfter?: string | null;
  quantityBefore?: number | null;
  quantityAfter?: number | null;
  approvalBefore?: LineApprovalStatus | null;
  approvalAfter?: LineApprovalStatus | null;
  mergedIntoLineId?: string | null;
}

/**
 * What moved between two snapshots, or null when nothing did.
 *
 * The kind is the most significant of them, `RENAMED` then `QUANTITY_CHANGED`
 * then `APPROVAL_CHANGED`, and every pair that moved is filled whichever kind
 * won: the columns describe the write and the kind only names it.
 *
 * The text is compared **as typed** rather than through `normalizeContent`. A
 * respelling is a change a person sees, because a basket row draws the anchor's
 * own text, so "jamon" becoming "Jamón" is a rename here even though the list's
 * fold calls them one name.
 *
 * Exported for the spec, which states the order as a table rather than reaching
 * it through eleven call sites.
 */
export function movedBetween(
  before: LineSnapshot,
  after: LineSnapshot
): MovedColumns | null {
  const content = before.content !== after.content;
  const quantity = before.quantity !== after.quantity;
  const approval = before.approvalStatus !== after.approvalStatus;
  if (!content && !quantity && !approval) {
    return null;
  }
  return {
    kind: content
      ? LineChangeKind.RENAMED
      : quantity
        ? LineChangeKind.QUANTITY_CHANGED
        : LineChangeKind.APPROVAL_CHANGED,
    ...(content
      ? { contentBefore: before.content, contentAfter: after.content }
      : {}),
    ...(quantity
      ? { quantityBefore: before.quantity, quantityAfter: after.quantity }
      : {}),
    ...(approval
      ? {
          approvalBefore: before.approvalStatus,
          approvalAfter: after.approvalStatus,
        }
      : {}),
  };
}

/**
 * The actor behind a write that arrived as a request.
 *
 * `via` is set by a basket write alone and carries the **actor's** identity,
 * which on a delegated write is not `req.userId`: changing what a household asks
 * for is authorized against the basket's owner (plan 0131), and the person doing
 * it may be a guest with no account at all.
 */
export function actorOf(req: {
  userId?: string | null;
  via?: LineWriteVia;
}): LineChangeActor {
  if (req.via) {
    return {
      userId: req.via.userId,
      participantId: req.via.participantId,
      basketId: req.via.basketId,
    };
  }
  return { userId: req.userId ?? null, participantId: null, basketId: null };
}

/** The actor behind an operator's write, whose account is the only thing known. */
export function operatorActor(actorId: string): LineChangeActor {
  return { userId: actorId, participantId: null, basketId: null };
}
