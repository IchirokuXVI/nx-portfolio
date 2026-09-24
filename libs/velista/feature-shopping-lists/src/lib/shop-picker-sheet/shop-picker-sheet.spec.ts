import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  BasketStore,
  BasketViewStore,
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
} from '@portfolio/velista/platform';
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
  };
}

function scope(
  priceScopeId: string,
  chain: string,
  locations: ReturnType<typeof shop>[] = []
): BasketPriceScope {
  return {
    priceScopeId,
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

  const paramMap = convertToParamMap({ basketId: BASKET_ID });
  TestBed.configureTestingModule({
    imports: [ShopPickerSheet, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '' }),
      { provide: BasketStore, useValue: store },
      BasketViewStore,
      { provide: SHOP_FINDER_SERVICE, useValue: memory },
      provideFakeGeolocationReader(reader),
      provideFakeBrowserFacade(new Map()),
      { provide: SheetNavigation, useValue: sheets },
      { provide: Router, useValue: { navigate: jest.fn() } },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: { paramMap, parent: null },
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

    it('lists the matches flat, across every chain', () => {
      const { fixture } = render(OWNER_SCOPES);

      type(fixture, 'Córdoba');

      // Every shop is in Córdoba: three rows, no headings, and the chain buttons
      // still above them, which is what the supermarkets page does.
      expect(rows(fixture)).toHaveLength(3);
      expect(headings(fixture)).toHaveLength(0);
      expect(chains(fixture)).toHaveLength(2);
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

    it('clears itself when a chain is tapped', () => {
      const { fixture } = render(OWNER_SCOPES);
      type(fixture, 'Córdoba');

      tapChain(fixture, 1);

      // The buttons and the flat matches are two answers to the same question,
      // and leaving the query behind would draw one over the other.
      expect(fixture.debugElement.query(By.css('.result-count'))).toBeNull();
      expect(rows(fixture)).toHaveLength(1);
    });
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
