import {
  type EnvironmentProviders,
  type Provider,
  signal,
} from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
  Router,
} from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  CATALOG_BROWSE_SERVICE,
  type CatalogBrowseServiceI,
  fakeItemNames,
  fakeLineStore,
  type FakeLineStore,
  fakeListStore,
  fakeMemberNames,
  fakeZoneStore,
  GatewayError,
  LINE_SERVICE,
  type LineServiceI,
  ProductPickStore,
  provideFakeItemNames,
  provideFakeLineStore,
  provideFakeListStore,
  provideFakeMemberNames,
  provideFakeSessionStore,
  provideFakeZoneStore,
} from '@portfolio/velista/data-access';
import {
  type AlsoOnVm,
  type CatalogBrowseContext,
  type CatalogItem,
  type CatalogScopeOffer,
  type Line,
  type ListPermission,
  type MyZone,
  type ShoppingListSummary,
} from '@portfolio/velista/models';
import {
  AppHistory,
  provideVelistaTesting,
  SheetNavigation,
} from '@portfolio/velista/platform';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { of } from 'rxjs';
import { DeleteLineSheet } from '../delete-line-sheet/delete-line-sheet';
import { LinePage } from './line-page';

/**
 * The line page, at the DOM (velista plan `0135`, sections 2 to 4).
 *
 * What a selector cannot hold: that a press sends the write it says it sends, that
 * a control a reader may not use is absent, and that the page reads what it needs
 * when nothing read it before.
 */

const ZONE_ID = '8f14e45f-ceea-4e2c-9e0b-9c1a6a3f2b71';
const LIST_ID = '3c9a1d02-5f47-4b8e-9a1c-7d2e6b4f0a35';
const LINE_ID = 'ln-1';
const ME = 'user-me';
const LINE_URL = `/velista/en/zones/${ZONE_ID}/lists/${LIST_ID}/lines/${LINE_ID}`;
const MERCADONA = 'chain-mercadona';

const ADMIN: readonly ListPermission[] = ['READ', 'WRITE', 'DECIDE', 'MANAGE'];
const READER: readonly ListPermission[] = ['READ'];
const WRITER: readonly ListPermission[] = ['READ', 'WRITE'];

function line(overrides: Partial<Line> = {}): Line {
  return {
    id: LINE_ID,
    listId: LIST_ID,
    content: 'Shampoo',
    quantity: 3,
    itemIds: ['normal', 'classic'],
    productGroupId: null,
    groupItemIds: [],
    favoriteItemId: null,
    preferredSupermarketId: null,
    position: 1,
    approvalStatus: 'APPROVED',
    boughtCount: 12,
    lastSettlementOutcome: null,
    claimed: false,
    named: true,
    claimedByUserId: null,
    createdByUserId: ME,
    approvedByUserId: ME,
    version: 1,
    ...overrides,
  };
}

function list(
  myPermissions: readonly ListPermission[] = ADMIN
): ShoppingListSummary {
  return {
    id: LIST_ID,
    zoneId: ZONE_ID,
    name: 'Weekly shop',
    createdByUserId: ME,
    autoApproveLines: false,
    lineCount: 1,
    wantedCount: 1,
    myPermissions,
  } as ShoppingListSummary;
}

function zone(): MyZone {
  return {
    id: ZONE_ID,
    name: 'Home',
    role: 'OWNER',
    status: 'APPROVED',
    memberCount: 2,
    listCount: 1,
  } as MyZone;
}

function item(id: string, en: string): CatalogItem {
  return {
    id,
    name: { en, es: '' },
    brand: 'Deliplus',
    size: 400,
    unit: 'MILLILITER',
    productGroupId: null,
    categories: [],
    offer: null,
    chainPrices: [],
    imageUrl: null,
    unitBasis: 'LITER',
  } as unknown as CatalogItem;
}

const CONTEXT: CatalogBrowseContext = {
  state: 'priced',
  postalCodes: ['28001'],
  chains: [
    {
      supermarketId: MERCADONA,
      name: { en: 'Mercadona', es: 'Mercadona' },
      locations: 1,
      logoUrl: null,
    },
  ],
  scopes: [{ priceScopeId: 'scope-m', supermarketId: MERCADONA }],
  chainNames: new Map(),
};

function offers(price: number): readonly CatalogScopeOffer[] {
  return [
    {
      available: true,
      offer: {
        price,
        unitPrice: price * 2.5,
        currency: 'EUR',
        priceScopeId: 'scope-m',
      } as CatalogScopeOffer['offer'],
    },
  ];
}

interface Options {
  readonly lines?: readonly Line[];
  readonly permissions?: readonly ListPermission[];
  readonly linesState?: 'idle' | 'loading' | 'loaded' | 'failed';
  /** What the read of the lines failed with, beside `linesState: 'failed'`. */
  readonly linesError?: unknown;
  readonly alsoOn?: AlsoOnVm;
}

async function render(options: Options = {}): Promise<{
  fixture: ComponentFixture<LinePage>;
  lines: FakeLineStore;
  router: { navigateByUrl: jest.Mock };
  browse: { context: jest.Mock; scopeOffers: jest.Mock };
}> {
  TestBed.resetTestingModule();

  const lines = fakeLineStore({
    lines: options.lines ?? [line()],
    state: options.linesState ?? 'loaded',
    error: options.linesError,
  });
  const router = { navigateByUrl: jest.fn().mockResolvedValue(true) };
  const browse = {
    context: jest.fn().mockResolvedValue(CONTEXT),
    scopeOffers: jest.fn(async (itemId: string) =>
      offers(itemId === 'normal' ? 2.15 : 3.45)
    ),
  };
  const map = convertToParamMap({
    zoneId: ZONE_ID,
    listId: LIST_ID,
    lineId: LINE_ID,
  });

  await TestBed.configureTestingModule({
    imports: [LinePage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      ...pageProviders(options, lines, browse),
      { provide: Router, useValue: router },
      {
        provide: ActivatedRoute,
        useValue: {
          paramMap: of(map),
          snapshot: { paramMap: map, parent: null, data: {} },
          parent: null,
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(LinePage);
  await drain(fixture);

  return { fixture, lines, router, browse };
}

/**
 * The page under a real router, with the delete sheet in its outlet, for what only a
 * routed child can show: a sheet that stays drawn while the line leaves the list.
 */
async function renderRouted(url: string): Promise<{
  harness: RouterTestingHarness;
  lines: FakeLineStore;
}> {
  TestBed.resetTestingModule();

  const lines = fakeLineStore({ lines: [line()], state: 'loaded' });
  const browse = {
    context: jest.fn().mockResolvedValue(CONTEXT),
    scopeOffers: jest.fn(async () => offers(2.15)),
  };

  await TestBed.configureTestingModule({
    imports: [RokuTranslatorTestingModule.forTesting()],
    providers: [
      ...pageProviders({}, lines, browse),
      provideRouter([
        {
          path: 'velista/en/zones/:zoneId/lists/:listId/lines/:lineId',
          component: LinePage,
          children: [{ path: 'sheet/delete', component: DeleteLineSheet }],
        },
      ]),
      {
        provide: SheetNavigation,
        useValue: {
          dismiss: jest.fn().mockResolvedValue(undefined),
          leaveTo: jest.fn().mockResolvedValue(undefined),
        },
      },
    ],
  }).compileComponents();

  const harness = await RouterTestingHarness.create(url);
  await drain(harness.fixture);

  return { harness, lines };
}

/** What both harnesses share: every store and service the page reads. */
function pageProviders(
  options: Options,
  lines: FakeLineStore,
  browse: { context: jest.Mock; scopeOffers: jest.Mock }
): (Provider | EnvironmentProviders)[] {
  const holding: Pick<LineServiceI, 'listsHoldingItem'> = {
    listsHoldingItem: async () =>
      options.alsoOn ?? { places: [], hasMore: false },
  };

  return [
    provideVelistaTesting({ basePath: '/velista' }),
    provideFakeLineStore(lines),
    provideFakeListStore(
      fakeListStore({
        lists: [list(options.permissions ?? ADMIN)],
        state: 'loaded',
      })
    ),
    provideFakeZoneStore(fakeZoneStore({ zones: [zone()] })),
    provideFakeMemberNames(fakeMemberNames({})),
    provideFakeItemNames(
      fakeItemNames({
        items: [
          item('normal', 'Shampoo for normal hair'),
          item('classic', 'Classic care shampoo'),
        ],
      })
    ),
    provideFakeSessionStore('REGISTERED'),
    {
      provide: CATALOG_BROWSE_SERVICE,
      useValue: browse as unknown as CatalogBrowseServiceI,
    },
    { provide: LINE_SERVICE, useValue: holding },
    ProductPickStore,
    { provide: AppHistory, useValue: { depth: () => 4 } },
    { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
  ];
}

/**
 * Let the effects wake and their promises land. The price and "also on" reads
 * resolve through promises that `whenStable` does not wait for in a zoneless test.
 */
async function drain(fixture: ComponentFixture<unknown>): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    fixture.detectChanges();
    for (let tick = 0; tick < 8; tick += 1) {
      await Promise.resolve();
    }
  }
  fixture.detectChanges();
}

const textOf = (fixture: ComponentFixture<LinePage>): string =>
  fixture.nativeElement.textContent ?? '';

function buttonWith(
  fixture: ComponentFixture<LinePage>,
  key: string
): HTMLButtonElement | null {
  return (
    fixture.debugElement
      .queryAll(By.css('button'))
      .map((element) => element.nativeElement as HTMLButtonElement)
      .find((element) => (element.textContent ?? '').includes(key)) ?? null
  );
}

function stars(fixture: ComponentFixture<LinePage>): HTMLButtonElement[] {
  return fixture.debugElement
    .queryAll(By.css('button.star'))
    .map((element) => element.nativeElement as HTMLButtonElement);
}

describe('LinePage', () => {
  it('titles the header with the line and says where it is', async () => {
    const { fixture } = await render();

    expect(fixture.nativeElement.querySelector('h1')?.textContent?.trim()).toBe(
      'Shampoo'
    );
    expect(textOf(fixture)).toContain('list.page.where');
    expect(textOf(fixture)).toContain('list.page.addedBy');
  });

  it('names the list on the chevron, which is where it goes (plan 0158)', async () => {
    const { fixture } = await render();
    const chevron = fixture.nativeElement.querySelector(
      'lib-page-header button.lead'
    ) as HTMLButtonElement | null;

    expect(chevron?.getAttribute('aria-label')).toBe('list.page.toList');
  });

  describe('a line with no name of its own (velista 0144, section 5)', () => {
    const addName = (fixture: ComponentFixture<LinePage>) =>
      fixture.nativeElement.querySelector(
        '.add-name'
      ) as HTMLButtonElement | null;

    it('is titled with its product and offers Add a name, which opens the name sheet', async () => {
      const { fixture, router } = await render({
        lines: [line({ named: false })],
      });

      expect(
        fixture.nativeElement.querySelector('h1')?.textContent?.trim()
      ).toBe('Shampoo for normal hair');
      expect(addName(fixture)?.textContent).toContain('list.page.addName');

      addName(fixture)?.click();
      await drain(fixture);
      expect(router.navigateByUrl).toHaveBeenCalledWith(
        LINE_URL + '/sheet/name'
      );
    });

    it('draws no Add a name for a named line', async () => {
      const { fixture } = await render();

      expect(addName(fixture)).toBeNull();
    });

    it('draws no Add a name for a reader who may not rename it', async () => {
      const { fixture } = await render({
        lines: [line({ named: false })],
        permissions: READER,
      });

      expect(addName(fixture)).toBeNull();
    });
  });

  describe('the number', () => {
    it('sends one more and one fewer as a delta', async () => {
      const { fixture, lines } = await render();
      const [fewer, more] = fixture.debugElement
        .queryAll(By.css('lib-quantity-stepper button'))
        .map((element) => element.nativeElement as HTMLButtonElement);

      more.click();
      fewer.click();
      await drain(fixture);

      expect(lines.calls.filter((call) => call.kind === 'quantity')).toEqual([
        { kind: 'quantity', lineId: LINE_ID, delta: 1 },
        { kind: 'quantity', lineId: LINE_ID, delta: -1 },
      ]);
    });

    it('is a number with no buttons for a reader without DECIDE', async () => {
      const { fixture } = await render({ permissions: READER });

      expect(
        fixture.nativeElement.querySelector('lib-quantity-stepper')
      ).toBeNull();
      expect(
        fixture.nativeElement.querySelector('.quantity')?.textContent
      ).toContain('3');
    });
  });

  describe('the products', () => {
    it('draws a card for each product, with the price it read', async () => {
      const { fixture, browse } = await render();

      const cards = fixture.nativeElement.querySelectorAll(
        'lib-line-product-rail li'
      );
      expect(cards).toHaveLength(2);
      expect(textOf(fixture)).toContain('Shampoo for normal hair');
      expect(textOf(fixture)).toContain('2.15');
      expect(browse.context).toHaveBeenCalledTimes(1);
      expect(browse.scopeOffers).toHaveBeenCalledTimes(2);
      // Two products, so one of them is the cheapest.
      expect(textOf(fixture)).toContain('list.page.card.cheapest');
    });

    it('draws the cheapest card first when the line holds the dearer one first', async () => {
      const { fixture } = await render({
        lines: [line({ itemIds: ['classic', 'normal'] })],
      });

      expect(
        fixture.nativeElement.querySelector('lib-line-product-rail li')
          ?.textContent
      ).toContain('Shampoo for normal hair');
    });

    it('opens the sheet that says which product a shopper gets, from the info button', async () => {
      const { fixture, router } = await render({ permissions: READER });
      const info = fixture.nativeElement.querySelector(
        'button.info'
      ) as HTMLButtonElement;

      expect(info.getAttribute('aria-label')).toBe('list.page.aboutLabel');
      info.click();
      await drain(fixture);

      expect(router.navigateByUrl).toHaveBeenCalledWith(
        LINE_URL + '/sheet/about-products'
      );
    });

    it('has no info button on a line with no products', async () => {
      const { fixture } = await render({ lines: [line({ itemIds: [] })] });

      expect(fixture.nativeElement.querySelector('button.info')).toBeNull();
    });

    it('opens the catalog that chooses the products of the line from Change, with them ticked (velista 0146)', async () => {
      const { fixture, router } = await render();

      buttonWith(fixture, 'list.page.productsChange')?.click();
      await drain(fixture);

      expect(router.navigateByUrl).toHaveBeenCalledWith(`${LINE_URL}/products`);
      expect(TestBed.inject(ProductPickStore).request()).toMatchObject({
        kind: 'set',
        lineId: LINE_ID,
        forLabel: 'list.row.pickFor',
        forDetail: 'Weekly shop',
        chosenIds: ['normal', 'classic'],
        returnUrl: LINE_URL,
        returnDepth: 4,
      });
      expect(TestBed.inject(ProductPickStore).ticked()).toEqual([
        'normal',
        'classic',
      ]);
    });

    it('says No product yet, one sentence and Choose a product on a line with none (velista 0146)', async () => {
      const { fixture, router } = await render({
        lines: [line({ itemIds: [] })],
      });

      expect(
        fixture.nativeElement.querySelector('lib-line-product-rail')
      ).toBeNull();
      expect(textOf(fixture)).toContain('list.page.productsNone');
      expect(textOf(fixture)).toContain('list.page.productsWhy');
      expect(textOf(fixture)).not.toContain('list.page.productsTitle');
      expect(buttonWith(fixture, 'list.page.productsChange')).toBeNull();

      buttonWith(fixture, 'list.page.productsChoose')?.click();
      await drain(fixture);
      expect(router.navigateByUrl).toHaveBeenCalledWith(`${LINE_URL}/products`);
      expect(TestBed.inject(ProductPickStore).request()?.chosenIds).toEqual([]);
    });

    it('offers Change and Choose a product to a writer on an approved line (backend 0076)', async () => {
      const withProducts = await render({ permissions: WRITER });
      expect(
        buttonWith(withProducts.fixture, 'list.page.productsChange')
      ).not.toBeNull();

      const empty = await render({
        permissions: WRITER,
        lines: [line({ itemIds: [] })],
      });
      expect(
        buttonWith(empty.fixture, 'list.page.productsChoose')
      ).not.toBeNull();
    });

    it('offers neither Change nor Choose a product to a reader who may not edit', async () => {
      const withProducts = await render({ permissions: READER });
      expect(
        buttonWith(withProducts.fixture, 'list.page.productsChange')
      ).toBeNull();

      const empty = await render({
        permissions: READER,
        lines: [line({ itemIds: [] })],
      });
      expect(buttonWith(empty.fixture, 'list.page.productsChoose')).toBeNull();
      expect(textOf(empty.fixture)).toContain('list.page.productsNone');
    });
  });

  describe('the favourite', () => {
    it('makes the product of the pressed star the favourite', async () => {
      const { fixture, lines } = await render();

      stars(fixture)[1].click();
      await drain(fixture);

      expect(lines.calls.filter((call) => call.kind === 'update')).toEqual([
        { kind: 'update', lineId: LINE_ID, favoriteItemId: 'classic' },
      ]);
    });

    it('draws the favourite first with its star pressed, and clears it on a second press', async () => {
      const { fixture, lines } = await render({
        lines: [line({ favoriteItemId: 'classic' })],
      });

      const [first, second] = stars(fixture);
      expect(first.getAttribute('aria-pressed')).toBe('true');
      expect(second.getAttribute('aria-pressed')).toBe('false');
      expect(
        fixture.nativeElement.querySelector('lib-line-product-rail li')
          ?.textContent
      ).toContain('Classic care shampoo');

      first.click();
      await drain(fixture);

      expect(lines.calls.filter((call) => call.kind === 'update')).toEqual([
        { kind: 'update', lineId: LINE_ID, favoriteItemId: null },
      ]);
    });

    it('asks for the price of a favourite the line holds past the products it reads on opening', async () => {
      const others = Array.from({ length: 24 }, (_, index) => `other-${index}`);
      const { browse } = await render({
        lines: [
          line({ itemIds: [...others, 'classic'], favoriteItemId: 'classic' }),
        ],
      });

      const asked = browse.scopeOffers.mock.calls.map(([itemId]) => itemId);
      expect(asked).toContain('classic');
      expect(asked).not.toContain('other-23');
    });

    it('shows a reader the favourite as a mark, and no star to press', async () => {
      const { fixture } = await render({
        permissions: READER,
        lines: [line({ favoriteItemId: 'classic' })],
      });

      expect(stars(fixture)).toHaveLength(0);
      expect(
        fixture.nativeElement.querySelectorAll('.star.is-mark')
      ).toHaveLength(1);
    });
  });

  describe('the rows', () => {
    it('opens the supermarket sheet, the history page and the comments', async () => {
      const { fixture, router } = await render();

      buttonWith(fixture, 'list.page.supermarket')?.click();
      buttonWith(fixture, 'list.page.history')?.click();
      buttonWith(fixture, 'list.page.comments')?.click();
      await drain(fixture);

      expect(router.navigateByUrl.mock.calls.map(([url]) => url)).toEqual([
        `${LINE_URL}/sheet/supermarket`,
        `${LINE_URL}/history`,
        `${LINE_URL}/sheet/comments`,
      ]);
    });

    it('says Any with no supermarket, and the name with one', async () => {
      const any = await render();
      expect(textOf(any.fixture)).toContain('list.page.supermarketAny');

      const chosen = await render({
        lines: [line({ preferredSupermarketId: MERCADONA })],
      });
      expect(textOf(chosen.fixture)).toContain('Mercadona');
      expect(textOf(chosen.fixture)).not.toContain('list.page.supermarketAny');
    });

    it('does not let a reader open the supermarket sheet', async () => {
      const { fixture } = await render({ permissions: READER });

      expect(textOf(fixture)).toContain('list.page.supermarket');
      expect(buttonWith(fixture, 'list.page.supermarket')).toBeNull();
    });
  });

  describe('the three dots', () => {
    it('open the menu sheet', async () => {
      const { fixture, router } = await render();

      (
        fixture.nativeElement.querySelector(
          'button[libPageHeaderAction]'
        ) as HTMLButtonElement
      ).click();
      await drain(fixture);

      expect(router.navigateByUrl).toHaveBeenCalledWith(
        `${LINE_URL}/sheet/menu`
      );
    });

    it('are absent for a reader, whose menu would be empty', async () => {
      const { fixture } = await render({ permissions: READER });

      expect(
        fixture.nativeElement.querySelector('button[libPageHeaderAction]')
      ).toBeNull();
    });
  });

  describe('also on', () => {
    it('is absent when no other list wants a product', async () => {
      const { fixture } = await render();
      expect(textOf(fixture)).not.toContain('list.page.alsoOn');
    });

    it('lists the other lists as rows', async () => {
      const { fixture } = await render({
        alsoOn: {
          places: [{ listId: 'l2', listName: 'Party list', zoneName: 'Home' }],
          hasMore: true,
        },
      });

      expect(textOf(fixture)).toContain('list.page.alsoOn');
      expect(textOf(fixture)).toContain('Party list');
      expect(textOf(fixture)).toContain('list.page.alsoOnMore');
    });
  });

  describe('loading (section 4)', () => {
    it('reads the lines when nothing holds them, and draws the skeleton', async () => {
      const { fixture, lines } = await render({
        lines: [],
        linesState: 'idle',
      });

      expect(lines.loadCount()).toBe(1);
      expect(fixture.nativeElement.querySelector('.bones')).not.toBeNull();
      expect(
        fixture.nativeElement.querySelector('h1')?.textContent?.trim()
      ).toBe('line.title');
    });

    it('does not read lines the store already holds', async () => {
      const { lines } = await render();
      expect(lines.loadCount()).toBe(0);
    });

    it('says the line is gone on a list read to its end that does not hold it', async () => {
      const { fixture } = await render({ lines: [] });

      expect(textOf(fixture)).toContain('list.gone.unavailable');
      expect(buttonWith(fixture, 'list.page.toList')).not.toBeNull();
    });

    it('offers to try again when the read failed', async () => {
      const { fixture, lines } = await render({
        lines: [],
        linesState: 'failed',
      });

      buttonWith(fixture, 'list.page.retry')?.click();
      await drain(fixture);

      expect(textOf(fixture)).toContain('list.page.failed');
      expect(lines.loadCount()).toBe(1);
    });
  });

  /**
   * Velista 0156. A line of a list this reader may not read drew the generic failure
   * and a Try again that only asked to be refused again; a line of another list said
   * it was deleted.
   */
  describe('a line you cannot read (velista 0156)', () => {
    const forbidden = new GatewayError({
      code: 'forbidden',
      status: 403,
      correlationId: 'cid-403',
    });

    it('draws the not available sentence and a way back to the group, and no retry', async () => {
      const { fixture, router } = await render({
        lines: [],
        linesState: 'failed',
        linesError: forbidden,
      });

      expect(textOf(fixture)).toContain('list.error.notAvailable');
      expect(textOf(fixture)).not.toContain('list.page.failed');
      expect(buttonWith(fixture, 'list.page.retry')).toBeNull();

      buttonWith(fixture, 'list.header.back')?.click();
      await drain(fixture);

      expect(router.navigateByUrl).toHaveBeenCalledWith(
        `/velista/en/zones/${ZONE_ID}`,
        { replaceUrl: true }
      );
    });

    it('says the same on a 404, so the two cannot be told apart', async () => {
      const { fixture } = await render({
        lines: [],
        linesState: 'failed',
        linesError: new GatewayError({
          code: 'not_found',
          status: 404,
          correlationId: 'cid-404',
        }),
      });

      expect(textOf(fixture)).toContain('list.error.notAvailable');
      expect(buttonWith(fixture, 'list.page.retry')).toBeNull();
    });

    it('draws no sheet over a line it cannot read', async () => {
      const gone = await render({
        lines: [],
        linesState: 'failed',
        linesError: forbidden,
      });
      expect(
        gone.fixture.nativeElement.querySelector('router-outlet')
      ).toBeNull();

      const ready = await render();
      expect(
        ready.fixture.nativeElement.querySelector('router-outlet')
      ).not.toBeNull();
    });

    it('keeps the sheet that is open when another user deletes the line, so its notice is drawn', async () => {
      const { harness, lines } = await renderRouted(LINE_URL + '/sheet/delete');
      const page = harness.fixture.nativeElement as HTMLElement;
      expect(page.querySelector('lib-delete-line-sheet')).not.toBeNull();

      lines.deleteByOthers(LINE_ID);
      await drain(harness.fixture);

      expect(page.querySelector('router-outlet')).not.toBeNull();
      expect(page.querySelector('lib-delete-line-sheet')).not.toBeNull();
      expect(page.textContent).toContain('list.gone.byOthers');
    });

    it('says a line absent from a loaded list is no longer in this list, in both languages', async () => {
      const { fixture } = await render({ lines: [] });

      expect(textOf(fixture)).toContain('list.gone.unavailable');
      expect(buttonWith(fixture, 'list.page.toList')).not.toBeNull();

      // The testing translator echoes the key, so the words are read from the files.
      const i18n = join(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        'ui',
        'assets',
        'i18n'
      );
      const words = (locale: string): string =>
        JSON.parse(readFileSync(join(i18n, `${locale}.json`), 'utf8')).list.gone
          .unavailable;
      expect(words('en')).toBe('That line is no longer in this list');
      expect(words('es')).toBe('Esa línea ya no está en esta lista');
    });
  });
});
