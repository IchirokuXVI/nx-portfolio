import { signal, type Provider } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
  Router,
  type ParamMap,
} from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  CATALOG_BROWSE_SERVICE,
  CATALOG_SERVICE,
  CatalogAddStore,
  CatalogBrowseMemory,
  fakeCategoryStore,
  GroupMembers,
  ItemNames,
  LINE_SERVICE,
  LIST_SERVICE,
  MEMORY_CATEGORIES,
  provideFakeCategoryStore,
  SessionStore,
  ZONE_SERVICE,
  type FakeCategoryStore,
} from '@portfolio/velista/data-access';
import type {
  CatalogItem,
  CatalogPriceState,
  CatalogScopeOffer,
  ListPermission,
} from '@portfolio/velista/models';
import {
  PageNavigation,
  provideFakeBrowserFacade,
  provideVelistaTesting,
} from '@portfolio/velista/platform';
import { BehaviorSubject } from 'rxjs';
import { ProductPage } from './product-page';

const OIL: CatalogItem = {
  id: 'item-oil',
  name: { es: 'Aceite de oliva virgen extra', en: 'Extra virgin olive oil' },
  brand: 'Hacendado',
  size: 1,
  unit: 'LITER',
  productGroupId: null,
  categories: [
    {
      id: 'cat-oils',
      parentId: 'cat-oils-sauces-and-spices',
      slug: 'oils',
      name: { en: 'Oils', es: 'Aceites' },
    },
  ],
  offer: null,
  chainPrices: [],
  imageUrl: null,
  packCount: null,
  unitBasis: 'LITER',
};

const RICE: CatalogItem = {
  ...OIL,
  id: 'item-rice',
  name: { es: 'Arroz redondo', en: 'Short grain rice' },
  brand: 'SOS',
  unit: 'KILOGRAM',
  categories: [],
  unitBasis: 'KILOGRAM',
};

/** The oil as one of a group, and the two products it shares the group with. */
const GROUPED: CatalogItem = { ...OIL, productGroupId: 'group-oil' };
const CARBONELL: CatalogItem = {
  ...GROUPED,
  id: 'item-oil-other',
  name: { es: 'Aceite de oliva Carbonell', en: 'Carbonell olive oil' },
  brand: 'Carbonell',
};
const COOSUR: CatalogItem = {
  ...GROUPED,
  id: 'item-oil-third',
  name: { es: 'Aceite de oliva Coosur', en: 'Coosur olive oil' },
  brand: 'Coosur',
};

/** One list as the store reads it from the list service. */
interface FakeList {
  readonly id: string;
  readonly zoneId: string;
  readonly zoneName: string;
  readonly name: string;
  readonly wantedCount: number;
  readonly myPermissions: readonly ListPermission[];
}

const WEEKLY: FakeList = {
  id: 'list-weekly',
  zoneId: 'zone-home',
  zoneName: 'Home',
  name: 'Weekly shop',
  wantedCount: 14,
  myPermissions: ['READ', 'WRITE', 'MANAGE'],
};

interface Options {
  readonly state?: CatalogPriceState;
  /** Replaces the double's source rows. */
  readonly rows?: readonly CatalogScopeOffer[] | null;
  /** The products the catalog holds. The oil and the rice unless a test says. */
  readonly items?: readonly CatalogItem[];
  /** Replaces the read of the product, for a read that fails or never ends. */
  readonly itemsByIds?: jest.Mock;
  /** What the catalog answers for the product's group. */
  readonly similar?: readonly CatalogItem[];
  /** A guest, who has no list to add to. */
  readonly guest?: boolean;
  readonly tree?: FakeCategoryStore;
}

interface Harness {
  readonly fixture: ComponentFixture<ProductPage>;
  readonly pages: { back: jest.Mock };
  readonly itemsByIds: jest.Mock;
  /** The route's parameters, which a test moves as a navigation would. */
  readonly params: BehaviorSubject<ParamMap>;
  readonly lines: { addLineResult: jest.Mock };
}

/** Lets every pending promise run, then draws. */
async function settle(fixture: ComponentFixture<ProductPage>): Promise<void> {
  for (let tick = 0; tick < 20; tick++) {
    await Promise.resolve();
  }
  fixture.detectChanges();
}

/** The real `CatalogAddStore` over doubles of what it reads and writes. */
function fakeAdds(guest: boolean) {
  const lines = {
    addLineResult: jest.fn(
      async (
        listId: string,
        _content: string,
        quantity = 1,
        itemIds: readonly string[] = []
      ) => ({
        line: {
          id: `line-${listId}-${itemIds[0]}`,
          quantity,
          approvalStatus: 'APPROVED',
        },
        merged: false,
      })
    ),
    addQuantity: jest.fn(),
    deleteLine: jest.fn(),
  };
  const providers: Provider[] = [
    CatalogAddStore,
    provideFakeBrowserFacade(new Map()),
    { provide: SessionStore, useValue: { isGuest: signal(guest) } },
    {
      provide: ZONE_SERVICE,
      useValue: {
        listMyZones: async () => ({
          items: [
            { id: WEEKLY.zoneId, name: WEEKLY.zoneName, myStatus: 'APPROVED' },
          ],
          nextCursor: null,
        }),
      },
    },
    {
      provide: LIST_SERVICE,
      useValue: {
        listLists: async () => ({ items: [WEEKLY], nextCursor: null }),
      },
    },
    { provide: LINE_SERVICE, useValue: lines },
  ];
  return { lines, providers };
}

async function render(options: Options = {}): Promise<Harness> {
  TestBed.resetTestingModule();

  const memory = new CatalogBrowseMemory();
  memory.state = options.state ?? 'priced';
  if (options.rows !== undefined) {
    jest.spyOn(memory, 'scopeOffers').mockResolvedValue(options.rows);
  }
  const items = options.items ?? [OIL, RICE];
  const itemsByIds =
    options.itemsByIds ??
    jest.fn(async (ids: readonly string[]) =>
      items.filter((item) => ids.includes(item.id))
    );
  const pages = { back: jest.fn().mockResolvedValue(undefined) };
  const params = new BehaviorSubject<ParamMap>(
    convertToParamMap({ itemId: 'item-oil' })
  );
  const adds = fakeAdds(options.guest === true);

  await TestBed.configureTestingModule({
    imports: [ProductPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      provideRouter([]),
      provideFakeCategoryStore(
        options.tree ?? fakeCategoryStore(MEMORY_CATEGORIES)
      ),
      GroupMembers,
      ItemNames,
      ...adds.providers,
      { provide: CATALOG_BROWSE_SERVICE, useValue: memory },
      {
        provide: CATALOG_SERVICE,
        useValue: {
          itemsByIds,
          groupMembers: async () => options.similar ?? [],
        },
      },
      {
        provide: ActivatedRoute,
        useValue: { paramMap: params, snapshot: { paramMap: params.value } },
      },
      { provide: PageNavigation, useValue: pages },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(ProductPage);
  fixture.detectChanges();
  // The page loads in its constructor, which `whenStable` does not wait for.
  await settle(fixture);
  await settle(fixture);

  return { fixture, pages, itemsByIds, params, lines: adds.lines };
}

function host(fixture: ComponentFixture<ProductPage>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function text(fixture: ComponentFixture<ProductPage>): string {
  return host(fixture).textContent ?? '';
}

function title(fixture: ComponentFixture<ProductPage>): string {
  return (
    host(fixture).querySelector('lib-page-header h1')?.textContent?.trim() ?? ''
  );
}

/** The price table, one string for each row, its parts in the order drawn. */
function prices(fixture: ComponentFixture<ProductPage>): string[] {
  return [...host(fixture).querySelectorAll('lib-price-table .row')].map(
    (row) =>
      [...row.querySelectorAll('.chain, .cheapest, .amount, .unit, .absent')]
        .map((part) => (part.textContent ?? '').trim())
        .join(' ')
  );
}

/** The similar products, as the rows the catalog draws. */
function similar(fixture: ComponentFixture<ProductPage>): HTMLElement[] {
  return [
    ...host(fixture).querySelectorAll<HTMLElement>('.rows lib-product-row'),
  ];
}

/** The words of the category link, without the glyph the icon double draws. */
function categoryLabel(link: HTMLAnchorElement | null): string {
  return [...(link?.childNodes ?? [])]
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent ?? '')
    .join('')
    .trim();
}

function navigateSpy(): jest.SpyInstance {
  return jest
    .spyOn(TestBed.inject(Router), 'navigateByUrl')
    .mockResolvedValue(true);
}

describe('ProductPage', () => {
  describe('its four states (velista 0134, section 5)', () => {
    it('draws bones in the shape of the product and the prices while the read is out', async () => {
      const { fixture } = await render({
        itemsByIds: jest.fn(() => new Promise(() => undefined)),
      });

      const status = host(fixture).querySelector('.page [role="status"]');
      expect(status?.getAttribute('aria-live')).toBe('polite');
      expect(status?.textContent).toContain('catalog.product.loading');
      expect(host(fixture).querySelectorAll('.bone').length).toBeGreaterThan(0);
      expect(host(fixture).querySelectorAll('.bone-row')).toHaveLength(3);
      expect(host(fixture).querySelector('lib-price-table')).toBeNull();
      // H6: the header never loads. It says the word for the kind of page.
      expect(title(fixture)).toBe('catalog.product.title');
    });

    it('draws the product once it is read: the name, the brand and the size', async () => {
      const { fixture, itemsByIds } = await render();

      expect(itemsByIds).toHaveBeenCalledWith(['item-oil']);
      expect(title(fixture)).toBe('Extra virgin olive oil');
      // The name again, whole, because the header cuts a long one to a line.
      expect(
        host(fixture).querySelector('.about-name')?.textContent?.trim()
      ).toBe('Extra virgin olive oil');
      expect(
        host(fixture).querySelector('.about-detail')?.textContent
      ).toContain('Hacendado');
      expect(host(fixture).querySelector('.bone')).toBeNull();
      expect(host(fixture).querySelector('[role="alert"]')).toBeNull();
      expect(host(fixture).querySelectorAll('h1')).toHaveLength(1);
    });

    it('says a failed read and reads again from Try again', async () => {
      const itemsByIds = jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValue([OIL]);
      const { fixture } = await render({ itemsByIds });

      const alert = host(fixture).querySelector('[role="alert"]');
      expect(alert?.textContent).toContain('catalog.product.failedTitle');
      expect(title(fixture)).toBe('catalog.product.title');
      expect(host(fixture).querySelector('lib-price-table')).toBeNull();

      const retry = alert?.querySelector<HTMLButtonElement>('button');
      expect(retry?.textContent).toContain('catalog.error.retry');
      retry?.click();
      await settle(fixture);

      expect(itemsByIds).toHaveBeenCalledTimes(2);
      expect(host(fixture).querySelector('[role="alert"]')).toBeNull();
      expect(title(fixture)).toBe('Extra virgin olive oil');
      expect(prices(fixture)).toHaveLength(3);
    });

    it('says the prices did not load rather than drawing an empty table', async () => {
      const { fixture } = await render({ rows: null });

      expect(
        host(fixture).querySelector('[role="alert"]')?.textContent
      ).toContain('catalog.product.failedTitle');
      expect(host(fixture).querySelector('lib-price-table')).toBeNull();
    });

    it('says a product is gone and offers the catalog, not Try again', async () => {
      const { fixture } = await render({ items: [] });

      expect(text(fixture)).toContain('catalog.product.goneTitle');
      expect(text(fixture)).toContain('catalog.product.goneBody');
      expect(host(fixture).querySelector('[role="alert"]')).toBeNull();
      expect(host(fixture).querySelector('.state button')).toBeNull();

      const link = host(fixture).querySelector<HTMLAnchorElement>('.state a');
      expect(link?.textContent).toContain('catalog.product.toCatalog');
      expect(link?.getAttribute('href')).toBe('/velista/en/catalog');
    });
  });

  it('goes back one step, with the catalog as the fallback', async () => {
    const { fixture, pages } = await render();

    const back = host(fixture).querySelector<HTMLButtonElement>(
      'lib-page-header button.lead'
    );
    expect(back?.getAttribute('aria-label')).toBe('catalog.product.back');
    back?.click();

    expect(pages.back).toHaveBeenCalledTimes(1);
    expect(pages.back).toHaveBeenCalledWith('/velista/en/catalog');
  });

  describe('the price at each supermarket', () => {
    it('lists every chain near the person, cheapest first, with CHEAPEST on the first priced row', async () => {
      const { fixture } = await render();

      expect(prices(fixture)).toEqual([
        'Mercadona catalog.product.cheapest €8.45 catalog.unit.LITER',
        'Deza €8.95 catalog.unit.LITER',
        'Carrefour catalog.product.notSold',
      ]);
      expect(host(fixture).querySelectorAll('.cheapest')).toHaveLength(1);
    });

    it('says a chain does not sell it rather than leaving the row blank', async () => {
      const { fixture } = await render();

      const absent = [
        ...host(fixture).querySelectorAll('lib-price-table .row.is-absent'),
      ];
      expect(absent).toHaveLength(1);
      expect(absent[0]?.textContent).toContain('Carrefour');
      expect(absent[0]?.textContent).toContain('catalog.product.notSold');
    });

    it('moves CHEAPEST to the next priced row when the first chain has none on offer', async () => {
      const real =
        (await new CatalogBrowseMemory().scopeOffers('item-oil')) ?? [];
      const { fixture } = await render({
        rows: real.map((row) =>
          row.offer.priceScopeId === 'scope-chain-mercadona'
            ? { ...row, available: false }
            : row
        ),
      });

      expect(prices(fixture)).toEqual([
        'Deza catalog.product.cheapest €8.95 catalog.unit.LITER',
        'Mercadona catalog.product.notSold',
        'Carrefour catalog.product.notSold',
      ]);
    });

    it('draws the unit price under each price, and none for a product with no basis', async () => {
      const priced = await render();
      const price = host(priced.fixture).querySelector(
        'lib-price-table .price'
      );
      expect(price?.querySelector('.amount')?.textContent?.trim()).toBe(
        '€8.45'
      );
      expect(
        price?.querySelector('.amount')?.nextElementSibling?.textContent?.trim()
      ).toBe('catalog.unit.LITER');

      const plain = await render({ items: [{ ...OIL, unitBasis: null }] });
      expect(
        host(plain.fixture).querySelector('lib-price-table .unit')
      ).toBeNull();
      expect(prices(plain.fixture)[0]).toBe(
        'Mercadona catalog.product.cheapest €8.45'
      );
    });

    it('says when the prices were seen, under the table', async () => {
      const { fixture } = await render();

      const note = host(fixture).querySelector('lib-price-table + .note');
      expect(note?.textContent).toContain('catalog.product.seen');
    });

    it('draws the note with its action, and no table, for somebody with no shopping place', async () => {
      const { fixture } = await render({ state: 'noPlace' });

      expect(host(fixture).querySelector('lib-price-table')).toBeNull();
      expect(text(fixture)).toContain('catalog.product.noShops');
      expect(text(fixture)).not.toContain('catalog.product.seen');

      const action =
        host(fixture).querySelector<HTMLAnchorElement>('.state.is-start a');
      expect(action?.textContent).toContain('catalog.noScope.add');
      expect(action?.getAttribute('href')).toBe('/velista/en/account/profiles');
      // The product itself is still drawn.
      expect(title(fixture)).toBe('Extra virgin olive oil');
    });
  });

  describe('the category link', () => {
    it('names the root and the leaf, and opens the catalog at that category', async () => {
      const { fixture } = await render();

      const link =
        host(fixture).querySelector<HTMLAnchorElement>('a.about-category');
      expect(categoryLabel(link)).toBe('Oils, sauces and spices · Oils');
      expect(link?.getAttribute('href')).toBe(
        '/velista/en/catalog?category=oils'
      );
    });

    it('names the leaf alone until the tree is read', async () => {
      const { fixture } = await render({ tree: fakeCategoryStore() });

      const link =
        host(fixture).querySelector<HTMLAnchorElement>('a.about-category');
      expect(categoryLabel(link)).toBe('Oils');
      expect(link?.getAttribute('href')).toBe(
        '/velista/en/catalog?category=oils'
      );
    });

    it('draws none for a product the catalog files nowhere', async () => {
      const { fixture } = await render({
        items: [{ ...OIL, categories: [] }],
      });

      expect(host(fixture).querySelector('a.about-category')).toBeNull();
    });
  });

  describe('similar products', () => {
    const group = { items: [GROUPED], similar: [GROUPED, CARBONELL, COOSUR] };

    it('lists the other products of the group as rows, each with the plus', async () => {
      const { fixture } = await render(group);

      // The product itself is never its own sibling.
      expect(similar(fixture)).toHaveLength(2);
      expect(similar(fixture)[0]?.textContent).toContain('Carbonell olive oil');
      expect(similar(fixture)[1]?.textContent).toContain('Coosur olive oil');
      for (const row of similar(fixture)) {
        expect(row.querySelector('button.add')).not.toBeNull();
      }
      expect(text(fixture)).toContain('catalog.similar.title');
    });

    it('says in the heading which list the plus adds to, with no count', async () => {
      const { fixture } = await render(group);

      const bar = host(fixture).querySelector('.similar-head lib-adding-bar');
      expect(bar?.classList.contains('is-compact')).toBe(true);
      expect(bar?.querySelector('.list-name')?.textContent?.trim()).toBe(
        'Weekly shop'
      );

      similar(fixture)[0]
        ?.querySelector<HTMLButtonElement>('button.add')
        ?.click();
      await settle(fixture);
      expect(bar?.querySelector('[data-adding="count"]')).toBeNull();
    });

    it('draws the rows with no plus and no list for somebody with nowhere to add', async () => {
      const { fixture } = await render({ ...group, guest: true });

      expect(similar(fixture)).toHaveLength(2);
      expect(
        host(fixture).querySelector('lib-product-row button.add')
      ).toBeNull();
      expect(host(fixture).querySelector('lib-adding-bar')).toBeNull();
    });

    it('adds one of a similar product to the chosen list from its plus', async () => {
      const { fixture, lines } = await render(group);
      const add = jest.spyOn(TestBed.inject(CatalogAddStore), 'add');

      similar(fixture)[0]
        ?.querySelector<HTMLButtonElement>('button.add')
        ?.click();
      await settle(fixture);

      expect(add).toHaveBeenCalledWith(
        expect.objectContaining({
          itemId: 'item-oil-other',
          name: 'Carbonell olive oil',
        })
      );
      expect(lines.addLineResult).toHaveBeenCalledWith(
        'list-weekly',
        'Carbonell olive oil',
        1,
        ['item-oil-other']
      );
      // What this page adds joins the record of the visit.
      expect(TestBed.inject(CatalogAddStore).count()).toBe(1);
      expect(
        similar(fixture)[0]
          ?.querySelector('button.add.has-count')
          ?.textContent?.trim()
      ).toBe('1');
    });

    it('opens the page of a similar product when its row is pressed', async () => {
      const { fixture } = await render(group);
      const navigate = navigateSpy();

      similar(fixture)[0]
        ?.querySelector<HTMLButtonElement>('button.open')
        ?.click();

      expect(navigate).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledWith(
        '/velista/en/catalog/products/item-oil-other'
      );
    });

    it('opens the sheet of lists over this page from the heading', async () => {
      const { fixture } = await render(group);
      const navigate = navigateSpy();

      host(fixture)
        .querySelector<HTMLButtonElement>(
          '.similar-head lib-adding-bar [data-adding="list"]'
        )
        ?.click();

      expect(navigate).toHaveBeenCalledWith(
        '/velista/en/catalog/products/item-oil/sheet/add-list'
      );
    });

    it('draws nothing for a product with no group', async () => {
      const { fixture } = await render();

      expect(similar(fixture)).toHaveLength(0);
      expect(text(fixture)).not.toContain('catalog.similar.title');
      expect(host(fixture).querySelector('lib-adding-bar')).toBeNull();
    });

    it('draws no heading for a group with nothing else in it', async () => {
      const { fixture } = await render({
        items: [GROUPED],
        similar: [GROUPED],
      });

      expect(similar(fixture)).toHaveLength(0);
      expect(text(fixture)).not.toContain('catalog.similar.title');
    });
  });

  it('follows the route to another product, because the router reuses the page', async () => {
    const { fixture, itemsByIds, params } = await render();
    expect(title(fixture)).toBe('Extra virgin olive oil');

    params.next(convertToParamMap({ itemId: 'item-rice' }));
    await settle(fixture);

    expect(itemsByIds).toHaveBeenLastCalledWith(['item-rice']);
    expect(title(fixture)).toBe('Short grain rice');
    expect(
      host(fixture).querySelector('.about-name')?.textContent?.trim()
    ).toBe('Short grain rice');
    // The rice's own prices: three chains, Deza the cheapest.
    expect(prices(fixture)[0]).toBe(
      'Deza catalog.product.cheapest €1.29 catalog.unit.KILOGRAM'
    );
    expect(prices(fixture)).toHaveLength(3);
  });

  it('reads once for the same product named again', async () => {
    const { fixture, itemsByIds, params } = await render();

    params.next(convertToParamMap({ itemId: 'item-oil' }));
    await settle(fixture);

    expect(itemsByIds).toHaveBeenCalledTimes(1);
  });
});
