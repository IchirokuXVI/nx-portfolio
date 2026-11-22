import {
  BasketStatus,
  type BuyForListBasketRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  BasketFinishedException,
  BasketRowHasNoProductException,
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

/** The row key's line as the resolver loads it, holding milk or nothing. */
const entry = (itemIds: string[]) => ({
  lineId: ROW,
  listId: WRITTEN,
  content: 'Milk from the corner shop',
  itemIds,
  favoriteItemId: null,
  tripItemId: null,
  unit: 'UNIT',
  quantity: 1,
  settlements: [],
});

function build(
  opened: {
    status?: BasketStatus;
    userId?: string | null;
    rowItemIds?: string[];
  } = {}
) {
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
        const anchor = entry(opened.rowItemIds ?? [MILK]);
        return { anchor, entries: [anchor] };
      },
    }),
  } as unknown as BasketWriteContext;
  const prepared: unknown[] = [];
  const dataSource = {
    transaction: async () => {
      touched.push('transaction');
    },
  } as unknown as DataSource;
  const lines = {
    prepareLineAtZero: async (req: unknown) => {
      touched.push('prepare');
      prepared.push(req);
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
  return { service, touched, prepared };
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

  it('answers 409 basket_row_has_no_product for a row with no product, before any write', async () => {
    const { service, touched } = build({ rowItemIds: [] });

    await expect(service.buyForList(request())).rejects.toBeInstanceOf(
      BasketRowHasNoProductException
    );
    expect(touched).toEqual(['row']);
  });

  it('buys the row’s product and names the line by catalog’s name, never the row line’s text', async () => {
    const { service, prepared } = build();

    await service.buyForList(request()).catch(() => undefined);

    // The row key's line was typed 'Milk from the corner shop' by another
    // household; the line made here is called what catalog calls the product.
    expect(prepared).toEqual([
      expect.objectContaining({
        listId: WRITTEN,
        itemId: MILK,
        content: 'Whole milk',
      }),
    ]);
  });

  it('hands no name on when catalog named the product in no language, so no line can be made', async () => {
    const { service, prepared } = build();

    await service
      .buyForList(request({ content: undefined }))
      .catch(() => undefined);

    // The row line's text is not a fallback (plan 0273, amended on
    // 2026-11-22). `lineAtZeroWithin` refuses a null name with
    // `basket_product_has_no_name`, which the integration spec pins.
    expect(prepared).toEqual([expect.objectContaining({ content: null })]);
  });
});
