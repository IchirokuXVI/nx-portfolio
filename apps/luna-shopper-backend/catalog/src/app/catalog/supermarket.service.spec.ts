import {
  DEFAULT_SCOPE_PRIORITY,
  PriceScopeKind,
} from '@portfolio/luna-shopper/contracts';
import { ValidationException } from '@portfolio/luna-shopper/platform';
import type { Repository } from 'typeorm';
import { PriceScope, Supermarket } from '../entities';
import type { CatalogAuditService } from './catalog-audit.service';
import type { PlatformAdminService } from './platform-admin.service';
import type { PriceScopeService } from './price-scope.service';
import { SupermarketService } from './supermarket.service';

/**
 * A chain starts with a national scope (plan 0153).
 *
 * The transaction is faked the way the real one behaves where it matters here:
 * every row the callback writes is staged, and the stage reaches `committed`
 * only when the callback returns. A callback that throws commits nothing, so a
 * write made outside the callback would show up in `committed` on the failure
 * path and fail the rollback test. The real database proof is
 * `supermarket-national-scope.integration.spec.ts`.
 */

const CHAIN = '11111111-1111-4111-8111-111111111111';
const OTHER_CHAIN = '22222222-2222-4222-8222-222222222222';

interface Written {
  target: unknown;
  row: Record<string, unknown>;
}

function build(options: { failOn?: unknown } = {}) {
  const committed: Written[] = [];
  let transactions = 0;
  let nextId = 0;

  const audit = {
    write: async <T>(
      _actor: unknown,
      work: (tx: unknown) => Promise<T>
    ): Promise<T> => {
      transactions++;
      const staged: Written[] = [];
      const tx = {
        manager: {
          create: (_target: unknown, fields: Record<string, unknown>) => ({
            ...fields,
          }),
        },
        create: async (target: unknown, row: Record<string, unknown>) => {
          if (target === options.failOn) {
            throw new Error('insert failed');
          }
          const saved = { ...row, id: row['id'] ?? `row-${++nextId}` };
          staged.push({ target, row: { ...saved } });
          return saved;
        },
        update: async (
          target: unknown,
          _before: unknown,
          row: Record<string, unknown>
        ) => {
          staged.push({ target, row: { ...row } });
          return { ...row };
        },
      };
      const result = await work(tx);
      committed.push(...staged);
      return result;
    },
  } as unknown as CatalogAuditService;

  const rows = new Map<string, Supermarket>([
    [CHAIN, { id: CHAIN, name: { es: 'Dia' } } as Supermarket],
  ]);
  const supermarkets = {
    create: (fields: Partial<Supermarket>) => ({ ...fields }),
    findOne: async ({ where }: { where: { id: string } }) => {
      const row = rows.get(where.id);
      return row ? { ...row } : null;
    },
  } as unknown as Repository<Supermarket>;

  const scopes: Record<string, { id: string; supermarketId: string }> = {
    'scope-own': { id: 'scope-own', supermarketId: CHAIN },
    'scope-other': { id: 'scope-other', supermarketId: OTHER_CHAIN },
  };
  const priceScopes = {
    load: async (id: string) => ({ ...scopes[id] }),
  } as unknown as PriceScopeService;

  const admin = {
    requireAdmin: async () => ({ kind: 'admin', actorId: 'admin-1' }),
  } as unknown as PlatformAdminService;

  const service = new SupermarketService(
    supermarkets,
    priceScopes,
    admin,
    audit
  );
  return { service, committed, transactions: () => transactions };
}

describe('SupermarketService', () => {
  describe('create', () => {
    it('makes the chain with a NATIONAL scope named after it as its default, in one transaction', async () => {
      const { service, committed, transactions } = build();

      const view = await service.create({
        userId: 'admin-1',
        name: { es: 'Lidl' },
      });

      expect(transactions()).toBe(1);
      const scopes = committed.filter((w) => w.target === PriceScope);
      expect(scopes).toHaveLength(1);
      expect(scopes[0].row).toMatchObject({
        supermarketId: view.id,
        kind: PriceScopeKind.NATIONAL,
        externalKey: null,
        label: { es: 'Lidl' },
        priority: DEFAULT_SCOPE_PRIORITY[PriceScopeKind.NATIONAL],
      });
      expect(view.defaultPriceScopeId).toBe(scopes[0].row['id']);
      // The last write of the chain is the one that holds the default.
      const chainWrites = committed.filter((w) => w.target === Supermarket);
      expect(chainWrites[chainWrites.length - 1].row).toMatchObject({
        id: view.id,
        defaultPriceScopeId: scopes[0].row['id'],
      });
    });

    it('writes neither the chain nor the scope when the scope cannot be saved', async () => {
      const { service, committed } = build({ failOn: PriceScope });

      await expect(
        service.create({ userId: 'admin-1', name: { es: 'Lidl' } })
      ).rejects.toThrow('insert failed');

      expect(committed).toEqual([]);
    });
  });

  describe('update', () => {
    it('sets a default scope of the chain itself', async () => {
      const { service } = build();

      const view = await service.update({
        userId: 'admin-1',
        supermarketId: CHAIN,
        defaultPriceScopeId: 'scope-own',
      });

      expect(view.defaultPriceScopeId).toBe('scope-own');
    });

    it("refuses another chain's scope as a validation error", async () => {
      const { service, committed } = build();

      await expect(
        service.update({
          userId: 'admin-1',
          supermarketId: CHAIN,
          defaultPriceScopeId: 'scope-other',
        })
      ).rejects.toBeInstanceOf(ValidationException);
      expect(committed).toEqual([]);
    });

    it('clears the default with null', async () => {
      const { service } = build();

      const view = await service.update({
        userId: 'admin-1',
        supermarketId: CHAIN,
        defaultPriceScopeId: null,
      });

      expect(view.defaultPriceScopeId).toBeNull();
    });
  });
});
