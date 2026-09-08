import { Injectable } from '@nestjs/common';
import {
  BULK_DECISION_MAX_OPERATIONS,
  BulkOperationErrorCode,
  type ApplyProductGroupAssignmentsRequest,
  type ApplyProductGroupAssignmentsResult,
  type ProductGroupAssignmentOperation,
  type ProductGroupAssignmentOutcome,
} from '@portfolio/luna-shopper/contracts';
import { ValidationException } from '@portfolio/luna-shopper/platform';
import { In } from 'typeorm';
import { Item, ProductGroup } from '../entities';
import { CatalogEventsPublisher } from '../events/catalog-events.publisher';
import {
  CatalogAuditService,
  type AuditedWrite,
} from './catalog-audit.service';
import { PlatformAdminService } from './platform-admin.service';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** One product moved, so the fan out can be announced after the commit. */
interface GroupMove {
  itemId: string;
  from: string | null;
  to: string;
}

/**
 * A whole curation session's group decisions, replayed in one transaction
 * (plan 0100).
 *
 * ## Why this is not on either of the two services it touches
 *
 * `ProductGroupService` says in its own class doc that nothing there assigns
 * items to groups, and `ItemService` says that assignment is `item.update`, one
 * product at a time, by a person. Both stay true. This is the third thing: a
 * file somebody decided offline, applied whole, which needs both tables inside
 * one transaction and belongs to neither.
 *
 * ## It is still owner curation
 *
 * Nothing here classifies anything. Every assignment in the request was decided
 * by the owner, or by a delegate working under the owner's own admin session,
 * and this service is the machinery that lands those decisions without leaving
 * half of them applied.
 *
 * ## Truly all or nothing, with no exception to explain
 *
 * Groups and item membership live in one database, so the transaction that
 * creates the groups is the transaction that assigns the products. That is the
 * one way this differs from the entry decisions it mirrors, where prices cross
 * into another service and cannot join the transaction.
 *
 * **Every check that reads a row runs inside that transaction**, against rows it
 * has locked. A slug that collides and a product somebody sorted a second ago
 * are exactly the races a check outside the transaction would lose.
 *
 * ## It announces what it moved
 *
 * Plan 0070's fan out starts wherever `items.productGroupId` moves, so it starts
 * here too: one event per product, after the commit. Announcing before it would
 * announce a move that a later operation of the same file could still roll back.
 */
@Injectable()
export class ProductGroupAssignmentService {
  constructor(
    private readonly admin: PlatformAdminService,
    private readonly audit: CatalogAuditService,
    private readonly events: CatalogEventsPublisher
  ) {}

  async apply(
    req: ApplyProductGroupAssignmentsRequest
  ): Promise<ApplyProductGroupAssignmentsResult> {
    const actor = await this.admin.requireAdmin(req);
    const operations = req.operations ?? [];
    if (operations.length === 0) {
      throw new ValidationException(
        'A bulk assignment needs at least one operation.'
      );
    }
    if (operations.length > BULK_DECISION_MAX_OPERATIONS) {
      throw new ValidationException(
        `A bulk assignment carries at most ${BULK_DECISION_MAX_OPERATIONS} ` +
          `operations, and this one carries ${operations.length}. It is ` +
          'refused whole rather than chunked: two chunks are two transactions, ' +
          'so the first can land while the second fails.'
      );
    }

    // Everything a request can get wrong on its own, before a transaction is
    // opened over it: a reference nothing creates, a subject named twice, an
    // operation that names both alternatives or neither.
    const shape = checkShape(operations);
    if (shape.some((outcome) => outcome.error !== null)) {
      return refused(shape);
    }

    try {
      const landed = await this.audit.write(actor, (tx) =>
        this.applyInside(tx, operations)
      );
      for (const move of landed.moved) {
        this.events.itemGroupChanged(move.itemId, move.from, move.to);
      }
      return {
        applied: true,
        error: null,
        results: landed.outcomes,
        createdGroups: landed.createdGroups,
      };
    } catch (error) {
      if (error instanceof BatchRefused) {
        return refused(error.outcomes);
      }
      throw error;
    }
  }

  /**
   * The work, inside the transaction, refusing by throwing.
   *
   * A refusal has to leave the transaction, and the only way out of a TypeORM
   * transaction callback that rolls back is an exception, so the outcomes ride
   * out on one. Returning them would commit the rows the refused file wrote.
   */
  private async applyInside(
    tx: AuditedWrite,
    operations: readonly ProductGroupAssignmentOperation[]
  ): Promise<{
    outcomes: ProductGroupAssignmentOutcome[];
    createdGroups: { ref: string; groupId: string }[];
    moved: GroupMove[];
  }> {
    const manager = tx.manager;
    const outcomes = operations.map(blankOutcome);
    const at = new Map(
      operations.map((operation, index) => [operation, index])
    );

    // Slugs first, in one read: a group whose handle is taken cannot be created,
    // and every assignment naming it would dangle.
    const wanted = new Map<string, number>();
    operations.forEach((operation, index) => {
      if (operation.op === 'createGroup') {
        wanted.set(slugOf(operation.slug), index);
      }
    });
    const taken = wanted.size
      ? await manager.find(ProductGroup, {
          where: { slug: In([...wanted.keys()]) },
        })
      : [];
    for (const group of taken) {
      const index = wanted.get(group.slug);
      if (index !== undefined) {
        fail(
          outcomes[index],
          BulkOperationErrorCode.ALREADY_TAKEN,
          `A product group already uses the slug "${group.slug}".`
        );
      }
    }
    refuseIfAnyFailed(outcomes);

    const byRef = new Map<string, string>();
    const createdGroups: { ref: string; groupId: string }[] = [];
    for (const operation of operations) {
      if (operation.op !== 'createGroup') {
        continue;
      }
      const saved = await tx.create(
        ProductGroup,
        manager.create(ProductGroup, {
          name: operation.name,
          slug: slugOf(operation.slug),
          referenceUnit: operation.referenceUnit,
          synonyms: {
            en: clean(operation.synonyms?.en),
            es: clean(operation.synonyms?.es),
          },
        })
      );
      byRef.set(operation.ref, saved.id);
      createdGroups.push({ ref: operation.ref, groupId: saved.id });
      const outcome = outcomes[at.get(operation) as number];
      outcome.applied = true;
      outcome.groupId = saved.id;
    }

    const assignments = operations.filter(
      (operation) => operation.op === 'assignItem'
    );

    // Every product this file moves, locked together, so nothing sorts one of
    // them between the check and the write.
    const rows = assignments.length
      ? await manager.find(Item, {
          where: {
            id: In(
              assignments.map((operation) =>
                operation.op === 'assignItem' ? operation.itemId : ''
              )
            ),
          },
          lock: { mode: 'pessimistic_write' },
        })
      : [];
    const byId = new Map(rows.map((row) => [row.id, row]));

    // A group named by id has to exist. No foreign key catches that until the
    // write, which would fail the file with a constraint name and no sentence.
    const namedIds = [
      ...new Set(
        assignments.flatMap((operation) =>
          operation.op === 'assignItem' && operation.groupId
            ? [operation.groupId]
            : []
        )
      ),
    ];
    const known = new Set(
      namedIds.length
        ? (
            await manager.find(ProductGroup, { where: { id: In(namedIds) } })
          ).map((group) => group.id)
        : []
    );

    const targets = new Map<string, string>();
    for (const operation of assignments) {
      if (operation.op !== 'assignItem') {
        continue;
      }
      const outcome = outcomes[at.get(operation) as number];
      const groupId =
        operation.groupId ?? byRef.get(operation.groupRef as string);
      if (groupId === undefined) {
        fail(
          outcome,
          BulkOperationErrorCode.UNKNOWN_REFERENCE,
          `No group of this request is named "${operation.groupRef}".`
        );
        continue;
      }
      if (operation.groupId !== undefined && !known.has(operation.groupId)) {
        fail(
          outcome,
          BulkOperationErrorCode.NOT_FOUND,
          `Product group ${operation.groupId} does not exist.`
        );
        continue;
      }
      const row = byId.get(operation.itemId);
      if (!row) {
        fail(
          outcome,
          BulkOperationErrorCode.NOT_FOUND,
          `Item ${operation.itemId} does not exist.`
        );
        continue;
      }
      if (row.productGroupId !== operation.expect.productGroupId) {
        fail(
          outcome,
          BulkOperationErrorCode.EXPECT_MISMATCH,
          `Item ${operation.itemId} is in group ` +
            `${row.productGroupId ?? 'none'}, and the decision was made when ` +
            `it was in ${operation.expect.productGroupId ?? 'none'}.`
        );
        continue;
      }
      targets.set(operation.itemId, groupId);
      outcome.groupId = groupId;
    }
    refuseIfAnyFailed(outcomes);

    // Nothing was refused, so the writes happen in a second pass. A first pass
    // that wrote as it checked would leave audit rows for decisions the file was
    // about to be refused over, and the rollback would be the only thing
    // undoing them.
    const moved: GroupMove[] = [];
    for (const [itemId, groupId] of targets) {
      const row = byId.get(itemId) as Item;
      const before = { ...row };
      const from = row.productGroupId;
      row.productGroupId = groupId;
      await tx.update(Item, before, row);
      if (from !== groupId) {
        moved.push({ itemId, from, to: groupId });
      }
    }
    for (const operation of assignments) {
      outcomes[at.get(operation) as number].applied = true;
    }

    return { outcomes, createdGroups, moved };
  }
}

/** Everything a request gets wrong on its own, with no database read. */
function checkShape(
  operations: readonly ProductGroupAssignmentOperation[]
): ProductGroupAssignmentOutcome[] {
  const outcomes = operations.map(blankOutcome);
  const refs = new Set<string>();
  const itemIds = new Set<string>();
  const slugs = new Set<string>();

  operations.forEach((operation, index) => {
    const outcome = outcomes[index];
    if (operation.op === 'createGroup') {
      if (refs.has(operation.ref)) {
        fail(
          outcome,
          BulkOperationErrorCode.DUPLICATE_SUBJECT,
          `Two operations create a group named "${operation.ref}".`
        );
        return;
      }
      refs.add(operation.ref);
      const slug = slugOf(operation.slug);
      if (!SLUG.test(slug)) {
        fail(
          outcome,
          BulkOperationErrorCode.MALFORMED_OPERATION,
          'slug must be lower case words separated by single dashes'
        );
        return;
      }
      if (slugs.has(slug)) {
        fail(
          outcome,
          BulkOperationErrorCode.DUPLICATE_SUBJECT,
          `Two operations create a group with the slug "${slug}".`
        );
        return;
      }
      slugs.add(slug);
      return;
    }

    if (itemIds.has(operation.itemId)) {
      fail(
        outcome,
        BulkOperationErrorCode.DUPLICATE_SUBJECT,
        `Item ${operation.itemId} is assigned twice.`
      );
      return;
    }
    itemIds.add(operation.itemId);
    if (
      Number(Boolean(operation.groupId)) +
        Number(Boolean(operation.groupRef)) !==
      1
    ) {
      fail(
        outcome,
        BulkOperationErrorCode.MALFORMED_OPERATION,
        'An assignment names exactly one of groupId and groupRef.'
      );
    }
  });

  // A reference is only checkable once every create has been seen, so a second
  // pass rather than the first.
  operations.forEach((operation, index) => {
    if (
      operation.op === 'assignItem' &&
      operation.groupRef !== undefined &&
      outcomes[index].error === null &&
      !refs.has(operation.groupRef)
    ) {
      fail(
        outcomes[index],
        BulkOperationErrorCode.UNKNOWN_REFERENCE,
        `No group of this request is named "${operation.groupRef}".`
      );
    }
  });

  return outcomes;
}

function refuseIfAnyFailed(outcomes: ProductGroupAssignmentOutcome[]): void {
  if (outcomes.some((outcome) => outcome.error !== null)) {
    throw new BatchRefused(outcomes);
  }
}

function blankOutcome(
  operation: ProductGroupAssignmentOperation
): ProductGroupAssignmentOutcome {
  return {
    op: operation.op,
    ref: operation.op === 'createGroup' ? operation.ref : null,
    itemId: operation.op === 'assignItem' ? operation.itemId : null,
    groupId: null,
    applied: false,
    error: null,
  };
}

function fail(
  outcome: ProductGroupAssignmentOutcome,
  code: BulkOperationErrorCode,
  detail: string
): void {
  outcome.applied = false;
  outcome.groupId = null;
  outcome.error = { code, detail };
}

/** Nothing landed, so no outcome may claim a group or say it applied. */
function refused(
  outcomes: ProductGroupAssignmentOutcome[]
): ApplyProductGroupAssignmentsResult {
  return {
    applied: false,
    error: null,
    results: outcomes.map((outcome) => ({
      ...outcome,
      applied: false,
      groupId: outcome.error === null ? null : outcome.groupId,
    })),
    createdGroups: [],
  };
}

function slugOf(slug: string): string {
  return slug.trim().toLowerCase();
}

function clean(words?: string[]): string[] {
  return [...new Set((words ?? []).map((word) => word.trim()).filter(Boolean))];
}

/** The outcomes on their way out of a transaction that must not commit. */
class BatchRefused extends Error {
  constructor(readonly outcomes: ProductGroupAssignmentOutcome[]) {
    super('The bulk assignment was refused.');
    this.name = 'BatchRefused';
  }
}
