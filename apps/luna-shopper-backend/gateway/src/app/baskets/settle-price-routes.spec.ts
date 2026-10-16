import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  BASKET_LIMITS,
  BASKET_PATTERNS,
  ITEM_PATTERNS,
  LINE_PATTERNS,
  ParticipantKind,
  SettlementOutcome,
  SUPERMARKET_LOCATION_PATTERNS,
  UnitOfMeasure,
  type BasketParticipantContext,
  type BasketSearchScopeRequest,
  type BasketTripBuys,
  type ChangeBasketLinesProductRequest,
  type ItemSnapshot,
  type SettleBasketRowRequest,
  type SettleLineRequest,
  type SettlePick,
} from '@portfolio/luna-shopper/contracts';
import { ForbiddenException } from '@portfolio/luna-shopper/platform';
import { LinesController } from '../lists/list.controller';
import { SettleLineDto } from '../lists/list.dto';
import { BasketController } from './basket.controller';
import {
  ChangeBasketLinesProductDto,
  RenameBasketRowDto,
  RevertBasketRowDto,
  SetBasketRowDemandDto,
  SettleBasketRowDto,
  SkipBasketRowDto,
  UnskipBasketRowQueryDto,
} from './basket.dto';
import {
  SettlePriceService,
  type RewriteChoice,
  type RewritePriceInput,
  type SettleChoice,
  type SettlePriceInput,
} from './settle-price.service';

/**
 * How a price and a name reach a settle, at the two routes that make one (plan
 * 0143, sections 4.1 and 4.2; plan 0202, sections 1 and 2), and how they reach
 * a change of product (plan 0202, section 3).
 *
 * What the service does with the input is `settle-price.spec.ts`. What is left
 * here is the wiring, and it carries the plan's security property: **the price
 * is read as the basket's owner and never as the actor**, whoever tapped. A
 * registered participant with a profile of their own, and a guest with none,
 * both record the owner's price at the owner's scopes.
 *
 * Since plan 0202 the gateway chooses the price. A body can still carry
 * `priceScopeId`, and no route reads it: a settle at a shop records the price
 * of that shop, and a settle with no shop records the cheapest price.
 */

const BASKET = 'b4b1f0e2-1f5a-4c2e-9a4d-6f0e2b7c1d33';
const OWNER = 'u-owner';
const OWNER_PROFILE = 'prof-owner';
const ACTOR = 'u-actor';
const SCOPE = 'b4e2c6a8-1f37-4d95-8a0b-2c6e4f9a1d73';
/** A scope a client sends and nothing prices: it is there to be ignored. */
const SENT_SCOPE = 'ffffffff-1111-4111-8111-111111111111';
const SHOP = '9a1d73b4-e2c6-4a81-b37d-95f80b2c6e4f';
const ITEM = '3f1a0c5e-2b7d-4a6f-8c91-0d2e4b6a8c13';
/** The one line the settles below name, which is also the row key. */
const LINE = '6a8c133f-1a0c-4e2b-9d4a-6f8c910d2e4b';
const OTHER_LINE = '0d2e4b6a-8c13-4f1a-8c5e-2b7d4a6f8c91';

const PAID = {
  priceScopeId: SCOPE,
  supermarketLocationId: null,
  supermarketId: null,
  pricePaidCents: 95,
  pricePaidCurrency: 'EUR',
};

/** What a buy copies of ITEM (plan 0202, section 1). */
const SNAPSHOT: ItemSnapshot = {
  name: { en: 'Milk', es: 'Leche' },
  brand: 'Hacendado',
  unitSize: 1,
  packCount: null,
  defaultUnit: UnitOfMeasure.LITER,
};

/** Nothing chosen, which is an ordinary settle. */
const NOTHING: SettleChoice = { paid: null, itemSnapshot: null };

const quote = (priceScopeId: string, price: number) => ({
  itemId: ITEM,
  priceScopeId,
  price,
  currency: 'EUR',
});

/**
 * ITEM as the fake catalogs below answer it, for the suites that run the real
 * {@link SettlePriceService}. The first quote is the cheapest, so it is also
 * the `bestOffer` a read with `offers: 'best'` carries.
 */
const catalogItem = (...offers: ReturnType<typeof quote>[]) => ({
  id: ITEM,
  ...SNAPSHOT,
  offers,
  bestOffer: offers[0],
});

function buildBasket(
  options: {
    servesLocations?: boolean;
    /** The shop the basket was started at. */
    basketShop?: string;
    chosen?: SettleChoice;
  } = {}
) {
  const sent: { subject: string; payload: unknown }[] = [];
  const send = jest.fn(async (subject: string, payload: unknown) => {
    sent.push({ subject, payload });
    if (subject === BASKET_PATTERNS.searchScope) {
      return {
        ownerUserId: OWNER,
        profileId: OWNER_PROFILE,
        servesLocations: options.servesLocations ?? false,
        supermarketLocationId: options.basketShop ?? null,
      };
    }
    return { entries: [], progress: {} };
  });

  const asked: SettlePriceInput[] = [];
  const prices = {
    choose: jest.fn(async (input: SettlePriceInput) => {
      asked.push(input);
      return options.chosen ?? { paid: PAID, itemSnapshot: SNAPSHOT };
    }),
    // Catalog knows the product, which `settle-price.spec.ts` proves apart.
    refuseUnknownItem: jest.fn(async () => undefined),
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
    settle: () =>
      sent.find((call) => call.subject === BASKET_PATTERNS.rowSettle)
        ?.payload as SettleBasketRowRequest,
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
    lineIds: [LINE],
    outcome: SettlementOutcome.BOUGHT,
    quantity: 1,
    from: 1,
    itemId: ITEM,
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
      LINE,
      body()
    );

    // The owner delegated shopping, not pricing.
    expect(w.asked).toEqual([
      {
        userId: OWNER,
        profileId: OWNER_PROFILE,
        itemId: ITEM,
        supermarketLocationId: undefined,
        servedLocations: false,
      },
    ]);
  });

  it('puts the price and the name it read on the settle message, and nothing the client sent', async () => {
    const w = buildBasket();

    await w.controller.settle(
      actor(ParticipantKind.OWNER, OWNER),
      BASKET,
      LINE,
      body({ priceScopeId: SENT_SCOPE, supermarketLocationId: SHOP })
    );

    expect(w.settle().paid).toEqual(PAID);
    expect(w.settle().itemSnapshot).toEqual(SNAPSHOT);
    // The two ids the client named are never the message's own fields.
    expect(w.settle()).not.toHaveProperty('priceScopeId');
    expect(w.settle()).not.toHaveProperty('supermarketLocationId');
  });

  it('accepts a scope from the client and does not read it (plan 0202)', async () => {
    const w = buildBasket();

    await w.controller.settle(
      actor(ParticipantKind.OWNER, OWNER),
      BASKET,
      LINE,
      body({ priceScopeId: SENT_SCOPE })
    );

    expect(w.asked[0]).not.toHaveProperty('priceScopeId');
    expect(JSON.stringify([w.asked, w.sent])).not.toContain(SENT_SCOPE);
  });

  it('carries the flag core decided about this reader', async () => {
    const w = buildBasket({ servesLocations: true });

    await w.controller.settle(
      actor(ParticipantKind.OWNER, OWNER),
      BASKET,
      LINE,
      body({ supermarketLocationId: SHOP })
    );

    expect(w.asked[0]).toMatchObject({
      supermarketLocationId: SHOP,
      servedLocations: true,
    });
  });

  // Before plan 0202 a settle that named no scope and no shop asked nothing
  // and recorded no price. The gateway now chooses the cheapest price for it,
  // so it has to know whose basket this is.
  it('asks core whose basket it is on every settle, also one that names no scope and no shop (plan 0202)', async () => {
    const w = buildBasket();

    await w.controller.settle(
      actor(ParticipantKind.OWNER, OWNER),
      BASKET,
      LINE,
      body()
    );

    expect(w.sent.map((call) => call.subject)).toEqual([
      BASKET_PATTERNS.searchScope,
      BASKET_PATTERNS.rowSettle,
    ]);
    expect(w.prices.choose).toHaveBeenCalledTimes(1);
    expect(w.settle().paid).toEqual(PAID);
  });

  it("prices at the basket's own shop when the settle names none", async () => {
    const w = buildBasket({ basketShop: SHOP, servesLocations: true });

    await w.controller.settle(
      actor(ParticipantKind.OWNER, OWNER),
      BASKET,
      LINE,
      body()
    );

    expect(w.asked[0].supermarketLocationId).toBe(SHOP);
  });

  it('sends no price and no name when none was chosen, as absent keys', async () => {
    const w = buildBasket({ chosen: NOTHING });

    await w.controller.settle(
      actor(ParticipantKind.OWNER, OWNER),
      BASKET,
      LINE,
      body()
    );

    expect(w.settle().paid).toBeUndefined();
    expect(w.settle()).not.toHaveProperty('itemSnapshot');
  });

  // Core is about to ask itself the same question and will fail or succeed on
  // its own terms. A price that cannot be read never fails a settle.
  it('still settles when core cannot say whose basket it is, with no price and no name', async () => {
    const sent: { subject: string; payload: unknown }[] = [];
    const send = jest.fn(async (subject: string, payload: unknown) => {
      if (subject === BASKET_PATTERNS.searchScope) {
        throw new Error('core slow');
      }
      sent.push({ subject, payload });
      return { entries: [], progress: {} };
    });
    const prices = { choose: jest.fn(), refuseUnknownItem: jest.fn() };
    const controller = new BasketController(
      { send } as never,
      {} as never,
      prices as never
    );

    await expect(
      controller.settle(
        actor(ParticipantKind.OWNER, OWNER),
        BASKET,
        LINE,
        body()
      )
    ).resolves.toBeDefined();
    expect(prices.choose).not.toHaveBeenCalled();
    expect(sent.map((call) => call.subject)).toEqual([
      BASKET_PATTERNS.rowSettle,
    ]);
    const settle = sent[0].payload as SettleBasketRowRequest;
    expect(settle.paid).toBeUndefined();
    expect(settle).not.toHaveProperty('itemSnapshot');
  });
});

describe('the list page settle route', () => {
  function buildList(options: { chosen?: SettleChoice } = {}) {
    const sent: { subject: string; payload: unknown }[] = [];
    const send = jest.fn(async (subject: string, payload: unknown) => {
      sent.push({ subject, payload });
      return { line: {}, settlement: {} };
    });
    const prices = {
      choose: jest.fn(
        async (_input: SettlePriceInput) =>
          options.chosen ?? { paid: PAID, itemSnapshot: SNAPSHOT }
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
      settle: () =>
        sent.find((call) => call.subject === LINE_PATTERNS.settle)
          ?.payload as SettleLineRequest,
    };
  }

  it('reads the price as the caller, at their own default profile and shops', async () => {
    const w = buildList();

    await w.controller.settle({ userId: ACTOR } as never, 'line-1', {
      outcome: SettlementOutcome.BOUGHT,
      quantity: 1,
      itemId: ITEM,
      supermarketLocationId: SHOP,
    } as SettleLineDto);

    // No basket, so no owner to be somebody else: the caller is the account,
    // an undefined profile resolves their default, and the shops are theirs.
    expect(w.prices.choose.mock.calls).toEqual([
      [
        {
          userId: ACTOR,
          profileId: undefined,
          itemId: ITEM,
          supermarketLocationId: SHOP,
          servedLocations: true,
        },
      ],
    ]);
    expect(w.settle().paid).toEqual(PAID);
    expect(w.settle().itemSnapshot).toEqual(SNAPSHOT);
  });

  // Before plan 0202 this settle recorded nothing: no scope named, no price.
  it('chooses a price for a settle that names no shop and no scope too (plan 0202)', async () => {
    const w = buildList();

    await w.controller.settle({ userId: ACTOR } as never, 'line-1', {
      outcome: SettlementOutcome.BOUGHT,
      itemId: ITEM,
    } as SettleLineDto);

    expect(w.prices.choose).toHaveBeenCalledWith({
      userId: ACTOR,
      profileId: undefined,
      itemId: ITEM,
      supermarketLocationId: undefined,
      servedLocations: true,
    });
    expect(w.settle().paid).toEqual(PAID);
  });

  it('accepts a scope from the client and does not read it (plan 0202)', async () => {
    const w = buildList();

    await w.controller.settle({ userId: ACTOR } as never, 'line-1', {
      outcome: SettlementOutcome.BOUGHT,
      itemId: ITEM,
      priceScopeId: SENT_SCOPE,
    } as SettleLineDto);

    expect(w.prices.choose.mock.calls[0][0]).not.toHaveProperty('priceScopeId');
    expect(JSON.stringify([w.prices.choose.mock.calls, w.sent])).not.toContain(
      SENT_SCOPE
    );
  });

  // Naming a shop never fails a purchase (velista `0114`).
  it('settles with no price, no shop and no name when nothing was chosen, as absent keys', async () => {
    const w = buildList({ chosen: NOTHING });

    await w.controller.settle({ userId: ACTOR } as never, 'line-1', {
      outcome: SettlementOutcome.BOUGHT,
      itemId: ITEM,
      supermarketLocationId: SHOP,
    } as SettleLineDto);

    expect(w.sent.map((call) => call.subject)).toEqual([LINE_PATTERNS.settle]);
    expect(w.settle().paid).toBeUndefined();
    expect(w.settle()).not.toHaveProperty('itemSnapshot');
  });

  it('is the line settle subject, unchanged', async () => {
    const w = buildList();

    await w.controller.settle({ userId: ACTOR } as never, 'line-1', {
      outcome: SettlementOutcome.BOUGHT,
      itemId: ITEM,
    } as SettleLineDto);

    expect(w.sent.map((call) => call.subject)).toEqual([LINE_PATTERNS.settle]);
    expect(w.settle()).toMatchObject({
      userId: ACTOR,
      lineId: 'line-1',
      outcome: SettlementOutcome.BOUGHT,
      itemId: ITEM,
    });
  });
});

/**
 * A settle that names no `itemId` is priced and named for the product core
 * records (plan 0151; plan 0202).
 *
 * The real {@link SettlePriceService} runs here, over a catalog that quotes
 * ITEM at 0.95 in SCOPE, so each case follows a request all the way to the
 * `paid` on the message core receives. Core's answer is faked as `pick`, and
 * the gateway is checked for pricing exactly that and nothing it worked out
 * for itself.
 *
 * No settle here names a shop, so the price is the cheapest across the scopes
 * of the owner or the caller (plan 0202, section 2).
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
            ...((payload as BasketSearchScopeRequest).lineIds === undefined
              ? {}
              : { pick }),
          };
        case LINE_PATTERNS.settlePick:
          return pick;
        case ITEM_PATTERNS.getMany:
          return { items: [catalogItem(quote(SCOPE, 0.95))] };
        case BASKET_PATTERNS.rowSettle:
          return { entries: [], progress: {} };
        default:
          return { line: {}, settlement: {} };
      }
    });
    const nats = { send } as never;
    const describeScopes = jest.fn(
      async (_userId: string, _options: { profileId?: string }) => resolution
    );
    const prices = new SettlePriceService(nats, {
      describe: describeScopes,
    } as never);
    return {
      basket: new BasketController(nats, {} as never, prices),
      lines: new LinesController(nats, {} as never, prices),
      sent,
      describeScopes,
      subjects: () => sent.map((call) => call.subject),
      payloadOf: <T>(subject: string) =>
        sent.find((call) => call.subject === subject)?.payload as T,
    };
  }

  const ONE_OPTION: SettlePick = { pickedItemId: ITEM, optionCount: 1 };
  const TWO_OPTIONS: SettlePick = { pickedItemId: null, optionCount: 2 };
  const FREE_TEXT: SettlePick = { pickedItemId: null, optionCount: 0 };

  describe('on a basket row', () => {
    it('no itemId, single option row, stores the cheapest price and the name', async () => {
      const w = wire(ONE_OPTION);

      await w.basket.settle(
        actor(ParticipantKind.OWNER, OWNER),
        BASKET,
        LINE,
        body({ itemId: undefined })
      );

      // The lines went with the scope question, so core answered the pick on
      // the round trip the settle already made (plan 0201: the lines, where
      // it used to be the row key).
      expect(
        w.payloadOf<BasketSearchScopeRequest>(BASKET_PATTERNS.searchScope)
      ).toEqual({ basketId: BASKET, participantId: 'p-1', lineIds: [LINE] });
      const settle = w.payloadOf<SettleBasketRowRequest>(
        BASKET_PATTERNS.rowSettle
      );
      expect(settle.paid).toEqual(PAID);
      expect(settle.itemSnapshot).toEqual(SNAPSHOT);
      // Priced as the owner, at the profile of the basket.
      expect(w.describeScopes).toHaveBeenCalledWith(OWNER, {
        profileId: OWNER_PROFILE,
      });
    });

    it('sends every line the settle names with the scope question', async () => {
      const w = wire(ONE_OPTION);

      await w.basket.settle(
        actor(ParticipantKind.OWNER, OWNER),
        BASKET,
        LINE,
        body({ itemId: undefined, lineIds: [LINE, OTHER_LINE] })
      );

      expect(
        w.payloadOf<BasketSearchScopeRequest>(BASKET_PATTERNS.searchScope)
          .lineIds
      ).toEqual([LINE, OTHER_LINE]);
    });

    // Core answers a count of 1 or 0 for the lines of a basket since plan
    // 0201. Before plan 0202 this settle kept the scope the client had named
    // with no price. Nothing is kept now, and catalog is not asked.
    it('no itemId on lines that hold no product, or agree on none, records no price and no name, without asking catalog', async () => {
      const w = wire(FREE_TEXT);

      await w.basket.settle(
        actor(ParticipantKind.OWNER, OWNER),
        BASKET,
        LINE,
        body({ itemId: undefined })
      );

      const settle = w.payloadOf<SettleBasketRowRequest>(
        BASKET_PATTERNS.rowSettle
      );
      expect(settle.paid).toBeUndefined();
      expect(settle).not.toHaveProperty('itemSnapshot');
      expect(w.subjects()).toEqual([
        BASKET_PATTERNS.searchScope,
        BASKET_PATTERNS.rowSettle,
      ]);
      expect(w.describeScopes).not.toHaveBeenCalled();
    });

    it('does not send the lines when the caller named the product', async () => {
      const w = wire(TWO_OPTIONS);

      await w.basket.settle(
        actor(ParticipantKind.OWNER, OWNER),
        BASKET,
        LINE,
        body()
      );

      expect(
        w.payloadOf<BasketSearchScopeRequest>(BASKET_PATTERNS.searchScope)
      ).not.toHaveProperty('lineIds');
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
        ...extra,
      }) as SettleLineDto;

    // Before plan 0202 a line settled with no scope named recorded nothing.
    it('no itemId, single product line, no shop, stores the cheapest price across the caller’s scopes and the name (plan 0202)', async () => {
      const w = wire(ONE_OPTION);

      await w.lines.settle({ userId: ACTOR } as never, 'line-1', settleBody());

      expect(w.payloadOf(LINE_PATTERNS.settlePick)).toEqual({
        userId: ACTOR,
        lineId: 'line-1',
      });
      const settle = w.payloadOf<SettleLineRequest>(LINE_PATTERNS.settle);
      expect(settle.paid).toEqual(PAID);
      expect(settle.itemSnapshot).toEqual(SNAPSHOT);
      // The caller's own default profile.
      expect(w.describeScopes).toHaveBeenCalledWith(ACTOR, {
        profileId: undefined,
      });
    });

    // Until plan 0202 the second of these was a 400 on `itemId`: a scope said
    // the caller saw a price for one product. No scope is read any more, so
    // several products with none named is a settle that records no product.
    it.each([
      ['nothing else', {}],
      ['a scope', { priceScopeId: SENT_SCOPE }],
      ['a shop', { supermarketLocationId: SHOP }],
    ])(
      'no itemId, several products, naming %s: settles with no price and no name rather than refusing (plan 0202)',
      async (_name, named) => {
        const w = wire(TWO_OPTIONS);

        await w.lines.settle(
          { userId: ACTOR } as never,
          'line-1',
          settleBody(named)
        );

        const settle = w.payloadOf<SettleLineRequest>(LINE_PATTERNS.settle);
        expect(settle.paid).toBeUndefined();
        expect(settle).not.toHaveProperty('itemSnapshot');
        expect(settle.itemId).toBeUndefined();
        // No product, so catalog is asked nothing.
        expect(w.subjects()).toEqual([
          LINE_PATTERNS.settlePick,
          LINE_PATTERNS.settle,
        ]);
      }
    );

    it('asks core nothing when the caller named the product', async () => {
      const w = wire(TWO_OPTIONS);

      await w.lines.settle(
        { userId: ACTOR } as never,
        'line-1',
        settleBody({ itemId: ITEM })
      );

      expect(w.subjects()).not.toContain(LINE_PATTERNS.settlePick);
      expect(w.payloadOf<SettleLineRequest>(LINE_PATTERNS.settle).paid).toEqual(
        PAID
      );
    });
  });
});

/**
 * A settle at a shop (plan 0163, section 5; plan 0202, section 2).
 *
 * The real {@link SettlePriceService} runs over a catalog that knows one shop,
 * outside the owner's profile, on a scope the profile never resolves. The
 * settle is priced at the quoted scope of its shop, so that shop is priced and
 * recorded like one inside the profile, with its chain beside it. A settle in
 * "any shop" mode records the cheapest price and neither id.
 */
describe('a settle at a shop (plan 0163)', () => {
  /** A LIDL shop in another city, on no scope the owner's profile reaches. */
  const FAR_SHOP = '5c7e9a1b-3d5f-4a7b-9c1d-3e5f7a9b1c3d';
  const FAR_STORE_SCOPE = '7a9b1c3d-5c7e-4a7b-9c1d-3e5f7a9b1c3d';
  const FAR_REGION_SCOPE = '1c3d5c7e-9a1b-4a7b-9c1d-3e5f7a9b1c3d';
  const LIDL = '3d5f7a9b-1c3d-4a7b-9c1d-3e5f7a9b1c3d';
  /** A shop catalog cannot answer for. */
  const OTHER_SHOP = '9b1c3d5c-7e9a-4a7b-9c1d-3e5f7a9b1c3d';

  const AT_FAR_SHOP = {
    priceScopeId: FAR_STORE_SCOPE,
    supermarketLocationId: FAR_SHOP,
    supermarketId: LIDL,
    pricePaidCents: 110,
    pricePaidCurrency: 'EUR',
  };

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
          // The cheapest is the owner's own scope, and the far shop is dearer.
          return {
            items: [
              catalogItem(quote(SCOPE, 0.95), quote(FAR_STORE_SCOPE, 1.1)),
            ],
          };
        case BASKET_PATTERNS.rowSettle:
          return { entries: [], progress: {} };
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
      settle: () =>
        sent.find((call) => call.subject === BASKET_PATTERNS.rowSettle)
          ?.payload as SettleBasketRowRequest | undefined,
      paid: () =>
        (
          sent.find((call) => call.subject === BASKET_PATTERNS.rowSettle)
            ?.payload as SettleBasketRowRequest | undefined
        )?.paid,
    };
  }

  it('prices a shop outside the profile at its own quoted scope, and records the shop and its chain', async () => {
    const w = wire();

    await w.basket.settle(
      actor(ParticipantKind.OWNER, OWNER),
      BASKET,
      LINE,
      body({ supermarketLocationId: FAR_SHOP })
    );

    expect(w.paid()).toEqual(AT_FAR_SHOP);
    expect(w.settle()?.itemSnapshot).toEqual(SNAPSHOT);
  });

  it('records a guest at the shop too, since every participant is served shops', async () => {
    const w = wire();

    await w.basket.settle(
      actor(ParticipantKind.GUEST, null),
      BASKET,
      LINE,
      body({ supermarketLocationId: FAR_SHOP })
    );

    expect(w.paid()).toMatchObject({
      supermarketLocationId: FAR_SHOP,
      supermarketId: LIDL,
    });
  });

  // The scope of the cheapest price is not where the person stood.
  it('records neither id in any shop mode, and the cheapest price with its scope', async () => {
    const w = wire();

    await w.basket.settle(
      actor(ParticipantKind.OWNER, OWNER),
      BASKET,
      LINE,
      body()
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
      LINE,
      body()
    );

    expect(w.paid()).toEqual(AT_FAR_SHOP);
  });

  it.each([
    ['with a scope named', { priceScopeId: SCOPE }],
    ['with no scope named', {}],
  ])(
    'refuses another shop on a basket started at one, %s, and writes nothing',
    async (_name, named) => {
      const w = wire({ basketShop: FAR_SHOP });

      await expect(
        w.basket.settle(
          actor(ParticipantKind.OWNER, OWNER),
          BASKET,
          LINE,
          body({ ...named, supermarketLocationId: OTHER_SHOP })
        )
      ).rejects.toMatchObject({ code: 'basket_shop_locked' });
      expect(w.sent.map((call) => call.subject)).not.toContain(
        BASKET_PATTERNS.rowSettle
      );
    }
  );

  // Before plan 0202 the scope the client named decided: a shop whose stack
  // did not hold it was dropped and the price at that scope kept. The shop
  // decides now, and the scope the client names is not read.
  it('prices at the shop whatever scope the client names (plan 0202)', async () => {
    const w = wire();

    await w.basket.settle(
      actor(ParticipantKind.OWNER, OWNER),
      BASKET,
      LINE,
      body({ priceScopeId: SCOPE, supermarketLocationId: FAR_SHOP })
    );

    expect(w.paid()).toEqual(AT_FAR_SHOP);
  });

  // ITEM costs 0.95 at a scope of the owner. That is not the price of the
  // shop the settle named, so it is not recorded in its place.
  it.each([
    ['catalog cannot answer for', { shop: OTHER_SHOP, served: true }],
    ['the reader is not served', { shop: FAR_SHOP, served: false }],
  ])(
    'records no price and no shop at a shop %s, never the cheapest instead, and still the name (plan 0202)',
    async (_name, { shop, served }) => {
      const w = wire({ servesLocations: served });

      await w.basket.settle(
        actor(ParticipantKind.OWNER, OWNER),
        BASKET,
        LINE,
        body({ supermarketLocationId: shop })
      );

      expect(w.settle()).toBeDefined();
      expect(w.paid()).toBeUndefined();
      expect(w.settle()?.itemSnapshot).toEqual(SNAPSHOT);
    }
  );
});

/**
 * A settle names its lines and its product (plan 0201, section 4).
 *
 * The product can be one that is on none of the lines, so core cannot check
 * the id and the gateway asks catalog. The real {@link SettlePriceService}
 * runs here: what it decides is `settle-price.spec.ts`, and what is proven
 * here is that the route asks, refuses before core is told anything, and does
 * not hold the price read up to do it.
 */
describe('a settle that names its lines and its product (plan 0201)', () => {
  const resolution = {
    priceScopeIds: [SCOPE],
    scopes: [],
    coverage: [],
    approximate: false,
    profileId: OWNER_PROFILE,
    explicit: false,
  };

  function wire(catalog: 'knows' | 'does not know' | 'throws') {
    const sent: { subject: string; payload: unknown }[] = [];
    const send = jest.fn(async (subject: string, payload: unknown) => {
      sent.push({ subject, payload });
      switch (subject) {
        case BASKET_PATTERNS.searchScope:
          return {
            ownerUserId: OWNER,
            profileId: OWNER_PROFILE,
            servesLocations: false,
            supermarketLocationId: null,
          };
        case ITEM_PATTERNS.getMany:
          if (catalog === 'throws') {
            throw new Error('catalog unreachable');
          }
          return {
            items: catalog === 'knows' ? [catalogItem(quote(SCOPE, 0.95))] : [],
          };
        default:
          return { entries: [], progress: {} };
      }
    });
    const nats = { send } as never;
    const prices = new SettlePriceService(nats, {
      describe: jest.fn(async () => resolution),
    } as never);
    return {
      basket: new BasketController(nats, {} as never, prices),
      sent,
      settle: () =>
        sent.find((call) => call.subject === BASKET_PATTERNS.rowSettle)
          ?.payload as SettleBasketRowRequest | undefined,
    };
  }

  it('sends core the lines the body names, beside the row key', async () => {
    const w = wire('knows');

    await w.basket.settle(
      actor(ParticipantKind.OWNER, OWNER),
      BASKET,
      LINE,
      body({ lineIds: [LINE, OTHER_LINE] })
    );

    expect(w.settle()).toMatchObject({
      basketId: BASKET,
      participantId: 'p-1',
      rowKey: LINE,
      lineIds: [LINE, OTHER_LINE],
      itemId: ITEM,
      paid: PAID,
      itemSnapshot: SNAPSHOT,
    });
  });

  it('asks catalog for the product alone, with no scopes, beside the price read', async () => {
    const w = wire('knows');

    await w.basket.settle(
      actor(ParticipantKind.OWNER, OWNER),
      BASKET,
      LINE,
      body()
    );

    const lookups = w.sent
      .filter((call) => call.subject === ITEM_PATTERNS.getMany)
      .map((call) => call.payload);
    expect(lookups).toContainEqual({ ids: [ITEM] });
    // Beside each other and not one after the other. The price read asks
    // core first, so the check reaches catalog before the price does.
    expect(lookups[0]).toEqual({ ids: [ITEM] });
    expect(lookups[1]).toEqual({
      ids: [ITEM],
      priceScopeIds: [SCOPE],
      offers: 'best',
    });
  });

  it.each([
    ['the owner', ParticipantKind.OWNER, OWNER],
    ['a guest', ParticipantKind.GUEST, null],
  ])(
    'refuses an itemId catalog does not know from %s with a 400 on itemId, and writes nothing',
    async (_name, kind, userId) => {
      const w = wire('does not know');

      await expect(
        w.basket.settle(actor(kind, userId), BASKET, LINE, body())
      ).rejects.toMatchObject({
        code: 'validation_failed',
        messageArgs: { field: 'itemId' },
      });
      expect(w.settle()).toBeUndefined();
    }
  );

  // Only a definite "not found" refuses a buy. The same failure reads no
  // price and no name, and the buy is written without them.
  it('settles when catalog cannot say whether it knows the product', async () => {
    const w = wire('throws');

    await w.basket.settle(
      actor(ParticipantKind.OWNER, OWNER),
      BASKET,
      LINE,
      body()
    );

    expect(w.settle()).toMatchObject({ lineIds: [LINE], itemId: ITEM });
    expect(w.settle()?.paid).toBeUndefined();
    expect(w.settle()).not.toHaveProperty('itemSnapshot');
  });

  // Core is still asked whose basket it is (plan 0202). It answers no pick
  // here, so there is no product and nothing for catalog to say.
  it('asks catalog nothing about a product when the settle names none', async () => {
    const w = wire('does not know');

    await w.basket.settle(
      actor(ParticipantKind.OWNER, OWNER),
      BASKET,
      LINE,
      body({ itemId: undefined })
    );

    expect(w.sent.map((call) => call.subject)).toEqual([
      BASKET_PATTERNS.searchScope,
      BASKET_PATTERNS.rowSettle,
    ]);
  });
});

/**
 * The change of product (plan 0202, section 3): `POST :id/lines/product`.
 *
 * Core rewrites the buys of the trip, and the gateway reads what the new
 * product costs and what it is called. So the route asks core where those buys
 * were priced, hands that to {@link SettlePriceService.chooseForRewrite}, and
 * puts the answers on the write. What the service does with the question is
 * `settle-price.spec.ts`.
 */
describe('the change of product route (plan 0202, section 3)', () => {
  const FAR_SCOPE = '7a9b1c3d-5c7e-4a7b-9c1d-3e5f7a9b1c3d';

  const dto = (
    extra: Partial<ChangeBasketLinesProductDto> = {}
  ): ChangeBasketLinesProductDto => ({
    lineIds: [LINE, OTHER_LINE],
    itemId: ITEM,
    keep: true,
    ...extra,
  });

  const registered = actor(ParticipantKind.REGISTERED, ACTOR);

  /** What the write always carries, whatever was read. */
  const WRITE = {
    basketId: BASKET,
    participantId: 'p-1',
    userId: ACTOR,
    lineIds: [LINE, OTHER_LINE],
    itemId: ITEM,
    keep: true,
  };

  describe('the wiring', () => {
    const CHOSEN: RewriteChoice = {
      paid: PAID,
      itemSnapshot: SNAPSHOT,
      prices: [
        {
          priceScopeId: FAR_SCOPE,
          pricePaidCents: 110,
          pricePaidCurrency: 'EUR',
        },
      ],
    };

    function build(
      options: {
        /** What core answers the scope question with, or a failure. */
        scope?: Record<string, unknown> | 'throws';
        chosen?: RewriteChoice;
      } = {}
    ) {
      const sent: { subject: string; payload: unknown }[] = [];
      const send = jest.fn(async (subject: string, payload: unknown) => {
        sent.push({ subject, payload });
        if (subject === BASKET_PATTERNS.searchScope) {
          if (options.scope === 'throws') {
            throw new Error('core slow');
          }
          return {
            ownerUserId: OWNER,
            profileId: OWNER_PROFILE,
            servesLocations: true,
            supermarketLocationId: null,
            ...options.scope,
          };
        }
        return { entries: [], progress: {} };
      });
      const prices = {
        chooseForRewrite: jest.fn(
          async (_input: RewritePriceInput) => options.chosen ?? CHOSEN
        ),
        refuseUnknownItem: jest.fn(async (_itemId: string) => undefined),
      };
      return {
        controller: new BasketController(
          { send } as never,
          {} as never,
          prices as never
        ),
        send,
        sent,
        prices,
        payloadOf: <T>(subject: string) =>
          sent.find((call) => call.subject === subject)?.payload as T,
      };
    }

    // They settle what the row shows and hold no list.
    it('refuses a guest before core or catalog is asked', async () => {
      const w = build();

      await expect(
        w.controller.changeProduct(
          actor(ParticipantKind.GUEST, null),
          BASKET,
          dto()
        )
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(w.send).not.toHaveBeenCalled();
      expect(w.prices.chooseForRewrite).not.toHaveBeenCalled();
      expect(w.prices.refuseUnknownItem).not.toHaveBeenCalled();
    });

    it('asks core where the buys of the trip on those lines were priced', async () => {
      const w = build();

      await w.controller.changeProduct(registered, BASKET, dto());

      expect(
        w.payloadOf<BasketSearchScopeRequest>(BASKET_PATTERNS.searchScope)
      ).toEqual({
        basketId: BASKET,
        participantId: 'p-1',
        lineIds: [LINE, OTHER_LINE],
        tripBuys: true,
      });
    });

    it("prices the product as the owner, at the basket's own shop and the scopes core answered", async () => {
      const tripBuys: BasketTripBuys = {
        priceScopeIds: [SCOPE, FAR_SCOPE],
        unscoped: true,
      };
      const w = build({ scope: { supermarketLocationId: SHOP, tripBuys } });

      await w.controller.changeProduct(registered, BASKET, dto());

      // The actor has an account of their own, and the price is still the
      // owner's.
      expect(w.prices.chooseForRewrite.mock.calls).toEqual([
        [
          {
            userId: OWNER,
            profileId: OWNER_PROFILE,
            itemId: ITEM,
            supermarketLocationId: SHOP,
            servedLocations: true,
            priceScopeIds: [SCOPE, FAR_SCOPE],
            unscoped: true,
          },
        ],
      ]);
    });

    it('asks for no scope and no shop when core answered no buy, no shop and no profile', async () => {
      const w = build({ scope: { profileId: null } });

      await w.controller.changeProduct(registered, BASKET, dto());

      expect(w.prices.chooseForRewrite).toHaveBeenCalledWith({
        userId: OWNER,
        profileId: undefined,
        itemId: ITEM,
        supermarketLocationId: undefined,
        servedLocations: true,
        priceScopeIds: [],
        unscoped: false,
      });
    });

    it('asks catalog whether it knows the product, beside it', async () => {
      const w = build();

      await w.controller.changeProduct(registered, BASKET, dto());

      expect(w.prices.refuseUnknownItem.mock.calls).toEqual([[ITEM]]);
    });

    it('sends core the write with the name, the prices and the price of a buy with no scope', async () => {
      const w = build();

      await w.controller.changeProduct(registered, BASKET, dto());

      expect(w.sent.map((call) => call.subject)).toEqual([
        BASKET_PATTERNS.searchScope,
        BASKET_PATTERNS.linesProduct,
      ]);
      expect(
        w.payloadOf<ChangeBasketLinesProductRequest>(
          BASKET_PATTERNS.linesProduct
        )
      ).toEqual({
        ...WRITE,
        itemSnapshot: SNAPSHOT,
        prices: CHOSEN.prices,
        paid: PAID,
      });
    });

    it('carries `keep` as the body said it', async () => {
      const w = build();

      await w.controller.changeProduct(
        registered,
        BASKET,
        dto({ keep: false })
      );

      expect(
        w.payloadOf<ChangeBasketLinesProductRequest>(
          BASKET_PATTERNS.linesProduct
        ).keep
      ).toBe(false);
    });

    it('leaves out each of the three that was not read, as absent keys', async () => {
      const w = build({
        chosen: { paid: null, itemSnapshot: null, prices: [] },
      });

      await w.controller.changeProduct(registered, BASKET, dto());

      const write = w.payloadOf<ChangeBasketLinesProductRequest>(
        BASKET_PATTERNS.linesProduct
      );
      expect(write).toEqual(WRITE);
      expect(write).not.toHaveProperty('itemSnapshot');
      expect(write).not.toHaveProperty('prices');
      expect(write).not.toHaveProperty('paid');
    });

    // The write is about to ask core about the same lines, and it answers the
    // real refusal.
    it('still sends the write when core cannot answer the scope question, with none of the three', async () => {
      const w = build({ scope: 'throws' });

      await w.controller.changeProduct(registered, BASKET, dto());

      expect(w.prices.chooseForRewrite).not.toHaveBeenCalled();
      const write = w.payloadOf<ChangeBasketLinesProductRequest>(
        BASKET_PATTERNS.linesProduct
      );
      expect(write).toEqual(WRITE);
      expect(write).not.toHaveProperty('itemSnapshot');
      expect(write).not.toHaveProperty('prices');
      expect(write).not.toHaveProperty('paid');
    });
  });

  /**
   * The real {@link SettlePriceService}, so a request is followed all the way
   * to the write core receives.
   */
  describe('over a real price service', () => {
    const resolution = {
      priceScopeIds: [SCOPE],
      scopes: [],
      coverage: [],
      approximate: false,
      profileId: OWNER_PROFILE,
      explicit: false,
    };

    function wire(catalog: 'knows' | 'does not know' | 'throws') {
      const sent: { subject: string; payload: unknown }[] = [];
      const send = jest.fn(async (subject: string, payload: unknown) => {
        sent.push({ subject, payload });
        switch (subject) {
          case BASKET_PATTERNS.searchScope:
            return {
              ownerUserId: OWNER,
              profileId: OWNER_PROFILE,
              servesLocations: true,
              supermarketLocationId: null,
              tripBuys: { priceScopeIds: [FAR_SCOPE], unscoped: true },
            };
          case ITEM_PATTERNS.getMany:
            if (catalog === 'throws') {
              throw new Error('catalog unreachable');
            }
            return {
              items:
                catalog === 'knows'
                  ? [catalogItem(quote(SCOPE, 0.95), quote(FAR_SCOPE, 1.1))]
                  : [],
            };
          default:
            return { entries: [], progress: {} };
        }
      });
      const nats = { send } as never;
      const prices = new SettlePriceService(nats, {
        describe: jest.fn(async () => resolution),
      } as never);
      return {
        basket: new BasketController(nats, {} as never, prices),
        sent,
        write: () =>
          sent.find((call) => call.subject === BASKET_PATTERNS.linesProduct)
            ?.payload as ChangeBasketLinesProductRequest | undefined,
      };
    }

    it('writes the price at each scope a buy recorded, the cheapest for a buy with none, and the name', async () => {
      const w = wire('knows');

      await w.basket.changeProduct(registered, BASKET, dto());

      expect(w.write()).toEqual({
        ...WRITE,
        itemSnapshot: SNAPSHOT,
        prices: [
          {
            priceScopeId: FAR_SCOPE,
            pricePaidCents: 110,
            pricePaidCurrency: 'EUR',
          },
        ],
        paid: PAID,
      });
    });

    it('refuses an itemId catalog does not know with a 400 on itemId, and writes nothing', async () => {
      const w = wire('does not know');

      await expect(
        w.basket.changeProduct(registered, BASKET, dto())
      ).rejects.toMatchObject({
        code: 'validation_failed',
        messageArgs: { field: 'itemId' },
      });
      expect(w.write()).toBeUndefined();
    });

    // Only a definite "not found" refuses. The product of the buys is still
    // corrected, with no price and no name.
    it('writes the change when catalog cannot say whether it knows the product', async () => {
      const w = wire('throws');

      await w.basket.changeProduct(registered, BASKET, dto());

      expect(w.write()).toEqual(WRITE);
    });
  });

  describe('its body', () => {
    const errorsOf = async (extra: Record<string, unknown>) =>
      (
        await validate(
          plainToInstance(ChangeBasketLinesProductDto, {
            lineIds: [LINE],
            itemId: ITEM,
            keep: false,
            ...extra,
          }),
          { whitelist: true, forbidNonWhitelisted: true }
        )
      ).map((error) => error.property);

    it('takes the lines, the product and whether to keep it', async () => {
      expect(await errorsOf({})).toEqual([]);
    });

    it.each([
      ['itemId', { itemId: 'milk' }],
      ['itemId', { itemId: undefined }],
      ['keep', { keep: undefined }],
      ['keep', { keep: 'yes' }],
    ])('refuses a bad or absent %s', async (field, extra) => {
      expect(await errorsOf(extra)).toEqual([field]);
    });

    // The gateway reads all of these, as it does for a settle.
    it.each([
      ['paid', PAID],
      ['prices', [{ priceScopeId: SCOPE, pricePaidCents: 1 }]],
      ['itemSnapshot', SNAPSHOT],
      ['pricePaidCents', 95],
      ['priceScopeId', SCOPE],
    ])('has no field for %s', async (field, value) => {
      expect(await errorsOf({ [field]: value })).toEqual([field]);
    });
  });
});

/**
 * The other writes on a row name their lines too (plan 0201, section 4).
 *
 * Wiring only: each route puts the `lineIds` it was given on the message, and
 * core is what loads those lines and refuses the ones it should.
 */
describe('the writes on a row name their lines (plan 0201)', () => {
  function wire() {
    const sent: { subject: string; payload: unknown }[] = [];
    const send = jest.fn(async (subject: string, payload: unknown) => {
      sent.push({ subject, payload });
      return { entries: [], progress: {} };
    });
    return {
      controller: new BasketController(
        { send } as never,
        {} as never,
        {} as never
      ),
      sent,
    };
  }
  const owner = actor(ParticipantKind.OWNER, OWNER);
  const lineIds = [LINE, OTHER_LINE];

  it('revert of units', async () => {
    const w = wire();

    await w.controller.revert(owner, BASKET, LINE, {
      lineIds,
      target: 'UNITS',
      units: 1,
      from: 2,
    });

    expect(w.sent).toEqual([
      {
        subject: BASKET_PATTERNS.rowRevert,
        payload: {
          basketId: BASKET,
          participantId: 'p-1',
          rowKey: LINE,
          lineIds,
          target: 'UNITS',
          units: 1,
          from: 2,
        },
      },
    ]);
  });

  it('revert of a close', async () => {
    const w = wire();

    await w.controller.revert(owner, BASKET, LINE, {
      lineIds,
      target: 'CLOSE',
    });

    expect(w.sent[0].payload).toEqual({
      basketId: BASKET,
      participantId: 'p-1',
      rowKey: LINE,
      lineIds,
      target: 'CLOSE',
    });
  });

  it('demand, whose line is always named', async () => {
    const w = wire();

    await w.controller.demand(owner, BASKET, LINE, {
      lineId: LINE,
      quantity: 0,
      from: 2,
    });

    expect(w.sent[0]).toEqual({
      subject: BASKET_PATTERNS.rowDemand,
      payload: {
        basketId: BASKET,
        participantId: 'p-1',
        rowKey: LINE,
        lineId: LINE,
        quantity: 0,
        from: 2,
      },
    });
  });

  it('rename', async () => {
    const w = wire();

    await w.controller.rename(owner, BASKET, LINE, {
      lineIds,
      content: 'Oat milk',
    });

    expect(w.sent[0]).toEqual({
      subject: BASKET_PATTERNS.rowRename,
      payload: {
        basketId: BASKET,
        participantId: 'p-1',
        userId: OWNER,
        rowKey: LINE,
        lineIds,
        content: 'Oat milk',
        confirmMerge: undefined,
      },
    });
  });

  it('skip, from its body', async () => {
    const w = wire();

    await w.controller.skip(owner, BASKET, LINE, { lineIds });

    expect(w.sent[0]).toEqual({
      subject: BASKET_PATTERNS.rowSkip,
      payload: {
        basketId: BASKET,
        participantId: 'p-1',
        rowKey: LINE,
        lineIds,
      },
    });
  });

  it('unskip, from its query', async () => {
    const w = wire();

    await w.controller.unskip(owner, BASKET, LINE, { lineIds });

    expect(w.sent[0]).toEqual({
      subject: BASKET_PATTERNS.rowUnskip,
      payload: {
        basketId: BASKET,
        participantId: 'p-1',
        rowKey: LINE,
        lineIds,
      },
    });
  });

  it('asks core for the lists that can still take a product', async () => {
    const w = wire();

    await w.controller.productLists(
      actor(ParticipantKind.REGISTERED, ACTOR),
      BASKET,
      ITEM
    );

    expect(w.sent).toEqual([
      {
        subject: BASKET_PATTERNS.productLists,
        payload: { basketId: BASKET, participantId: 'p-1', itemId: ITEM },
      },
    ]);
  });
});

/**
 * The bounds of `lineIds`, on every body and on the one query that carry it
 * (plan 0201, section 4): 1 to 100 uuids, none twice.
 */
describe.each([
  ['the settle body', SettleBasketRowDto, { outcome: 'BOUGHT', from: 1 }],
  ['the revert body', RevertBasketRowDto, { target: 'CLOSE' }],
  ['the rename body', RenameBasketRowDto, { content: 'Oat milk' }],
  ['the skip body', SkipBasketRowDto, {}],
  ['the unskip query', UnskipBasketRowQueryDto, {}],
  // Plan 0202, section 3.
  [
    'the change of product body',
    ChangeBasketLinesProductDto,
    { itemId: ITEM, keep: true },
  ],
])('lineIds on %s', (_name, Dto, required) => {
  const errorsOf = async (lineIds: unknown) =>
    (
      await validate(
        plainToInstance(Dto as never, { ...required, lineIds }) as object,
        { whitelist: true, forbidNonWhitelisted: true }
      )
    ).map((error) => error.property);

  /** `count` distinct uuids. */
  const uuids = (count: number) =>
    Array.from(
      { length: count },
      (_, at) => `6a8c133f-1a0c-4e2b-9d4a-${String(at).padStart(12, '0')}`
    );

  it('accepts one line, and a hundred', async () => {
    expect(await errorsOf([LINE])).toEqual([]);
    expect(await errorsOf(uuids(BASKET_LIMITS.maxWriteLines))).toEqual([]);
  });

  it.each([
    ['is absent', undefined],
    ['is empty', []],
    ['names more than a hundred lines', 'too many'],
    ['names a line twice', [LINE, LINE]],
    ['names something that is not a uuid', [LINE, 'line-1']],
  ])('refuses a request whose lineIds %s', async (_case, lineIds) => {
    expect(
      await errorsOf(
        lineIds === 'too many'
          ? uuids(BASKET_LIMITS.maxWriteLines + 1)
          : lineIds
      )
    ).toEqual(['lineIds']);
  });
});

describe('the unskip query (plan 0201, section 4)', () => {
  const parse = (query: Record<string, unknown>) =>
    plainToInstance(UnskipBasketRowQueryDto, query);

  it('reads the lines from one comma separated parameter', async () => {
    const dto = parse({ lineIds: `${LINE},${OTHER_LINE}` });

    expect(dto.lineIds).toEqual([LINE, OTHER_LINE]);
    expect(await validate(dto)).toEqual([]);
  });

  it('reads the parameter repeated the same way', () => {
    expect(parse({ lineIds: [LINE, OTHER_LINE] }).lineIds).toEqual([
      LINE,
      OTHER_LINE,
    ]);
  });

  it('refuses an empty parameter', async () => {
    const errors = await validate(parse({ lineIds: '' }));

    expect(errors.map((error) => error.property)).toEqual(['lineIds']);
  });
});

describe('the demand body (plan 0201, section 4)', () => {
  it('requires the line', async () => {
    const errors = await validate(
      plainToInstance(SetBasketRowDemandDto, { quantity: 1, from: 0 })
    );

    expect(errors.map((error) => error.property)).toEqual(['lineId']);
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
  ['the row settle body', SettleBasketRowDto, { from: 1, lineIds: [LINE] }],
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

  // The scope is still accepted, so a client that sends it is not refused.
  // No route reads it since plan 0202.
  it('accepts the two ids it does take, of which the scope is not read', async () => {
    expect(
      await check({ priceScopeId: SCOPE, supermarketLocationId: SHOP })
    ).toEqual([]);
  });
});
