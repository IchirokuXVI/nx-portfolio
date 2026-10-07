import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
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
  MEMORY_CATEGORIES,
  provideFakeCategoryStore,
  type FakeCategoryStore,
} from '@portfolio/velista/data-access';
import type {
  CatalogItem,
  CatalogPriceState,
  CatalogScopeOffer,
} from '@portfolio/velista/models';
import {
  PageNavigation,
  provideVelistaTesting,
  StorageKeys,
} from '@portfolio/velista/platform';
import { PriceHistory } from '@portfolio/velista/ui';
import { BehaviorSubject } from 'rxjs';
import {
  fakeAdds,
  WEEKLY,
  type FakeAdds,
  type FakeAddsOptions,
  type FakeLine,
  type FakeList,
} from '../catalog-adds.testing';
import { ProductPage } from './product-page';

const DAY_MS = 24 * 60 * 60 * 1000;

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

/** A second list of the same group, and two lists of another group. */
const PARTY: FakeList = { ...WEEKLY, id: 'list-party', name: 'Party' };
const CLEANING: FakeList = {
  ...WEEKLY,
  id: 'list-cleaning',
  zoneId: 'zone-flat',
  zoneName: 'Flat',
  name: 'Cleaning',
};
/** A list the person only reads. */
const ROTA: FakeList = {
  ...CLEANING,
  id: 'list-rota',
  name: 'Rota',
  myPermissions: ['READ'],
};

/** The oil under its own name, two of it, as the weekly shop held it before. */
const OIL_LINE: FakeLine = {
  id: 'line-oil',
  listId: 'list-weekly',
  content: 'Extra virgin olive oil',
  quantity: 2,
  itemIds: ['item-oil'],
};

/** The same product again, under a name somebody typed. */
const FRYING_LINE: FakeLine = {
  id: 'line-frying',
  listId: 'list-weekly',
  content: 'Oil for frying',
  quantity: 1,
  itemIds: ['item-oil'],
};

interface Options extends FakeAddsOptions {
  readonly state?: CatalogPriceState;
  /** Replaces the double's source rows. */
  readonly rows?: readonly CatalogScopeOffer[] | null;
  /** The products the catalog holds. The oil and the rice unless a test says. */
  readonly items?: readonly CatalogItem[];
  /** Replaces the read of the product, for a read that fails or never ends. */
  readonly itemsByIds?: jest.Mock;
  /** What the catalog answers for the product's group. */
  readonly similar?: readonly CatalogItem[];
  readonly tree?: FakeCategoryStore;
  /**
   * Called with the spy on the read of the price history before the page is
   * made, so a test can make the first read fail or never answer.
   */
  readonly history?: (read: jest.SpyInstance) => void;
}

interface Harness {
  readonly fixture: ComponentFixture<ProductPage>;
  readonly pages: { back: jest.Mock };
  readonly itemsByIds: jest.Mock;
  /** The route's parameters, which a test moves as a navigation would. */
  readonly params: BehaviorSubject<ParamMap>;
  /** The line service double the store reads and writes through. */
  readonly lines: FakeAdds['lines'];
  /** The read of the price history, on the double that answers it. */
  readonly history: jest.SpyInstance;
  readonly store: CatalogAddStore;
}

/** Lets every pending promise run, then draws. */
async function settle(fixture: ComponentFixture<ProductPage>): Promise<void> {
  for (let tick = 0; tick < 20; tick++) {
    await Promise.resolve();
  }
  fixture.detectChanges();
}

async function render(options: Options = {}): Promise<Harness> {
  TestBed.resetTestingModule();

  const memory = new CatalogBrowseMemory();
  memory.state = options.state ?? 'priced';
  if (options.rows !== undefined) {
    jest.spyOn(memory, 'scopeOffers').mockResolvedValue(options.rows);
  }
  const history = jest.spyOn(memory, 'priceHistory');
  options.history?.(history);
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
  const adds = fakeAdds(options);

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

  return {
    fixture,
    pages,
    itemsByIds,
    params,
    lines: adds.lines,
    history,
    store: TestBed.inject(CatalogAddStore),
  };
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

/** The section "How the price has moved", or null when the page draws none. */
function historySection(
  fixture: ComponentFixture<ProductPage>
): HTMLElement | null {
  return (
    host(fixture)
      .querySelector('#product-history-title')
      ?.closest<HTMLElement>('section') ?? null
  );
}

/** The chart, as the component the page hands its lines to. */
function chart(fixture: ComponentFixture<ProductPage>): PriceHistory {
  return fixture.debugElement.query(By.directive(PriceHistory))
    .componentInstance as PriceHistory;
}

function rangeButton(
  fixture: ComponentFixture<ProductPage>,
  range: string
): HTMLButtonElement | null {
  return host(fixture).querySelector<HTMLButtonElement>(
    `lib-price-history [data-range="${range}"]`
  );
}

/** The section "In your lists" once it has a heading, or null. */
function listsSection(
  fixture: ComponentFixture<ProductPage>
): HTMLElement | null {
  return (
    host(fixture)
      .querySelector('#product-lists-title')
      ?.closest<HTMLElement>('section') ?? null
  );
}

/** A stepper as a test reads and presses it. */
interface DrawnStepper {
  readonly quantity: string | null;
  readonly minus: HTMLButtonElement | null;
  readonly plus: HTMLButtonElement | null;
}

function stepperIn(scope: Element | null | undefined): DrawnStepper | null {
  const stepper = scope?.querySelector('lib-quantity-stepper') ?? null;
  if (stepper === null) {
    return null;
  }
  const steps = stepper.querySelectorAll<HTMLButtonElement>('button.step');
  return {
    quantity:
      stepper
        .querySelector('[role="spinbutton"]')
        ?.getAttribute('aria-valuenow') ?? null,
    minus: steps[0] ?? null,
    plus: steps[1] ?? null,
  };
}

/** One list of the table: its row, and the stepper of the line under the product's name. */
function listRow(
  fixture: ComponentFixture<ProductPage>,
  listId: string
): { readonly row: HTMLElement | null; readonly main: DrawnStepper | null } {
  const row = host(fixture).querySelector<HTMLElement>(
    `lib-lists-table li[data-list="${listId}"]`
  );
  return { row, main: stepperIn(row?.querySelector('.row')) };
}

/** A line that holds the product under another name, on its own inset row. */
function otherLine(
  fixture: ComponentFixture<ProductPage>,
  lineId: string
): {
  readonly row: HTMLElement | null;
  readonly stepper: DrawnStepper | null;
} {
  const row = host(fixture).querySelector<HTMLElement>(
    `lib-lists-table .other[data-line="${lineId}"]`
  );
  return { row, stepper: stepperIn(row) };
}

/** The sentence a failed write raises, or blank. */
function addFailed(fixture: ComponentFixture<ProductPage>): string {
  return host(fixture).querySelector('.add-failed')?.textContent?.trim() ?? '';
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
      // Neither later section is drawn, or read, before the product is.
      expect(historySection(fixture)).toBeNull();
      expect(host(fixture).querySelector('lib-lists-table')).toBeNull();
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
      expect(host(fixture).querySelector('.bone-row')).toBeNull();
      expect(host(fixture).querySelector('[role="alert"]')).toBeNull();
      expect(host(fixture).querySelectorAll('h1')).toHaveLength(1);
    });

    it('draws its sections in the order of the plan: the prices, the history, the lists, similar products', async () => {
      const { fixture } = await render({
        items: [GROUPED],
        similar: [GROUPED, CARBONELL],
      });

      expect(
        [...host(fixture).querySelectorAll('.page h2')].map(
          (heading) => heading.id
        )
      ).toEqual([
        'product-prices-title',
        'product-history-title',
        'product-lists-title',
        'product-similar-title',
      ]);
    });

    it('says a failed read and reads again from Try again', async () => {
      const itemsByIds = jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValue([OIL]);
      const { fixture, history, lines } = await render({ itemsByIds });

      const alert = host(fixture).querySelector('[role="alert"]');
      expect(alert?.textContent).toContain('catalog.product.failedTitle');
      expect(title(fixture)).toBe('catalog.product.title');
      expect(host(fixture).querySelector('lib-price-table')).toBeNull();
      // A page that did not load asks for neither of its later sections.
      expect(history).not.toHaveBeenCalled();
      expect(lines.linesHoldingItem).not.toHaveBeenCalled();

      const retry = alert?.querySelector<HTMLButtonElement>('button');
      expect(retry?.textContent).toContain('catalog.error.retry');
      retry?.click();
      await settle(fixture);

      expect(itemsByIds).toHaveBeenCalledTimes(2);
      expect(host(fixture).querySelector('[role="alert"]')).toBeNull();
      expect(title(fixture)).toBe('Extra virgin olive oil');
      expect(prices(fixture)).toHaveLength(3);
      expect(history).toHaveBeenCalledTimes(1);
      expect(lines.linesHoldingItem).toHaveBeenCalledTimes(1);
    });

    it('says the prices did not load rather than drawing an empty table', async () => {
      const { fixture } = await render({ rows: null });

      expect(
        host(fixture).querySelector('[role="alert"]')?.textContent
      ).toContain('catalog.product.failedTitle');
      expect(host(fixture).querySelector('lib-price-table')).toBeNull();
    });

    it('says a product is gone and offers the catalog, not Try again', async () => {
      const { fixture, history, lines } = await render({ items: [] });

      expect(text(fixture)).toContain('catalog.product.goneTitle');
      expect(text(fixture)).toContain('catalog.product.goneBody');
      expect(host(fixture).querySelector('[role="alert"]')).toBeNull();
      expect(host(fixture).querySelector('.state button')).toBeNull();

      const link = host(fixture).querySelector<HTMLAnchorElement>('.state a');
      expect(link?.textContent).toContain('catalog.product.toCatalog');
      expect(link?.getAttribute('href')).toBe('/velista/en/catalog');
      // There is no product to have a history, or to be on a list.
      expect(history).not.toHaveBeenCalled();
      expect(lines.linesHoldingItem).not.toHaveBeenCalled();
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

  describe('how the price has moved (velista 0134, section 6)', () => {
    it('draws bones for the history while its read is out, under prices that are already there', async () => {
      const { fixture } = await render({
        history: (read) =>
          read.mockImplementation(() => new Promise(() => undefined)),
      });

      const section = historySection(fixture);
      expect(section?.querySelector('h2')?.textContent).toContain(
        'catalog.history.title'
      );
      const bones = section?.querySelector('.skeleton.is-inline');
      expect(bones?.getAttribute('aria-hidden')).toBe('true');
      expect(bones?.querySelectorAll('.bone-row')).toHaveLength(2);
      expect(section?.querySelector('lib-price-history')).toBeNull();
      expect(section?.querySelector('[role="alert"]')).toBeNull();
      // The read does not hold the page back: the prices and the lists are drawn.
      expect(prices(fixture)).toHaveLength(3);
      expect(host(fixture).querySelector('lib-lists-table')).not.toBeNull();
      // After the price table, which is the chart's table view.
      expect(
        section?.previousElementSibling?.querySelector('lib-price-table')
      ).not.toBeNull();
    });

    it('reads one year of the product, once', async () => {
      const { history } = await render();

      expect(history).toHaveBeenCalledTimes(1);
      const [itemId, from, to] = history.mock.calls[0] as [string, Date, Date];
      expect(itemId).toBe('item-oil');
      expect(to.getTime() - from.getTime()).toBe(365 * DAY_MS);
      expect(Math.abs(to.getTime() - Date.now())).toBeLessThan(60_000);
    });

    it('says the history did not load, alone, and reads it again from Try again', async () => {
      const { fixture, history, itemsByIds } = await render({
        history: (read) => read.mockResolvedValueOnce(null),
      });

      const alert = historySection(fixture)?.querySelector('[role="alert"]');
      expect(alert?.textContent).toContain('catalog.history.failed');
      expect(
        historySection(fixture)?.querySelector('lib-price-history')
      ).toBeNull();
      // It fails alone: the page, its prices and its lists are all still there.
      expect(host(fixture).querySelectorAll('[role="alert"]')).toHaveLength(1);
      expect(title(fixture)).toBe('Extra virgin olive oil');
      expect(prices(fixture)).toHaveLength(3);
      expect(host(fixture).querySelector('lib-lists-table')).not.toBeNull();

      const retry = alert?.querySelector<HTMLButtonElement>('button');
      expect(retry?.textContent).toContain('catalog.error.retry');
      retry?.click();
      await settle(fixture);

      expect(history).toHaveBeenCalledTimes(2);
      expect(history).toHaveBeenLastCalledWith(
        'item-oil',
        expect.any(Date),
        expect.any(Date)
      );
      // Only the history was read again.
      expect(itemsByIds).toHaveBeenCalledTimes(1);
      expect(host(fixture).querySelector('[role="alert"]')).toBeNull();
      expect(
        historySection(fixture)?.querySelector('lib-price-history')
      ).not.toBeNull();
    });

    it('hands the chart one line for each chain that has a history, named, cheapest today first', async () => {
      const { fixture } = await render();

      // Carrefour does not sell the oil, so it has no line.
      const lines = chart(fixture).lines();
      expect(lines.map((line) => line.id)).toEqual([
        'chain-mercadona',
        'chain-deza',
      ]);
      expect(lines.map((line) => line.name)).toEqual(['Mercadona', 'Deza']);
      // A colour belongs to a chain: the slots follow the chain ids, not the prices.
      expect(lines.map((line) => line.slot)).toEqual([1, 0]);
      expect(chart(fixture).product()).toBe('Extra virgin olive oil');
      expect(chart(fixture).currency()).toBe('EUR');
      expect(chart(fixture).locale()).toBe('en');

      const drawn = historySection(fixture);
      expect(drawn?.querySelectorAll('svg path.line')).toHaveLength(2);
      expect(
        [...(drawn?.querySelectorAll('.legend [data-chain]') ?? [])].map(
          (entry) => entry.querySelector('.entry-name')?.textContent?.trim()
        )
      ).toEqual(['Mercadona', 'Deza']);
      expect(drawn?.querySelector('svg')?.getAttribute('aria-label')).toBe(
        'catalog.history.chart.quarter'
      );
    });

    it('opens on three months, and redraws another range without a second read', async () => {
      const { fixture, history } = await render();
      const span = () => chart(fixture).to() - chart(fixture).from();

      expect(chart(fixture).range()).toBe('quarter');
      expect(
        rangeButton(fixture, 'quarter')?.getAttribute('aria-pressed')
      ).toBe('true');
      expect(span()).toBe(91 * DAY_MS);
      // The price at the start of the window, and the two moves inside it.
      expect(chart(fixture).lines()[0]?.steps).toHaveLength(3);

      rangeButton(fixture, 'month')?.click();
      fixture.detectChanges();

      expect(chart(fixture).range()).toBe('month');
      expect(span()).toBe(30 * DAY_MS);
      expect(rangeButton(fixture, 'month')?.getAttribute('aria-pressed')).toBe(
        'true'
      );
      expect(
        rangeButton(fixture, 'quarter')?.getAttribute('aria-pressed')
      ).toBe('false');
      // Cut from the year that was read: one move is left in a month.
      expect(
        chart(fixture)
          .lines()
          .map((line) => line.id)
      ).toEqual(['chain-mercadona', 'chain-deza']);
      expect(chart(fixture).lines()[0]?.steps).toHaveLength(2);
      expect(
        historySection(fixture)
          ?.querySelector('svg')
          ?.getAttribute('aria-label')
      ).toBe('catalog.history.chart.month');

      rangeButton(fixture, 'year')?.click();
      fixture.detectChanges();

      expect(span()).toBe(365 * DAY_MS);
      expect(chart(fixture).lines()[0]?.steps).toHaveLength(3);
      await settle(fixture);
      expect(history).toHaveBeenCalledTimes(1);
    });

    it('says one sentence and draws no chart for a product whose price was never seen to move', async () => {
      const { fixture } = await render({
        history: (read) =>
          read.mockImplementation(
            async (_itemId: string, from: Date, to: Date) => ({
              from,
              to,
              series: [],
            })
          ),
      });

      const section = historySection(fixture);
      expect(section?.querySelector('.none')?.textContent).toContain(
        'catalog.history.none.quarter'
      );
      expect(section?.querySelector('svg')).toBeNull();
      expect(section?.querySelector('[role="alert"]')).toBeNull();
      // A longer range may hold a movement the shorter one does not.
      expect(section?.querySelectorAll('[data-range]')).toHaveLength(3);
    });

    it('draws no history, and asks for none, for somebody with no shopping place', async () => {
      const { fixture, history } = await render({ state: 'noPlace' });

      expect(historySection(fixture)).toBeNull();
      expect(text(fixture)).not.toContain('catalog.history.title');
      expect(host(fixture).querySelector('lib-price-history')).toBeNull();
      expect(history).not.toHaveBeenCalled();
    });

    it('reads the history of the next product when the route moves to it', async () => {
      const { fixture, history, params } = await render();

      params.next(convertToParamMap({ itemId: 'item-rice' }));
      await settle(fixture);

      expect(history).toHaveBeenCalledTimes(2);
      expect(history.mock.calls[1]?.[0]).toBe('item-rice');
      // The rice is sold by all three chains, Deza the cheapest today.
      expect(
        chart(fixture)
          .lines()
          .map((line) => line.id)
      ).toEqual(['chain-deza', 'chain-mercadona', 'chain-carrefour']);
      expect(chart(fixture).product()).toBe('Short grain rice');
    });
  });

  describe('in your lists (velista 0134, section 7)', () => {
    it('draws every list the person can read under its group, the last used list and its group first', async () => {
      const { fixture, lines } = await render({
        lists: [WEEKLY, PARTY, CLEANING, ROTA],
        storage: new Map([[StorageKeys.lastList, 'zone-flat/list-cleaning']]),
      });

      expect(lines.linesHoldingItem).toHaveBeenCalledTimes(1);
      expect(lines.linesHoldingItem).toHaveBeenCalledWith('item-oil');
      expect(listsSection(fixture)?.querySelector('h2')?.textContent).toContain(
        'catalog.inLists.title'
      );
      const drawn = [
        ...host(fixture).querySelectorAll(
          'lib-lists-table .group, lib-lists-table li[data-list]'
        ),
      ].map((row) =>
        row.classList.contains('group')
          ? `# ${row.textContent?.trim()}`
          : (row.querySelector('.name')?.textContent?.trim() ?? '')
      );
      expect(drawn).toEqual([
        '# Flat',
        'Cleaning',
        'Rota',
        '# Home',
        'Weekly shop',
        'Party',
      ]);
      expect(
        host(fixture).querySelectorAll('lib-lists-table .last')
      ).toHaveLength(1);
      expect(
        listRow(fixture, 'list-cleaning').row?.querySelector('.last')
          ?.textContent
      ).toContain('catalog.inLists.last');

      // No list holds the oil yet, so every stepper starts at zero.
      for (const listId of ['list-cleaning', 'list-weekly', 'list-party']) {
        expect(listRow(fixture, listId).main?.quantity).toBe('0');
        expect(listRow(fixture, listId).main?.minus?.disabled).toBe(true);
      }
      // A list the person only reads has no stepper and says so.
      const rota = listRow(fixture, 'list-rota');
      expect(rota.main).toBeNull();
      expect(rota.row?.textContent).toContain('catalog.inLists.readOnly');
    });

    it('marks the list the plus of the catalog adds to when nothing was used before', async () => {
      const { fixture } = await render({ lists: [WEEKLY, PARTY] });

      expect(
        listRow(fixture, 'list-weekly').row?.querySelector('.last')
      ).not.toBeNull();
      expect(
        listRow(fixture, 'list-party').row?.querySelector('.last')
      ).toBeNull();
    });

    it('draws no table for a guest, who has no lists and is asked for none', async () => {
      const { fixture, lines } = await render({ guest: true });

      // The rest of the page is the guest's too.
      expect(prices(fixture)).toHaveLength(3);
      expect(historySection(fixture)).not.toBeNull();
      expect(listsSection(fixture)).toBeNull();
      expect(host(fixture).querySelector('lib-lists-table')).toBeNull();
      expect(text(fixture)).not.toContain('catalog.inLists.title');
      expect(host(fixture).querySelector('.bone-row')).toBeNull();
      expect(host(fixture).querySelector('[role="alert"]')).toBeNull();
      expect(lines.linesHoldingItem).not.toHaveBeenCalled();
    });

    it('draws no table, and no failure, for a person with no list at all', async () => {
      const { fixture, lines } = await render({ lists: [] });

      expect(lines.linesHoldingItem).toHaveBeenCalledTimes(1);
      expect(listsSection(fixture)).toBeNull();
      expect(host(fixture).querySelector('lib-lists-table')).toBeNull();
      expect(host(fixture).querySelector('[role="alert"]')).toBeNull();
    });

    it('draws bones for the lists while their read is out', async () => {
      const { fixture } = await render({
        arm: ({ lines }) =>
          lines.linesHoldingItem.mockImplementation(
            () => new Promise(() => undefined)
          ),
      });

      const bones = host(fixture).querySelector(
        'section.section[aria-hidden="true"] .skeleton.is-inline'
      );
      expect(bones?.querySelectorAll('.bone-row')).toHaveLength(2);
      expect(listsSection(fixture)).toBeNull();
      expect(host(fixture).querySelector('lib-lists-table')).toBeNull();
      // The read does not hold the page back.
      expect(prices(fixture)).toHaveLength(3);
      expect(host(fixture).querySelector('lib-price-history')).not.toBeNull();
    });

    it('says the lists did not load, alone, and reads them again from Try again', async () => {
      const { fixture, lines, itemsByIds, history } = await render({
        arm: (doubles) =>
          doubles.lines.linesHoldingItem.mockRejectedValueOnce(
            new Error('offline')
          ),
      });

      const section = listsSection(fixture);
      expect(section?.querySelector('h2')?.textContent).toContain(
        'catalog.inLists.title'
      );
      const alert = section?.querySelector('[role="alert"]');
      expect(alert?.textContent).toContain('catalog.inLists.failed');
      expect(host(fixture).querySelector('lib-lists-table')).toBeNull();
      expect(host(fixture).querySelectorAll('[role="alert"]')).toHaveLength(1);
      expect(prices(fixture)).toHaveLength(3);
      expect(host(fixture).querySelector('lib-price-history')).not.toBeNull();

      const retry = alert?.querySelector<HTMLButtonElement>('button');
      expect(retry?.textContent).toContain('catalog.error.retry');
      retry?.click();
      await settle(fixture);

      expect(lines.linesHoldingItem).toHaveBeenCalledTimes(2);
      // Only the lists were read again.
      expect(itemsByIds).toHaveBeenCalledTimes(1);
      expect(history).toHaveBeenCalledTimes(1);
      expect(host(fixture).querySelector('[role="alert"]')).toBeNull();
      expect(listRow(fixture, 'list-weekly').main?.quantity).toBe('0');
    });

    it('starts a list at the quantity of the line that has the product under exactly its name', async () => {
      const { fixture } = await render({
        lists: [WEEKLY, PARTY],
        lines: [OIL_LINE, FRYING_LINE],
      });

      expect(listRow(fixture, 'list-weekly').main?.quantity).toBe('2');
      expect(listRow(fixture, 'list-weekly').main?.minus?.disabled).toBe(false);
      expect(listRow(fixture, 'list-party').main?.quantity).toBe('0');
    });

    it('draws a line that holds the product under another name on its own row, with its own quantity', async () => {
      const { fixture } = await render({ lines: [OIL_LINE, FRYING_LINE] });

      const other = otherLine(fixture, 'line-frying');
      expect(other.row?.closest('li')?.getAttribute('data-list')).toBe(
        'list-weekly'
      );
      expect(other.row?.querySelector('.other-name')?.textContent?.trim()).toBe(
        'Oil for frying'
      );
      expect(other.row?.textContent).toContain('catalog.inLists.other');
      expect(other.stepper?.quantity).toBe('1');
      // The line under the product's own name is the list's stepper, not a row.
      expect(
        host(fixture).querySelectorAll('lib-lists-table .other')
      ).toHaveLength(1);
      expect(otherLine(fixture, 'line-oil').row).toBeNull();
    });

    it('adds one to the list whose plus was pressed, and that joins the record of the visit', async () => {
      const { fixture, lines, store } = await render({
        lists: [WEEKLY, PARTY],
      });
      const add = jest.spyOn(store, 'add');

      listRow(fixture, 'list-party').main?.plus?.click();
      await settle(fixture);

      expect(add).toHaveBeenCalledTimes(1);
      expect(add).toHaveBeenCalledWith(
        {
          itemId: 'item-oil',
          name: 'Extra virgin olive oil',
          detail: expect.stringContaining('Hacendado'),
        },
        'list-party'
      );
      // To that list, not to the one the plus of the catalog adds to.
      expect(lines.addLineResult).toHaveBeenCalledTimes(1);
      expect(lines.addLineResult).toHaveBeenCalledWith(
        'list-party',
        'Extra virgin olive oil',
        1,
        ['item-oil']
      );
      expect(listRow(fixture, 'list-party').main?.quantity).toBe('1');
      expect(listRow(fixture, 'list-weekly').main?.quantity).toBe('0');

      expect(store.count()).toBe(1);
      expect(store.visit()).toMatchObject([
        {
          listId: 'list-party',
          itemId: 'item-oil',
          lineId: 'line-list-party-item-oil',
          quantity: 1,
          before: 0,
          created: true,
        },
      ]);
      // The list the plus of the catalog adds to has not moved.
      expect(store.target()?.listId).toBe('list-weekly');
    });

    it('raises the line that is there with the plus, and records how many it held before', async () => {
      const { fixture, lines, store } = await render({ lines: [OIL_LINE] });

      listRow(fixture, 'list-weekly').main?.plus?.click();
      await settle(fixture);

      expect(lines.addLineResult).toHaveBeenCalledWith(
        'list-weekly',
        'Extra virgin olive oil',
        1,
        ['item-oil']
      );
      expect(listRow(fixture, 'list-weekly').main?.quantity).toBe('3');
      expect(store.visit()).toMatchObject([
        { lineId: 'line-oil', quantity: 3, before: 2, created: false },
      ]);
    });

    it('deletes a line this page made when the minus brings it to zero', async () => {
      const { fixture, lines, store } = await render({
        lists: [WEEKLY, PARTY],
      });
      listRow(fixture, 'list-party').main?.plus?.click();
      await settle(fixture);
      const step = jest.spyOn(store, 'step');

      listRow(fixture, 'list-party').main?.minus?.click();
      await settle(fixture);

      expect(step).toHaveBeenCalledWith(
        expect.objectContaining({ listId: 'list-party', itemId: 'item-oil' }),
        'line-list-party-item-oil',
        -1
      );
      expect(lines.deleteLine).toHaveBeenCalledWith('line-list-party-item-oil');
      expect(lines.addQuantity).not.toHaveBeenCalled();
      expect(listRow(fixture, 'list-party').main?.quantity).toBe('0');
      expect(store.count()).toBe(0);
    });

    it('sets a line that was there before to zero with the minus, and deletes nothing', async () => {
      const { fixture, lines } = await render({
        lines: [{ ...OIL_LINE, quantity: 1 }],
      });

      listRow(fixture, 'list-weekly').main?.minus?.click();
      await settle(fixture);

      expect(lines.addQuantity).toHaveBeenCalledTimes(1);
      expect(lines.addQuantity).toHaveBeenCalledWith('line-oil', -1);
      expect(lines.deleteLine).not.toHaveBeenCalled();
      expect(listRow(fixture, 'list-weekly').main?.quantity).toBe('0');
    });

    it('moves a line under another name with its own stepper, and leaves the list’s own line alone', async () => {
      const { fixture, lines, store } = await render({
        lines: [OIL_LINE, FRYING_LINE],
      });
      const step = jest.spyOn(store, 'step');

      otherLine(fixture, 'line-frying').stepper?.plus?.click();
      await settle(fixture);

      expect(step).toHaveBeenCalledTimes(1);
      expect(step).toHaveBeenCalledWith(
        {
          listId: 'list-weekly',
          itemId: 'item-oil',
          detail: expect.stringContaining('Hacendado'),
        },
        'line-frying',
        1
      );
      expect(lines.addQuantity).toHaveBeenCalledTimes(1);
      expect(lines.addQuantity).toHaveBeenCalledWith('line-frying', 1);
      expect(lines.addLineResult).not.toHaveBeenCalled();
      expect(otherLine(fixture, 'line-frying').stepper?.quantity).toBe('2');
      expect(listRow(fixture, 'list-weekly').main?.quantity).toBe('2');
      // Raised in this visit, so it joins the record, as a line that was there.
      expect(store.visit()).toMatchObject([
        { lineId: 'line-frying', quantity: 2, before: 1, created: false },
      ]);

      otherLine(fixture, 'line-frying').stepper?.minus?.click();
      await settle(fixture);

      expect(lines.addQuantity).toHaveBeenLastCalledWith('line-frying', -1);
      expect(otherLine(fixture, 'line-frying').stepper?.quantity).toBe('1');
      expect(lines.deleteLine).not.toHaveBeenCalled();
      expect(store.count()).toBe(0);
    });

    it('says a failed write once and puts the list back where it was', async () => {
      const { fixture, lines, store } = await render();
      expect(addFailed(fixture)).toBe('');

      lines.addLineResult.mockRejectedValueOnce(new Error('offline'));
      listRow(fixture, 'list-weekly').main?.plus?.click();
      await settle(fixture);

      expect(addFailed(fixture)).toBe('catalog.add.failed');
      expect(listRow(fixture, 'list-weekly').main?.quantity).toBe('0');
      expect(store.count()).toBe(0);

      // The next press takes the sentence down, and this time the write lands.
      listRow(fixture, 'list-weekly').main?.plus?.click();
      fixture.detectChanges();
      expect(addFailed(fixture)).toBe('');
      await settle(fixture);
      expect(listRow(fixture, 'list-weekly').main?.quantity).toBe('1');
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
      const { fixture, lines, store } = await render(group);
      const add = jest.spyOn(store, 'add');

      similar(fixture)[0]
        ?.querySelector<HTMLButtonElement>('button.add')
        ?.click();
      await settle(fixture);

      // No list is named, so it goes to the one the heading says.
      expect(add).toHaveBeenCalledTimes(1);
      expect(add.mock.calls[0]).toEqual([
        expect.objectContaining({
          itemId: 'item-oil-other',
          name: 'Carbonell olive oil',
        }),
      ]);
      expect(lines.addLineResult).toHaveBeenCalledWith(
        'list-weekly',
        'Carbonell olive oil',
        1,
        ['item-oil-other']
      );
      // What this page adds joins the record of the visit.
      expect(store.count()).toBe(1);
      // The same row as the catalog: the plus stays, and the line is under it.
      const row = similar(fixture)[0];
      expect(row?.querySelector('button.add.has-count')).toBeNull();
      expect(row?.querySelector('.held-name')?.textContent?.trim()).toBe(
        'Carbonell olive oil'
      );
      expect(stepperIn(row?.querySelector('.held-line'))?.quantity).toBe('1');
      expect(similar(fixture)[1]?.querySelector('.held')).toBeNull();
      // It is another product, so the table of this one has not moved.
      expect(listRow(fixture, 'list-weekly').main?.quantity).toBe('0');
    });

    it('shows the lines of the chosen list under a similar product, and a press on one writes that line', async () => {
      const { fixture, lines, store } = await render({
        ...group,
        lines: [
          {
            id: 'line-carbonell',
            listId: 'list-weekly',
            content: 'Oil for the salad',
            quantity: 2,
            itemIds: ['item-oil-other'],
          },
        ],
      });
      const step = jest.spyOn(store, 'step');
      const line = () => similar(fixture)[0]?.querySelector('.held-line');

      expect(line()?.getAttribute('data-line')).toBe('line-carbonell');
      expect(line()?.querySelector('.held-name')?.textContent?.trim()).toBe(
        'Oil for the salad'
      );
      expect(stepperIn(line())?.quantity).toBe('2');

      stepperIn(line())?.plus?.click();
      await settle(fixture);

      expect(step).toHaveBeenCalledWith(
        expect.objectContaining({
          listId: 'list-weekly',
          itemId: 'item-oil-other',
        }),
        'line-carbonell',
        1
      );
      expect(lines.addQuantity).toHaveBeenCalledWith('line-carbonell', 1);
      expect(stepperIn(line())?.quantity).toBe('3');
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
    const { fixture, itemsByIds, params, lines } = await render({
      lines: [OIL_LINE],
    });
    expect(title(fixture)).toBe('Extra virgin olive oil');
    expect(listRow(fixture, 'list-weekly').main?.quantity).toBe('2');

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
    // And its own lists: the weekly shop holds the oil, not the rice.
    expect(lines.linesHoldingItem).toHaveBeenLastCalledWith('item-rice');
    expect(listRow(fixture, 'list-weekly').main?.quantity).toBe('0');
  });

  it('reads once for the same product named again', async () => {
    const { fixture, itemsByIds, params, history, lines } = await render();

    params.next(convertToParamMap({ itemId: 'item-oil' }));
    await settle(fixture);

    expect(itemsByIds).toHaveBeenCalledTimes(1);
    expect(history).toHaveBeenCalledTimes(1);
    expect(lines.linesHoldingItem).toHaveBeenCalledTimes(1);
  });
});
