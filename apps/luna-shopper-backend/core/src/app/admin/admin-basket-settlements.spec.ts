import {
  BasketKind,
  BasketStatus,
  SettlementOutcome,
  type BasketRowView,
} from '@portfolio/luna-shopper/contracts';
import type { Repository } from 'typeorm';
import type { BasketReadService } from '../baskets/basket-read.service';
import type { BasketService } from '../baskets/basket.service';
import type { Basket, BasketSource } from '../entities';
import type { LineService } from '../lists/line.service';
import type { ListService } from '../lists/list.service';
import { AdminListService } from './admin-list.service';
import type { CorePlatformAdminService } from './platform-admin.service';

/**
 * A basket row's settlements on the admin detail read (plan 0160).
 *
 * Operator plan 0150 found with psql that settlements carried no paid price.
 * The detail read now carries each row's settlements, so the check is a
 * screen. What is asserted here is the assembly: which settlements land on
 * which row, for both halves of the read. The SQL is proven against a real
 * database, which a double cannot do.
 */

const NOW = new Date('2026-09-20T10:00:00.000Z');
const BASKET = 'b1';

function basketRow(status: BasketStatus): Basket {
  return {
    id: BASKET,
    ownerUserId: 'u-owner',
    kind: BasketKind.GENERATED,
    name: null,
    status,
    generatedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  } as unknown as Basket;
}

/** A row of the settlements query, as `manager.query` returns it. */
function settlement(
  id: string,
  lineId: string,
  settledAt: string,
  over: Record<string, unknown> = {}
) {
  return {
    id,
    lineId,
    itemId: 'i1',
    outcome: SettlementOutcome.BOUGHT,
    quantity: 1,
    pricePaidCents: 129,
    pricePaidCurrency: 'EUR',
    priceScopeId: 's1',
    supermarketLocationId: null,
    settledByUserId: null,
    settledByParticipantId: 'p1',
    settledAt: new Date(settledAt),
    revertedAt: null,
    ...over,
  };
}

function build(basket: Basket, open: Partial<BasketRowView>[] = []) {
  const query = jest.fn();
  const baskets = {
    findOne: jest.fn(async () => basket),
    query,
  } as unknown as Repository<Basket>;
  const sources = {
    createQueryBuilder: () => {
      const qb = {
        select: () => qb,
        addSelect: () => qb,
        where: () => qb,
        groupBy: () => qb,
        addGroupBy: () => qb,
        getRawMany: async () => [],
      };
      return qb;
    },
  } as unknown as Repository<BasketSource>;
  const generated = {
    countsFor: async () => new Map([[BASKET, { lineCount: 2 }]]),
  } as unknown as BasketService;
  const basketRead = {
    openRows: async () => open,
  } as unknown as BasketReadService;
  const service = new AdminListService(
    {} as never,
    {} as never,
    baskets,
    sources,
    { requireAdmin: async () => 'a1' } as unknown as CorePlatformAdminService,
    {} as ListService,
    {} as LineService,
    generated,
    basketRead
  );
  return { service, query };
}

describe('AdminListService.getBasket: settlements (plan 0160)', () => {
  it('puts every settlement of an open row on it, across the lines the row covers, oldest first', async () => {
    const { service, query } = build(basketRow(BasketStatus.OPEN), [
      {
        rowKey: 'l1',
        content: 'Leche',
        left: 1,
        bought: 2,
        asked: 3,
        entries: [
          { lineId: 'l1' } as BasketRowView['entries'][number],
          { lineId: 'l2' } as BasketRowView['entries'][number],
        ],
      },
      {
        rowKey: 'l3',
        content: 'Pan',
        left: 1,
        bought: 0,
        asked: 1,
        entries: [{ lineId: 'l3' } as BasketRowView['entries'][number]],
      },
    ]);
    query.mockResolvedValueOnce([
      settlement('s2', 'l2', '2026-09-20T09:00:00.000Z'),
      settlement('s1', 'l1', '2026-09-20T09:30:00.000Z', {
        revertedAt: new Date('2026-09-20T09:40:00.000Z'),
      }),
    ]);

    const detail = await service.getBasket({
      userId: 'a1',
      adminToken: 't',
      basketId: BASKET,
    });

    // One query for the whole basket, filtered on every line any row covers.
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1]).toEqual([BASKET, ['l1', 'l2', 'l3']]);
    const [milk, bread] = detail.lines;
    expect(milk.settlements.map((row) => row.id)).toEqual(['s2', 's1']);
    expect(milk.settlements[0]).toEqual({
      id: 's2',
      lineId: 'l2',
      itemId: 'i1',
      outcome: SettlementOutcome.BOUGHT,
      quantity: 1,
      pricePaidCents: 129,
      pricePaidCurrency: 'EUR',
      priceScopeId: 's1',
      supermarketLocationId: null,
      settledByUserId: null,
      settledByParticipantId: 'p1',
      settledAt: '2026-09-20T09:00:00.000Z',
      revertedAt: null,
    });
    // A taken back settlement stays, marked.
    expect(milk.settlements[1].revertedAt).toBe('2026-09-20T09:40:00.000Z');
    expect(bread.settlements).toEqual([]);
  });

  it('puts a finished basket settlements on the frozen row of their line', async () => {
    const { service, query } = build(basketRow(BasketStatus.FINISHED));
    query
      .mockResolvedValueOnce([
        { lineId: 'l1', content: 'Leche', asked: 2, bought: 1 },
        { lineId: 'l3', content: 'Pan', asked: 1, bought: 0 },
      ])
      .mockResolvedValueOnce([
        settlement('s1', 'l1', '2026-09-20T09:00:00.000Z'),
        settlement('s3', 'l3', '2026-09-20T09:10:00.000Z', {
          outcome: SettlementOutcome.NOT_AVAILABLE,
          quantity: 0,
          pricePaidCents: null,
          pricePaidCurrency: null,
        }),
      ]);

    const detail = await service.getBasket({
      userId: 'a1',
      adminToken: 't',
      basketId: BASKET,
    });

    expect(query.mock.calls[1][1]).toEqual([BASKET, ['l1', 'l3']]);
    expect(detail.lines.map((row) => row.settlements.map((s) => s.id))).toEqual(
      [['s1'], ['s3']]
    );
    expect(detail.lines[1].settlements[0].pricePaidCents).toBeNull();
  });

  it('asks nothing about settlements for a basket with no rows', async () => {
    const { service, query } = build(basketRow(BasketStatus.OPEN), []);

    const detail = await service.getBasket({
      userId: 'a1',
      adminToken: 't',
      basketId: BASKET,
    });

    expect(detail.lines).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});
