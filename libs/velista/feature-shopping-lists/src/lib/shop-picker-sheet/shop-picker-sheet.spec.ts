import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  ActivatedRoute,
  convertToParamMap,
  DefaultUrlSerializer,
  Router,
  type UrlTree,
} from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  BasketStore,
  BasketViewStore,
  provideFakeCategoryStore,
  provideFakeShopSectionsStore,
  SHOP_FINDER_SERVICE,
  ShopFinderMemory,
  ShopPickNotices,
  toNearbyShops,
  toRecentShops,
} from '@portfolio/velista/data-access';
import type {
  BasketParticipant,
  BasketPriceScope,
} from '@portfolio/velista/models';
import {
  fakeGeolocationReader,
  provideFakeBrowserFacade,
  provideFakeGeolocationReader,
  provideVelistaTesting,
  SheetNavigation,
  StorageKeys,
} from '@portfolio/velista/platform';
import { HeldBuy } from '../held-buy';
import { ShopPickerSheet } from './shop-picker-sheet';

const BASKET_ID = 'b4b1f0e2-1f5a-4c2e-9a4d-6f0e2b7c1d33';

/** One shop of a scope, with the five fields the search looks in. */
function shop(
  id: string,
  name: string | null,
  address: string,
  city: string,
  postalCode: string
) {
  return {
    id,
    label: name === null ? null : { en: name, es: name },
    address,
    city,
    postalCode,
    sections: [],
  };
}

function scope(
  priceScopeId: string,
  chain: string,
  locations: ReturnType<typeof shop>[] = []
): BasketPriceScope {
  return {
    priceScopeId,
    supermarketId: `sm-${chain}`,
    logoUrl: null,
    supermarketName: { en: chain, es: chain },
    locations,
  };
}

/** An owner's basket: two chains, three shops, two postal codes at Mercadona. */
const OWNER_SCOPES = [
  scope('s-merca', 'Mercadona', [
    shop(
      'loc-tejares',
      'Ronda de los Tejares',
      'Ronda de los Tejares 32',
      'Córdoba',
      '14008'
    ),
    shop('loc-barcelona', null, 'Avenida de Barcelona 4', 'Córdoba', '14001'),
  ]),
  scope('s-dia', 'Dia', [
    shop('loc-victoria', null, 'Paseo de la Victoria 21', 'Córdoba', '14004'),
  ]),
];

/** Chains whose scopes name no shop: a scope catalog could not place. */
const NO_SHOP_SCOPES = [scope('s-merca', 'Mercadona'), scope('s-dia', 'Dia')];

function render(
  scopes: readonly BasketPriceScope[],
  options: {
    /** The reader's own participant row, or null before the basket has arrived. */
    readonly me?: Pick<BasketParticipant, 'kind'> | null;
    readonly memory?: ShopFinderMemory;
    readonly reader?: ReturnType<typeof fakeGeolocationReader>;
    /** The question at the first buy (velista `0141`): `data.shopAsk` on the route. */
    readonly asking?: boolean;
    /** This device's storage, so a spec can read what an answer kept. */
    readonly storage?: Map<string, string>;
  } = {}
) {
  TestBed.resetTestingModule();
  const memory = options.memory ?? new ShopFinderMemory();
  const reader =
    options.reader ??
    fakeGeolocationReader({
      outcome: {
        state: 'located',
        point: { latitude: 37.88, longitude: -4.78, accuracyMetres: 12 },
      },
    });

  const sheets = {
    dismiss: jest.fn().mockResolvedValue(undefined),
    leaveTo: jest.fn().mockResolvedValue(undefined),
  };

  const held = signal(
    new Map(scopes.map((entry) => [entry.priceScopeId, entry]))
  );
  // The device's shop (velista `0102`), read at once by this double.
  const readAt = signal<string | null>(null);
  const store = {
    readAt,
    shopRead: readAt,
    readAtShop: jest.fn((locationId: string | null) => {
      readAt.set(locationId);
      return Promise.resolve();
    }),
    lines: signal([]),
    // How a sheet addresses its own basket since velista `0091`: off the store,
    // never off `paramMap`, which has no id under `shopping-lists/live`.
    address: signal({ basketId: BASKET_ID }),
    products: signal(new Map()),
    lastAdded: signal(null),
    me: signal(options.me ?? null),
    basket: computed(() => ({
      id: BASKET_ID,
      sources: [],
      scopes: held(),
      shop: null,
      lockedShopId: null,
      readAt: readAt(),
    })),
    listNames: signal(new Map<string, string>()),
  };

  // The navigation under way when the sheet is torn down, which says whether
  // the basket stays (velista `0141`). Null is a teardown outside a navigation.
  const serializer = new DefaultUrlSerializer();
  const router = {
    navigate: jest.fn(),
    navigation: null as { readonly finalUrl: UrlTree } | null,
    getCurrentNavigation() {
      return this.navigation;
    },
    serializeUrl: (tree: UrlTree) => serializer.serialize(tree),
    navigatingTo(url: string) {
      this.navigation = { finalUrl: serializer.parse(url) };
    },
  };

  const paramMap = convertToParamMap({ basketId: BASKET_ID });
  TestBed.configureTestingModule({
    imports: [ShopPickerSheet, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '' }),
      { provide: BasketStore, useValue: store },
      BasketViewStore,
      provideFakeCategoryStore(),
      provideFakeShopSectionsStore(),
      { provide: SHOP_FINDER_SERVICE, useValue: memory },
      provideFakeGeolocationReader(reader),
      provideFakeBrowserFacade(options.storage ?? new Map()),
      HeldBuy,
      { provide: SheetNavigation, useValue: sheets },
      { provide: Router, useValue: router },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            paramMap,
            parent: null,
            data: options.asking ? { shopAsk: true } : {},
          },
          paramMap: { subscribe: () => ({ unsubscribe: () => undefined }) },
          parent: null,
        },
      },
    ],
  });

  const fixture = TestBed.createComponent(ShopPickerSheet);
  fixture.detectChanges();

  return {
    fixture,
    sheets,
    memory,
    reader,
    view: TestBed.inject(BasketViewStore),
    notices: TestBed.inject(ShopPickNotices),
    held: TestBed.inject(HeldBuy),
    router,
  };
}

type Fixture = ReturnType<typeof render>['fixture'];

function chains(fixture: Fixture): readonly string[] {
  return fixture.debugElement
    .queryAll(By.css('lib-franchise-buttons .chip'))
    .map((node) => (node.nativeElement as HTMLElement).textContent ?? '');
}

function tapChain(fixture: Fixture, index: number): void {
  fixture.debugElement
    .queryAll(By.css('lib-franchise-buttons .chip'))
    [index].nativeElement.click();
  fixture.detectChanges();
}

function rows(fixture: Fixture): readonly string[] {
  return fixture.debugElement
    .queryAll(By.css('lib-shop-list .row'))
    .map((node) => (node.nativeElement as HTMLElement).textContent ?? '');
}

function headings(fixture: Fixture): readonly string[] {
  return fixture.debugElement
    .queryAll(By.css('lib-shop-list .heading'))
    .map(
      (node) => (node.nativeElement as HTMLElement).textContent?.trim() ?? ''
    );
}

function type(fixture: Fixture, query: string): void {
  const field = fixture.debugElement.query(By.css('.search-input'))
    .nativeElement as HTMLInputElement;
  field.value = query;
  field.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

/**
 * Choosing which shop the person is buying at (velista `0078`, section 4; `0102`).
 *
 * The supermarkets page's own pieces over a **basket's** scopes, drawn by
 * `ShopPicker` from `ui`: the search across every chain, the chain buttons, and the
 * shops under their postal codes. A row picks **the shop**, because the shop is
 * where the person is standing, and every participant is served the same shops.
 */
describe('ShopPickerSheet', () => {
  it('draws one button per chain, with the count of its shops', () => {
    const { fixture } = render(OWNER_SCOPES);

    expect(chains(fixture)).toHaveLength(2);
    expect(chains(fixture)[0]).toContain('Mercadona');
    // Two shops at Mercadona, one at Dia. `shops.chain.count` takes the number.
    expect(chains(fixture)[0]).toContain('shops.chain.count');
    expect(chains(fixture)[1]).toContain('Dia');
  });

  it('opens a chain onto its shops, grouped by postal code', () => {
    const { fixture } = render(OWNER_SCOPES);

    expect(rows(fixture)).toHaveLength(0);

    tapChain(fixture, 0);

    expect(rows(fixture)).toHaveLength(2);
    // The code itself heads the group: a basket's shops carry a postal code and
    // not the profile's own word for it (`0059`, section 3.3's fallback).
    expect(headings(fixture)).toEqual(['14008', '14001']);
  });

  it('draws the body the get a list sheet draws too', () => {
    const { fixture } = render(OWNER_SCOPES);

    expect(
      fixture.debugElement.query(By.css('lib-shop-picker'))
    ).not.toBeNull();
  });

  it('writes the shop that was picked, and goes back to the filter sheet', () => {
    const { fixture, sheets, view } = render(OWNER_SCOPES);
    tapChain(fixture, 0);

    fixture.debugElement
      .queryAll(By.css('lib-shop-list .checkbox'))[1]
      .nativeElement.click();
    fixture.detectChanges();

    // The second shop of the first scope, and not the scope: two Mercadonas of
    // one scope are two places to stand (velista `0102`).
    expect(view.shop()).toBe('loc-barcelona');
    // A pop, because the filter sheet pushed this one: the filter sheet's URL is
    // only the fallback for a cold load on this sheet's own address.
    expect(sheets.dismiss).toHaveBeenCalledWith(
      `/en/shopping-lists/${BASKET_ID}/sheet/filter`
    );
    expect(sheets.leaveTo).not.toHaveBeenCalled();
  });

  it('checks the chosen shop and no other of its scope', () => {
    const { fixture, view } = render(OWNER_SCOPES);
    view.setShop('loc-barcelona');
    fixture.detectChanges();
    tapChain(fixture, 0);

    const radios = fixture.debugElement
      .queryAll(By.css('lib-shop-list .checkbox'))
      .map((node) => node.nativeElement as HTMLInputElement);
    expect(radios.map((radio) => radio.checked)).toEqual([false, true]);
  });

  describe('the search', () => {
    it.each([
      ['Tejares', 'the shop’s own name'],
      ['mercadona', 'the chain'],
      ['Avenida de Barcelona', 'the street'],
      ['cordoba', 'the town, folded'],
      ['14004', 'the postal code'],
    ])('matches %s, which is %s', (query) => {
      const { fixture } = render(OWNER_SCOPES);

      type(fixture, query);

      expect(rows(fixture).length).toBeGreaterThan(0);
    });

    it('lists the matches flat, across every chain, in place of the buttons', () => {
      const { fixture } = render(OWNER_SCOPES);

      type(fixture, 'Córdoba');

      // Every shop is in Córdoba: three rows, no headings, and no chain buttons
      // while the field holds something (velista 0124, decided in review).
      expect(rows(fixture)).toHaveLength(3);
      expect(headings(fixture)).toHaveLength(0);
      expect(chains(fixture)).toHaveLength(0);
    });

    it('says how many matched, and says so when none did', () => {
      const { fixture } = render(OWNER_SCOPES);

      type(fixture, 'Sevilla');

      expect(
        fixture.debugElement.query(By.css('.result-count'))
      ).not.toBeNull();
      expect(rows(fixture)).toHaveLength(0);
      expect(
        fixture.debugElement.query(By.css('.empty')).nativeElement.textContent
      ).toContain('shops.empty.noMatch');
    });

    it('brings the buttons back once the field is emptied', () => {
      const { fixture } = render(OWNER_SCOPES);
      type(fixture, 'Córdoba');

      type(fixture, '');

      expect(fixture.debugElement.query(By.css('.result-count'))).toBeNull();
      expect(chains(fixture)).toHaveLength(2);
      expect(rows(fixture)).toHaveLength(0);
    });
  });

  /**
   * A chain opens inside the sheet (velista 0124): a sheet cannot push a page, so
   * the title row shows a back chevron, the chain's logo and its name, and hides
   * Near me. Back returns to the root and never leaves the sheet.
   */
  describe('a chain opened inside the sheet', () => {
    it('draws the chain in the title row, keeps the sheet’s name, and hides Near me', () => {
      const { fixture } = render(OWNER_SCOPES);

      tapChain(fixture, 0);

      const title = fixture.nativeElement.querySelector(
        '#shop-picker-title'
      ) as HTMLElement;
      expect(title.textContent).toContain('Mercadona');
      expect(title.textContent).toContain('basket.view.shop.title');
      expect(
        fixture.nativeElement.querySelector('.head lib-chain-logo')
      ).not.toBeNull();
      expect(
        fixture.nativeElement.querySelector('lib-near-me-button')
      ).toBeNull();
      expect(fixture.nativeElement.querySelector('.search-input')).toBeNull();
      expect(
        fixture.nativeElement.querySelector('.count')?.textContent
      ).toContain('shops.chain.inAreas');
    });

    it('goes back to the root with the chevron, and never leaves the sheet', () => {
      const { fixture, sheets } = render(OWNER_SCOPES);
      tapChain(fixture, 0);

      (
        fixture.nativeElement.querySelector('.back') as HTMLButtonElement
      ).click();
      fixture.detectChanges();

      expect(sheets.dismiss).not.toHaveBeenCalled();
      expect(chains(fixture)).toHaveLength(2);
      expect(
        fixture.nativeElement.querySelector('lib-near-me-button')
      ).not.toBeNull();
    });

    it('leaves the sheet from the root’s chevron', () => {
      const { fixture, sheets } = render(OWNER_SCOPES);

      (
        fixture.nativeElement.querySelector('.back') as HTMLButtonElement
      ).click();

      expect(sheets.dismiss).toHaveBeenCalledTimes(1);
    });
  });

  it('keys the chains by id, so two scopes of one chain are one button', () => {
    const { fixture } = render([
      ...OWNER_SCOPES,
      scope('s-merca-2', 'Mercadona', [
        shop('loc-mayor', null, 'Calle Mayor 3', 'Córdoba', '14001'),
      ]),
    ]);

    expect(chains(fixture)).toHaveLength(2);
    tapChain(fixture, 0);
    expect(rows(fixture)).toHaveLength(3);
  });

  it('ticks the chain of the shop being bought at', () => {
    const { fixture, view } = render(OWNER_SCOPES);
    view.setShop('loc-victoria');
    fixture.detectChanges();

    const pressed = fixture.debugElement
      .queryAll(By.css('lib-franchise-buttons .chip'))
      .map((node) => node.nativeElement.getAttribute('aria-pressed'));
    expect(pressed).toEqual(['false', 'true']);
  });

  /**
   * A chain is not a place to stand in, so a scope with no shop to name offers
   * nothing to pick, and its chain has no button (velista `0102`).
   */
  it('draws no button for a chain with no shop to pick', () => {
    const { fixture, view } = render(NO_SHOP_SCOPES);

    expect(chains(fixture)).toHaveLength(0);
    expect(rows(fixture)).toHaveLength(0);
    expect(view.shop()).toBeNull();
  });
});

/** A shop view as the gateway names one, near the device or bought at. */
function shopView(id: string, chain: string, inProfile = true) {
  return {
    id,
    supermarketId: `sm-${chain}`,
    supermarketName: { en: chain, es: chain },
    label: null,
    address: `Calle ${id}`,
    city: 'Córdoba',
    postalCode: '14001',
    inProfile,
  };
}

/** Let the reader, the fake route and the store settle, then draw. */
async function settle(fixture: Fixture): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
  fixture.detectChanges();
}

function pressNearMe(fixture: Fixture): void {
  (
    fixture.nativeElement.querySelector(
      'lib-near-me-button button'
    ) as HTMLButtonElement
  ).click();
}

/**
 * "Near me" and the recent shops in a basket (velista `0103`): the basket's own
 * nearby route, any participant, and the server's pick acted on as given.
 */
describe('ShopPickerSheet, near me', () => {
  it('asks for no position until Near me is pressed', async () => {
    const { fixture, reader, memory } = render(OWNER_SCOPES, {
      me: { kind: 'OWNER' },
    });
    await settle(fixture);

    expect(reader.state.reads).toBe(0);
    expect(memory.calls).not.toContain('basket');
  });

  it('sets the shop the server picked, closes, and leaves the message with its distance', async () => {
    const memory = new ShopFinderMemory();
    memory.nearby = toNearbyShops({
      candidates: [
        {
          ...shopView('near-1', 'Mercadona'),
          distanceMetres: 120,
          excluded: false,
        },
      ],
      pick: { locationId: 'near-1', distanceMetres: 120 },
      noPick: null,
    });
    const { fixture, sheets, view, notices, reader } = render(OWNER_SCOPES, {
      memory,
    });

    pressNearMe(fixture);
    await settle(fixture);

    // The basket's own route, with the picker's own read of the device.
    expect(memory.calls).toEqual(['basket']);
    expect(memory.asked).toEqual([BASKET_ID]);
    expect(reader.state.options[0]).toMatchObject({
      enableHighAccuracy: true,
      timeoutMs: 15_000,
      maximumAgeMs: 0,
    });
    expect(view.shop()).toBe('near-1');
    expect(sheets.dismiss).toHaveBeenCalledTimes(1);
    expect(notices.notice()).toMatchObject({
      basket: BASKET_ID,
      shop: { id: 'near-1' },
      distanceMetres: 120,
    });
  });

  it.each(['AMBIGUOUS', 'LOW_ACCURACY', 'OUTSIDE_PROFILE'] as const)(
    'draws the candidates for %s and picks nothing',
    async (reason) => {
      const memory = new ShopFinderMemory();
      memory.nearby = toNearbyShops({
        candidates: [
          {
            ...shopView('near-1', 'Mercadona', reason !== 'OUTSIDE_PROFILE'),
            distanceMetres: 180,
            excluded: false,
          },
          {
            ...shopView('near-2', 'Dia'),
            distanceMetres: 230,
            excluded: false,
          },
        ],
        pick: null,
        noPick: reason,
      });
      const { fixture, sheets, view, notices } = render(OWNER_SCOPES, {
        memory,
      });

      pressNearMe(fixture);
      await settle(fixture);

      const region = fixture.nativeElement.querySelector(
        '.near-region'
      ) as HTMLElement;
      expect(region.textContent).toContain(
        `basket.view.shop.near.reason.${reason}`
      );
      expect(
        [...region.querySelectorAll('.aside')].map((node) =>
          node.textContent?.trim()
        )
      ).toEqual(['180 m', '230 m']);
      expect(view.shop()).toBeNull();
      expect(sheets.dismiss).not.toHaveBeenCalled();
      expect(notices.notice()).toBeNull();
    }
  );

  it('draws one line for no shop nearby', async () => {
    const { fixture } = render(OWNER_SCOPES);

    pressNearMe(fixture);
    await settle(fixture);

    expect(
      fixture.nativeElement.querySelector('.near-region .line')?.textContent
    ).toContain('basket.view.shop.near.reason.NONE_NEARBY');
  });

  it('lets a guest choose a nearby shop the owner never listed, with no message', async () => {
    const memory = new ShopFinderMemory();
    memory.nearby = toNearbyShops({
      candidates: [
        {
          ...shopView('elsewhere', 'Lidl'),
          distanceMetres: 90,
          excluded: false,
        },
        { ...shopView('other', 'Dia'), distanceMetres: 140, excluded: false },
      ],
      pick: null,
      noPick: 'AMBIGUOUS',
    });
    const { fixture, sheets, view, notices } = render(OWNER_SCOPES, {
      me: { kind: 'GUEST' },
      memory,
    });

    pressNearMe(fixture);
    await settle(fixture);
    (
      fixture.nativeElement.querySelector(
        '.near-region input'
      ) as HTMLInputElement
    ).click();

    expect(memory.calls).toEqual(['basket']);
    expect(view.shop()).toBe('elsewhere');
    expect(sheets.dismiss).toHaveBeenCalledTimes(1);
    expect(notices.notice()).toBeNull();
  });

  it.each([
    ['denied', 'basket.view.shop.near.denied'],
    ['timed-out', 'basket.view.shop.near.timedOut'],
    ['unavailable', 'basket.view.shop.near.failed'],
  ] as const)(
    'says so in one line when the device answers %s, and asks no server',
    async (state, key) => {
      const reader = fakeGeolocationReader({ outcome: { state } });
      const { fixture, memory } = render(OWNER_SCOPES, { reader });

      pressNearMe(fixture);
      await settle(fixture);

      expect(
        fixture.nativeElement.querySelector('.near-region .line')?.textContent
      ).toContain(key);
      expect(memory.calls).not.toContain('basket');
      // The chains still work below the line.
      expect(chains(fixture)).toHaveLength(2);
    }
  );

  it('says the lookup failed in one line when the server does not answer', async () => {
    const memory = new ShopFinderMemory();
    memory.failNearby = true;
    const { fixture } = render(OWNER_SCOPES, { memory });

    pressNearMe(fixture);
    await settle(fixture);

    expect(
      fixture.nativeElement.querySelector('.near-region .line')?.textContent
    ).toContain('basket.view.shop.near.failed');
  });
});

describe('ShopPickerSheet, recent shops', () => {
  it('draws the signed in reader’s recent shops first, and a pick from them sets the shop', async () => {
    const memory = new ShopFinderMemory();
    memory.recent = toRecentShops({
      shops: [
        {
          shop: shopView('recent-1', 'Lidl'),
          lastBoughtAt: new Date().toISOString(),
        },
        {
          shop: shopView('recent-2', 'Dia'),
          lastBoughtAt: '2026-01-02T10:00:00Z',
        },
      ],
    });
    const { fixture, view } = render(OWNER_SCOPES, {
      me: { kind: 'OWNER' },
      memory,
    });
    await settle(fixture);

    expect(memory.calls).toEqual(['recent']);
    const section = fixture.nativeElement.querySelector(
      '.section'
    ) as HTMLElement;
    expect(section.textContent).toContain('basket.view.shop.recent.heading');
    expect(section.querySelectorAll('.row')).toHaveLength(2);
    expect(section.querySelector('.aside')?.textContent).toContain(
      'basket.view.shop.recent.today'
    );

    (section.querySelector('input') as HTMLInputElement).click();
    expect(view.shop()).toBe('recent-1');
  });

  it('draws no recent section when the reader has none', async () => {
    const { fixture, memory } = render(OWNER_SCOPES, {
      me: { kind: 'REGISTERED' },
    });
    await settle(fixture);

    expect(memory.calls).toEqual(['recent']);
    expect(fixture.nativeElement.textContent).not.toContain(
      'basket.view.shop.recent.heading'
    );
  });

  it('never asks for recent shops for a guest, and draws none', async () => {
    const memory = new ShopFinderMemory();
    memory.recent = toRecentShops({
      shops: [
        {
          shop: shopView('recent-1', 'Lidl'),
          lastBoughtAt: '2026-09-01T10:00:00Z',
        },
      ],
    });
    const { fixture } = render(OWNER_SCOPES, {
      me: { kind: 'GUEST' },
      memory,
    });
    await settle(fixture);

    expect(memory.calls).toEqual([]);
    expect(fixture.nativeElement.textContent).not.toContain(
      'basket.view.shop.recent.heading'
    );
  });
});

/**
 * The question at the first buy of a trip (velista `0141`): the same sheet at
 * `sheet/shop`, with "No shop", a foot with "Don't ask again", and every way out
 * leading to the basket and writing the buy that waits.
 */
describe('ShopPickerSheet, asking at the first buy', () => {
  const BASKET_URL = `/en/shopping-lists/${BASKET_ID}`;

  /** Two shops near the device, the nearest first, and no pick of the server's. */
  function nearby(): ShopFinderMemory {
    const memory = new ShopFinderMemory();
    memory.nearby = toNearbyShops({
      candidates: [
        {
          ...shopView('near-1', 'Mercadona'),
          distanceMetres: 40,
          excluded: false,
        },
        { ...shopView('near-2', 'Dia'), distanceMetres: 210, excluded: false },
      ],
      pick: null,
      noPick: 'AMBIGUOUS',
    });
    return memory;
  }

  function granted() {
    return fakeGeolocationReader({
      permission: 'granted',
      outcome: {
        state: 'located',
        point: { latitude: 37.88, longitude: -4.78, accuracyMetres: 12 },
      },
    });
  }

  function title(fixture: Fixture): string {
    return (
      (fixture.nativeElement.querySelector('#shop-picker-title') as HTMLElement)
        .textContent ?? ''
    ).trim();
  }

  /** A buy the page held, which records that it was written. */
  function holdBuy(held: HeldBuy): { written: number } {
    const buy = { written: 0 };
    held.hold(async () => {
      buy.written++;
    });
    return buy;
  }

  describe('with location already allowed', () => {
    it('finds the shops, selects the nearest, and asks "Are you buying here?"', async () => {
      const reader = granted();
      const { fixture, memory } = render(OWNER_SCOPES, {
        asking: true,
        memory: nearby(),
        reader,
      });
      await settle(fixture);

      expect(reader.state.queries).toBe(1);
      expect(reader.state.reads).toBe(1);
      expect(memory.calls).toContain('basket');
      expect(title(fixture)).toBe('basket.shopAsk.title');
      const radios = fixture.nativeElement.querySelectorAll(
        '.near-region input'
      ) as NodeListOf<HTMLInputElement>;
      expect(radios[0].checked).toBe(true);
      // The question has found the shop, so it draws no Near me and no reason.
      expect(
        fixture.nativeElement.querySelector('lib-near-me-button')
      ).toBeNull();
      expect(
        fixture.nativeElement.querySelector('.near-region .line')
      ).toBeNull();
    });

    it('chooses the selected shop with one press and writes the buy', async () => {
      const { fixture, view, held, sheets } = render(OWNER_SCOPES, {
        asking: true,
        memory: nearby(),
        reader: granted(),
      });
      const buy = holdBuy(held);
      await settle(fixture);

      (
        fixture.nativeElement.querySelector(
          '.near-region input'
        ) as HTMLInputElement
      ).click();
      await settle(fixture);

      expect(view.shop()).toBe('near-1');
      expect(buy.written).toBe(1);
      expect(sheets.dismiss).toHaveBeenCalledWith(BASKET_URL);
    });

    it('is the plain picker when no shop is near, with no line about the look', async () => {
      const { fixture } = render(OWNER_SCOPES, {
        asking: true,
        reader: granted(),
      });
      await settle(fixture);

      expect(title(fixture)).toBe('basket.view.shop.title');
      expect(
        fixture.nativeElement.querySelector('.near-region .line')
      ).toBeNull();
      expect(
        fixture.nativeElement.querySelector('lib-near-me-button')
      ).not.toBeNull();
    });

    it('is the plain picker when the read fails, with no line about it', async () => {
      const memory = nearby();
      memory.failNearby = true;
      const { fixture } = render(OWNER_SCOPES, {
        asking: true,
        memory,
        reader: granted(),
      });
      await settle(fixture);

      expect(title(fixture)).toBe('basket.view.shop.title');
      expect(
        fixture.nativeElement.querySelector('.near-region .line')
      ).toBeNull();
    });
  });

  it.each(['prompt', 'denied', 'unknown'] as const)(
    'is the plain picker when the permission is %s, and reads no position',
    async (permission) => {
      const reader = fakeGeolocationReader({ permission });
      const { fixture, memory } = render(OWNER_SCOPES, {
        asking: true,
        memory: nearby(),
        reader,
      });
      await settle(fixture);

      expect(reader.state.reads).toBe(0);
      expect(memory.calls).not.toContain('basket');
      expect(title(fixture)).toBe('basket.view.shop.title');
      expect(
        fixture.nativeElement.querySelector('lib-near-me-button')
      ).not.toBeNull();
    }
  );

  describe('the answers', () => {
    it('"No shop" keeps an answer for the trip and writes the buy with none', async () => {
      const storage = new Map<string, string>();
      const { fixture, view, held, sheets } = render(OWNER_SCOPES, {
        asking: true,
        storage,
      });
      const buy = holdBuy(held);
      await settle(fixture);

      (
        fixture.nativeElement.querySelector(
          '.no-shop-radio'
        ) as HTMLInputElement
      ).click();
      await settle(fixture);

      expect(view.shop()).toBeNull();
      expect(view.asksForShop()).toBe(false);
      expect(storage.get(StorageKeys.shopAskOff)).toBeUndefined();
      expect(buy.written).toBe(1);
      expect(sheets.dismiss).toHaveBeenCalledWith(BASKET_URL);
    });

    it('"Don\'t ask again" keeps the flag on the device and writes the buy', async () => {
      const storage = new Map<string, string>();
      const { fixture, held, sheets } = render(OWNER_SCOPES, {
        asking: true,
        storage,
      });
      const buy = holdBuy(held);
      await settle(fixture);

      (
        fixture.nativeElement.querySelector('.never') as HTMLButtonElement
      ).click();
      await settle(fixture);

      expect(storage.get(StorageKeys.shopAskOff)).toBe('true');
      expect(buy.written).toBe(1);
      expect(sheets.dismiss).toHaveBeenCalledWith(BASKET_URL);
    });

    it('a shop chosen by hand is kept as the filter keeps it, and writes the buy', async () => {
      const { fixture, view, held } = render(OWNER_SCOPES, { asking: true });
      const buy = holdBuy(held);
      await settle(fixture);
      tapChain(fixture, 0);

      fixture.debugElement
        .queryAll(By.css('lib-shop-list .checkbox'))[0]
        .nativeElement.click();
      await settle(fixture);

      expect(view.shop()).toBe('loc-tejares');
      expect(view.asksForShop()).toBe(false);
      expect(buy.written).toBe(1);
    });

    it('the cross keeps an answer for the trip and writes the buy', async () => {
      const { fixture, view, held, sheets } = render(OWNER_SCOPES, {
        asking: true,
      });
      const buy = holdBuy(held);
      await settle(fixture);

      (
        fixture.nativeElement.querySelector('.close') as HTMLButtonElement
      ).click();
      await settle(fixture);

      expect(view.asksForShop()).toBe(false);
      expect(buy.written).toBe(1);
      expect(sheets.dismiss).toHaveBeenCalledWith(BASKET_URL);
    });

    it('a sheet left by the back gesture answers for the trip and writes the buy', async () => {
      const { fixture, view, held } = render(OWNER_SCOPES, { asking: true });
      const buy = holdBuy(held);
      await settle(fixture);

      fixture.destroy();
      await Promise.resolve();

      expect(view.asksForShop()).toBe(false);
      expect(buy.written).toBe(1);
    });

    it('a back gesture onto a URL of the basket still answers for the trip', async () => {
      const { fixture, view, held, router } = render(OWNER_SCOPES, {
        asking: true,
      });
      const buy = holdBuy(held);
      await settle(fixture);

      router.navigatingTo(`${BASKET_URL}?q=milk`);
      fixture.destroy();
      await Promise.resolve();

      expect(view.asksForShop()).toBe(false);
      expect(buy.written).toBe(1);
    });

    it.each([
      ['a page outside the basket', '/en/shops/near-1'],
      ['another basket', '/en/shopping-lists/another'],
      ['a basket whose id starts the same', `${BASKET_URL}0`],
    ])('leaving for %s answers nothing and drops the buy', async (_, url) => {
      const { fixture, view, held, router } = render(OWNER_SCOPES, {
        asking: true,
      });
      const buy = holdBuy(held);
      await settle(fixture);

      router.navigatingTo(url);
      fixture.destroy();
      await held.release();

      expect(view.asksForShop()).toBe(true);
      expect(buy.written).toBe(0);
    });

    it('writes the buy once, whichever answer came first', async () => {
      const { fixture, held } = render(OWNER_SCOPES, { asking: true });
      const buy = holdBuy(held);
      await settle(fixture);

      (
        fixture.nativeElement.querySelector('.close') as HTMLButtonElement
      ).click();
      await settle(fixture);
      fixture.destroy();
      await Promise.resolve();

      expect(buy.written).toBe(1);
    });
  });

  it('draws the foot and "No shop", and no chevron to the filter', async () => {
    const { fixture } = render(OWNER_SCOPES, { asking: true });
    await settle(fixture);

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.foot')?.textContent).toContain(
      'basket.shopAsk.note'
    );
    expect(element.querySelector('.never')?.textContent).toContain(
      'basket.shopAsk.never'
    );
    expect(element.querySelector('.no-shop')).not.toBeNull();
    expect(element.querySelector('.back')).toBeNull();
  });

  it('answers a cold load with no buy waiting, and only chooses the shop', async () => {
    const { fixture, view, sheets } = render(OWNER_SCOPES, {
      asking: true,
    });
    await settle(fixture);
    tapChain(fixture, 0);

    fixture.debugElement
      .queryAll(By.css('lib-shop-list .checkbox'))[1]
      .nativeElement.click();
    await settle(fixture);

    expect(view.shop()).toBe('loc-barcelona');
    expect(sheets.dismiss).toHaveBeenCalledWith(BASKET_URL);
  });

  it('draws no button to a shop’s own page, which would leave the basket', async () => {
    const { fixture } = render(OWNER_SCOPES, {
      asking: true,
      memory: nearby(),
      reader: granted(),
    });
    await settle(fixture);

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelectorAll('.near-region .pick').length).toBe(2);
    expect(element.querySelector('.pick-about')).toBeNull();

    tapChain(fixture, 0);
    expect(element.querySelectorAll('lib-shop-list .pick').length).toBe(2);
    expect(element.querySelector('.pick-about')).toBeNull();
  });

  it('keeps the button to a shop’s own page on the filter’s own picker', async () => {
    const { fixture } = render(OWNER_SCOPES);
    await settle(fixture);
    tapChain(fixture, 0);

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.pick-about')
    ).not.toBeNull();
  });

  it('never draws the question on the filter’s own picker', async () => {
    const { fixture } = render(OWNER_SCOPES);
    await settle(fixture);

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.foot')).toBeNull();
    expect(element.querySelector('.no-shop')).toBeNull();
    expect(element.querySelector('.close')).toBeNull();
  });
});
