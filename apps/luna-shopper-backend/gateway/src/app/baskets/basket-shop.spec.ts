import {
  BASKET_PATTERNS,
  SUPERMARKET_LOCATION_PATTERNS,
  type ShopAvailabilityView,
} from '@portfolio/luna-shopper/contracts';
import { NotFoundException } from '@portfolio/luna-shopper/platform';
import type { CurrentUser } from '../auth/jwt.strategy';
import {
  isInProfile,
  toBasketShopView,
  toScopeLocationView,
  withShopInScopes,
} from './basket-shop';
import { CreateBasketDto } from './basket.dto';
import { BasketsController } from './baskets.controller';

/**
 * A shop, named for a person, and the basket started at one (plan 0163,
 * sections 1 and 3).
 */

const SHOP = '5c7e9a1b-3d5f-4a7b-9c1d-3e5f7a9b1c3d';
const LOGO = 'https://example.test/lidl.svg';
const SECTION = { id: 'sec-frescos', name: { es: 'Frescos' } };

const shop = (postalCode: string | null): ShopAvailabilityView => ({
  location: {
    id: SHOP,
    supermarketId: 'lidl',
    priceScopeId: 'scope-store',
    priceScopeIds: ['scope-store'],
    label: null,
    address: 'Gran Vía 1',
    city: 'Madrid',
    country: 'ES',
    postalCode,
    postalCodeSource: null,
    latitude: null,
    longitude: null,
    externalRef: null,
    externalProvider: null,
    sections: [SECTION],
  },
  supermarket: {
    id: 'lidl',
    name: { en: 'Lidl', es: 'Lidl' },
    logoUrl: LOGO,
  } as ShopAvailabilityView['supermarket'],
  availability: [],
});

describe('inProfile (plan 0163, section 3)', () => {
  it.each([
    ['a code the profile holds', '14008', ['14008', '14010'], true],
    ['a code it does not', '28013', ['14008'], false],
    ['a code stored with stray spaces', ' 14008', ['14008 '], true],
    ['a shop with no postal code', null, ['14008'], false],
    ['a profile with no codes', '14008', [], false],
  ])('answers %s', (_name, code, codes, expected) => {
    expect(isInProfile(code, codes)).toBe(expected);
  });

  it('is carried on the shop view, which names the chain', () => {
    expect(toBasketShopView(shop('28013'), ['14008'])).toStrictEqual({
      id: SHOP,
      supermarketId: 'lidl',
      supermarketName: { en: 'Lidl', es: 'Lidl' },
      supermarketLogoUrl: LOGO,
      label: null,
      address: 'Gran Vía 1',
      city: 'Madrid',
      postalCode: '28013',
      inProfile: false,
      sections: [SECTION],
    });
  });
});

describe('what a picker row needs (plan 0170)', () => {
  it('carries the shop’s section names onto the scope’s shop, and the logo onto a scope it adds', () => {
    const [added] = withShopInScopes([], shop('28013'), true);
    expect(added).toStrictEqual({
      priceScopeId: 'scope-store',
      supermarketId: 'lidl',
      supermarketName: { en: 'Lidl', es: 'Lidl' },
      supermarketLogoUrl: LOGO,
      locations: [toScopeLocationView(shop('28013').location)],
    });
    expect(added.locations[0].sections).toEqual([SECTION]);
  });

  it('answers a null logo and no sections as they are, never absent', () => {
    const bare = shop(null);
    bare.location.sections = [];
    bare.supermarket.logoUrl = null;
    const view = toBasketShopView(bare, []);
    expect(view.supermarketLogoUrl).toBeNull();
    expect(view.sections).toEqual([]);
    expect(toScopeLocationView(bare.location).sections).toEqual([]);
  });
});

describe('POST /v1/baskets with a shop (plan 0163, section 1)', () => {
  const OWNER = { userId: 'u-owner' } as CurrentUser;

  function harness(known: boolean) {
    const send = jest.fn(async (pattern: string, payload: unknown) => {
      if (pattern === SUPERMARKET_LOCATION_PATTERNS.shopAvailability) {
        if (!known) {
          throw new NotFoundException('Supermarket location not found');
        }
        return shop('28013');
      }
      if (pattern === BASKET_PATTERNS.create) {
        return { basket: { id: 'b-new' }, list: { id: 'b-new' }, payload };
      }
      throw new Error(`unexpected pattern ${pattern}`);
    });
    const controller = new BasketsController(
      { send } as never,
      { countsFor: jest.fn() } as never
    );
    return { controller, send };
  }

  const dto = (extra: Partial<CreateBasketDto> = {}) =>
    ({ ...extra }) as CreateBasketDto;

  it('asks catalog that the shop exists, then hands it to core', async () => {
    const { controller, send } = harness(true);

    await controller.create(OWNER, dto({ supermarketLocationId: SHOP }));

    expect(send.mock.calls.map(([pattern]) => pattern)).toEqual([
      SUPERMARKET_LOCATION_PATTERNS.shopAvailability,
      BASKET_PATTERNS.create,
    ]);
    expect(send.mock.calls[1][1]).toMatchObject({
      userId: 'u-owner',
      supermarketLocationId: SHOP,
    });
  });

  it('answers the 404 for an unknown shop, and core writes nothing', async () => {
    const { controller, send } = harness(false);

    await expect(
      controller.create(OWNER, dto({ supermarketLocationId: SHOP }))
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(send.mock.calls.map(([pattern]) => pattern)).not.toContain(
      BASKET_PATTERNS.create
    );
  });

  it('asks catalog nothing when no shop was named', async () => {
    const { controller, send } = harness(true);

    await controller.create(OWNER, dto());

    expect(send.mock.calls.map(([pattern]) => pattern)).toEqual([
      BASKET_PATTERNS.create,
    ]);
  });
});
