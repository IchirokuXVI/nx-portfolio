import {
  BASKET_PATTERNS,
  ITEM_PATTERNS,
  ParticipantKind,
  UnitOfMeasure,
  type BasketParticipantContext,
  type BuyForListBasketRequest,
  type ItemSnapshot,
} from '@portfolio/luna-shopper/contracts';
import {
  ForbiddenException,
  runWithRequestContext,
} from '@portfolio/luna-shopper/platform';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BasketController } from './basket.controller';
import { BuyForListBasketRowDto } from './basket.dto';
import type { SettleChoice } from './settle-price.service';

/**
 * The route of a buy for a list that does not ask (plan 0273). Core does the
 * write, `basket-buy-for-list.integration.spec.ts` proves it. What is left
 * here is what the gateway adds: the owner's price and the product's name, a
 * guest refused before anything is asked, and the body's bounds.
 */

const BASKET = 'b4b1f0e2-1f5a-4c2e-9a4d-6f0e2b7c1d33';
const OWNER = 'u-owner';
const LIST = '0d2e4b6a-8c13-4f1a-8c5e-2b7d4a6f8c91';
const ITEM = '3f1a0c5e-2b7d-4a6f-8c91-0d2e4b6a8c13';
const ROW = '6a8c133f-1a0c-4e2b-9d4a-6f8c910d2e4b';
const SCOPE = 'b4e2c6a8-1f37-4d95-8a0b-2c6e4f9a1d73';

const SNAPSHOT: ItemSnapshot = {
  name: { en: 'Milk', es: 'Leche' },
  brand: 'Hacendado',
  unitSize: 1,
  packCount: null,
  defaultUnit: UnitOfMeasure.LITER,
  approxWeight: null,
};
const PAID = {
  priceScopeId: SCOPE,
  supermarketLocationId: null,
  supermarketId: null,
  pricePaidCents: 95,
  pricePaidCurrency: 'EUR',
  estimated: false,
};

function build(chosen: SettleChoice = { paid: PAID, itemSnapshot: SNAPSHOT }) {
  const sent: { subject: string; payload: unknown }[] = [];
  const send = jest.fn(async (subject: string, payload: unknown) => {
    sent.push({ subject, payload });
    if (subject === BASKET_PATTERNS.searchScope) {
      return {
        ownerUserId: OWNER,
        profileId: null,
        servesLocations: false,
        supermarketLocationId: null,
      };
    }
    if (subject === ITEM_PATTERNS.getMany) {
      // The sizing the unit check reads: a pack, counted in units.
      return { items: [{ id: ITEM, ...SNAPSHOT }] };
    }
    return { entries: [], progress: {} };
  });
  const prices = {
    choose: jest.fn(async () => chosen),
    refuseUnknownItem: jest.fn(async () => undefined),
  };
  return {
    controller: new BasketController(
      { send } as never,
      {} as never,
      prices as never
    ),
    sent,
    prices,
    message: () =>
      sent.find((call) => call.subject === BASKET_PATTERNS.rowBuyForList)
        ?.payload as BuyForListBasketRequest | undefined,
  };
}

const actor = (
  kind: ParticipantKind,
  userId: string | null
): BasketParticipantContext => ({
  participantId: 'p-1',
  basketId: BASKET,
  kind,
  userId,
});

const body = (
  extra: Partial<BuyForListBasketRowDto> = {}
): BuyForListBasketRowDto =>
  ({
    targetListId: LIST,
    quantity: 2,
    unit: 'UNIT',
    itemId: ITEM,
    ...extra,
  }) as BuyForListBasketRowDto;

describe('the buy for a list route (plan 0273)', () => {
  it('sends the owner’s price, the snapshot and the name in the reader’s language', async () => {
    const w = build();

    await runWithRequestContext({ correlationId: 'c', locale: 'es' }, () =>
      w.controller.buyForList(
        actor(ParticipantKind.REGISTERED, 'u-actor'),
        BASKET,
        ROW,
        body()
      )
    );

    expect(w.message()).toEqual({
      basketId: BASKET,
      participantId: 'p-1',
      userId: 'u-actor',
      rowKey: ROW,
      targetListId: LIST,
      quantity: 2,
      unit: 'UNIT',
      itemId: ITEM,
      content: 'Leche',
      paid: PAID,
      itemSnapshot: SNAPSHOT,
    });
    expect(w.prices.choose).toHaveBeenCalledWith(
      expect.objectContaining({ userId: OWNER, itemId: ITEM, unit: 'UNIT' })
    );
    expect(w.prices.refuseUnknownItem).toHaveBeenCalledWith(ITEM);
  });

  it('carries the lineId it was given and no name when catalog did not answer', async () => {
    const w = build({ paid: null, itemSnapshot: null });
    const lineId = '9a1d73b4-e2c6-4a81-b37d-95f80b2c6e4f';

    await w.controller.buyForList(
      actor(ParticipantKind.OWNER, OWNER),
      BASKET,
      ROW,
      body({ lineId })
    );

    expect(w.message()).toMatchObject({ lineId });
    expect(w.message()).not.toHaveProperty('content');
    expect(w.message()).not.toHaveProperty('itemSnapshot');
  });

  it('refuses a guest before catalog or core is asked', async () => {
    const w = build();

    await expect(
      w.controller.buyForList(
        actor(ParticipantKind.GUEST, null),
        BASKET,
        ROW,
        body()
      )
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(w.sent).toEqual([]);
    expect(w.prices.choose).not.toHaveBeenCalled();
  });

  it('takes a quantity of 1 to the ceiling, and no quantity of 0', async () => {
    const errors = async (raw: Record<string, unknown>) =>
      (await validate(plainToInstance(BuyForListBasketRowDto, raw))).map(
        (error) => error.property
      );
    const ok = { targetListId: LIST, quantity: 1, unit: 'UNIT', itemId: ITEM };

    expect(await errors(ok)).toEqual([]);
    expect(await errors({ ...ok, quantity: 0 })).toEqual(['quantity']);
    expect(await errors({ ...ok, lineId: 'not-a-uuid' })).toEqual(['lineId']);
    expect(await errors({ ...ok, unit: undefined })).toEqual(['unit']);
  });
});
