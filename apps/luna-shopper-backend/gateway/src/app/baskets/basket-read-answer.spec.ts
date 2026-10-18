import {
  BASKET_PATTERNS,
  BasketKind,
  BasketRowState,
  BasketRowUsualState,
  BasketStatus,
  ITEM_PATTERNS,
  LineApprovalStatus,
  ParticipantKind,
  PriceSourceKind,
  SECTION_PATTERNS,
  SUPERMARKET_LOCATION_PATTERNS,
  SUPERMARKET_PATTERNS,
  UnitOfMeasure,
  type BasketLinePick,
  type BasketParticipantContext,
  type BasketParticipantView,
  type BasketResult,
  type BasketRowView,
  type BasketView,
  type CatalogScopeView,
  type ItemView,
  type ShopAvailabilityView,
} from '@portfolio/luna-shopper/contracts';
import { NotAParticipantException } from '@portfolio/luna-shopper/platform';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CatalogSuggestService } from '../catalog/catalog-suggest.service';
import type { ShopperSelection } from '../catalog/scope-resolution.service';
import { BasketCatalogService } from './basket-catalog.service';
import { BasketController, BasketLiveController } from './basket.controller';
import { SettlePriceService } from './settle-price.service';

/**
 * The two basket reads answer exactly what they answered (plan 0205,
 * section 4).
 *
 * Every case below reads `GET /v1/baskets/:id` or `GET /v1/baskets/live` over
 * one fixed world and compares the whole answer, field by field, with the
 * answer recorded in `basket-read-answer.recorded.json`. A change to the read
 * that moves one field of one case fails here and names the case.
 *
 * ## What is real and what is played
 *
 * The gateway half is real: both controllers, {@link BasketCatalogService}
 * and the helper that names the chain of a scope. Core and catalog are played
 * from the fixtures of this file, because no gateway spec can reach a
 * database. So this proves the composition and the order of its questions.
 * What core computes for each reader is proved in core, on a real Postgres
 * (`basket-read.integration.spec.ts` and the files beside it).
 *
 * Nothing in the world moves with the clock and no id is random, so no value
 * is normalized: the recording is compared as it is.
 *
 * ## What the file holds
 *
 * The whole answer of every read where nothing fails. A read where one
 * question fails is recorded as what differs from the same read with nothing
 * failing: each path that moved, and its value. That keeps the file small
 * enough to read, and it says what a failure costs in so many words.
 *
 * ## Recording again
 *
 * `RECORD_BASKET_ANSWERS=1 npx nx test luna-shopper-backend-gateway
 * --testFile=basket-read-answer.spec.ts` writes the file again. Do that only
 * when an answer is meant to change, and read the diff of the recording as
 * the change to the contract that it is.
 */

const RECORDING = join(__dirname, 'basket-read-answer.recorded.json');
const RECORD = process.env['RECORD_BASKET_ANSWERS'] === '1';

const BASKET_ID = 'b4b1f0e2-1f5a-4c2e-9a4d-6f0e2b7c1d33';
const OWNER = 'u-owner';
const PROFILE = 'prof-home';
const SCOPE_MERCADONA = 'scope-mercadona';
const SCOPE_CARREFOUR = 'scope-carrefour';
/** The quoted scope of the shops below, which is not one of the owner's. */
const SCOPE_SHOP = 'scope-shop';
const SHOP = 'loc-read';
const OWN_SHOP = 'loc-own';
const LIST_A = 'list-a';
const LIST_B = 'list-b';

type Reader = 'owner' | 'member' | 'guest';

/** One question of the read that can fail, each alone. */
type Failure =
  | 'core: searchScope'
  | 'core: priceChoices'
  | 'core: the selection of the profile'
  | 'core: the scopes of the profile'
  | 'catalog: the shop, before the rows'
  | 'catalog: the shop, with the products'
  | 'catalog: the sections'
  | 'catalog: the products, for the picks'
  | 'catalog: the products, for the rows'
  | 'catalog: the chains'
  | 'catalog: the shops of the profile';

const FAILURES: Failure[] = [
  'core: searchScope',
  'core: priceChoices',
  'core: the selection of the profile',
  'core: the scopes of the profile',
  'catalog: the shop, before the rows',
  'catalog: the shop, with the products',
  'catalog: the sections',
  'catalog: the products, for the picks',
  'catalog: the products, for the rows',
  'catalog: the chains',
  'catalog: the shops of the profile',
];

interface World {
  reader: Reader;
  /** The shop the basket was started at, or none. */
  basketShop?: string;
  /** Null for a basket with no profile. */
  profileId?: string | null;
  fails?: Failure;
  /** The participant was removed after the guard resolved them. */
  removed?: boolean;
  /** No line needs a price: each has one product, a favourite or a buy. */
  nothingToPrice?: boolean;
}

const PEOPLE: Record<Reader, BasketParticipantView> = {
  owner: {
    id: 'p-owner',
    kind: ParticipantKind.OWNER,
    displayName: null,
    username: 'Calm Harbour',
    guestNumber: null,
    userId: OWNER,
    shareLinkId: null,
    expiresAt: null,
  },
  member: {
    id: 'p-member',
    kind: ParticipantKind.REGISTERED,
    displayName: null,
    username: 'Lucky Otter',
    guestNumber: null,
    userId: 'u-member',
    shareLinkId: 'link-1',
    expiresAt: '2026-09-01T20:00:00.000Z',
  },
  guest: {
    id: 'p-guest',
    kind: ParticipantKind.GUEST,
    displayName: 'Guest',
    username: null,
    guestNumber: 1,
    userId: null,
    shareLinkId: 'link-1',
    expiresAt: '2026-09-01T20:00:00.000Z',
  },
};

/** The lists each reader writes: both, one of the two, none. */
const WRITES: Record<Reader, string[]> = {
  owner: [LIST_A, LIST_B],
  member: [LIST_A],
  guest: [],
};

const participantOf = (reader: Reader): BasketParticipantContext => ({
  participantId: PEOPLE[reader].id,
  basketId: BASKET_ID,
  kind: PEOPLE[reader].kind,
  userId: PEOPLE[reader].userId,
});

/**
 * A row as core answers it for one reader: a list is named only where the
 * reader writes it, and `usual` is filled only on a read with a chain.
 */
function rowOf(
  reader: Reader,
  usual: boolean,
  content: string,
  productId: string | null,
  lines: { lineId: string; listId: string; itemIds: string[] }[]
): BasketRowView {
  return {
    rowKey: lines[0].lineId,
    content,
    productId,
    left: lines.length,
    bought: 0,
    asked: lines.length,
    boughtElsewhere: 0,
    state: BasketRowState.WANTED,
    note: null,
    noteAt: null,
    mark: null,
    awaitingApproval: false,
    touchedBy: null,
    touchedAt: null,
    entries: lines.map((line) => {
      const canWrite = WRITES[reader].includes(line.listId);
      return {
        lineId: line.lineId,
        ...(canWrite ? { listId: line.listId } : {}),
        content,
        itemIds: line.itemIds,
        favoriteItemId: null,
        canWrite,
        left: 1,
        bought: 0,
        boughtElsewhere: 0,
        state: BasketRowState.WANTED,
        approvalStatus: LineApprovalStatus.APPROVED,
        version: 1,
        skipped: false,
        closed: false,
        act: null,
        tripItemId: null,
        demandEditable: true,
      };
    }),
    usual: usual ? { state: BasketRowUsualState.HERE, bought: 2, of: 3 } : null,
  };
}

/**
 * The basket as core answers it. Four rows: one product, a line of two
 * products that counts as the pick of the gateway (its first product with no
 * pick), free text, and one product on two lists.
 */
function viewOf(
  world: World,
  kind: BasketKind,
  picks: BasketLinePick[],
  supermarketId: string | undefined
): BasketView {
  const { reader } = world;
  const usual = supermarketId !== undefined;
  const picked =
    picks.find((pick) => pick.lineId === 'l-two')?.itemId ?? 'i-oat';
  const rows = [
    rowOf(reader, usual, 'Milk', 'i-milk', [
      { lineId: 'l-milk', listId: LIST_A, itemIds: ['i-milk'] },
    ]),
    rowOf(reader, usual, 'Oat drink', picked, [
      { lineId: 'l-two', listId: LIST_A, itemIds: ['i-oat', 'i-soy'] },
    ]),
    rowOf(reader, usual, 'Something for dinner', null, [
      { lineId: 'l-text', listId: LIST_B, itemIds: [] },
    ]),
    rowOf(reader, usual, 'Bread', 'i-bread', [
      { lineId: 'l-bread-a', listId: LIST_A, itemIds: ['i-bread'] },
      { lineId: 'l-bread-b', listId: LIST_B, itemIds: ['i-bread'] },
    ]),
  ];
  return {
    id: BASKET_ID,
    kind,
    name: kind === BasketKind.LIVE ? null : 'Saturday',
    status: BasketStatus.OPEN,
    createdAt: '2026-09-01T08:00:00.000Z',
    rows,
    lists: [
      { listId: LIST_A, name: 'Weekly', zoneId: 'zone-1', zoneName: 'Home' },
      { listId: LIST_B, name: 'Party', zoneId: 'zone-1', zoneName: 'Home' },
    ].filter((list) => WRITES[reader].includes(list.listId)),
    participants: [PEOPLE.owner, PEOPLE.member, PEOPLE.guest],
    me: PEOPLE[reader],
    progress: { done: 0, unavailable: 0, total: rows.length, pending: 4 },
    truncated: false,
    servesLocations: true,
    unseenChangeCount: 2,
    newestUnseenChangeId: 'change-9',
    supermarketLocationId: world.basketShop ?? null,
  };
}

const offer = (itemId: string, priceScopeId: string, price: number) => ({
  itemId,
  priceScopeId,
  price,
  currency: 'EUR',
  unitPrice: price,
  unitPriceLabel: 'EUR/L',
  observedAt: '2026-09-01T06:00:00.000Z',
  sourceKind: PriceSourceKind.OFFICIAL_WEB,
  stale: false,
});

/** A product with an offer at each scope that was asked and that quotes it. */
function itemOf(
  id: string,
  prices: Record<string, number>,
  asked: readonly string[] | undefined
): ItemView {
  const offers = Object.entries(prices)
    .filter(([scope]) => asked?.includes(scope))
    .map(([scope, price]) => offer(id, scope, price));
  const best = [...offers].sort((a, b) => a.price - b.price)[0] ?? null;
  return {
    id,
    name: { en: id, es: id },
    brand: null,
    imageUrl: null,
    imageSource: null,
    imageSupermarketId: null,
    ownImageUrl: null,
    images: [],
    sku: null,
    ean: null,
    eans: [],
    unitSize: 1,
    packCount: null,
    categories: [],
    defaultUnit: UnitOfMeasure.LITER,
    productGroupId: null,
    bestOffer: best,
    ...(asked ? { offers } : {}),
  } as unknown as ItemView;
}

/**
 * What each product costs, by scope. The soy drink is the cheaper of the pair
 * at the owner's scopes and the dearer at the shop, so the pick of the line
 * of two products differs between a read with a shop and a read with none.
 */
const PRICES: Record<string, Record<string, number>> = {
  'i-milk': { [SCOPE_MERCADONA]: 0.95, [SCOPE_CARREFOUR]: 1.05 },
  'i-oat': { [SCOPE_MERCADONA]: 1.6, [SCOPE_SHOP]: 1.4 },
  'i-soy': { [SCOPE_MERCADONA]: 1.2, [SCOPE_SHOP]: 1.9 },
  'i-bread': { [SCOPE_CARREFOUR]: 0.8 },
};

const shopOf = (id: string, itemIds: string[]): ShopAvailabilityView =>
  ({
    location: {
      id,
      supermarketId: 'mercadona',
      priceScopeId: SCOPE_SHOP,
      priceScopeIds: [SCOPE_SHOP, SCOPE_MERCADONA],
      label: null,
      address: 'Avenida de Manolete',
      city: 'Córdoba',
      country: 'ES',
      // Outside the postal codes of the profile, on purpose.
      postalCode: '14005',
      postalCodeSource: null,
      latitude: null,
      longitude: null,
      externalRef: null,
      externalProvider: null,
      footprintM2: null,
      sections: [],
    },
    supermarket: {
      id: 'mercadona',
      name: { en: 'Mercadona', es: 'Mercadona' },
    },
    availability: itemIds.map((itemId) => ({
      itemId,
      available: itemId === 'i-bread' ? false : true,
    })),
  }) as unknown as ShopAvailabilityView;

const locationOf = (id: string, supermarketId: string, scope: string) => ({
  id,
  supermarketId,
  priceScopeId: scope,
  priceScopeIds: [scope],
  label: null,
  address: `${id} street`,
  city: 'Córdoba',
  country: 'ES',
  postalCode: '14008',
  postalCodeSource: null,
  latitude: null,
  longitude: null,
  externalRef: null,
  externalProvider: null,
  footprintM2: null,
  sections: [],
});

const resolution = (): CatalogScopeView => ({
  priceScopeIds: [SCOPE_MERCADONA, SCOPE_CARREFOUR],
  scopes: [
    {
      priceScopeId: SCOPE_MERCADONA,
      supermarketId: 'mercadona',
      postalCode: '14008',
      origin: 'POSTAL_CODE',
      approximate: false,
      supermarketLocationId: null,
      priority: 0,
      quoted: true,
      priced: true,
    },
    {
      priceScopeId: SCOPE_CARREFOUR,
      supermarketId: 'carrefour',
      postalCode: '14008',
      origin: 'POSTAL_CODE',
      approximate: false,
      supermarketLocationId: null,
      priority: 0,
      quoted: true,
      priced: true,
    },
  ],
  coverage: [{ postalCode: '14008', served: true }],
  approximate: false,
  profileId: PROFILE,
  explicit: false,
});

/** The profile refuses one shop of Mercadona and the whole of no chain. */
const selection = (): ShopperSelection => ({
  profileId: PROFILE,
  postalCodes: ['14008'],
  excludedSupermarketIds: [],
  excludedSupermarketLocationIds: ['loc-mercadona-refused'],
});

function build(world: World) {
  const subjects: string[] = [];
  let itemReads = 0;
  const fail = (failure: Failure): void => {
    if (world.fails === failure) {
      throw new Error(`${failure} did not answer`);
    }
  };
  const refuseRemoved = (): void => {
    if (world.removed) {
      throw new NotAParticipantException('Not a participant of this basket');
    }
  };

  const send = jest.fn(async (subject: string, payload: unknown) => {
    subjects.push(subject);
    const asked = payload as {
      picks?: BasketLinePick[];
      supermarketId?: string;
      supermarketLocationId?: string;
      itemIds?: string[];
      ids?: string[];
      priceScopeIds?: string[];
      priceScopeId?: string;
    };
    switch (subject) {
      case BASKET_PATTERNS.get:
        refuseRemoved();
        return viewOf(
          world,
          BasketKind.GENERATED,
          asked.picks ?? [],
          asked.supermarketId
        );
      case BASKET_PATTERNS.live:
        return viewOf(
          world,
          BasketKind.LIVE,
          asked.picks ?? [],
          asked.supermarketId
        );
      case BASKET_PATTERNS.priceChoices:
      case BASKET_PATTERNS.livePriceChoices:
        refuseRemoved();
        fail('core: priceChoices');
        return {
          basketId: BASKET_ID,
          participantId: PEOPLE[world.reader].id,
          lines: world.nothingToPrice
            ? []
            : [{ lineId: 'l-two', itemIds: ['i-oat', 'i-soy'] }],
        };
      case BASKET_PATTERNS.searchScope:
        refuseRemoved();
        fail('core: searchScope');
        return {
          ownerUserId: OWNER,
          profileId: world.profileId === undefined ? PROFILE : world.profileId,
          servesLocations: true,
          supermarketLocationId: world.basketShop ?? null,
        };
      case SUPERMARKET_LOCATION_PATTERNS.shopAvailability: {
        const itemIds = asked.itemIds ?? [];
        fail(
          itemIds.length === 0
            ? 'catalog: the shop, before the rows'
            : 'catalog: the shop, with the products'
        );
        return shopOf(asked.supermarketLocationId ?? SHOP, itemIds);
      }
      case SECTION_PATTERNS.itemsAtLocation:
        fail('catalog: the sections');
        return {
          items: (asked.itemIds ?? []).map((itemId) => ({
            itemId,
            sectionIds: itemId === 'i-milk' ? ['section-dairy'] : [],
          })),
        };
      case ITEM_PATTERNS.getMany:
        itemReads += 1;
        fail(
          itemReads === 1
            ? 'catalog: the products, for the picks'
            : 'catalog: the products, for the rows'
        );
        return {
          items: (asked.ids ?? []).map((id) =>
            itemOf(id, PRICES[id] ?? {}, asked.priceScopeIds)
          ),
        };
      case SUPERMARKET_PATTERNS.list:
        fail('catalog: the chains');
        return {
          items: [
            { id: 'mercadona', name: { en: 'Mercadona', es: 'Mercadona' } },
            { id: 'carrefour', name: { en: 'Carrefour', es: 'Carrefour' } },
          ],
          nextCursor: null,
        };
      case SUPERMARKET_LOCATION_PATTERNS.search: {
        // Plan 0213: every chain's shops in the profile's codes, at once.
        fail('catalog: the shops of the profile');
        const shopsOf = (supermarketId: string, scope: string, ids: string[]) =>
          ids.map((id) => ({
            location: locationOf(id, supermarketId, scope),
            supermarket: {
              id: supermarketId,
              name: { en: supermarketId, es: supermarketId },
            },
            excluded: false,
            excludedChain: false,
          }));
        return {
          items: [
            ...shopsOf('mercadona', SCOPE_MERCADONA, [
              'loc-mercadona-1',
              'loc-mercadona-refused',
            ]),
            ...shopsOf('carrefour', SCOPE_CARREFOUR, ['loc-carrefour-1']),
          ],
          nextCursor: null,
        };
      }
      default:
        throw new Error(`unexpected subject ${subject}`);
    }
  });

  const scopes = {
    describe: jest.fn(async () => {
      fail('core: the scopes of the profile');
      return resolution();
    }),
    forShops: jest.fn(async () => {
      fail('core: the selection of the profile');
      return selection();
    }),
  };

  const catalog = new BasketCatalogService(
    { send } as never,
    scopes as never,
    new CatalogSuggestService({ send } as never)
  );
  const controller = new BasketController(
    { send } as never,
    catalog,
    new SettlePriceService({ send } as never, scopes as never)
  );
  const live = new BasketLiveController({ send } as never, catalog);
  return { controller, live, subjects };
}

type Route = ':id' | 'live';

interface Case {
  name: string;
  route: Route;
  world: World;
  locationId?: string;
  /** The case this one is recorded against. Absent for a whole answer. */
  base?: string;
}

/** The two reads whose whole answer the file holds. */
const NO_SHOP = ':id: owner, no shop';
const AT_A_SHOP = ':id: owner, at a shop';

const CASES: Case[] = [
  { name: NO_SHOP, route: ':id', world: { reader: 'owner' } },
  {
    name: AT_A_SHOP,
    route: ':id',
    world: { reader: 'owner' },
    locationId: SHOP,
  },
];
const add = (
  route: Route,
  title: string,
  base: string,
  world: World,
  locationId?: string
): void => {
  CASES.push({ name: `${route}: ${title}`, route, world, locationId, base });
};

for (const reader of ['member', 'guest'] as const) {
  add(':id', `${reader}, no shop`, NO_SHOP, { reader });
  add(':id', `${reader}, at a shop`, AT_A_SHOP, { reader }, SHOP);
}
// A basket that was started at a shop is read there, whatever is asked.
add(':id', 'owner, a basket started at a shop', AT_A_SHOP, {
  reader: 'owner',
  basketShop: OWN_SHOP,
});
add(
  ':id',
  'owner, a basket started at a shop, asked at that shop',
  AT_A_SHOP,
  { reader: 'owner', basketShop: OWN_SHOP },
  OWN_SHOP
);
add(
  ':id',
  'owner, a basket started at a shop, asked at another',
  AT_A_SHOP,
  { reader: 'owner', basketShop: OWN_SHOP },
  SHOP
);
add(':id', 'guest, a basket started at a shop', AT_A_SHOP, {
  reader: 'guest',
  basketShop: OWN_SHOP,
});
add(':id', 'owner, a basket with no profile', NO_SHOP, {
  reader: 'owner',
  profileId: null,
});
add(
  ':id',
  'owner, a basket with no profile, at a shop',
  AT_A_SHOP,
  { reader: 'owner', profileId: null },
  SHOP
);
// A profile that was deleted is a profile core still names and nothing
// resolves any more.
add(':id', 'owner, a profile that was deleted', NO_SHOP, {
  reader: 'owner',
  fails: 'core: the scopes of the profile',
});
add(':id', 'guest, removed between the guard and the read', NO_SHOP, {
  reader: 'guest',
  removed: true,
});
for (const fails of FAILURES) {
  add(
    ':id',
    `owner, at a shop, ${fails} fails`,
    AT_A_SHOP,
    { reader: 'owner', fails },
    SHOP
  );
  add(':id', `guest, no shop, ${fails} fails`, ':id: guest, no shop', {
    reader: 'guest',
    fails,
  });
}

// The permanent basket is read by its owner, as themselves.
add('live', 'owner, no shop', NO_SHOP, { reader: 'owner' });
add('live', 'owner, at a shop', AT_A_SHOP, { reader: 'owner' }, SHOP);
add('live', 'owner, no profile', NO_SHOP, { reader: 'owner', profileId: null });
for (const fails of FAILURES) {
  add(
    'live',
    `owner, at a shop, ${fails} fails`,
    'live: owner, at a shop',
    { reader: 'owner', fails },
    SHOP
  );
}

/** The answer of a read, or the refusal it ended in. */
type Outcome =
  | { answer: BasketResult; asked: string[] }
  | { refused: { name: string; message: string }; asked: string[] };

async function read(one: Case): Promise<Outcome> {
  const { controller, live, subjects } = build(one.world);
  const query = one.locationId ? { locationId: one.locationId } : undefined;
  try {
    const answer =
      one.route === 'live'
        ? await live.live({ userId: OWNER, kind: 'REGISTERED' } as never, query)
        : await controller.get(
            participantOf(one.world.reader),
            BASKET_ID,
            query
          );
    return wire({ answer, asked: subjects });
  } catch (error) {
    const refusal = error as Error;
    return wire({
      refused: { name: refusal.constructor.name, message: refusal.message },
      asked: subjects,
    });
  }
}

/** What travels: an absent field and an undefined one are the same answer. */
function wire<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** What a path holds when the field is not there at all. */
const ABSENT = '(absent)';

const isPlain = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Every path where `now` is not `base`, with the value it has now.
 *
 * Objects are compared key by key, and arrays of one length item by item. An
 * array that changed its length is one difference, and holds the whole array.
 */
function differences(
  base: unknown,
  now: unknown,
  path = '',
  into: Record<string, unknown> = {}
): Record<string, unknown> {
  if (isPlain(base) && isPlain(now)) {
    const keys = new Set([...Object.keys(base), ...Object.keys(now)]);
    for (const key of keys) {
      differences(
        key in base ? base[key] : ABSENT,
        key in now ? now[key] : ABSENT,
        path ? `${path}.${key}` : key,
        into
      );
    }
    return into;
  }
  if (Array.isArray(base) && Array.isArray(now) && base.length === now.length) {
    base.forEach((item, index) =>
      differences(item, now[index], `${path}[${index}]`, into)
    );
    return into;
  }
  if (JSON.stringify(base) !== JSON.stringify(now)) {
    into[path] = now;
  }
  return into;
}

/** What the file holds for one case. */
type Recorded = Outcome | { differsFrom: string; at: Record<string, unknown> };

describe('the basket reads answer what they answered (plan 0205, section 4)', () => {
  const recorded: Record<string, Recorded> = existsSync(RECORDING)
    ? JSON.parse(readFileSync(RECORDING, 'utf8'))
    : {};
  const fresh: Record<string, Recorded> = {};
  const byName = new Map(CASES.map((one) => [one.name, one]));

  afterAll(() => {
    if (RECORD) {
      writeFileSync(RECORDING, `${JSON.stringify(fresh, null, 2)}\n`);
    }
  });

  it('holds a recording for every case, and for no other', () => {
    if (RECORD) {
      return;
    }
    expect(Object.keys(recorded).sort()).toEqual(
      CASES.map((one) => one.name).sort()
    );
  });

  it.each(CASES.map((one) => [one.name, one] as const))(
    '%s',
    async (name, one) => {
      const outcome = await read(one);
      const base = one.base ? byName.get(one.base) : undefined;
      // The base is read again here and not taken from the file: its own case
      // compares it with the file, and this one says what moved beside it.
      const now: Recorded =
        one.base && base
          ? {
              differsFrom: one.base,
              at: differences(await read(base), outcome),
            }
          : outcome;
      if (RECORD) {
        fresh[name] = now;
        return;
      }
      expect(now).toEqual(recorded[name]);
    }
  );

  // The recording is only a proof when the world reaches every branch. These
  // say what each fixture is there for, so a fixture that stops reaching its
  // branch fails here and not silently, also while recording.
  describe('the world reaches what it is there to reach', () => {
    const outcomeOf = (name: string): Promise<Outcome> => {
      const one = byName.get(name);
      if (!one) {
        throw new Error(`no case called "${name}"`);
      }
      return read(one);
    };
    const answerOf = async (name: string): Promise<BasketResult> => {
      const outcome = await outcomeOf(name);
      if (!('answer' in outcome)) {
        throw new Error(`"${name}" was refused: ${outcome.refused.message}`);
      }
      return outcome.answer;
    };

    it('prices every product and describes both chains', async () => {
      const answer = await answerOf(NO_SHOP);
      expect(answer.products.map((product) => product.id)).toEqual([
        'i-milk',
        'i-soy',
        'i-bread',
      ]);
      expect(answer.scopes.map((scope) => scope.supermarketId).sort()).toEqual([
        'carrefour',
        'mercadona',
      ]);
    });

    it('picks another product at a shop than with none', async () => {
      const none = await answerOf(NO_SHOP);
      const shop = await answerOf(AT_A_SHOP);
      expect(none.rows[1].productId).toBe('i-soy');
      expect(shop.rows[1].productId).toBe('i-oat');
      expect(shop.rows[0].usual).not.toBeNull();
      expect(none.rows[0].usual).toBeNull();
    });

    it('names a list only to a reader who writes it', async () => {
      expect((await answerOf(NO_SHOP)).lists).toHaveLength(2);
      expect((await answerOf(':id: member, no shop')).lists).toHaveLength(1);
      expect((await answerOf(':id: guest, no shop')).lists).toHaveLength(0);
    });

    it('leaves out the shop the profile refuses', async () => {
      const mercadona = (await answerOf(NO_SHOP)).scopes.find(
        (scope) => scope.supermarketId === 'mercadona'
      );
      expect(
        mercadona?.locations.map((shop) => shop.supermarketLocationId)
      ).toEqual(['loc-mercadona-1']);
    });

    it('names the shop a basket was started at, and no other', async () => {
      expect(
        (await answerOf(':id: owner, a basket started at a shop')).shop
      ).toMatchObject({ id: OWN_SHOP });
      expect((await answerOf(AT_A_SHOP)).shop).toBeNull();
    });

    it('refuses another shop and a removed participant', async () => {
      expect(
        await outcomeOf(
          ':id: owner, a basket started at a shop, asked at another'
        )
      ).toMatchObject({ refused: { name: 'BasketShopLockedException' } });
      expect(
        await outcomeOf(':id: guest, removed between the guard and the read')
      ).toMatchObject({ refused: { name: 'NotAParticipantException' } });
    });

    it.each(FAILURES)('keeps its four rows when %s fails', async (fails) => {
      for (const name of [
        `:id: owner, at a shop, ${fails} fails`,
        `:id: guest, no shop, ${fails} fails`,
        `live: owner, at a shop, ${fails} fails`,
      ]) {
        expect((await answerOf(name)).rows).toHaveLength(4);
      }
    });
  });
});

/**
 * The rows alone (plan 0205, section 3).
 *
 * `GET /v1/baskets/:id/rows` and `GET /v1/baskets/live/rows` answer what core
 * computes and stop. Each test makes the full read and the rows read over the
 * same world and compares them, so the two cannot drift apart.
 */
describe('the rows alone (plan 0205, section 3)', () => {
  /** What catalog is asked only to compose, which a rows read never asks. */
  const COMPOSITION: string[] = [
    SECTION_PATTERNS.itemsAtLocation,
    SUPERMARKET_PATTERNS.list,
    SUPERMARKET_LOCATION_PATTERNS.search,
  ];

  /** The full answer with the catalog half taken off. */
  const coreHalfOf = (full: BasketResult): BasketView => {
    const {
      products: _products,
      shop: _shop,
      scopes: _scopes,
      scopesIncomplete: _scopesIncomplete,
      ...rest
    } = full;
    return rest;
  };

  const queryOf = (locationId: string | undefined) =>
    locationId ? { locationId } : undefined;

  describe.each([
    ['with no shop', undefined],
    ['at a shop', SHOP],
  ] as const)('%s', (_title, locationId) => {
    it.each(['owner', 'member', 'guest'] as const)(
      ':id/rows answers a %s the rows, the lists, the people, the progress and the marks of the full read',
      async (reader) => {
        const full = await build({ reader }).controller.get(
          participantOf(reader),
          BASKET_ID,
          queryOf(locationId)
        );
        const { controller, subjects } = build({ reader });
        const rows = await controller.rows(
          participantOf(reader),
          BASKET_ID,
          queryOf(locationId)
        );

        expect(wire(rows)).toEqual(wire(coreHalfOf(full)));
        // The fields a client reads after an event, named so that a view
        // that loses one fails here by its name.
        expect(rows.rows).toHaveLength(4);
        expect(rows.participants).toHaveLength(3);
        expect(rows.progress).toEqual(full.progress);
        expect(rows.unseenChangeCount).toBe(2);
        expect(rows.newestUnseenChangeId).toBe('change-9');
        expect(rows).not.toHaveProperty('products');
        expect(rows).not.toHaveProperty('scopes');
        expect(rows).not.toHaveProperty('shop');
        // It stops at the rows.
        expect(subjects[subjects.length - 1]).toBe(BASKET_PATTERNS.get);
        expect(subjects.filter((one) => COMPOSITION.includes(one))).toEqual([]);
      }
    );

    it('live/rows answers the owner the same half of the live read', async () => {
      const user = { userId: OWNER, kind: 'REGISTERED' } as never;
      const full = await build({ reader: 'owner' }).live.live(
        user,
        queryOf(locationId)
      );
      const { live, subjects } = build({ reader: 'owner' });
      const rows = await live.liveRows(user, queryOf(locationId));

      expect(wire(rows)).toEqual(wire(coreHalfOf(full)));
      expect(subjects[subjects.length - 1]).toBe(BASKET_PATTERNS.live);
      expect(subjects.filter((one) => COMPOSITION.includes(one))).toEqual([]);
    });
  });

  it('counts a line of two products as the cheapest, as the full read does', async () => {
    const none = await build({ reader: 'owner' }).controller.rows(
      participantOf('owner'),
      BASKET_ID
    );
    const shop = await build({ reader: 'owner' }).controller.rows(
      participantOf('owner'),
      BASKET_ID,
      { locationId: SHOP }
    );

    expect(none.rows[1].productId).toBe('i-soy');
    expect(shop.rows[1].productId).toBe('i-oat');
    // `usual` is counted at the chain of the shop, so it needs the shop.
    expect(none.rows[0].usual).toBeNull();
    expect(shop.rows[0].usual).not.toBeNull();
  });

  it('asks core three questions and catalog none when no line needs a price', async () => {
    const { controller, subjects } = build({
      reader: 'guest',
      nothingToPrice: true,
    });

    await controller.rows(participantOf('guest'), BASKET_ID);

    expect([...subjects].sort()).toEqual(
      [
        BASKET_PATTERNS.searchScope,
        BASKET_PATTERNS.priceChoices,
        BASKET_PATTERNS.get,
      ].sort()
    );
  });

  it('asks core two questions for the live rows when no line needs a price', async () => {
    const { live, subjects } = build({ reader: 'owner', nothingToPrice: true });

    await live.liveRows({ userId: OWNER, kind: 'REGISTERED' } as never);

    expect(subjects).toEqual([
      BASKET_PATTERNS.livePriceChoices,
      BASKET_PATTERNS.live,
    ]);
  });

  it('refuses another shop on a basket that was started at one', async () => {
    const { controller } = build({ reader: 'owner', basketShop: OWN_SHOP });

    await expect(
      controller.rows(participantOf('owner'), BASKET_ID, { locationId: SHOP })
    ).rejects.toThrow('This basket was started at another shop');
  });

  it('still refuses another shop when core could not say where the basket was started', async () => {
    const { controller } = build({
      reader: 'owner',
      basketShop: OWN_SHOP,
      fails: 'core: searchScope',
    });

    await expect(
      controller.rows(participantOf('owner'), BASKET_ID, { locationId: SHOP })
    ).rejects.toThrow('This basket was started at another shop');
  });

  it('refuses a participant who was removed after the guard', async () => {
    const { controller } = build({ reader: 'guest', removed: true });

    await expect(
      controller.rows(participantOf('guest'), BASKET_ID)
    ).rejects.toBeInstanceOf(NotAParticipantException);
  });

  it.each(FAILURES)('keeps its four rows when %s fails', async (fails) => {
    const rows = await build({ reader: 'owner', fails }).controller.rows(
      participantOf('owner'),
      BASKET_ID,
      { locationId: SHOP }
    );

    expect(rows.rows).toHaveLength(4);
  });
});
