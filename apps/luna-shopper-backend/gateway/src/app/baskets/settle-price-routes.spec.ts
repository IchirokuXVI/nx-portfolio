import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  BASKET_PATTERNS,
  ITEM_PATTERNS,
  LINE_PATTERNS,
  ParticipantKind,
  SettlementOutcome,
  SUPERMARKET_LOCATION_PATTERNS,
  type BasketParticipantContext,
  type BasketSearchScopeRequest,
  type SettleBasketRowRequest,
  type SettleLineRequest,
  type SettlePick,
} from '@portfolio/luna-shopper/contracts';
import { LinesController } from '../lists/list.controller';
import { SettleLineDto } from '../lists/list.dto';
import { BasketController } from './basket.controller';
import { SettleBasketRowDto } from './basket.dto';
import {
  SettlePriceService,
  type SettlePriceInput,
} from './settle-price.service';

/**
 * How a price reaches a settle, at the two routes that make one (plan 0143,
 * sections 4.1 and 4.2).
 *
 * What the service does with the input is `settle-price.spec.ts`. What is left
 * here is the wiring, and it carries the plan's security property: **the price
 * is read as the basket's owner and never as the actor**, whoever tapped. A
 * registered participant with a profile of their own, and a guest with none,
 * both record the owner's price at the owner's scopes.
 */

const BASKET = 'b4b1f0e2-1f5a-4c2e-9a4d-6f0e2b7c1d33';
const OWNER = 'u-owner';
const OWNER_PROFILE = 'prof-owner';
const ACTOR = 'u-actor';
const SCOPE = 'b4e2c6a8-1f37-4d95-8a0b-2c6e4f9a1d73';
const SHOP = '9a1d73b4-e2c6-4a81-b37d-95f80b2c6e4f';
const ITEM = '3f1a0c5e-2b7d-4a6f-8c91-0d2e4b6a8c13';

const PAID = {
  priceScopeId: SCOPE,
  supermarketLocationId: null,
  supermarketId: null,
  pricePaidCents: 95,
  pricePaidCurrency: 'EUR',
};

function buildBasket(options: { servesLocations?: boolean } = {}) {
  const sent: { subject: string; payload: unknown }[] = [];
  const send = jest.fn(async (subject: string, payload: unknown) => {
    sent.push({ subject, payload });
    if (subject === BASKET_PATTERNS.searchScope) {
      return {
        ownerUserId: OWNER,
        profileId: OWNER_PROFILE,
        servesLocations: options.servesLocations ?? false,
      };
    }
    return { row: {}, progress: {} };
  });

  const asked: SettlePriceInput[] = [];
  const prices = {
    read: jest.fn(async (input: SettlePriceInput) => {
      asked.push(input);
      return PAID;
    }),
  };

  return {
    controller: new BasketController(
      { send } as never,
      {} as never,
      prices as never
    ),
    sent,
    asked,
    prices,
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

const body = (extra: Partial<SettleBasketRowDto> = {}): SettleBasketRowDto =>
  ({
    outcome: SettlementOutcome.BOUGHT,
    quantity: 1,
    from: 1,
    itemId: ITEM,
    priceScopeId: SCOPE,
    ...extra,
  }) as SettleBasketRowDto;

describe('the row settle route (plan 0143, section 4.2)', () => {
  it.each([
    ['a registered participant with an account of their own', ACTOR],
    ['a guest with no account at all', null],
  ])('reads the price as the owner when the actor is %s', async (_n, user) => {
    const w = buildBasket();

    await w.controller.settle(
      actor(user ? ParticipantKind.REGISTERED : ParticipantKind.GUEST, user),
      BASKET,
      'row-1',
      body()
    );

    // The owner delegated shopping, not pricing.
    expect(w.asked).toEqual([
      {
        userId: OWNER,
        profileId: OWNER_PROFILE,
        itemId: ITEM,
        priceScopeId: SCOPE,
        supermarketLocationId: undefined,
        servedLocations: false,
      },
    ]);
  });

  it('puts what it read on the settle message, and nothing the client sent', async () => {
    const w = buildBasket();

    await w.controller.settle(
      actor(ParticipantKind.OWNER, OWNER),
      BASKET,
      'row-1',
      body({ supermarketLocationId: SHOP })
    );

    const settle = w.sent.find(
      (call) => call.subject === BASKET_PATTERNS.rowSettle
    )?.payload as SettleBasketRowRequest;
    expect(settle.paid).toEqual(PAID);
    // The two ids the client named are the service's input and never the
    // message's own fields.
    expect(settle).not.toHaveProperty('priceScopeId');
    expect(settle).not.toHaveProperty('supermarketLocationId');
  });

  it('carries the flag core decided about this reader', async () => {
    const w = buildBasket({ servesLocations: true });

    await w.controller.settle(
      actor(ParticipantKind.OWNER, OWNER),
      BASKET,
      'row-1',
      body({ supermarketLocationId: SHOP })
    );

    expect(w.asked[0]).toMatchObject({
      supermarketLocationId: SHOP,
      servedLocations: true,
    });
  });

  it('asks nothing and sends no price when the client named no scope', async () => {
    const w = buildBasket();

    await w.controller.settle(
      actor(ParticipantKind.OWNER, OWNER),
      BASKET,
      'row-1',
      body({ priceScopeId: undefined })
    );

    expect(w.prices.read).not.toHaveBeenCalled();
    expect(w.sent.map((call) => call.subject)).toEqual([
      BASKET_PATTERNS.rowSettle,
    ]);
  });

  // Core is about to ask itself the same question and will fail or succeed on
  // its own terms. A price that cannot be read never fails a settle.
  it('still settles when core cannot say whose basket it is', async () => {
    const send = jest.fn(async (subject: string) => {
      if (subject === BASKET_PATTERNS.searchScope) {
        throw new Error('core slow');
      }
      return { row: {}, progress: {} };
    });
    const prices = { read: jest.fn() };
    const controller = new BasketController(
      { send } as never,
      {} as never,
      prices as never
    );

    await expect(
      controller.settle(
        actor(ParticipantKind.OWNER, OWNER),
        BASKET,
        'row-1',
        body()
      )
    ).resolves.toBeDefined();
    expect(prices.read).not.toHaveBeenCalled();
  });
});

describe('the list page settle route', () => {
  const SHOP_PAID = {
    ...PAID,
    supermarketLocationId: SHOP,
    supermarketId: 'chain-1',
  };

  function buildList(options: { atShop?: typeof SHOP_PAID | null } = {}) {
    const sent: { subject: string; payload: unknown }[] = [];
    const send = jest.fn(async (subject: string, payload: unknown) => {
      sent.push({ subject, payload });
      return { line: {}, settlement: {} };
    });
    const prices = {
      read: jest.fn(async () => PAID),
      readAtShop: jest.fn(async () =>
        options.atShop === undefined ? SHOP_PAID : options.atShop
      ),
    };
    return {
      controller: new LinesController(
        { send } as never,
        {} as never,
        prices as never
      ),
      sent,
      prices,
    };
  }

  it('reads the price as the caller, at their own default profile and shops', async () => {
    const w = buildList();

    await w.controller.settle({ userId: ACTOR } as never, 'line-1', {
      outcome: SettlementOutcome.BOUGHT,
      quantity: 1,
      itemId: ITEM,
      priceScopeId: SCOPE,
      supermarketLocationId: SHOP,
    } as SettleLineDto);

    // No basket, so no owner to be somebody else: the caller is the account,
    // an undefined profile resolves their default, and the shops are theirs.
    expect(w.prices.read).toHaveBeenCalledWith({
      userId: ACTOR,
      profileId: undefined,
      itemId: ITEM,
      priceScopeId: SCOPE,
      supermarketLocationId: SHOP,
      servedLocations: true,
    });
    const settle = w.sent[0].payload as SettleLineRequest;
    expect(settle.paid).toEqual(PAID);
  });

  it('sends no price when the client named no scope', async () => {
    const w = buildList();

    await w.controller.settle({ userId: ACTOR } as never, 'line-1', {
      outcome: SettlementOutcome.BOUGHT,
    } as SettleLineDto);

    expect(w.prices.read).not.toHaveBeenCalled();
    expect((w.sent[0].payload as SettleLineRequest).paid).toBeUndefined();
  });

  it('works the scope out from the shop when the client named only a shop (velista 0114)', async () => {
    const w = buildList();

    await w.controller.settle({ userId: ACTOR } as never, 'line-1', {
      outcome: SettlementOutcome.BOUGHT,
      quantity: 1,
      itemId: ITEM,
      supermarketLocationId: SHOP,
    } as SettleLineDto);

    expect(w.prices.read).not.toHaveBeenCalled();
    expect(w.prices.readAtShop).toHaveBeenCalledWith({
      userId: ACTOR,
      profileId: undefined,
      itemId: ITEM,
      supermarketLocationId: SHOP,
      servedLocations: true,
    });
    expect((w.sent[0].payload as SettleLineRequest).paid).toEqual(SHOP_PAID);
  });

  it('settles with no price and no shop when the shop resolves nothing', async () => {
    const w = buildList({ atShop: null });

    await w.controller.settle({ userId: ACTOR } as never, 'line-1', {
      outcome: SettlementOutcome.BOUGHT,
      itemId: ITEM,
      supermarketLocationId: SHOP,
    } as SettleLineDto);

    expect(w.sent.map((call) => call.subject)).toEqual([LINE_PATTERNS.settle]);
    expect((w.sent[0].payload as SettleLineRequest).paid).toBeUndefined();
  });

  it('asks nothing about a shop on a trip that found nothing', async () => {
    const w = buildList();

    await w.controller.settle({ userId: ACTOR } as never, 'line-1', {
      outcome: SettlementOutcome.NOT_AVAILABLE,
      supermarketLocationId: SHOP,
    } as SettleLineDto);

    expect(w.prices.readAtShop).not.toHaveBeenCalled();
    expect((w.sent[0].payload as SettleLineRequest).paid).toBeUndefined();
  });

  it('is the line settle subject, unchanged', async () => {
    const w = buildList();

    await w.controller.settle({ userId: ACTOR } as never, 'line-1', {
      outcome: SettlementOutcome.BOUGHT,
    } as SettleLineDto);

    expect(w.sent[0].subject).toBe(LINE_PATTERNS.settle);
  });
});

/**
 * A settle that names no `itemId` is priced for the product core records (plan
 * 0151).
 *
 * The real {@link SettlePriceService} runs here, over a catalog that quotes
 * ITEM at 0.95 in SCOPE, so each case follows a request all the way to the
 * `paid` on the message core receives. Core's answer is faked as `pick`, and
 * the gateway is checked for pricing exactly that and nothing it worked out
 * for itself.
 */
describe('a settle with no itemId (plan 0151)', () => {
  const resolution = {
    priceScopeIds: [SCOPE],
    scopes: [
      {
        priceScopeId: SCOPE,
        supermarketId: 'mercadona',
        postalCode: '14013',
        origin: 'POSTAL_CODE',
        approximate: false,
      },
    ],
    coverage: [],
    approximate: false,
    profileId: OWNER_PROFILE,
    explicit: false,
  };

  /** Core answers `pick`, catalog quotes ITEM, and everything is recorded. */
  function wire(pick: SettlePick) {
    const sent: { subject: string; payload: unknown }[] = [];
    const send = jest.fn(async (subject: string, payload: unknown) => {
      sent.push({ subject, payload });
      switch (subject) {
        case BASKET_PATTERNS.searchScope:
          return {
            ownerUserId: OWNER,
            profileId: OWNER_PROFILE,
            servesLocations: false,
            ...((payload as BasketSearchScopeRequest).rowKey === undefined
              ? {}
              : { pick }),
          };
        case LINE_PATTERNS.settlePick:
          return pick;
        case ITEM_PATTERNS.getMany:
          return {
            items: [
              {
                id: ITEM,
                offers: [
                  {
                    itemId: ITEM,
                    priceScopeId: SCOPE,
                    price: 0.95,
                    currency: 'EUR',
                  },
                ],
              },
            ],
          };
        case BASKET_PATTERNS.rowSettle:
          return { row: {}, progress: {} };
        default:
          return { line: {}, settlement: {} };
      }
    });
    const nats = { send } as never;
    const prices = new SettlePriceService(nats, {
      describe: jest.fn(async () => resolution),
    } as never);
    return {
      basket: new BasketController(nats, {} as never, prices),
      lines: new LinesController(nats, {} as never, prices),
      sent,
      payloadOf: <T>(subject: string) =>
        sent.find((call) => call.subject === subject)?.payload as T,
    };
  }

  const ONE_OPTION: SettlePick = { pickedItemId: ITEM, optionCount: 1 };
  const TWO_OPTIONS: SettlePick = { pickedItemId: null, optionCount: 2 };
  const FREE_TEXT: SettlePick = { pickedItemId: null, optionCount: 0 };

  describe('on a basket row', () => {
    it('no itemId, single option row, scope with a price, stores the price', async () => {
      const w = wire(ONE_OPTION);

      await w.basket.settle(
        actor(ParticipantKind.OWNER, OWNER),
        BASKET,
        'row-1',
        body({ itemId: undefined })
      );

      // The row went with the scope question, so core answered the pick on
      // the round trip the settle already made.
      expect(
        w.payloadOf<BasketSearchScopeRequest>(BASKET_PATTERNS.searchScope)
      ).toEqual({ basketId: BASKET, participantId: 'p-1', rowKey: 'row-1' });
      expect(
        w.payloadOf<SettleBasketRowRequest>(BASKET_PATTERNS.rowSettle).paid
      ).toEqual(PAID);
    });

    it('no itemId, several options, refuses with a 400 on itemId and writes nothing', async () => {
      const w = wire(TWO_OPTIONS);

      await expect(
        w.basket.settle(
          actor(ParticipantKind.OWNER, OWNER),
          BASKET,
          'row-1',
          body({ itemId: undefined })
        )
      ).rejects.toMatchObject({
        code: 'validation_failed',
        messageArgs: { field: 'itemId' },
      });
      expect(w.sent.map((call) => call.subject)).not.toContain(
        BASKET_PATTERNS.rowSettle
      );
    });

    it('no itemId on a free text row keeps the scope and records no price', async () => {
      const w = wire(FREE_TEXT);

      await w.basket.settle(
        actor(ParticipantKind.OWNER, OWNER),
        BASKET,
        'row-1',
        body({ itemId: undefined })
      );

      expect(
        w.payloadOf<SettleBasketRowRequest>(BASKET_PATTERNS.rowSettle).paid
      ).toEqual({ ...PAID, pricePaidCents: null, pricePaidCurrency: null });
    });

    it('does not send the row when the caller named the product', async () => {
      const w = wire(TWO_OPTIONS);

      await w.basket.settle(
        actor(ParticipantKind.OWNER, OWNER),
        BASKET,
        'row-1',
        body()
      );

      expect(
        w.payloadOf<BasketSearchScopeRequest>(BASKET_PATTERNS.searchScope)
      ).not.toHaveProperty('rowKey');
      expect(
        w.payloadOf<SettleBasketRowRequest>(BASKET_PATTERNS.rowSettle).paid
      ).toEqual(PAID);
    });
  });

  describe('on a list line', () => {
    const settleBody = (extra: Partial<SettleLineDto> = {}) =>
      ({
        outcome: SettlementOutcome.BOUGHT,
        quantity: 1,
        priceScopeId: SCOPE,
        ...extra,
      }) as SettleLineDto;

    it('no itemId, single product line, scope with a price, stores the price', async () => {
      const w = wire(ONE_OPTION);

      await w.lines.settle({ userId: ACTOR } as never, 'line-1', settleBody());

      expect(w.payloadOf(LINE_PATTERNS.settlePick)).toEqual({
        userId: ACTOR,
        lineId: 'line-1',
      });
      expect(w.payloadOf<SettleLineRequest>(LINE_PATTERNS.settle).paid).toEqual(
        PAID
      );
    });

    it('no itemId, several products, refuses with a 400 on itemId and writes nothing', async () => {
      const w = wire(TWO_OPTIONS);

      await expect(
        w.lines.settle({ userId: ACTOR } as never, 'line-1', settleBody())
      ).rejects.toMatchObject({
        code: 'validation_failed',
        messageArgs: { field: 'itemId' },
      });
      expect(w.sent.map((call) => call.subject)).not.toContain(
        LINE_PATTERNS.settle
      );
    });

    it('no itemId, several products, only a shop: settles with no shop rather than refusing (velista 0114)', async () => {
      const w = wire(TWO_OPTIONS);

      await w.lines.settle(
        { userId: ACTOR } as never,
        'line-1',
        settleBody({ priceScopeId: undefined, supermarketLocationId: SHOP })
      );

      expect(
        w.payloadOf<SettleLineRequest>(LINE_PATTERNS.settle).paid
      ).toBeUndefined();
    });

    it('asks core nothing when the caller named the product', async () => {
      const w = wire(TWO_OPTIONS);

      await w.lines.settle(
        { userId: ACTOR } as never,
        'line-1',
        settleBody({ itemId: ITEM })
      );

      expect(w.sent.map((call) => call.subject)).not.toContain(
        LINE_PATTERNS.settlePick
      );
      expect(w.payloadOf<SettleLineRequest>(LINE_PATTERNS.settle).paid).toEqual(
        PAID
      );
    });
  });
});

/**
 * A settle at a shop (plan 0163, section 5).
 *
 * The real {@link SettlePriceService} runs over a catalog that knows two shops:
 * one in the owner's profile, and one outside it that the profile never
 * resolves. The settle's resolution is the owner's scopes **plus** the stack of
 * the settle's shop, so the second is priced and recorded like the first, with
 * its chain beside it. A settle in "any shop" mode records neither id.
 */
describe('a settle at a shop (plan 0163)', () => {
  /** A LIDL shop in another city, on no scope the owner's profile reaches. */
  const FAR_SHOP = '5c7e9a1b-3d5f-4a7b-9c1d-3e5f7a9b1c3d';
  const FAR_STORE_SCOPE = '7a9b1c3d-5c7e-4a7b-9c1d-3e5f7a9b1c3d';
  const FAR_REGION_SCOPE = '1c3d5c7e-9a1b-4a7b-9c1d-3e5f7a9b1c3d';
  const LIDL = '3d5f7a9b-1c3d-4a7b-9c1d-3e5f7a9b1c3d';
  const OTHER_SHOP = '9b1c3d5c-7e9a-4a7b-9c1d-3e5f7a9b1c3d';

  const resolution = {
    priceScopeIds: [SCOPE],
    scopes: [
      {
        priceScopeId: SCOPE,
        supermarketId: 'mercadona',
        postalCode: '14013',
        origin: 'POSTAL_CODE',
        approximate: false,
      },
    ],
    coverage: [],
    approximate: false,
    profileId: OWNER_PROFILE,
    explicit: false,
  };

  function wire(
    options: {
      basketShop?: string | null;
      servesLocations?: boolean;
    } = {}
  ) {
    const sent: { subject: string; payload: unknown }[] = [];
    const send = jest.fn(async (subject: string, payload: unknown) => {
      sent.push({ subject, payload });
      switch (subject) {
        case BASKET_PATTERNS.searchScope:
          return {
            ownerUserId: OWNER,
            profileId: OWNER_PROFILE,
            servesLocations: options.servesLocations ?? true,
            supermarketLocationId: options.basketShop ?? null,
          };
        case SUPERMARKET_LOCATION_PATTERNS.shopAvailability: {
          const id = (payload as { supermarketLocationId: string })
            .supermarketLocationId;
          if (id !== FAR_SHOP) {
            throw new Error('not found');
          }
          return {
            location: {
              id: FAR_SHOP,
              supermarketId: LIDL,
              priceScopeId: FAR_STORE_SCOPE,
              priceScopeIds: [FAR_STORE_SCOPE, FAR_REGION_SCOPE],
              postalCode: '28013',
            },
            supermarket: { id: LIDL, name: { en: 'Lidl', es: 'Lidl' } },
            availability: [],
          };
        }
        case ITEM_PATTERNS.getMany:
          return {
            items: [
              {
                id: ITEM,
                offers: [
                  {
                    itemId: ITEM,
                    priceScopeId: SCOPE,
                    price: 0.95,
                    currency: 'EUR',
                  },
                  {
                    itemId: ITEM,
                    priceScopeId: FAR_STORE_SCOPE,
                    price: 1.1,
                    currency: 'EUR',
                  },
                ],
              },
            ],
          };
        case BASKET_PATTERNS.rowSettle:
          return { row: {}, progress: {} };
        default:
          return { line: {}, settlement: {} };
      }
    });
    const nats = { send } as never;
    const prices = new SettlePriceService(nats, {
      describe: jest.fn(async () => resolution),
    } as never);
    return {
      basket: new BasketController(nats, {} as never, prices),
      sent,
      paid: () =>
        (
          sent.find((call) => call.subject === BASKET_PATTERNS.rowSettle)
            ?.payload as SettleBasketRowRequest | undefined
        )?.paid,
    };
  }

  it('prices a shop outside the profile at its own stack, and records the shop and its chain', async () => {
    const w = wire();

    await w.basket.settle(
      actor(ParticipantKind.OWNER, OWNER),
      BASKET,
      'row-1',
      body({ priceScopeId: FAR_STORE_SCOPE, supermarketLocationId: FAR_SHOP })
    );

    expect(w.paid()).toEqual({
      priceScopeId: FAR_STORE_SCOPE,
      supermarketLocationId: FAR_SHOP,
      supermarketId: LIDL,
      pricePaidCents: 110,
      pricePaidCurrency: 'EUR',
    });
  });

  it('records a guest at the shop too, since every participant is served shops', async () => {
    const w = wire();

    await w.basket.settle(
      actor(ParticipantKind.GUEST, null),
      BASKET,
      'row-1',
      body({ priceScopeId: FAR_STORE_SCOPE, supermarketLocationId: FAR_SHOP })
    );

    expect(w.paid()).toMatchObject({
      supermarketLocationId: FAR_SHOP,
      supermarketId: LIDL,
    });
  });

  // The scope of the cheapest price is not where the person stood.
  it('records neither id in any shop mode, and keeps the scope and the price', async () => {
    const w = wire();

    await w.basket.settle(
      actor(ParticipantKind.OWNER, OWNER),
      BASKET,
      'row-1',
      body({ priceScopeId: SCOPE })
    );

    expect(w.paid()).toEqual({
      priceScopeId: SCOPE,
      supermarketLocationId: null,
      supermarketId: null,
      pricePaidCents: 95,
      pricePaidCurrency: 'EUR',
    });
    expect(w.sent.map((call) => call.subject)).not.toContain(
      SUPERMARKET_LOCATION_PATTERNS.shopAvailability
    );
  });

  it("records the basket's own shop when the settle names none", async () => {
    const w = wire({ basketShop: FAR_SHOP });

    await w.basket.settle(
      actor(ParticipantKind.REGISTERED, ACTOR),
      BASKET,
      'row-1',
      body({ priceScopeId: FAR_STORE_SCOPE })
    );

    expect(w.paid()).toMatchObject({
      priceScopeId: FAR_STORE_SCOPE,
      supermarketLocationId: FAR_SHOP,
      supermarketId: LIDL,
      pricePaidCents: 110,
    });
  });

  it('refuses another shop on a basket started at one, and writes nothing', async () => {
    const w = wire({ basketShop: FAR_SHOP });

    await expect(
      w.basket.settle(
        actor(ParticipantKind.OWNER, OWNER),
        BASKET,
        'row-1',
        body({ priceScopeId: SCOPE, supermarketLocationId: OTHER_SHOP })
      )
    ).rejects.toMatchObject({ code: 'basket_shop_locked' });
    expect(w.sent.map((call) => call.subject)).not.toContain(
      BASKET_PATTERNS.rowSettle
    );
  });

  it('refuses another shop even when the settle names no scope', async () => {
    const w = wire({ basketShop: FAR_SHOP });

    await expect(
      w.basket.settle(
        actor(ParticipantKind.OWNER, OWNER),
        BASKET,
        'row-1',
        body({ priceScopeId: undefined, supermarketLocationId: OTHER_SHOP })
      )
    ).rejects.toMatchObject({ code: 'basket_shop_locked' });
  });

  it('drops a shop whose stack does not hold the scope, and keeps the price', async () => {
    const w = wire();

    await w.basket.settle(
      actor(ParticipantKind.OWNER, OWNER),
      BASKET,
      'row-1',
      body({ priceScopeId: SCOPE, supermarketLocationId: FAR_SHOP })
    );

    expect(w.paid()).toEqual({ ...PAID });
  });
});

/**
 * No request body can carry an amount of money (section 4.1).
 *
 * Both DTOs are validated with `forbidNonWhitelisted`, which is what turns "we
 * did not add a field" into "a field cannot be added by a caller". Without it
 * the rule would be a convention, and a convention is not what stops a guest
 * writing money into a household's history.
 */
describe.each([
  ['the row settle body', SettleBasketRowDto, { from: 1 }],
  ['the list settle body', SettleLineDto, {}],
])('%s', (_name, Dto, required) => {
  const check = (body: Record<string, unknown>) =>
    validate(
      plainToInstance(Dto as never, {
        outcome: SettlementOutcome.BOUGHT,
        ...required,
        ...body,
      }),
      { whitelist: true, forbidNonWhitelisted: true }
    );

  it('refuses a body carrying pricePaidCents', async () => {
    const errors = await check({ pricePaidCents: 95 });

    expect(errors.map((error) => error.property)).toContain('pricePaidCents');
  });

  it('accepts the two ids it does take', async () => {
    expect(
      await check({ priceScopeId: SCOPE, supermarketLocationId: SHOP })
    ).toEqual([]);
  });
});
