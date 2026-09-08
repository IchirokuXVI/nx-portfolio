import {
  BulkOperationErrorCode,
  UnitOfMeasure,
  type ApplyProductGroupAssignmentsRequest,
  type ProductGroupAssignmentOperation,
} from '@portfolio/luna-shopper/contracts';
import {
  ForbiddenException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import type { FindOperator } from 'typeorm';
import { Item, ProductGroup } from '../entities';
import type { CatalogEventsPublisher } from '../events/catalog-events.publisher';
import type { CatalogAuditService } from './catalog-audit.service';
import type { PlatformAdminService } from './platform-admin.service';
import { ProductGroupAssignmentService } from './product-group-assignment.service';

/**
 * A whole curation session's group decisions, replayed in one transaction
 * (plan 0100).
 *
 * The rules worth asserting, and each is one a wrong implementation would look
 * correct without:
 *
 * - a clean file creates its groups, moves every product, and **announces every
 *   move**, because plan 0070's fan out starts wherever `productGroupId` moves
 *   and a household subscribed to Milk is waiting on it;
 * - one product somebody else has sorted refuses the whole file, with no group
 *   created and no event announced;
 * - a slug the catalog already holds is caught inside the transaction that
 *   would have written it, not by a constraint afterwards;
 * - nothing is announced for a file that was refused, at any step.
 */

const ADMIN = 'owner-1';

function item(id: string, productGroupId: string | null = null): Item {
  return { id, productGroupId } as Item;
}

/** The ids or slugs an `In(...)` criterion names. */
function valuesOf(where: unknown, field: 'id' | 'slug'): string[] {
  const criterion = (where as Record<string, FindOperator<string> | string>)?.[
    field
  ];
  if (typeof criterion === 'string') {
    return [criterion];
  }
  const value = (criterion as { value?: string[] })?.value;
  return Array.isArray(value) ? value : [];
}

function build(
  options: {
    items?: Item[];
    /** Groups the catalog already holds, by slug. */
    existingGroups?: ProductGroup[];
  } = {}
) {
  const items = new Map((options.items ?? []).map((row) => [row.id, row]));
  const groups = options.existingGroups ?? [];
  const createdGroups: ProductGroup[] = [];
  const updatedItems: Item[] = [];
  let nextGroup = 1;

  const manager = {
    find: jest.fn(async (target: unknown, opts: { where?: unknown }) => {
      if (target === Item) {
        return valuesOf(opts?.where, 'id')
          .map((id) => items.get(id))
          .filter(Boolean);
      }
      const bySlug = valuesOf(opts?.where, 'slug');
      if (bySlug.length > 0) {
        return groups.filter((group) => bySlug.includes(group.slug));
      }
      const byId = valuesOf(opts?.where, 'id');
      return groups
        .concat(createdGroups)
        .filter((group) => byId.includes(group.id));
    }),
    create: jest.fn(
      (_target: unknown, draft: Partial<ProductGroup>) =>
        ({ ...draft }) as ProductGroup
    ),
  };

  const tx = {
    manager,
    create: jest.fn(async (_target: unknown, draft: ProductGroup) => {
      const saved = {
        ...draft,
        id: `group-new-${nextGroup++}`,
      } as ProductGroup;
      createdGroups.push(saved);
      return saved;
    }),
    update: jest.fn(async (_target: unknown, _before: unknown, row: Item) => {
      updatedItems.push({ ...row });
      return row;
    }),
  };

  const audit = {
    write: jest.fn(
      async (_actor: unknown, work: (write: typeof tx) => Promise<unknown>) =>
        work(tx)
    ),
  } as unknown as CatalogAuditService;

  const admin = {
    requireAdmin: jest.fn(async (credential: { userId: string }) => {
      if (credential.userId !== ADMIN) {
        throw new ForbiddenException('nope');
      }
      return { kind: 'admin' as const, actorId: credential.userId };
    }),
  } as unknown as PlatformAdminService;

  const itemGroupChanged = jest.fn();
  const events = { itemGroupChanged } as unknown as CatalogEventsPublisher;

  const service = new ProductGroupAssignmentService(admin, audit, events);
  return { service, createdGroups, updatedItems, itemGroupChanged, tx };
}

function request(
  operations: ProductGroupAssignmentOperation[]
): ApplyProductGroupAssignmentsRequest {
  return { userId: ADMIN, operations };
}

const MILK: ProductGroupAssignmentOperation = {
  op: 'createGroup',
  ref: 'milk',
  name: { es: 'Leche', en: 'Milk' },
  slug: 'milk',
  referenceUnit: UnitOfMeasure.LITER,
};

describe('ProductGroupAssignmentService', () => {
  it('refuses a caller who is not the platform admin', async () => {
    const { service } = build();
    await expect(
      service.apply({ userId: 'someone-else', operations: [MILK] })
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses an empty request and one over the cap', async () => {
    const { service } = build();
    await expect(service.apply(request([]))).rejects.toBeInstanceOf(
      ValidationException
    );

    const tooMany = Array.from({ length: 1001 }, (_value, index) => ({
      ...MILK,
      ref: `ref-${index}`,
      slug: `slug-${index}`,
    }));
    await expect(service.apply(request(tooMany))).rejects.toBeInstanceOf(
      ValidationException
    );
  });

  it('creates the groups and moves every product, announcing each move', async () => {
    const { service, createdGroups, updatedItems, itemGroupChanged } = build({
      items: [item('i-1'), item('i-2')],
    });

    const result = await service.apply(
      request([
        MILK,
        {
          op: 'assignItem',
          itemId: 'i-1',
          groupRef: 'milk',
          expect: { productGroupId: null },
        },
        {
          op: 'assignItem',
          itemId: 'i-2',
          groupRef: 'milk',
          expect: { productGroupId: null },
        },
      ])
    );

    expect(result.applied).toBe(true);
    expect(result.createdGroups).toEqual([
      { ref: 'milk', groupId: 'group-new-1' },
    ]);
    expect(createdGroups[0].slug).toBe('milk');
    expect(updatedItems.map((row) => row.productGroupId)).toEqual([
      'group-new-1',
      'group-new-1',
    ]);
    expect(result.results.every((outcome) => outcome.applied)).toBe(true);

    // Plan 0070: a subscribed line hears about every product that moved.
    expect(itemGroupChanged).toHaveBeenCalledTimes(2);
    expect(itemGroupChanged).toHaveBeenCalledWith('i-1', null, 'group-new-1');
  });

  it('refuses the whole file when one product was sorted since the decision', async () => {
    const { service, updatedItems, itemGroupChanged } = build({
      items: [item('i-1'), item('i-2', 'group-old')],
    });

    const result = await service.apply(
      request([
        MILK,
        {
          op: 'assignItem',
          itemId: 'i-1',
          groupRef: 'milk',
          expect: { productGroupId: null },
        },
        {
          op: 'assignItem',
          itemId: 'i-2',
          groupRef: 'milk',
          expect: { productGroupId: null },
        },
      ])
    );

    expect(result.applied).toBe(false);
    expect(result.createdGroups).toEqual([]);
    expect(result.results[2].error?.code).toBe(
      BulkOperationErrorCode.EXPECT_MISMATCH
    );
    // The transaction rolled back, so nothing was written and nothing may be
    // announced: an event for a move that did not happen empties a line.
    expect(updatedItems).toEqual([]);
    expect(itemGroupChanged).not.toHaveBeenCalled();
    expect(result.results.every((outcome) => !outcome.applied)).toBe(true);
    expect(result.results[0].groupId).toBeNull();
  });

  it('catches a slug the catalog already holds, inside the transaction', async () => {
    const { service, itemGroupChanged, tx } = build({
      items: [item('i-1')],
      existingGroups: [{ id: 'group-old', slug: 'milk' } as ProductGroup],
    });

    const result = await service.apply(
      request([
        MILK,
        {
          op: 'assignItem',
          itemId: 'i-1',
          groupRef: 'milk',
          expect: { productGroupId: null },
        },
      ])
    );

    expect(result.applied).toBe(false);
    expect(result.results[0].error?.code).toBe(
      BulkOperationErrorCode.ALREADY_TAKEN
    );
    expect(tx.create).not.toHaveBeenCalled();
    expect(itemGroupChanged).not.toHaveBeenCalled();
  });

  it('refuses a group id the catalog does not hold', async () => {
    const { service } = build({ items: [item('i-1')] });

    const result = await service.apply(
      request([
        {
          op: 'assignItem',
          itemId: 'i-1',
          groupId: '11111111-1111-1111-1111-111111111111',
          expect: { productGroupId: null },
        },
      ])
    );

    expect(result.applied).toBe(false);
    expect(result.results[0].error?.code).toBe(
      BulkOperationErrorCode.NOT_FOUND
    );
  });

  it('refuses a request that contradicts itself, before it opens a transaction', async () => {
    const { service, tx } = build({ items: [item('i-1')] });

    const result = await service.apply(
      request([
        MILK,
        { ...MILK, ref: 'milk-again' },
        {
          op: 'assignItem',
          itemId: 'i-1',
          groupId: '11111111-1111-1111-1111-111111111111',
          groupRef: 'milk',
          expect: { productGroupId: null },
        },
      ])
    );

    expect(result.applied).toBe(false);
    // Two groups with one slug, and an assignment naming both alternatives.
    expect(result.results[1].error?.code).toBe(
      BulkOperationErrorCode.DUPLICATE_SUBJECT
    );
    expect(result.results[2].error?.code).toBe(
      BulkOperationErrorCode.MALFORMED_OPERATION
    );
    expect(tx.create).not.toHaveBeenCalled();
  });

  it('refuses a slug that is not a handle', async () => {
    const { service } = build();

    const result = await service.apply(
      request([{ ...MILK, slug: 'Not A Slug' }])
    );

    expect(result.applied).toBe(false);
    expect(result.results[0].error?.code).toBe(
      BulkOperationErrorCode.MALFORMED_OPERATION
    );
  });
});
