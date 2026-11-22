import {
  BasketStatus,
  type BuyForListBasketRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  BasketFinishedException,
  ForbiddenException,
  NotFoundException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import type { DataSource, Repository } from 'typeorm';
import type { Basket } from '../entities';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import type { LineChangeRecorder } from '../lists/changes/line-change.recorder';
import type { LineService } from '../lists/line.service';
import { BasketBuyForListService } from './basket-buy-for-list.service';
import type { BasketWriteContext } from './basket-write.context';
import type { LineClaimService } from './line-claim.service';

/**
 * The refusals of a buy for a list that does not ask (plan 0273, section 1,
 * specs 4 and 5). Each is answered before anything is read for the write, so
 * nothing opens a transaction and nothing reaches the list. What the write
 * does is `basket-buy-for-list.integration.spec.ts`.
 */

const BASKET = '5b0f6f7e-6c7c-4d55-9f4e-3a8b2f9d1c01';
const PARTICIPANT = '5b0f6f7e-6c7c-4d55-9f4e-3a8b2f9d1c02';
const USER = '5b0f6f7e-6c7c-4d55-9f4e-3a8b2f9d1c03';
const WRITTEN = '5b0f6f7e-6c7c-4d55-9f4e-3a8b2f9d1c04';
const READ_ONLY = '5b0f6f7e-6c7c-4d55-9f4e-3a8b2f9d1c05';
const ELSEWHERE = '5b0f6f7e-6c7c-4d55-9f4e-3a8b2f9d1c06';
const ROW = '5b0f6f7e-6c7c-4d55-9f4e-3a8b2f9d1c07';
const MILK = '5b0f6f7e-6c7c-4d55-9f4e-3a8b2f9d1c08';

function build(opened: { status?: BasketStatus; userId?: string | null } = {}) {
  const touched: string[] = [];
  const context = {
    open: async () => ({
      basket: { id: BASKET, status: opened.status ?? BasketStatus.OPEN },
      participant: {
        id: PARTICIPANT,
        userId: opened.userId === undefined ? USER : opened.userId,
      },
      servedListIds: new Set([WRITTEN]),
      coveredListIds: [WRITTEN, READ_ONLY],
      via: () => ({
        participantId: PARTICIPANT,
        basketId: BASKET,
        userId: USER,
      }),
      row: async () => {
        touched.push('row');
        return { anchor: { content: 'Milk', itemIds: [MILK] }, entries: [] };
      },
    }),
  } as unknown as BasketWriteContext;
  const dataSource = {
    transaction: async () => {
      touched.push('transaction');
    },
  } as unknown as DataSource;
  const lines = {
    prepareLineAtZero: async () => {
      touched.push('prepare');
      return {};
    },
  } as unknown as LineService;
  const service = new BasketBuyForListService(
    dataSource,
    { query: async () => [] } as unknown as Repository<Basket>,
    context,
    lines,
    {} as LineClaimService,
    {} as CoreEventsPublisher,
    {} as LineChangeRecorder
  );
  return { service, touched };
}

const request = (
  extra: Partial<BuyForListBasketRequest> = {}
): BuyForListBasketRequest => ({
  basketId: BASKET,
  participantId: PARTICIPANT,
  userId: USER,
  rowKey: ROW,
  targetListId: WRITTEN,
  quantity: 2,
  unit: 'UNIT',
  itemId: MILK,
  content: 'Whole milk',
  ...extra,
});

describe('a buy for a list that did not ask (plan 0273)', () => {
  it('refuses a guest with the add’s 403, before anything is read', async () => {
    const { service, touched } = build({ userId: null });

    await expect(service.buyForList(request())).rejects.toBeInstanceOf(
      ForbiddenException
    );
    expect(touched).toEqual([]);
  });

  it('refuses a list the actor may only read with 403', async () => {
    const { service, touched } = build();

    await expect(
      service.buyForList(request({ targetListId: READ_ONLY }))
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(touched).toEqual([]);
  });

  it('answers 404 for a list the basket does not cover', async () => {
    const { service, touched } = build();

    await expect(
      service.buyForList(request({ targetListId: ELSEWHERE }))
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(touched).toEqual([]);
  });

  it('refuses a finished basket', async () => {
    const { service, touched } = build({ status: BasketStatus.FINISHED });

    await expect(service.buyForList(request())).rejects.toBeInstanceOf(
      BasketFinishedException
    );
    expect(touched).toEqual([]);
  });

  it('refuses a quantity outside 1 to the ceiling, and a missing unit', async () => {
    const { service, touched } = build();

    for (const quantity of [0, 1.5, 100000]) {
      await expect(
        service.buyForList(request({ quantity }))
      ).rejects.toBeInstanceOf(ValidationException);
    }
    await expect(
      service.buyForList(request({ unit: undefined as never }))
    ).rejects.toBeInstanceOf(ValidationException);
    expect(touched).toEqual([]);
  });
});
