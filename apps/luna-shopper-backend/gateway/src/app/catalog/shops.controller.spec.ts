import {
  PROFILE_PATTERNS,
  SUPERMARKET_LOCATION_PATTERNS,
  type ProfileScopeSelector,
} from '@portfolio/luna-shopper/contracts';
import { CatalogShopsController } from './catalog.controller';
import { SearchShopsQueryDto, ShopQueryDto } from './catalog.dto';
import { ScopeResolutionService } from './scope-resolution.service';

/**
 * The gateway's half of the shop reads (plan 0068, sections 2 and 3.1).
 *
 * What the two routes are responsible for is composition, and only that: core
 * says what the caller wants, catalog says what that means, and this is the only
 * place holding both. So these tests assert what is passed and what is
 * assembled, and never which shops come back, which is catalog's and is proven
 * in `shops-in-postal-codes.integration.spec.ts` against real Postgres.
 */

const USER = 'user-1';
const PROFILE = 'profile-1';
const MERCADONA = 'chain-mercadona';
const DIA = 'chain-dia';
const SHOP = 'shop-1';

/** What core answers, unless a test says otherwise. */
function selector(patch: Partial<ProfileScopeSelector> = {}) {
  return {
    profileId: PROFILE,
    postalCodes: ['14010', '28001'],
    supermarketIds: [],
    excludedSupermarketIds: [],
    empty: false,
    ...patch,
  } satisfies ProfileScopeSelector;
}

/** One summary row as catalog answers it, counts only and no opinion. */
function summaryRow(patch: Record<string, unknown> = {}) {
  return {
    supermarketId: MERCADONA,
    name: { en: 'Mercadona', es: 'Mercadona' },
    logoUrl: null,
    externalBrandKey: 'Q377705',
    locations: 3,
    excluded: 0,
    ...patch,
  };
}

function build(options: {
  selector?: ProfileScopeSelector;
  chains?: ReturnType<typeof summaryRow>[];
}) {
  const send = jest.fn(async (pattern: string) => {
    if (pattern === PROFILE_PATTERNS.resolveScopes) {
      return options.selector ?? selector();
    }
    if (pattern === SUPERMARKET_LOCATION_PATTERNS.summarizeByChain) {
      return { chains: options.chains ?? [summaryRow()] };
    }
    return { items: [], nextCursor: null };
  });
  const nats = { send } as never;
  const controller = new CatalogShopsController(
    nats,
    new ScopeResolutionService(nats, {} as never)
  );
  return { controller, send };
}

/** The arguments of the call to one subject, or undefined if it was not made. */
function sentTo(send: jest.Mock, pattern: string) {
  return send.mock.calls.find((call) => call[0] === pattern)?.[1];
}

function shopQuery(patch: Partial<ShopQueryDto> = {}): ShopQueryDto {
  return Object.assign(new ShopQueryDto(), patch);
}

describe('GET /v1/catalog/shops/summary', () => {
  it('looks in the profile’s postal codes and passes its refusals to catalog', async () => {
    const { controller, send } = build({
      selector: selector({ excludedSupermarketIds: [DIA] }),
    });

    await controller.summary({ userId: USER } as never, shopQuery());

    expect(
      sentTo(send, SUPERMARKET_LOCATION_PATTERNS.summarizeByChain)
    ).toEqual({
      userId: USER,
      postalCodes: ['14010', '28001'],
      excludedSupermarketIds: [DIA],
      excludedSupermarketLocationIds: [],
      includeExcluded: false,
    });
  });

  it('takes the codes the caller stated instead of the profile’s, keeping its refusals', async () => {
    // A screen showing a code the user is about to add asks about it before it
    // is saved, and they are still the person who refused that DIA.
    const { controller, send } = build({
      selector: selector({ excludedSupermarketIds: [DIA] }),
    });

    await controller.summary(
      { userId: USER } as never,
      shopQuery({ postalCode: ['41001'] })
    );

    expect(
      sentTo(send, SUPERMARKET_LOCATION_PATTERNS.summarizeByChain)
    ).toMatchObject({
      postalCodes: ['41001'],
      excludedSupermarketIds: [DIA],
    });
  });

  it('passes the refused shops through once plan 0064 fills them in', async () => {
    const { controller, send } = build({
      selector: selector({ excludedSupermarketLocationIds: [SHOP] }),
    });

    await controller.summary({ userId: USER } as never, shopQuery());

    expect(
      sentTo(send, SUPERMARKET_LOCATION_PATTERNS.summarizeByChain)
    ).toMatchObject({ excludedSupermarketLocationIds: [SHOP] });
  });

  it('answers a profile that has said nothing, rather than refusing to', async () => {
    // The priced reads raise `CATALOG_SCOPE_REQUIRED` here. "Which shops are
    // near me" is exactly the question somebody halfway through filling their
    // profile in has to be able to ask.
    const { controller, send } = build({
      selector: selector({ postalCodes: [], empty: true }),
      chains: [],
    });

    await expect(
      controller.summary({ userId: USER } as never, shopQuery())
    ).resolves.toEqual({ chains: [] });
    expect(
      sentTo(send, SUPERMARKET_LOCATION_PATTERNS.summarizeByChain)
    ).toMatchObject({ postalCodes: [] });
  });

  describe('the three states of a franchise button', () => {
    it('says none refused when catalog counted none', async () => {
      const { controller } = build({ chains: [summaryRow({ excluded: 0 })] });

      const { chains } = await controller.summary(
        { userId: USER } as never,
        shopQuery()
      );

      expect(chains[0]).toMatchObject({
        locations: 3,
        excluded: 0,
        excludedChain: false,
      });
    });

    it('says some refused when catalog counted some', async () => {
      const { controller } = build({ chains: [summaryRow({ excluded: 1 })] });

      const { chains } = await controller.summary(
        { userId: USER } as never,
        shopQuery()
      );

      expect(chains[0]).toMatchObject({
        locations: 3,
        excluded: 1,
        excludedChain: false,
      });
    });

    it('says the chain itself is refused, which catalog does not know', async () => {
      // The state that cannot be counted: "not DIA" covers the DIA that opens
      // next month, and it lives on the profile rather than on any row here.
      const { controller } = build({
        selector: selector({ excludedSupermarketIds: [MERCADONA] }),
        chains: [summaryRow({ excluded: 0 })],
      });

      const { chains } = await controller.summary(
        { userId: USER } as never,
        shopQuery({ includeExcluded: true })
      );

      expect(chains[0].excludedChain).toBe(true);
    });
  });
});

describe('GET /v1/catalog/shops', () => {
  it('passes the codes, the refusals and the caller’s narrowing to catalog', async () => {
    const { controller, send } = build({
      selector: selector({
        excludedSupermarketIds: [DIA],
        excludedSupermarketLocationIds: [SHOP],
      }),
    });
    const query = Object.assign(new SearchShopsQueryDto(), {
      supermarketId: MERCADONA,
      query: 'tejares',
      limit: 20,
    });

    await controller.search({ userId: USER } as never, query);

    expect(sentTo(send, SUPERMARKET_LOCATION_PATTERNS.search)).toEqual({
      userId: USER,
      postalCodes: ['14010', '28001'],
      supermarketId: MERCADONA,
      query: 'tejares',
      includeExcluded: false,
      excludedSupermarketIds: [DIA],
      excludedSupermarketLocationIds: [SHOP],
      cursor: undefined,
      limit: 20,
    });
  });

  it('asks for the refused ones only when the caller does', async () => {
    const { controller, send } = build({});

    await controller.search(
      { userId: USER } as never,
      Object.assign(new SearchShopsQueryDto(), { includeExcluded: true })
    );

    expect(sentTo(send, SUPERMARKET_LOCATION_PATTERNS.search)).toMatchObject({
      includeExcluded: true,
    });
  });
});
