import {
  BulkOperationErrorCode,
  ItemCategory,
  ItemSourceMatch,
  PriceSourceKind,
  SourceEntryStatus,
  UnitOfMeasure,
  type ApplySourceEntryDecisionsRequest,
  type ItemView,
  type SourceEntryDecisionOperation,
} from '@portfolio/luna-shopper/contracts';
import {
  ForbiddenException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import type { FindOperator, Repository } from 'typeorm';
import type { SourceCatalogEntry, SourceEntryPrice } from '../entities';
import type { CatalogClient } from './catalog-client.service';
import type { PlatformAdminService } from './platform-admin.service';
import { SourceEntryBatchService } from './source-entry-batch.service';
import type { SourceEntryPriceWriter } from './source-entry-write';

/**
 * A whole decisions file, applied in one call (plan 0100).
 *
 * The four things worth asserting are the four steps, and each one is a rule a
 * wrong implementation would look correct without:
 *
 * - a clean file lands whole, binding every row and writing every price;
 * - **one bad `expect` refuses the whole file with zero writes**, which is the
 *   entire reason this route exists rather than a loop over the per row ones;
 * - a bind that fails after the products were created deletes them, and names
 *   the ones it could not delete;
 * - a price write that fails skips **that row's prices only**, leaves its bind
 *   standing, and says so. Step four is the one place this is not atomic, and
 *   nothing else may quietly become non atomic beside it.
 */

const ADMIN = 'owner-1';
const CHAIN = 'chain-mercadona';
const SEEN = new Date('2026-09-10T09:00:00.000Z');

function price(overrides: Partial<SourceEntryPrice> = {}): SourceEntryPrice {
  return {
    id: 'sep-1',
    entryId: 'e-1',
    priceScopeId: 'scope-national',
    price: 0.89,
    currency: 'EUR',
    unitPrice: 0.89,
    unitPriceLabel: '€/L',
    validFrom: null,
    validUntil: null,
    details: null,
    observedAt: SEEN,
    runId: 'run-monday',
    createdAt: SEEN,
    updatedAt: SEEN,
    ...overrides,
  } as SourceEntryPrice;
}

function entry(
  overrides: Partial<SourceCatalogEntry> = {}
): SourceCatalogEntry {
  return {
    id: 'e-1',
    supermarketId: CHAIN,
    externalId: '4241',
    sourceKind: PriceSourceKind.OFFICIAL_API,
    name: 'Leche semidesnatada Hacendado',
    brand: 'Hacendado',
    ean: null,
    unitSize: 1,
    sizeFormat: '1 L',
    categoryPath: ['Lácteos', 'Leche'],
    url: null,
    extra: null,
    timesSeen: 3,
    firstSeenAt: SEEN,
    lastSeenAt: SEEN,
    firstRunId: 'run-monday',
    lastRunId: 'run-monday',
    itemId: null,
    candidateEntryId: null,
    status: SourceEntryStatus.UNRESOLVED,
    matchedBy: null,
    confidence: 0,
    decidedAt: null,
    prices: [price()],
    createdAt: SEEN,
    updatedAt: SEEN,
    ...overrides,
  } as SourceCatalogEntry;
}

function item(id: string): ItemView {
  return {
    id,
    name: { es: 'Leche' },
    brand: null,
    ean: null,
    unitSize: null,
    imageUrl: null,
    sku: null,
    category: ItemCategory.DAIRY,
    defaultUnit: UnitOfMeasure.LITER,
  } as unknown as ItemView;
}

/** The ids an `In(...)` criterion names, whichever way TypeORM wrapped them. */
function idsOf(where: unknown): string[] {
  const id = (where as { id?: FindOperator<string> | string })?.id;
  if (typeof id === 'string') {
    return [id];
  }
  const value = (id as { value?: string[] })?.value;
  return Array.isArray(value) ? value : [];
}

function build(
  options: {
    rows?: SourceCatalogEntry[];
    /** Fail the save of this entry, which is a step three failure. */
    failSaveOf?: string;
    /** Fail the price write for these entries, which is a step four skip. */
    failPricesOf?: string[];
    /** Fail the cleanup delete, so the product is reported as an orphan. */
    failDelete?: boolean;
    createItems?: jest.Mock;
  } = {}
) {
  const rows = options.rows ?? [entry()];
  const byId = new Map(rows.map((row) => [row.id, row]));
  const saved: SourceCatalogEntry[] = [];

  const manager = {
    find: jest.fn(async (_target: unknown, opts: { where?: unknown }) =>
      idsOf(opts?.where)
        .map((id) => byId.get(id))
        .filter(Boolean)
    ),
    save: jest.fn(async (_target: unknown, row: SourceCatalogEntry) => {
      if (options.failSaveOf === row.id) {
        throw new Error('deadlock detected');
      }
      saved.push({ ...row });
      return row;
    }),
    transaction: jest.fn(async (work: (m: unknown) => Promise<unknown>) =>
      work(manager)
    ),
  };

  const entries = {
    manager,
    find: jest.fn(async (opts: { where?: unknown }) =>
      idsOf(opts?.where)
        .map((id) => byId.get(id))
        .filter(Boolean)
    ),
  } as unknown as Repository<SourceCatalogEntry>;

  const createItems =
    options.createItems ??
    jest.fn(async (inputs: unknown[]) => ({
      items: inputs.map((_input, index) => item(`item-new-${index + 1}`)),
    }));
  const deleteItem = jest.fn(async (itemId: string) => {
    if (options.failDelete) {
      throw new Error('catalog said no');
    }
    return { id: itemId };
  });
  const catalog = { createItems, deleteItem } as unknown as CatalogClient;

  const write = jest.fn(async (row: SourceCatalogEntry) => {
    if (options.failPricesOf?.includes(row.id)) {
      throw new Error('scope is gone');
    }
    return (row.prices ?? []).length;
  });
  const prices = { write } as unknown as SourceEntryPriceWriter;

  const admin = {
    requireAdmin: jest.fn(async (credential: { userId: string }) => {
      if (credential.userId !== ADMIN) {
        throw new ForbiddenException('nope');
      }
      return credential.userId;
    }),
  } as unknown as PlatformAdminService;

  const service = new SourceEntryBatchService(entries, catalog, prices, admin);
  return { service, saved, createItems, deleteItem, write, manager, admin };
}

function request(
  operations: SourceEntryDecisionOperation[]
): ApplySourceEntryDecisionsRequest {
  return { userId: ADMIN, runId: 'session-1', operations };
}

const expectFresh = {
  status: SourceEntryStatus.UNRESOLVED,
  lastSeenAt: SEEN.toISOString(),
};

describe('SourceEntryBatchService', () => {
  it('refuses a caller who is not the platform admin', async () => {
    const { service } = build();
    await expect(
      service.applyDecisions({
        userId: 'someone-else',
        operations: [
          {
            op: 'accept',
            entryId: 'e-1',
            itemId: 'i-1',
            expect: expectFresh,
          },
        ],
      })
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses an empty file and one over the cap, before it reads a row', async () => {
    const { service, manager } = build();
    await expect(service.applyDecisions(request([]))).rejects.toBeInstanceOf(
      ValidationException
    );

    const tooMany = Array.from({ length: 1001 }, (_value, index) => ({
      op: 'accept' as const,
      entryId: `e-${index}`,
      itemId: 'i-1',
      expect: expectFresh,
    }));
    await expect(
      service.applyDecisions(request(tooMany))
    ).rejects.toBeInstanceOf(ValidationException);
    expect(manager.transaction).not.toHaveBeenCalled();
  });

  it('lands a clean file whole: binds every row and writes every price', async () => {
    const rows = [entry(), entry({ id: 'e-2', externalId: '4242' })];
    const { service, saved, createItems, write } = build({ rows });

    const result = await service.applyDecisions(
      request([
        {
          op: 'createItem',
          entryId: 'e-1',
          ref: 'milk',
          item: { name: { es: 'Leche semidesnatada' } },
          expect: expectFresh,
        },
        // The second row of the same product, bound to the item the first
        // operation creates, before that item has an id.
        {
          op: 'accept',
          entryId: 'e-2',
          itemRef: 'milk',
          expect: expectFresh,
        },
      ])
    );

    expect(result.applied).toBe(true);
    expect(result.failedStep).toBeNull();
    // Echoed, so a report can be filed under the session that decided the file.
    expect(result.runId).toBe('session-1');
    expect(createItems).toHaveBeenCalledTimes(1);
    expect(saved.map((row) => row.id)).toEqual(['e-1', 'e-2']);
    expect(saved.every((row) => row.status === SourceEntryStatus.ACTIVE)).toBe(
      true
    );
    expect(saved.every((row) => row.matchedBy === ItemSourceMatch.MANUAL)).toBe(
      true
    );
    expect(saved.every((row) => row.confidence === 1)).toBe(true);
    // Both rows carry the id the one create answered.
    expect(new Set(saved.map((row) => row.itemId))).toEqual(
      new Set(['item-new-1'])
    );
    expect(result.results.every((outcome) => outcome.applied)).toBe(true);
    expect(result.results.map((outcome) => outcome.pricesWritten)).toEqual([
      1, 1,
    ]);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('never rewrites what the source printed, whatever the item is called', async () => {
    const { service, saved } = build();
    await service.applyDecisions(
      request([
        {
          op: 'createItem',
          entryId: 'e-1',
          ref: 'milk',
          item: { name: { es: 'Something else entirely' }, brand: 'Other' },
          expect: expectFresh,
        },
      ])
    );

    // Plan 0086, D8: the row keeps the source's own strings so the next run
    // that produces this key still resolves through it.
    expect(saved[0].name).toBe('Leche semidesnatada Hacendado');
    expect(saved[0].brand).toBe('Hacendado');
    expect(saved[0].sizeFormat).toBe('1 L');
  });

  it('refuses the whole file for one stale expect, and writes nothing anywhere', async () => {
    const rows = [entry(), entry({ id: 'e-2', externalId: '4242' })];
    const { service, saved, createItems } = build({ rows });

    const result = await service.applyDecisions(
      request([
        {
          op: 'createItem',
          entryId: 'e-1',
          ref: 'milk',
          item: {},
          expect: expectFresh,
        },
        {
          op: 'accept',
          entryId: 'e-2',
          itemId: 'item-9',
          // The row was observed again after the decision was made about it.
          expect: {
            status: SourceEntryStatus.UNRESOLVED,
            lastSeenAt: '2026-09-01T00:00:00.000Z',
          },
        },
      ])
    );

    expect(result.applied).toBe(false);
    expect(result.failedStep).toBe('VALIDATE');
    expect(saved).toEqual([]);
    // Step two never ran, so the catalog holds nothing this file created.
    expect(createItems).not.toHaveBeenCalled();
    expect(result.results[0].error).toBeNull();
    expect(result.results[0].applied).toBe(false);
    expect(result.results[1].error?.code).toBe(
      BulkOperationErrorCode.EXPECT_MISMATCH
    );
  });

  it('refuses a row somebody else has already decided', async () => {
    const rows = [entry({ status: SourceEntryStatus.ACTIVE, itemId: 'i-9' })];
    const { service, saved } = build({ rows });

    const result = await service.applyDecisions(
      request([
        { op: 'accept', entryId: 'e-1', itemId: 'i-1', expect: expectFresh },
      ])
    );

    expect(result.applied).toBe(false);
    expect(result.results[0].error?.code).toBe(
      BulkOperationErrorCode.NOT_PENDING
    );
    expect(saved).toEqual([]);
  });

  it('refuses a file that contradicts itself, before it reads a row', async () => {
    const { service, manager } = build();

    const result = await service.applyDecisions(
      request([
        { op: 'accept', entryId: 'e-1', itemId: 'i-1', expect: expectFresh },
        // The same row decided twice, and an accept naming both alternatives.
        {
          op: 'accept',
          entryId: 'e-1',
          itemId: 'i-2',
          itemRef: 'milk',
          expect: expectFresh,
        },
      ])
    );

    expect(result.applied).toBe(false);
    expect(result.failedStep).toBe('VALIDATE');
    expect(result.results[1].error?.code).toBe(
      BulkOperationErrorCode.DUPLICATE_SUBJECT
    );
    expect(manager.transaction).not.toHaveBeenCalled();
  });

  it('refuses an accept naming a product no operation of the file creates', async () => {
    const { service } = build();

    const result = await service.applyDecisions(
      request([
        {
          op: 'accept',
          entryId: 'e-1',
          itemRef: 'ghost',
          expect: expectFresh,
        },
      ])
    );

    expect(result.results[0].error?.code).toBe(
      BulkOperationErrorCode.UNKNOWN_REFERENCE
    );
  });

  it('deletes the products it created when the bind fails, and names what would not go', async () => {
    const rows = [entry(), entry({ id: 'e-2', externalId: '4242' })];
    const { service, deleteItem, write } = build({
      rows,
      failSaveOf: 'e-2',
    });

    const result = await service.applyDecisions(
      request([
        {
          op: 'createItem',
          entryId: 'e-1',
          ref: 'milk',
          item: {},
          expect: expectFresh,
        },
        {
          op: 'createItem',
          entryId: 'e-2',
          ref: 'bread',
          item: {},
          expect: expectFresh,
        },
      ])
    );

    expect(result.applied).toBe(false);
    expect(result.failedStep).toBe('BIND');
    expect(deleteItem.mock.calls.map((call) => call[0])).toEqual([
      'item-new-1',
      'item-new-2',
    ]);
    expect(result.orphanedItemIds).toEqual([]);
    // Nothing was bound, so nothing may have written a price.
    expect(write).not.toHaveBeenCalled();
  });

  it('reports the products a failed cleanup left behind rather than swallowing them', async () => {
    const { service, deleteItem } = build({
      failSaveOf: 'e-1',
      failDelete: true,
    });

    const result = await service.applyDecisions(
      request([
        {
          op: 'createItem',
          entryId: 'e-1',
          ref: 'milk',
          item: {},
          expect: expectFresh,
        },
      ])
    );

    expect(result.applied).toBe(false);
    expect(deleteItem).toHaveBeenCalledTimes(1);
    expect(result.orphanedItemIds).toEqual(['item-new-1']);
  });

  it('skips only the failing row when a price write fails, and leaves its bind standing', async () => {
    const rows = [entry(), entry({ id: 'e-2', externalId: '4242' })];
    const { service, saved } = build({ rows, failPricesOf: ['e-1'] });

    const result = await service.applyDecisions(
      request([
        { op: 'accept', entryId: 'e-1', itemId: 'i-1', expect: expectFresh },
        { op: 'accept', entryId: 'e-2', itemId: 'i-2', expect: expectFresh },
      ])
    );

    // Step four is the one place this is not atomic, decided in review: prices
    // are recoverable and a cross service rollback is not worth a saga.
    expect(result.applied).toBe(true);
    expect(saved).toHaveLength(2);
    expect(result.results[0].applied).toBe(true);
    expect(result.results[0].pricesWritten).toBe(0);
    expect(result.results[1].pricesWritten).toBe(1);
    // Named once, in a list of its own, so a caller reads "these rows are bound
    // and still want their prices" rather than scanning every outcome.
    expect(result.priceSkips).toEqual([
      { entryId: 'e-1', itemId: 'i-1', reason: 'scope is gone' },
    ]);
  });

  it('binds nothing when the products could not be created', async () => {
    const createItems = jest.fn(async () => {
      throw new Error('an EAN this file uses is already taken');
    });
    const { service, saved } = build({ createItems });

    const result = await service.applyDecisions(
      request([
        {
          op: 'createItem',
          entryId: 'e-1',
          ref: 'milk',
          item: {},
          expect: expectFresh,
        },
      ])
    );

    expect(result.applied).toBe(false);
    expect(result.failedStep).toBe('CREATE_ITEMS');
    expect(result.error).toContain('already taken');
    expect(saved).toEqual([]);
  });
});
