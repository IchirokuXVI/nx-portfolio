import {
  ITEM_LOOKUP_LIMITS,
  ITEM_PATTERNS,
  PROFILE_PATTERNS,
  SUPERMARKET_PATTERNS,
  type CatalogScopeView,
  type ItemOfferView,
  type ItemView,
} from '@portfolio/luna-shopper/contracts';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CatalogSuggestService } from './catalog-suggest.service';
import { CatalogItemLookupController } from './catalog.controller';
import { LookupItemsDto } from './catalog.dto';
import { ScopeResolutionService } from './scope-resolution.service';

/**
 * Reading a set of product names over HTTP (plan 0053, section 1), and since
 * plan 0207 their prices.
 *
 * `ITEM_PATTERNS.getMany` existed and had exactly one consumer, the participant
 * surface velista `0044` added so a guest could read the names in a basket.
 * There was no general route in front of it, which is why velista's line screens
 * resolved products through a hand written fixture and told a user with a real
 * catalog that their line has no products when it does.
 *
 * What the route is responsible for is asserted here: the cap is enforced and
 * not merely documented, the caller is not named in the request, and with
 * `prices` the read is priced at the scopes of the caller's default profile and
 * names their chains. Which products come back, the fact that unknown ids are
 * omitted, and what an offer holds are catalog's and are proven there.
 */

const ID = '11111111-2222-4333-8444-555555555555';
const OTHER_ID = '11111111-2222-4333-8444-666666666666';
const USER = { userId: 'user-1' } as never;

const MERCADONA = 'c0000000-0000-4000-a000-000000000001';
const LIDL = 'c0000000-0000-4000-a000-000000000002';
const SCOPE_MERCADONA = 'd0000000-0000-4000-a000-000000000001';
const SCOPE_LIDL = 'd0000000-0000-4000-a000-000000000002';

function ids(count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `1111111${index % 10}-2222-4333-8444-555555555555`
  );
}

async function errorsOn(body: object): Promise<string[]> {
  const failures = await validate(plainToInstance(LookupItemsDto, body));
  return failures.flatMap((failure) => Object.keys(failure.constraints ?? {}));
}

function lookupDto(body: { ids: string[]; prices?: boolean }): LookupItemsDto {
  return plainToInstance(LookupItemsDto, body);
}

const offer = (itemId: string, priceScopeId: string, price: number) =>
  ({ itemId, priceScopeId, price, currency: 'EUR' }) as ItemOfferView;

/** A resolution of a default profile that shops at two chains. */
const TWO_CHAINS: CatalogScopeView = {
  priceScopeIds: [SCOPE_MERCADONA, SCOPE_LIDL],
  scopes: [
    { priceScopeId: SCOPE_MERCADONA, supermarketId: MERCADONA },
    { priceScopeId: SCOPE_LIDL, supermarketId: LIDL },
  ] as CatalogScopeView['scopes'],
  coverage: [],
  approximate: false,
  profileId: 'p1',
  explicit: false,
};

/** A profile that names no postal code and no chain (plan 0069). */
const NO_SCOPES: CatalogScopeView = {
  priceScopeIds: [],
  scopes: [],
  coverage: [],
  approximate: false,
  profileId: 'p1',
  explicit: false,
};

/**
 * The controller with the real suggest service behind it, so the chains are
 * named by the code that names them for the dropdown. `items` is what catalog
 * answers for `item.getMany`.
 */
function build(
  options: { items?: ItemView[]; resolved?: CatalogScopeView } = {}
) {
  const send = jest.fn(async (subject: string, _payload?: unknown) => {
    if (subject === SUPERMARKET_PATTERNS.list) {
      return {
        items: [
          { id: MERCADONA, name: { es: 'Mercadona' }, logoUrl: 'm.png' },
          { id: LIDL, name: { es: 'Lidl' }, logoUrl: null },
        ],
        nextCursor: null,
      };
    }
    return { items: options.items ?? [] };
  });
  const describe = jest.fn(async () => options.resolved ?? TWO_CHAINS);
  const controller = new CatalogItemLookupController(
    { send } as never,
    { describe } as never,
    new CatalogSuggestService({ send } as never)
  );
  const sentTo = (subject: string) =>
    send.mock.calls.filter((call) => call[0] === subject);
  return { controller, send, describe, sentTo };
}

describe('POST /v1/catalog/items/lookup', () => {
  it('passes the ids straight through to the batch pattern', async () => {
    const { controller, send } = build();

    await controller.lookup(USER, lookupDto({ ids: [ID] }));

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(ITEM_PATTERNS.getMany, { ids: [ID] });
  });

  it('names no caller, because a product name is not private', async () => {
    const { controller, send } = build();

    await controller.lookup(USER, lookupDto({ ids: [ID], prices: true }));

    // The subject takes no `userId` by design: the gateway's own guard is what
    // decides who may reach the route, and catalog has no per user answer to
    // give about a product's name. A priced read names scopes, not a person.
    expect(send.mock.calls[0][1]).not.toHaveProperty('userId');
  });

  it('accepts a request naming exactly the documented maximum', async () => {
    expect(await errorsOn({ ids: ids(ITEM_LOOKUP_LIMITS.maxIds) })).toEqual([]);
  });

  it('refuses one product past it, at the route', async () => {
    // A batch read with no ceiling is a listing, and plan 0049 section 3
    // deliberately stopped the catalog being listable. Documenting the cap and
    // not enforcing it would have left that hole open through this route.
    expect(
      await errorsOn({ ids: ids(ITEM_LOOKUP_LIMITS.maxIds + 1) })
    ).toContain('arrayMaxSize');
  });

  it('refuses an id that is not an item reference', async () => {
    expect(await errorsOn({ ids: ['milk'] })).toContain('isUuid');
  });

  it('accepts an empty request, which is a page with nothing to name', async () => {
    // A line with no products asks for none, and answering it with a bad
    // request would make an ordinary empty basket an error.
    expect(await errorsOn({ ids: [] })).toEqual([]);
  });
});

describe('POST /v1/catalog/items/lookup without prices (plan 0207, section 2)', () => {
  it.each([[undefined], [false]])(
    'answers what it answered before the plan when prices is %j',
    async (prices) => {
      const items = [{ id: ID } as ItemView];
      const { controller, send, describe } = build({ items });

      const answer = await controller.lookup(
        USER,
        lookupDto({ ids: [ID], prices })
      );

      // The answer of catalog, whole and with nothing beside it.
      expect(answer).toEqual({ items });
      expect(answer).not.toHaveProperty('scopes');
      // No profile is resolved and no chain is listed for a read that prices
      // nothing.
      expect(describe).not.toHaveBeenCalled();
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0][1]).toEqual({ ids: [ID] });
    }
  );
});

describe('POST /v1/catalog/items/lookup with prices (plan 0207, section 2)', () => {
  it('prices the read at the scopes of the default profile, with every offer', async () => {
    const { controller, describe, sentTo } = build();

    await controller.lookup(USER, lookupDto({ ids: [ID], prices: true }));

    // No selector: the default profile, as the browse read resolves it.
    expect(describe).toHaveBeenCalledWith('user-1', {});
    expect(sentTo(ITEM_PATTERNS.getMany)).toEqual([
      [
        ITEM_PATTERNS.getMany,
        {
          ids: [ID],
          priceScopeIds: [SCOPE_MERCADONA, SCOPE_LIDL],
          offers: 'all',
        },
      ],
    ]);
  });

  it('answers each item with its offers, and the chain of each scope they name', async () => {
    const milk = {
      id: ID,
      bestOffer: offer(ID, SCOPE_LIDL, 0.89),
      offers: [offer(ID, SCOPE_LIDL, 0.89), offer(ID, SCOPE_MERCADONA, 0.95)],
    } as ItemView;
    const { controller } = build({ items: [milk] });

    const answer = await controller.lookup(
      USER,
      lookupDto({ ids: [ID], prices: true })
    );

    expect(answer.items).toEqual([milk]);
    expect(answer.scopes).toEqual([
      {
        priceScopeId: SCOPE_LIDL,
        supermarketId: LIDL,
        supermarketName: { es: 'Lidl' },
        supermarketLogoUrl: null,
      },
      {
        priceScopeId: SCOPE_MERCADONA,
        supermarketId: MERCADONA,
        supermarketName: { es: 'Mercadona' },
        supermarketLogoUrl: 'm.png',
      },
    ]);
  });

  it('keeps an item with no price at those scopes, with no offer', async () => {
    const milk = {
      id: ID,
      bestOffer: offer(ID, SCOPE_MERCADONA, 0.95),
      offers: [offer(ID, SCOPE_MERCADONA, 0.95)],
    } as ItemView;
    // What catalog answers for a product nobody prices there.
    const saffron = { id: OTHER_ID, bestOffer: null, offers: [] } as ItemView;
    const { controller } = build({ items: [milk, saffron] });

    const answer = await controller.lookup(
      USER,
      lookupDto({ ids: [ID, OTHER_ID], prices: true })
    );

    expect(answer.items).toEqual([milk, saffron]);
    // Only the scope an offer names is named.
    expect(answer.scopes?.map((scope) => scope.priceScopeId)).toEqual([
      SCOPE_MERCADONA,
    ]);
  });

  it('answers every item with no offer for a caller with no scope, and it is not an error', async () => {
    // What catalog answers when the request names no scope: no `bestOffer`.
    const items = [{ id: ID } as ItemView, { id: OTHER_ID } as ItemView];
    const { controller, sentTo } = build({ items, resolved: NO_SCOPES });

    const answer = await controller.lookup(
      USER,
      lookupDto({ ids: [ID, OTHER_ID], prices: true })
    );

    expect(answer).toEqual({ items, scopes: [] });
    expect(sentTo(ITEM_PATTERNS.getMany)[0][1]).toEqual({
      ids: [ID, OTHER_ID],
      priceScopeIds: [],
      offers: 'all',
    });
    // Nothing to name, so the chains are not listed.
    expect(sentTo(SUPERMARKET_PATTERNS.list)).toHaveLength(0);
  });

  it('holds the same bound on the ids', async () => {
    expect(
      await errorsOn({ ids: ids(ITEM_LOOKUP_LIMITS.maxIds), prices: true })
    ).toEqual([]);
    expect(
      await errorsOn({ ids: ids(ITEM_LOOKUP_LIMITS.maxIds + 1), prices: true })
    ).toContain('arrayMaxSize');
  });

  it('refuses a prices that is not a boolean', async () => {
    expect(await errorsOn({ ids: [ID], prices: 'yes' })).toContain('isBoolean');
  });

  it('still answers the items when the chains cannot be listed', async () => {
    const milk = {
      id: ID,
      bestOffer: offer(ID, SCOPE_LIDL, 0.89),
      offers: [offer(ID, SCOPE_LIDL, 0.89)],
    } as ItemView;
    const send = jest.fn(async (subject: string) => {
      if (subject === SUPERMARKET_PATTERNS.list) {
        throw new Error('catalog is slow today');
      }
      return { items: [milk] };
    });
    const controller = new CatalogItemLookupController(
      { send } as never,
      { describe: async () => TWO_CHAINS } as never,
      new CatalogSuggestService({ send } as never)
    );

    const answer = await controller.lookup(
      USER,
      lookupDto({ ids: [ID], prices: true })
    );

    expect(answer).toEqual({ items: [milk], scopes: [] });
  });
});

describe('the lookup resolves the default profile as the browse read does (plan 0207)', () => {
  it('asks core for the scopes of the caller with no profile named', async () => {
    const send = jest.fn(async (subject: string) =>
      subject === PROFILE_PATTERNS.resolveScopes
        ? { profileId: 'p1', empty: true }
        : { items: [] }
    );
    const redis = { tryCommand: async () => null };
    const controller = new CatalogItemLookupController(
      { send } as never,
      new ScopeResolutionService({ send } as never, redis as never),
      new CatalogSuggestService({ send } as never)
    );

    const answer = await controller.lookup(
      USER,
      lookupDto({ ids: [ID], prices: true })
    );

    expect(send.mock.calls[0]).toEqual([
      PROFILE_PATTERNS.resolveScopes,
      { userId: 'user-1', profileId: undefined },
    ]);
    // A profile that says nothing resolves to no scope, and the read goes on.
    expect(answer).toEqual({ items: [], scopes: [] });
  });
});
