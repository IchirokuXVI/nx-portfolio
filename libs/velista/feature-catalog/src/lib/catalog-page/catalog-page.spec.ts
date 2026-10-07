import { Location } from '@angular/common';
import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
  Router,
  type ParamMap,
  type UrlTree,
} from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  CATALOG_BROWSE_SERVICE,
  CatalogAddStore,
  CatalogBrowseMemory,
  fakeCategoryStore,
  MEMORY_CATEGORIES,
  provideFakeCategoryStore,
  type FakeCategoryStore,
} from '@portfolio/velista/data-access';
import type {
  CatalogBrowseQuery,
  CatalogLocation,
  CatalogPriceState,
} from '@portfolio/velista/models';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { AddingBar } from '@portfolio/velista/ui';
import { BehaviorSubject } from 'rxjs';
import {
  fakeAdds,
  WEEKLY,
  type FakeAdds,
  type FakeAddsOptions,
  type FakeLine,
} from '../catalog-adds.testing';
import { CATALOG_SEARCH_DEBOUNCE_MS, CatalogPage } from './catalog-page';

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

interface Harness {
  readonly fixture: ComponentFixture<CatalogPage>;
  readonly memory: CatalogBrowseMemory;
  readonly browse: jest.SpyInstance;
  /** The tab's query parameters, which a test moves as a navigation would. */
  readonly query: BehaviorSubject<ParamMap>;
  readonly tree: FakeCategoryStore;
  /** The line service double the store reads and writes through. */
  readonly lines: FakeAdds['lines'];
  /** Every double of the store, for the reads of the groups and the lists. */
  readonly adds: FakeAdds;
}

interface RenderOptions extends FakeAddsOptions {
  /** The mount. The portfolio's unless a test wants the standalone build. */
  readonly basePath?: string;
  /** The slug in `?category=` on arrival. */
  readonly category?: string;
  /** The chain in `?chain=` on arrival (velista 0124). */
  readonly chain?: string;
  /** The shop in `?shop=` on arrival (velista 0124). */
  readonly shop?: string;
  /** The text in `?q=` on arrival. */
  readonly q?: string;
  /** The order in `?order=` on arrival. */
  readonly order?: string;
  /** The tree the store holds; null is a tree that has not landed. */
  readonly tree?: FakeCategoryStore;
}

/**
 * Lets every pending promise run, then draws. `whenStable` is not used, because it
 * never settles under fake timers.
 */
async function settle(fixture: ComponentFixture<CatalogPage>): Promise<void> {
  for (let tick = 0; tick < 20; tick++) {
    await Promise.resolve();
  }
  fixture.detectChanges();
}

async function render(
  state: CatalogPriceState = 'priced',
  options: RenderOptions = {}
): Promise<Harness> {
  TestBed.resetTestingModule();

  const memory = new CatalogBrowseMemory();
  memory.state = state;
  const browse = jest.spyOn(memory, 'browse');
  const query = new BehaviorSubject<ParamMap>(
    convertToParamMap({
      ...(options.category === undefined ? {} : { category: options.category }),
      ...(options.chain === undefined ? {} : { chain: options.chain }),
      ...(options.shop === undefined ? {} : { shop: options.shop }),
      ...(options.q === undefined ? {} : { q: options.q }),
      ...(options.order === undefined ? {} : { order: options.order }),
    })
  );
  const tree = options.tree ?? fakeCategoryStore(MEMORY_CATEGORIES);
  const adds = fakeAdds(options);

  await TestBed.configureTestingModule({
    imports: [CatalogPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: options.basePath ?? '/velista' }),
      provideRouter([]),
      provideFakeCategoryStore(tree),
      ...adds.providers,
      { provide: ActivatedRoute, useValue: { queryParamMap: query } },
      { provide: CATALOG_BROWSE_SERVICE, useValue: memory },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(CatalogPage);
  fixture.detectChanges();
  await settle(fixture);
  await settle(fixture);

  return { fixture, memory, browse, query, tree, lines: adds.lines, adds };
}

/** Where the router was last sent, as a URL string whichever form it was given. */
function lastUrl(navigate: jest.SpyInstance): string {
  const calls = navigate.mock.calls;
  const target = calls[calls.length - 1]?.[0] as string | UrlTree;
  return typeof target === 'string'
    ? target
    : TestBed.inject(Router).serializeUrl(target);
}

function host(fixture: ComponentFixture<CatalogPage>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function field(fixture: ComponentFixture<CatalogPage>): HTMLInputElement {
  const input =
    host(fixture).querySelector<HTMLInputElement>('#catalog-search');
  if (input === null) {
    throw new Error('no search field');
  }
  return input;
}

/** The order control on the line that heads the list. */
function orderControl(page: HTMLElement): HTMLButtonElement {
  const control = page.querySelector<HTMLButtonElement>(
    'lib-order-menu .control'
  );
  if (control === null) {
    throw new Error('no order control');
  }
  return control;
}

/** The rows of the open order menu. The popover is drawn outside the host. */
function orderOptions(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('[data-order]')];
}

/**
 * The order menu, opened, read and closed again: the orders it offers, the one
 * that is checked, and what the control says while it is closed.
 */
function orderMenu(fixture: ComponentFixture<CatalogPage>): {
  orders: (string | undefined)[];
  checked: string | null;
  shown: string;
} {
  const control = orderControl(host(fixture));
  control.click();
  fixture.detectChanges();
  const options = orderOptions();
  const read = {
    orders: options.map((option) => option.dataset['order']),
    checked:
      options.find((option) => option.getAttribute('aria-checked') === 'true')
        ?.dataset['order'] ?? null,
    shown: control.querySelector('.control-value')?.textContent?.trim() ?? '',
  };
  control.click();
  fixture.detectChanges();
  return read;
}

/** Opens the order menu and presses one of its rows. */
function chooseOrder(
  fixture: ComponentFixture<CatalogPage>,
  order: string
): void {
  orderControl(host(fixture)).click();
  fixture.detectChanges();
  orderOptions()
    .find((option) => option.dataset['order'] === order)
    ?.click();
  fixture.detectChanges();
}

/**
 * One of the two selectors (velista 0134, section 2): its body, its text, its
 * accessible name, and its cross when something is chosen.
 */
function selector(
  fixture: ComponentFixture<CatalogPage>,
  which: 'supermarket' | 'category'
): {
  readonly body: HTMLButtonElement;
  readonly text: string;
  readonly label: string | null;
  readonly clear: HTMLButtonElement | null;
  readonly set: boolean;
} {
  const body = host(fixture).querySelector<HTMLButtonElement>(
    `lib-catalog-selectors [data-selector="${which}"]`
  );
  const pick = body?.closest('.pick') ?? null;
  if (body === null || pick === null) {
    throw new Error(`no ${which} selector`);
  }
  return {
    body,
    text: body.querySelector('.text')?.textContent?.trim() ?? '',
    label: body.getAttribute('aria-label'),
    clear: pick.querySelector<HTMLButtonElement>('.clear'),
    set: pick.classList.contains('is-set'),
  };
}

/** The note at the left end of the line that heads the list, or null. */
function headNote(fixture: ComponentFixture<CatalogPage>): string | null {
  const notes = host(fixture).querySelectorAll('.head .head-note');
  if (notes.length > 1) {
    throw new Error('more than one head note');
  }
  return notes[0]?.textContent?.trim() ?? null;
}

/** The trailing control of each row: the plus. */
function plusses(fixture: ComponentFixture<CatalogPage>): HTMLButtonElement[] {
  return [
    ...host(fixture).querySelectorAll<HTMLButtonElement>(
      'lib-product-row button.add'
    ),
  ];
}

/** The row of one product, found by the name it draws. */
function rowOf(
  fixture: ComponentFixture<CatalogPage>,
  name: string
): HTMLElement {
  const row = [
    ...host(fixture).querySelectorAll<HTMLElement>('lib-product-row'),
  ].find((one) => one.querySelector('.name')?.textContent?.trim() === name);
  if (row === undefined) {
    throw new Error(`no row for ${name}`);
  }
  return row;
}

/** The plus of one product's row, or null for a row with none. */
function plusOf(
  fixture: ComponentFixture<CatalogPage>,
  name: string
): HTMLButtonElement | null {
  return rowOf(fixture, name).querySelector<HTMLButtonElement>('button.add');
}

/** The names of the products drawn, in the order drawn. */
function names(fixture: ComponentFixture<CatalogPage>): string[] {
  return [...host(fixture).querySelectorAll('lib-product-row .name')].map(
    (name) => name.textContent?.trim() ?? ''
  );
}

/** One line of the chosen list under a row, as the row draws it. */
interface DrawnLine {
  readonly lineId: string;
  readonly name: string;
  readonly quantity: string | null;
  readonly minus: HTMLButtonElement | null;
  readonly plus: HTMLButtonElement | null;
}

/** The lines of the chosen list that hold one product, under its row. */
function heldLines(
  fixture: ComponentFixture<CatalogPage>,
  name: string
): DrawnLine[] {
  return [
    ...rowOf(fixture, name).querySelectorAll<HTMLElement>('.held-line'),
  ].map((line) => {
    const steps = line.querySelectorAll<HTMLButtonElement>(
      'lib-quantity-stepper button.step'
    );
    return {
      lineId: line.dataset['line'] ?? '',
      name: line.querySelector('.held-name')?.textContent?.trim() ?? '',
      quantity:
        line
          .querySelector('lib-quantity-stepper [role="spinbutton"]')
          ?.getAttribute('aria-valuenow') ?? null,
      minus: steps[0] ?? null,
      plus: steps[1] ?? null,
    };
  });
}

/** What stands where the line above the tab bar would, when a read failed. */
function addsFailed(fixture: ComponentFixture<CatalogPage>): {
  readonly alert: HTMLElement | null;
  readonly text: string;
  readonly retry: HTMLButtonElement | null;
} {
  const alert = host(fixture).querySelector<HTMLElement>('p.adds-failed');
  return {
    alert,
    text: alert?.querySelector('.adds-failed-text')?.textContent?.trim() ?? '',
    retry: alert?.querySelector<HTMLButtonElement>('button') ?? null,
  };
}

/** The "Without a price" lines of the list. */
function unpriced(fixture: ComponentFixture<CatalogPage>): HTMLElement[] {
  return [
    ...host(fixture).querySelectorAll<HTMLElement>('ul.rows li.unpriced'),
  ];
}

/** The line above the tab bar, or null for somebody with no list to add to. */
function addingBar(fixture: ComponentFixture<CatalogPage>): HTMLElement | null {
  return host(fixture).querySelector<HTMLElement>('lib-adding-bar');
}

/** The sentence a failed write raises, or blank. */
function addFailed(fixture: ComponentFixture<CatalogPage>): string {
  return host(fixture).querySelector('.add-failed')?.textContent?.trim() ?? '';
}

function lastQuery(browse: jest.SpyInstance): CatalogBrowseQuery {
  const calls = browse.mock.calls;
  return calls[calls.length - 1]?.[0] as CatalogBrowseQuery;
}

function rows(fixture: ComponentFixture<CatalogPage>): number {
  return host(fixture).querySelectorAll('lib-product-row').length;
}

describe('CatalogPage', () => {
  afterEach(() => jest.useRealTimers());

  it('opens on the catalog order, with no Best match and a full list', async () => {
    const { fixture, browse } = await render();

    expect(orderMenu(fixture)).toEqual({
      orders: ['category', 'price', 'unitPrice'],
      checked: 'category',
      shown: 'catalog.order.short.category',
    });
    expect(lastQuery(browse)).toMatchObject({
      query: '',
      order: 'category',
      soldBy: null,
      priceScopeIds: [],
    });
    expect(rows(fixture)).toBeGreaterThan(5);
    // By aisle, so no line says where the rows with no price start.
    expect(unpriced(fixture)).toHaveLength(0);
  });

  it('heads the page with the one page header: the catalog tab’s glyph, the title and no action', async () => {
    const { fixture } = await render();
    const header = host(fixture).querySelector('lib-page-header');

    expect(header?.querySelector('h1')?.textContent?.trim()).toBe(
      'catalog.title'
    );
    expect(header?.querySelector('.icon lib-product-icon')).not.toBeNull();
    expect(header?.querySelector('button')).toBeNull();
    expect(host(fixture).querySelectorAll('h1')).toHaveLength(1);
    // Outside the scroller, so it stays while the list scrolls.
    expect(host(fixture).querySelector('.page lib-page-header')).toBeNull();
  });

  it('says where the prices are from on the line that heads the list, before the order', async () => {
    const { fixture } = await render();
    const note = host(fixture).querySelector('.head-note');

    expect(note?.textContent).toContain('catalog.near');
    expect(note?.closest('.head')).not.toBeNull();
    expect(note?.closest('.tools')).toBeNull();
    expect(note?.closest('lib-page-header')).toBeNull();
    expect(note?.nextElementSibling?.tagName).toBe('LIB-ORDER-MENU');
  });

  it('switches to Best match once typing settles, and not on every keystroke', async () => {
    const { fixture, browse } = await render();
    jest.useFakeTimers();
    const before = browse.mock.calls.length;

    const input = field(fixture);
    input.value = 'lec';
    input.dispatchEvent(new Event('input'));
    jest.advanceTimersByTime(CATALOG_SEARCH_DEBOUNCE_MS - 50);
    input.value = 'leche';
    input.dispatchEvent(new Event('input'));
    jest.advanceTimersByTime(CATALOG_SEARCH_DEBOUNCE_MS - 50);

    // Still waiting: two keystrokes, and neither has asked yet.
    expect(browse.mock.calls.length).toBe(before);

    jest.advanceTimersByTime(50);
    await settle(fixture);

    expect(browse.mock.calls.length).toBe(before + 1);
    expect(lastQuery(browse)).toMatchObject({
      query: 'leche',
      order: 'relevance',
    });
    expect(orderMenu(fixture)).toEqual({
      orders: ['relevance', 'category', 'price', 'unitPrice'],
      checked: 'relevance',
      shown: 'catalog.order.short.relevance',
    });
  });

  it('drops Best match again when the search is cleared', async () => {
    const { fixture, browse } = await render();
    jest.useFakeTimers();

    const input = field(fixture);
    input.value = 'leche';
    input.dispatchEvent(new Event('input'));
    jest.advanceTimersByTime(CATALOG_SEARCH_DEBOUNCE_MS);
    await settle(fixture);

    host(fixture).querySelector<HTMLButtonElement>('.field-clear')?.click();
    await settle(fixture);

    expect(orderMenu(fixture)).toMatchObject({
      orders: ['category', 'price', 'unitPrice'],
      checked: 'category',
    });
    expect(lastQuery(browse)).toMatchObject({ query: '', order: 'category' });
  });

  it('draws the tools as the field and one row of two selectors, with nothing chosen', async () => {
    const { fixture } = await render();

    expect(host(fixture).querySelector('lib-chain-chips')).toBeNull();
    expect(
      host(fixture).querySelectorAll('.tools lib-catalog-selectors')
    ).toHaveLength(1);

    const supermarket = selector(fixture, 'supermarket');
    expect(supermarket.text).toBe('catalog.supermarket.all');
    expect(supermarket.label).toBe('catalog.selector.supermarketAll');
    const category = selector(fixture, 'category');
    expect(category.text).toBe('catalog.categories.all');
    expect(category.label).toBe('catalog.selector.categoryAll');

    // Nothing chosen: each selector is one button, with nothing to clear.
    expect(supermarket.set).toBe(false);
    expect(supermarket.clear).toBeNull();
    expect(category.set).toBe(false);
    expect(category.clear).toBeNull();
    expect(field(fixture).placeholder).toBe('catalog.search.all');
  });

  it('names the chain and the category on the selectors, each with its own cross', async () => {
    const { fixture } = await render('priced', {
      category: 'milk',
      chain: 'chain-deza',
    });

    const supermarket = selector(fixture, 'supermarket');
    expect(supermarket.set).toBe(true);
    expect(supermarket.text).toBe('Deza');
    expect(supermarket.label).toBe('catalog.selector.supermarketAny');
    expect(supermarket.clear?.getAttribute('aria-label')).toBe(
      'catalog.supermarket.clear'
    );

    // The leaf alone is drawn. The accessible name says the root too.
    const category = selector(fixture, 'category');
    expect(category.set).toBe(true);
    expect(category.text).toBe('Milk');
    expect(category.label).toBe('catalog.selector.categoryLeaf');
    expect(category.clear?.getAttribute('aria-label')).toBe(
      'catalog.categories.clear'
    );
  });

  it('clears only its own choice with each cross, and keeps the other one in the URL', async () => {
    const { fixture } = await render('priced', {
      category: 'milk',
      chain: 'chain-deza',
    });
    const navigate = jest
      .spyOn(TestBed.inject(Router), 'navigateByUrl')
      .mockResolvedValue(true);

    selector(fixture, 'supermarket').clear?.click();
    expect(lastUrl(navigate)).toBe('/velista/en/catalog?category=milk');

    selector(fixture, 'category').clear?.click();
    expect(lastUrl(navigate)).toBe('/velista/en/catalog?chain=chain-deza');
  });

  it('opens the picker page with the choice it holds', async () => {
    const { fixture } = await render('priced', {
      category: 'milk',
      chain: 'chain-deza',
    });
    const navigate = jest
      .spyOn(TestBed.inject(Router), 'navigateByUrl')
      .mockResolvedValue(true);

    selector(fixture, 'supermarket').body.click();

    expect(lastUrl(navigate)).toBe(
      '/velista/en/catalog/supermarket?category=milk&chain=chain-deza'
    );
  });

  it('narrows to the chain in the URL, prices from its scopes, and names it', async () => {
    const { fixture, browse } = await render('priced', { chain: 'chain-deza' });

    expect(lastQuery(browse)).toMatchObject({
      soldBy: 'chain-deza',
      priceScopeIds: ['scope-chain-deza'],
      locationId: null,
    });
    expect(field(fixture).placeholder).toBe('catalog.search.chain');
    // The chain on the selector, heard as "any shop", with a cross beside it.
    const chosen = selector(fixture, 'supermarket');
    expect(chosen.text).toBe('Deza');
    expect(chosen.label).toBe('catalog.selector.supermarketAny');
    expect(chosen.clear?.getAttribute('aria-label')).toBe(
      'catalog.supermarket.clear'
    );
  });

  it('goes back to every supermarket with the x, pushed, keeping the category', async () => {
    const { fixture, browse, query } = await render('priced', {
      category: 'milk',
      chain: 'chain-deza',
    });
    const navigate = jest
      .spyOn(TestBed.inject(Router), 'navigateByUrl')
      .mockResolvedValue(true);

    selector(fixture, 'supermarket').clear?.click();
    expect(lastUrl(navigate)).toBe('/velista/en/catalog?category=milk');
    expect(
      navigate.mock.calls[navigate.mock.calls.length - 1][1]
    ).toBeUndefined();

    // The navigation lands on this page, which reads the URL again.
    query.next(convertToParamMap({ category: 'milk' }));
    await settle(fixture);
    expect(lastQuery(browse)).toMatchObject({
      soldBy: null,
      priceScopeIds: [],
      categoryId: 'cat-milk',
    });
    expect(field(fixture).placeholder).toBe('catalog.categories.search');
  });

  it('prices at one shop with locationId alone, and says where', async () => {
    const { fixture, browse } = await render('priced', {
      chain: 'chain-mercadona',
      shop: 'location-mercadona-mayor',
    });
    await settle(fixture);

    expect(lastQuery(browse)).toMatchObject({
      soldBy: null,
      priceScopeIds: [],
      locationId: 'location-mercadona-mayor',
    });
    // The selector names the chain. The line that heads the list names the shop.
    const chosen = selector(fixture, 'supermarket');
    expect(chosen.text).toBe('Mercadona');
    expect(chosen.label).toBe('catalog.selector.supermarketShop');
    expect(headNote(fixture)).toBe('catalog.supermarket.pricesAt');
  });

  it('writes the chain a ?shop= link left out into the URL, so the URL and the page agree', async () => {
    const navigate = jest
      .spyOn(Router.prototype, 'navigateByUrl')
      .mockResolvedValue(true);
    try {
      const { fixture, browse, query } = await render('priced', {
        shop: 'location-mercadona-mayor',
      });
      await settle(fixture);

      // The shop's chain, beside the shop, in place of this entry.
      const url = lastUrl(navigate);
      expect(url).toContain('chain=chain-mercadona');
      expect(url).toContain('shop=location-mercadona-mayor');
      expect(navigate.mock.calls[navigate.mock.calls.length - 1][1]).toEqual({
        replaceUrl: true,
      });

      // That navigation lands here: the same choice, so no first page again.
      const reads = browse.mock.calls.length;
      query.next(
        convertToParamMap({
          chain: 'chain-mercadona',
          shop: 'location-mercadona-mayor',
        })
      );
      await settle(fixture);
      expect(browse.mock.calls.length).toBe(reads);
      expect(selector(fixture, 'supermarket').text).toBe('Mercadona');
      expect(headNote(fixture)).toBe('catalog.supermarket.pricesAt');
    } finally {
      navigate.mockRestore();
    }
  });

  it('writes no URL when the tab is left before the shop answers', async () => {
    // The shop's real answer, held back until after the page is gone.
    const found = await new CatalogBrowseMemory().location(
      'location-mercadona-mayor'
    );
    let answer: (location: CatalogLocation | null) => void = () => undefined;
    const location = jest
      .spyOn(CatalogBrowseMemory.prototype, 'location')
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            answer = resolve;
          })
      );
    const navigate = jest
      .spyOn(Router.prototype, 'navigateByUrl')
      .mockResolvedValue(true);
    try {
      const { fixture } = await render('priced', {
        shop: 'location-mercadona-mayor',
      });
      expect(location).toHaveBeenCalledWith('location-mercadona-mayor');

      fixture.destroy();
      answer(found);
      await settle(fixture);

      expect(navigate).not.toHaveBeenCalled();
    } finally {
      location.mockRestore();
      navigate.mockRestore();
    }
  });

  it('says a product has no price at the shop rather than dropping it', async () => {
    const { fixture } = await render('noPlace', {
      chain: 'chain-mercadona',
      shop: 'location-mercadona-mayor',
    });
    await settle(fixture);

    const missing = host(fixture).querySelectorAll('.no-price');
    expect(missing.length).toBeGreaterThan(0);
    expect(missing[0].textContent).toContain('catalog.row.noPrice');
    expect(missing[0].textContent).toContain('catalog.supermarket.notPriced');
  });

  it('announces how many products are drawn, politely', async () => {
    const { fixture } = await render();

    const status = host(fixture).querySelector('.page [role="status"]');
    expect(status?.getAttribute('aria-live')).toBe('polite');
    expect(status?.textContent).toContain('catalog.count');
  });

  it('names the words that found nothing, and offers to clear them', async () => {
    const { fixture } = await render();
    jest.useFakeTimers();

    const input = field(fixture);
    input.value = 'zzzz';
    input.dispatchEvent(new Event('input'));
    jest.advanceTimersByTime(CATALOG_SEARCH_DEBOUNCE_MS);
    await settle(fixture);

    expect(rows(fixture)).toBe(0);
    expect(host(fixture).textContent).toContain('catalog.empty.title');
    expect(host(fixture).textContent).toContain('catalog.empty.clear');
  });

  it('opens a product on its own page, under the mount', async () => {
    const { fixture } = await render();
    const navigate = jest
      .spyOn(TestBed.inject(Router), 'navigateByUrl')
      .mockResolvedValue(true);

    rowOf(fixture, 'Extra virgin olive oil')
      .querySelector<HTMLButtonElement>('button.open')
      ?.click();

    expect(lastUrl(navigate)).toBe('/velista/en/catalog/products/item-oil');
  });

  it('opens /en/catalog/products/<id> on a standalone build, with no query and no sheet segment', async () => {
    // The choice stays in the tab's own history entry, so the page's URL is bare.
    const { fixture } = await render('priced', {
      basePath: '',
      category: 'milk',
      chain: 'chain-mercadona',
    });
    const navigate = jest
      .spyOn(TestBed.inject(Router), 'navigateByUrl')
      .mockResolvedValue(true);

    host(fixture)
      .querySelector<HTMLButtonElement>('lib-product-row button.open')
      ?.click();

    expect(lastUrl(navigate)).toBe('/en/catalog/products/item-milk');
  });

  describe('the line that heads the list (velista 0134, section 3)', () => {
    it('names the shop first, then the chain, then the postal code', async () => {
      const near = await render();
      expect(headNote(near.fixture)).toBe('catalog.near');

      const chain = await render('priced', { chain: 'chain-deza' });
      expect(headNote(chain.fixture)).toBe('catalog.head.chainNear');

      const shop = await render('priced', {
        chain: 'chain-mercadona',
        shop: 'location-mercadona-mayor',
      });
      await settle(shop.fixture);
      expect(headNote(shop.fixture)).toBe('catalog.supermarket.pricesAt');
    });

    it('names the chain alone for somebody with no postal code, and nothing with neither', async () => {
      const chain = await render('noPlace', { chain: 'chain-deza' });
      expect(headNote(chain.fixture)).toBe('catalog.supermarket.any');

      const plain = await render('noPlace');
      expect(headNote(plain.fixture)).toBeNull();
    });

    it('offers the three orders with an empty field, and Best match before them with text', async () => {
      const plain = await render();
      expect(orderMenu(plain.fixture).orders).toEqual([
        'category',
        'price',
        'unitPrice',
      ]);

      const typed = await render('priced', { q: 'leche' });
      expect(orderMenu(typed.fixture)).toEqual({
        orders: ['relevance', 'category', 'price', 'unitPrice'],
        checked: 'relevance',
        shown: 'catalog.order.short.relevance',
      });
    });

    it('reads again in the order a row of the menu names', async () => {
      const { fixture, browse } = await render('priced', { q: 'leche' });

      chooseOrder(fixture, 'category');
      await settle(fixture);

      expect(lastQuery(browse)).toMatchObject({
        query: 'leche',
        order: 'category',
      });
      expect(orderMenu(fixture).checked).toBe('category');
    });

    it('sends Lowest price when it is chosen, and keeps it in the URL in place of the entry', async () => {
      const { fixture, browse } = await render();
      const router = TestBed.inject(Router);
      const navigate = jest
        .spyOn(router, 'navigateByUrl')
        .mockResolvedValue(true);
      const url = jest
        .spyOn(router, 'url', 'get')
        .mockReturnValue('/velista/en/catalog');
      const reads = browse.mock.calls.length;

      chooseOrder(fixture, 'price');
      await settle(fixture);

      expect(browse.mock.calls.length).toBe(reads + 1);
      expect(lastQuery(browse)).toMatchObject({ query: '', order: 'price' });
      expect(orderMenu(fixture)).toMatchObject({
        checked: 'price',
        shown: 'catalog.order.short.price',
      });
      expect(lastUrl(navigate)).toBe('/velista/en/catalog?order=price');
      expect(navigate.mock.calls[navigate.mock.calls.length - 1][1]).toEqual({
        replaceUrl: true,
      });

      // The order it opens on is the URL without the parameter, not `order=category`.
      url.mockReturnValue('/velista/en/catalog?order=price');
      chooseOrder(fixture, 'category');
      await settle(fixture);
      expect(lastUrl(navigate)).toBe('/velista/en/catalog');
    });

    it('sends the price per kilo or litre order too, from a link that names it', async () => {
      const { fixture, browse } = await render('priced', {
        order: 'unitPrice',
      });

      expect(lastQuery(browse)).toMatchObject({ order: 'unitPrice' });
      expect(orderMenu(fixture)).toMatchObject({
        checked: 'unitPrice',
        shown: 'catalog.order.short.unitPrice',
      });
    });

    it('keeps a price order through a search that begins and one that ends', async () => {
      const { fixture, browse } = await render('priced', { order: 'price' });
      const router = TestBed.inject(Router);
      const navigate = jest
        .spyOn(router, 'navigateByUrl')
        .mockResolvedValue(true);
      jest
        .spyOn(router, 'url', 'get')
        .mockReturnValue('/velista/en/catalog?order=price');
      jest.useFakeTimers();

      const input = field(fixture);
      input.value = 'leche';
      input.dispatchEvent(new Event('input'));
      jest.advanceTimersByTime(CATALOG_SEARCH_DEBOUNCE_MS);
      await settle(fixture);

      // Best match joins the menu, and the cheapest is still what was asked for.
      expect(lastQuery(browse)).toMatchObject({
        query: 'leche',
        order: 'price',
      });
      expect(orderMenu(fixture)).toEqual({
        orders: ['relevance', 'category', 'price', 'unitPrice'],
        checked: 'price',
        shown: 'catalog.order.short.price',
      });
      expect(lastUrl(navigate)).toBe('/velista/en/catalog?q=leche&order=price');

      host(fixture).querySelector<HTMLButtonElement>('.field-clear')?.click();
      await settle(fixture);

      expect(lastQuery(browse)).toMatchObject({ query: '', order: 'price' });
      expect(orderMenu(fixture)).toMatchObject({
        orders: ['category', 'price', 'unitPrice'],
        checked: 'price',
      });
    });

    it('draws "Without a price" once, before the first row with no price, in a price order', async () => {
      const { fixture } = await render('priced', { order: 'price' });

      // Cheapest first, and the one product nobody near sells comes last.
      expect(names(fixture)[0]).toBe('Whole milk');
      expect(names(fixture)[names(fixture).length - 1]).toBe(
        'Traditional gazpacho'
      );

      const lines = unpriced(fixture);
      expect(lines).toHaveLength(1);
      expect(lines[0]?.textContent?.trim()).toBe('catalog.unpriced');
      // A row of the list, between the last priced product and the first without.
      const before = lines[0]?.previousElementSibling;
      expect(before?.querySelector('.name')?.textContent?.trim()).toBe(
        'Extra virgin olive oil'
      );
      expect(before?.querySelector('.price')).not.toBeNull();
      const after = lines[0]?.nextElementSibling;
      expect(after?.querySelector('.name')?.textContent?.trim()).toBe(
        'Traditional gazpacho'
      );
      expect(after?.querySelector('.no-price')).not.toBeNull();
      expect(lines[0]?.querySelector('lib-product-row')).toBeNull();
    });

    it('draws it where the chosen chain stops pricing, not where the catalog does', async () => {
      const { fixture } = await render('priced', {
        chain: 'chain-mercadona',
        order: 'price',
      });

      const lines = unpriced(fixture);
      expect(lines).toHaveLength(1);
      // Mercadona stocks the bread and gives it no price.
      expect(
        lines[0]?.nextElementSibling
          ?.querySelector('.name')
          ?.textContent?.trim()
      ).toBe('Wholemeal sliced bread');
      expect(lines[0]?.nextElementSibling?.nextElementSibling).toBeNull();
    });

    it('draws it in the price per kilo or litre order, and appears when a price order is chosen', async () => {
      const { fixture } = await render();
      expect(unpriced(fixture)).toHaveLength(0);

      chooseOrder(fixture, 'unitPrice');
      await settle(fixture);

      expect(unpriced(fixture)).toHaveLength(1);
      expect(
        unpriced(fixture)[0]
          ?.nextElementSibling?.querySelector('.name')
          ?.textContent?.trim()
      ).toBe('Traditional gazpacho');

      chooseOrder(fixture, 'category');
      await settle(fixture);
      expect(unpriced(fixture)).toHaveLength(0);
    });

    it('draws none when no row has a price: one part needs no separator', async () => {
      const { fixture, browse } = await render('noPlace', { order: 'price' });

      expect(lastQuery(browse)).toMatchObject({ order: 'price' });
      expect(rows(fixture)).toBeGreaterThan(5);
      expect(unpriced(fixture)).toHaveLength(0);
    });
  });

  describe('adding from a row (velista 0134, section 4)', () => {
    const OIL = 'Extra virgin olive oil';
    const RICE = 'Short grain rice';

    it('draws a plus on every row and the line that names the list', async () => {
      const { fixture } = await render();

      expect(plusses(fixture)).toHaveLength(rows(fixture));
      expect(plusses(fixture)[0]?.getAttribute('aria-label')).toBe(
        'catalog.add.label'
      );
      // A sibling of the row's own button, never a child of it.
      expect(plusses(fixture)[0]?.closest('button.open')).toBeNull();
      // The list holds none of these products, so no row has a line under it.
      expect(host(fixture).querySelector('lib-product-row .held')).toBeNull();

      const bar = addingBar(fixture);
      expect(bar?.querySelector('.list-name')?.textContent?.trim()).toBe(
        'Weekly shop'
      );
      // Nothing added yet, so no count.
      expect(bar?.querySelector('[data-adding="count"]')).toBeNull();
      // Outside the scroller, so it stays above the tab bar.
      expect(bar?.closest('.page')).toBeNull();
      expect(addsFailed(fixture).alert).toBeNull();
    });

    it('draws no plus, no line and no list for a guest, who is never asked for lists', async () => {
      const { fixture, adds } = await render('priced', {
        guest: true,
        lines: [OIL_LINE],
      });

      expect(rows(fixture)).toBeGreaterThan(5);
      expect(plusses(fixture)).toHaveLength(0);
      expect(host(fixture).querySelector('lib-product-row .held')).toBeNull();
      expect(
        host(fixture).querySelector('lib-product-row lib-quantity-stepper')
      ).toBeNull();
      expect(addingBar(fixture)).toBeNull();
      // Having no list is not a failed read, so nothing offers a second try.
      expect(addsFailed(fixture).alert).toBeNull();
      expect(adds.zones.listMyZones).not.toHaveBeenCalled();
      expect(adds.lines.listLines).not.toHaveBeenCalled();
    });

    it('draws no plus and no line for a person with no list they can write to', async () => {
      const { fixture } = await render('priced', {
        lists: [{ ...WEEKLY, myPermissions: ['READ'] }],
        lines: [OIL_LINE],
      });

      expect(rows(fixture)).toBeGreaterThan(5);
      expect(plusses(fixture)).toHaveLength(0);
      expect(host(fixture).querySelector('lib-product-row .held')).toBeNull();
      expect(addingBar(fixture)).toBeNull();
      expect(addsFailed(fixture).alert).toBeNull();
    });

    it('adds one of the product, by its id and its name, when the plus is pressed', async () => {
      const { fixture, lines } = await render();
      const add = jest.spyOn(TestBed.inject(CatalogAddStore), 'add');

      plusOf(fixture, OIL)?.click();
      await settle(fixture);

      expect(add).toHaveBeenCalledTimes(1);
      expect(add).toHaveBeenCalledWith(
        expect.objectContaining({
          itemId: 'item-oil',
          name: 'Extra virgin olive oil',
        })
      );
      // The line is named after the product, in the reader's language.
      expect(lines.addLineResult).toHaveBeenCalledWith(
        'list-weekly',
        'Extra virgin olive oil',
        1,
        ['item-oil']
      );
      // The plus stays a plus. The line it made is under the row, with one.
      expect(plusOf(fixture, OIL)?.classList.contains('has-count')).toBe(false);
      expect(
        plusOf(fixture, OIL)?.querySelector('lib-plus-icon')
      ).not.toBeNull();
      expect(heldLines(fixture, OIL)).toMatchObject([
        {
          lineId: 'line-list-weekly-item-oil',
          name: 'Extra virgin olive oil',
          quantity: '1',
        },
      ]);
      expect(
        host(fixture).querySelectorAll('lib-product-row .held')
      ).toHaveLength(1);

      // A second press raises that line. It does not make another.
      plusOf(fixture, OIL)?.click();
      await settle(fixture);
      expect(lines.addLineResult).toHaveBeenCalledTimes(2);
      expect(heldLines(fixture, OIL).map((line) => line.quantity)).toEqual([
        '2',
      ]);
    });

    it('shows under a row the lines of the chosen list that already hold the product, each with its quantity', async () => {
      const party = { ...WEEKLY, id: 'list-party', name: 'Party' };
      const { fixture, lines } = await render('priced', {
        lists: [WEEKLY, party],
        lines: [
          OIL_LINE,
          FRYING_LINE,
          // Another list holds the rice. That is not the list the plus adds to.
          {
            id: 'line-party-rice',
            listId: 'list-party',
            content: 'Short grain rice',
            quantity: 4,
            itemIds: ['item-rice'],
          },
        ],
      });

      expect(lines.listLines).toHaveBeenCalledWith(
        'list-weekly',
        expect.anything()
      );
      expect(heldLines(fixture, OIL)).toMatchObject([
        { lineId: 'line-oil', name: 'Extra virgin olive oil', quantity: '2' },
        { lineId: 'line-frying', name: 'Oil for frying', quantity: '1' },
      ]);
      const held = rowOf(fixture, OIL).querySelector('.held');
      expect(held?.querySelector('.held-title')?.textContent?.trim()).toBe(
        'catalog.held.title'
      );
      expect(
        held
          ?.querySelector('lib-quantity-stepper [role="spinbutton"]')
          ?.getAttribute('aria-label')
      ).toBe('catalog.held.stepper');
      // The lines sit beside the product's button and the plus, inside neither.
      expect(held?.closest('button')).toBeNull();
      expect(plusOf(fixture, OIL)).not.toBeNull();

      expect(heldLines(fixture, RICE)).toHaveLength(0);
      expect(
        host(fixture).querySelectorAll('lib-product-row .held')
      ).toHaveLength(1);
      // Nothing was added in this visit, so the line above the tab bar counts none.
      expect(
        addingBar(fixture)?.querySelector('[data-adding="count"]')
      ).toBeNull();
    });

    it('writes the line whose stepper was pressed, and no other', async () => {
      const { fixture, lines } = await render('priced', {
        lines: [OIL_LINE, FRYING_LINE],
      });
      const store = TestBed.inject(CatalogAddStore);
      const step = jest.spyOn(store, 'step');

      heldLines(fixture, OIL)[1]?.plus?.click();
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
      expect(heldLines(fixture, OIL).map((line) => line.quantity)).toEqual([
        '2',
        '2',
      ]);
      // A line raised in this visit joins the record of it.
      expect(store.count()).toBe(1);

      heldLines(fixture, OIL)[0]?.minus?.click();
      await settle(fixture);

      expect(step).toHaveBeenLastCalledWith(
        expect.objectContaining({ listId: 'list-weekly', itemId: 'item-oil' }),
        'line-oil',
        -1
      );
      expect(lines.addQuantity).toHaveBeenLastCalledWith('line-oil', -1);
      expect(heldLines(fixture, OIL).map((line) => line.quantity)).toEqual([
        '1',
        '2',
      ]);
      // A stepper moves a line. It never adds one and never deletes one of these.
      expect(lines.addLineResult).not.toHaveBeenCalled();
      expect(lines.deleteLine).not.toHaveBeenCalled();
      expect(store.count()).toBe(1);
    });

    it('gives each row its own lines, and a press on one row leaves the other alone', async () => {
      const { fixture, lines } = await render();
      plusOf(fixture, OIL)?.click();
      plusOf(fixture, RICE)?.click();
      await settle(fixture);

      expect(
        host(fixture).querySelectorAll('lib-product-row lib-quantity-stepper')
      ).toHaveLength(2);
      expect(heldLines(fixture, OIL)).toHaveLength(1);
      expect(heldLines(fixture, RICE)).toHaveLength(1);

      heldLines(fixture, RICE)[0]?.plus?.click();
      await settle(fixture);

      expect(lines.addQuantity).toHaveBeenCalledTimes(1);
      expect(lines.addQuantity).toHaveBeenCalledWith(
        'line-list-weekly-item-rice',
        1
      );
      expect(heldLines(fixture, RICE)[0]?.quantity).toBe('2');
      expect(heldLines(fixture, OIL)[0]?.quantity).toBe('1');
    });

    it('takes back a line the plus made with the minus at one, and leaves a line that was there before at zero', async () => {
      const { fixture, lines } = await render('priced', {
        lines: [FRYING_LINE],
      });
      plusOf(fixture, RICE)?.click();
      await settle(fixture);
      expect(heldLines(fixture, RICE)[0]?.quantity).toBe('1');

      // The visit made the rice's line, so nothing of it is left behind.
      heldLines(fixture, RICE)[0]?.minus?.click();
      await settle(fixture);
      expect(lines.deleteLine).toHaveBeenCalledWith(
        'line-list-weekly-item-rice'
      );
      expect(heldLines(fixture, RICE)).toHaveLength(0);
      expect(TestBed.inject(CatalogAddStore).count()).toBe(0);

      // The oil for frying was there before: it goes to zero and stays.
      heldLines(fixture, OIL)[0]?.minus?.click();
      await settle(fixture);
      expect(lines.addQuantity).toHaveBeenCalledWith('line-frying', -1);
      expect(lines.deleteLine).toHaveBeenCalledTimes(1);
      expect(heldLines(fixture, OIL)).toMatchObject([
        { lineId: 'line-frying', quantity: '0' },
      ]);
      // At zero there is nothing fewer to ask for.
      expect(heldLines(fixture, OIL)[0]?.minus?.disabled).toBe(true);
    });

    it('draws a line the person may not change with its stepper out of action, and still offers the plus', async () => {
      // Somebody who can add and cannot decide: an approved line is not theirs to move.
      const { fixture, lines } = await render('priced', {
        lists: [{ ...WEEKLY, myPermissions: ['READ', 'WRITE'] }],
        lines: [OIL_LINE],
      });

      const line = heldLines(fixture, OIL)[0];
      expect(line?.quantity).toBe('2');
      expect(line?.minus?.disabled).toBe(true);
      expect(line?.plus?.disabled).toBe(true);
      line?.plus?.click();
      await settle(fixture);
      expect(lines.addQuantity).not.toHaveBeenCalled();

      expect(plusOf(fixture, OIL)).not.toBeNull();
    });

    it('counts what the visit added on the line, and opens both sheets with the choice kept', async () => {
      const { fixture } = await render('priced', {
        category: 'milk',
        chain: 'chain-mercadona',
      });
      const navigate = jest
        .spyOn(TestBed.inject(Router), 'navigateByUrl')
        .mockResolvedValue(true);
      const bar = () =>
        fixture.debugElement.query(By.directive(AddingBar))
          .componentInstance as AddingBar;

      expect(bar().list()).toBe('Weekly shop');
      expect(bar().count()).toBe(0);

      plusses(fixture)[0]?.click();
      await settle(fixture);
      expect(bar().count()).toBe(1);
      const count = addingBar(fixture)?.querySelector<HTMLButtonElement>(
        '[data-adding="count"]'
      );
      expect(count?.textContent).toContain('catalog.adding.count');

      addingBar(fixture)
        ?.querySelector<HTMLButtonElement>('[data-adding="list"]')
        ?.click();
      expect(lastUrl(navigate)).toBe(
        '/velista/en/catalog/sheet/add-list?category=milk&chain=chain-mercadona'
      );

      count?.click();
      expect(lastUrl(navigate)).toBe(
        '/velista/en/catalog/sheet/added?category=milk&chain=chain-mercadona'
      );
    });

    it('says a failed add once, takes the line back off the row, and takes the sentence down on the next press', async () => {
      const { fixture, lines } = await render();
      expect(addFailed(fixture)).toBe('');
      const live = host(fixture).querySelector('.add-failed');
      expect(live?.getAttribute('role')).toBe('status');
      expect(live?.getAttribute('aria-live')).toBe('polite');

      lines.addLineResult.mockRejectedValueOnce(new Error('offline'));
      plusOf(fixture, OIL)?.click();
      await settle(fixture);

      expect(TestBed.inject(CatalogAddStore).failures()).toBe(1);
      expect(addFailed(fixture)).toBe('catalog.add.failed');
      expect(heldLines(fixture, OIL)).toHaveLength(0);
      expect(
        addingBar(fixture)?.querySelector('[data-adding="count"]')
      ).toBeNull();

      // The next press writes, and the sentence is gone and stays gone.
      plusOf(fixture, RICE)?.click();
      fixture.detectChanges();
      expect(addFailed(fixture)).toBe('');
      await settle(fixture);
      expect(addFailed(fixture)).toBe('');
      expect(heldLines(fixture, RICE)[0]?.quantity).toBe('1');
    });

    it('says a failed step too, and puts the line back at the quantity it had', async () => {
      const { fixture, lines } = await render('priced', { lines: [OIL_LINE] });

      lines.addQuantity.mockRejectedValueOnce(new Error('offline'));
      heldLines(fixture, OIL)[0]?.plus?.click();
      await settle(fixture);

      expect(lines.addQuantity).toHaveBeenCalledWith('line-oil', 1);
      expect(addFailed(fixture)).toBe('catalog.add.failed');
      expect(heldLines(fixture, OIL)[0]?.quantity).toBe('2');
      expect(TestBed.inject(CatalogAddStore).count()).toBe(0);

      heldLines(fixture, OIL)[0]?.plus?.click();
      fixture.detectChanges();
      expect(addFailed(fixture)).toBe('');
      await settle(fixture);
      expect(heldLines(fixture, OIL)[0]?.quantity).toBe('3');
    });

    it('says the lists did not load where the line would be, and reads them again from Try again', async () => {
      const { fixture, adds } = await render('priced', {
        arm: ({ zones }) =>
          zones.listMyZones.mockRejectedValueOnce(new Error('offline')),
      });

      const failed = addsFailed(fixture);
      expect(failed.alert?.getAttribute('role')).toBe('alert');
      expect(failed.text).toBe('catalog.adding.failedLists');
      expect(failed.retry?.textContent?.trim()).toBe('catalog.error.retry');
      // In place of the line, outside the scroller, and not mistaken for no list.
      expect(failed.alert?.closest('.page')).toBeNull();
      expect(addingBar(fixture)).toBeNull();
      expect(plusses(fixture)).toHaveLength(0);
      // The catalog itself is still there to read.
      expect(rows(fixture)).toBeGreaterThan(5);
      expect(adds.zones.listMyZones).toHaveBeenCalledTimes(1);

      failed.retry?.click();
      await settle(fixture);

      expect(adds.zones.listMyZones).toHaveBeenCalledTimes(2);
      expect(addsFailed(fixture).alert).toBeNull();
      expect(
        addingBar(fixture)?.querySelector('.list-name')?.textContent?.trim()
      ).toBe('Weekly shop');
      expect(plusses(fixture)).toHaveLength(rows(fixture));
    });

    it('says the lines of the chosen list did not load, and reads those alone from Try again', async () => {
      const { fixture, adds } = await render('priced', {
        lines: [OIL_LINE],
        arm: ({ lines }) =>
          lines.listLines.mockRejectedValueOnce(new Error('offline')),
      });

      const failed = addsFailed(fixture);
      expect(failed.alert?.getAttribute('role')).toBe('alert');
      expect(failed.text).toBe('catalog.adding.failedLines');
      // The line stays: it is the one way to another list, and the plus still
      // adds to the list it names.
      expect(
        addingBar(fixture)?.querySelector('.list-name')?.textContent?.trim()
      ).toBe('Weekly shop');
      // Whether the list holds the oil is not known, so no line is drawn for it.
      expect(heldLines(fixture, OIL)).toHaveLength(0);

      failed.retry?.click();
      await settle(fixture);

      expect(adds.lines.listLines).toHaveBeenCalledTimes(2);
      // The lists were read once. Only the lines were asked for again.
      expect(adds.zones.listMyZones).toHaveBeenCalledTimes(1);
      expect(addsFailed(fixture).alert).toBeNull();
      expect(
        addingBar(fixture)?.querySelector('.list-name')?.textContent?.trim()
      ).toBe('Weekly shop');
      expect(heldLines(fixture, OIL)).toMatchObject([
        { lineId: 'line-oil', quantity: '2' },
      ]);
    });

    it('says it again when the second try fails too', async () => {
      const { fixture, adds } = await render('priced', {
        arm: ({ zones }) =>
          zones.listMyZones
            .mockRejectedValueOnce(new Error('offline'))
            .mockRejectedValueOnce(new Error('offline')),
      });

      addsFailed(fixture).retry?.click();
      await settle(fixture);

      expect(adds.zones.listMyZones).toHaveBeenCalledTimes(2);
      expect(addsFailed(fixture).text).toBe('catalog.adding.failedLists');
      expect(addingBar(fixture)).toBeNull();
    });
  });

  describe('no filter is reset by choosing another', () => {
    it('opens with the text and the order the URL holds, as a picker hands them back', async () => {
      const { fixture, browse } = await render('priced', {
        chain: 'chain-deza',
        q: 'leche',
        order: 'price',
      });

      expect(field(fixture).value).toBe('leche');
      expect(orderMenu(fixture)).toMatchObject({
        orders: ['relevance', 'category', 'price', 'unitPrice'],
        checked: 'price',
      });
      expect(lastQuery(browse)).toMatchObject({
        query: 'leche',
        order: 'price',
        soldBy: 'chain-deza',
      });
    });

    it('opens text alone on Best match, and ignores an order the text does not offer', async () => {
      const typed = await render('priced', { q: 'leche' });
      expect(lastQuery(typed.browse)).toMatchObject({ order: 'relevance' });

      const plain = await render('priced', { order: 'relevance' });
      expect(lastQuery(plain.browse)).toMatchObject({
        query: '',
        order: 'category',
      });

      // An order the read no longer has, as an old link still names it.
      const old = await render('priced', { q: 'leche', order: 'created' });
      expect(lastQuery(old.browse)).toMatchObject({ order: 'relevance' });
      const older = await render('priced', { order: 'name' });
      expect(lastQuery(older.browse)).toMatchObject({ order: 'category' });
      expect(orderMenu(older.fixture).checked).toBe('category');
    });

    it('writes the text and the order into the URL in place of the entry, as they change', async () => {
      const { fixture } = await render('priced', { chain: 'chain-deza' });
      const router = TestBed.inject(Router);
      const navigate = jest
        .spyOn(router, 'navigateByUrl')
        .mockResolvedValue(true);
      jest.spyOn(router, 'url', 'get').mockReturnValue('/velista/en/catalog');
      jest.useFakeTimers();

      const input = field(fixture);
      input.value = 'leche';
      input.dispatchEvent(new Event('input'));
      jest.advanceTimersByTime(CATALOG_SEARCH_DEBOUNCE_MS);
      await settle(fixture);

      expect(lastUrl(navigate)).toBe(
        '/velista/en/catalog?chain=chain-deza&q=leche'
      );
      expect(navigate.mock.calls[navigate.mock.calls.length - 1][1]).toEqual({
        replaceUrl: true,
      });

      chooseOrder(fixture, 'price');
      await settle(fixture);

      expect(lastUrl(navigate)).toBe(
        '/velista/en/catalog?chain=chain-deza&q=leche&order=price'
      );
    });

    it('hands the text and the order to both pickers', async () => {
      const { fixture } = await render('priced', {
        chain: 'chain-deza',
        q: 'leche',
        order: 'price',
      });
      const navigate = jest
        .spyOn(TestBed.inject(Router), 'navigateByUrl')
        .mockResolvedValue(true);

      selector(fixture, 'supermarket').body.click();
      expect(lastUrl(navigate)).toBe(
        '/velista/en/catalog/supermarket?chain=chain-deza&q=leche&order=price'
      );
      selector(fixture, 'category').body.click();
      expect(lastUrl(navigate)).toBe(
        '/velista/en/catalog/categories?chain=chain-deza&q=leche&order=price'
      );
    });

    it('carries what is in the field to a picker opened before the debounce', async () => {
      const { fixture } = await render();
      const navigate = jest
        .spyOn(TestBed.inject(Router), 'navigateByUrl')
        .mockResolvedValue(true);
      jest.useFakeTimers();

      const input = field(fixture);
      input.value = 'leche';
      input.dispatchEvent(new Event('input'));
      selector(fixture, 'supermarket').body.click();

      expect(lastUrl(navigate)).toBe('/velista/en/catalog/supermarket?q=leche');
    });

    it('reads the text again on a pop onto another entry of the tab', async () => {
      const { fixture, browse, query } = await render('priced', {
        q: 'leche',
      });

      query.next(convertToParamMap({ category: 'milk' }));
      await settle(fixture);

      expect(field(fixture).value).toBe('');
      expect(lastQuery(browse)).toMatchObject({
        query: '',
        order: 'category',
        categoryId: 'cat-milk',
      });
    });
  });

  describe('through the real router', () => {
    @Component({ template: '' })
    class PickerStub {}

    /** Real time, because the router and the debounce both have to run. */
    async function wait(harness: RouterTestingHarness): Promise<void> {
      await new Promise((resolve) =>
        setTimeout(resolve, CATALOG_SEARCH_DEBOUNCE_MS + 100)
      );
      harness.detectChanges();
    }

    it('keeps the text and the order across a picker, and across a pop back onto the tab', async () => {
      TestBed.resetTestingModule();
      const memory = new CatalogBrowseMemory();
      const browse = jest.spyOn(memory, 'browse');
      await TestBed.configureTestingModule({
        imports: [RokuTranslatorTestingModule.forTesting()],
        providers: [
          provideVelistaTesting({ basePath: '/velista' }),
          provideRouter([
            { path: 'velista/en/catalog', component: CatalogPage },
            { path: 'velista/en/catalog/supermarket', component: PickerStub },
          ]),
          provideFakeCategoryStore(fakeCategoryStore(MEMORY_CATEGORIES)),
          ...fakeAdds().providers,
          { provide: CATALOG_BROWSE_SERVICE, useValue: memory },
          { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
        ],
      }).compileComponents();
      const router = TestBed.inject(Router);
      const location = TestBed.inject(Location);
      // A test bed's router does not listen for a pop until it is told to.
      router.setUpLocationChangeListener();
      const harness = await RouterTestingHarness.create(
        '/velista/en/catalog?chain=chain-deza'
      );
      const page = () => harness.routeNativeElement as HTMLElement;
      const input = () =>
        page().querySelector<HTMLInputElement>('#catalog-search');
      const shown = () =>
        page().querySelector('lib-order-menu .control-value')?.textContent;
      await wait(harness);

      // Typing, then an order: both land in the URL, and the field keeps its text.
      const field = input() as HTMLInputElement;
      field.value = 'leche';
      field.dispatchEvent(new Event('input'));
      await wait(harness);
      orderControl(page()).click();
      harness.detectChanges();
      orderOptions()
        .find((option) => option.dataset['order'] === 'price')
        ?.click();
      await wait(harness);
      expect(router.url).toBe(
        '/velista/en/catalog?chain=chain-deza&q=leche&order=price'
      );
      expect(input()?.value).toBe('leche');

      // The picker, a page of its own: the tab is destroyed under it.
      page()
        .querySelector<HTMLButtonElement>('[data-selector="supermarket"]')
        ?.click();
      await wait(harness);
      expect(router.url).toBe(
        '/velista/en/catalog/supermarket?chain=chain-deza&q=leche&order=price'
      );

      // The chevron pops onto the tab's entry, which was written in place.
      location.back();
      await wait(harness);
      expect(router.url).toBe(
        '/velista/en/catalog?chain=chain-deza&q=leche&order=price'
      );
      expect(input()?.value).toBe('leche');
      expect(shown()).toContain('catalog.order.short.price');
      expect(lastQuery(browse)).toMatchObject({
        query: 'leche',
        order: 'price',
        soldBy: 'chain-deza',
      });

      // An answer from the picker: another chain, everything else as it was.
      await harness.navigateByUrl(
        '/velista/en/catalog?chain=chain-mercadona&q=leche&order=price'
      );
      await wait(harness);
      expect(input()?.value).toBe('leche');
      expect(shown()).toContain('catalog.order.short.price');
      expect(lastQuery(browse)).toMatchObject({
        query: 'leche',
        order: 'price',
        soldBy: 'chain-mercadona',
      });
    });
  });

  describe('a category (velista 0119)', () => {
    it('opens the page of parents from the Category selector', async () => {
      const { fixture, browse } = await render();
      const navigate = jest
        .spyOn(TestBed.inject(Router), 'navigateByUrl')
        .mockResolvedValue(true);

      expect(lastQuery(browse)).toMatchObject({ categoryId: null });
      selector(fixture, 'category').body.click();

      expect(lastUrl(navigate)).toBe('/velista/en/catalog/categories');
    });

    it('reads a leaf from the URL, sends its id, and draws the leaf alone on the selector', async () => {
      const { fixture, browse } = await render('priced', { category: 'milk' });
      const navigate = jest
        .spyOn(TestBed.inject(Router), 'navigateByUrl')
        .mockResolvedValue(true);

      expect(lastQuery(browse)).toMatchObject({ categoryId: 'cat-milk' });
      expect(rows(fixture)).toBe(2);

      const chosen = selector(fixture, 'category');
      expect(chosen.text).toBe('Milk');
      expect(chosen.label).toBe('catalog.selector.categoryLeaf');
      expect(field(fixture).placeholder).toBe('catalog.categories.search');

      // Its body reopens the root's children page, carrying the choice to mark.
      chosen.body.click();
      expect(lastUrl(navigate)).toBe(
        '/velista/en/catalog/categories/eggs-milk-and-butter?category=milk'
      );
    });

    it('draws a chosen root by its name alone', async () => {
      const { fixture, browse } = await render('priced', {
        category: 'eggs-milk-and-butter',
      });

      expect(lastQuery(browse)).toMatchObject({
        categoryId: 'cat-eggs-milk-and-butter',
      });
      expect(rows(fixture)).toBe(4);
      const chosen = selector(fixture, 'category');
      expect(chosen.text).toBe('Eggs, milk, and butter');
      expect(chosen.label).toBe('catalog.selector.categoryRoot');
    });

    it('keeps the choice through a chain and a search, and the chain through the choice', async () => {
      const { fixture, browse, query } = await render('priced', {
        category: 'milk',
      });
      jest.useFakeTimers();

      query.next(convertToParamMap({ category: 'milk', chain: 'chain-deza' }));
      await settle(fixture);
      expect(lastQuery(browse)).toMatchObject({
        categoryId: 'cat-milk',
        soldBy: 'chain-deza',
      });
      expect(field(fixture).placeholder).toBe('catalog.categories.searchChain');

      const input = field(fixture);
      input.value = 'leche';
      input.dispatchEvent(new Event('input'));
      jest.advanceTimersByTime(CATALOG_SEARCH_DEBOUNCE_MS);
      await settle(fixture);
      expect(lastQuery(browse)).toMatchObject({
        query: 'leche',
        categoryId: 'cat-milk',
        soldBy: 'chain-deza',
      });

      // The cross pressed: the URL loses the parameter, and the chain and the text stay.
      query.next(convertToParamMap({ chain: 'chain-deza', q: 'leche' }));
      await settle(fixture);
      expect(lastQuery(browse)).toMatchObject({
        query: 'leche',
        categoryId: null,
        soldBy: 'chain-deza',
      });
    });

    it('clears by navigating to the tab without the parameter, not by popping', async () => {
      const { fixture } = await render('priced', { category: 'milk' });
      const navigate = jest
        .spyOn(TestBed.inject(Router), 'navigateByUrl')
        .mockResolvedValue(true);

      const cross = selector(fixture, 'category').clear;
      expect(cross?.getAttribute('aria-label')).toBe(
        'catalog.categories.clear'
      );
      cross?.click();

      expect(lastUrl(navigate)).toBe('/velista/en/catalog');
      // Pushed, so back returns to the narrowed tab.
      expect(
        navigate.mock.calls[navigate.mock.calls.length - 1][1]
      ).toBeUndefined();
    });

    it('names the leaf and the chain when the chain has nothing in it', async () => {
      const { fixture } = await render('priced', {
        category: 'eggs',
        chain: 'chain-deza',
      });

      expect(rows(fixture)).toBe(0);
      const text = host(fixture).textContent ?? '';
      expect(text).toContain('catalog.categories.emptyChainTitle');
      expect(text).toContain('catalog.categories.emptyChainBody');
      expect(
        host(fixture).querySelector('.empty button')?.textContent
      ).toContain('catalog.categories.clear');
    });

    it('drops a slug the tree does not hold and opens the tab plain', async () => {
      // Spied on the prototype, because the page navigates while it is created.
      const navigate = jest
        .spyOn(Router.prototype, 'navigateByUrl')
        .mockResolvedValue(true);

      const { browse } = await render('priced', {
        category: 'not-a-category',
      });

      expect(lastUrl(navigate)).toBe('/velista/en/catalog');
      expect(navigate.mock.calls[navigate.mock.calls.length - 1][1]).toEqual({
        replaceUrl: true,
      });
      expect(browse).not.toHaveBeenCalled();
      navigate.mockRestore();
    });

    it('asks for the tree first, and lists everything when it could not be read', async () => {
      // A fake whose ensure answers without the tree landing: a failed read.
      const tree = fakeCategoryStore();
      const { fixture, browse } = await render('priced', {
        category: 'milk',
        tree,
      });

      expect(tree.ensured()).toBeGreaterThan(0);
      expect(browse).toHaveBeenCalledTimes(1);
      expect(lastQuery(browse)).toMatchObject({ categoryId: null });
      expect(rows(fixture)).toBeGreaterThan(5);
    });
  });

  describe('with no postal code (0069, section 2)', () => {
    it('lists the whole catalog, every row saying no price, under one card', async () => {
      const { fixture } = await render('noPlace');

      expect(rows(fixture)).toBeGreaterThan(5);
      expect(host(fixture).querySelectorAll('.card')).toHaveLength(1);
      expect(host(fixture).querySelector('.card')?.textContent).toContain(
        'catalog.noScope.title'
      );
      expect(host(fixture).querySelectorAll('.no-price').length).toBe(
        rows(fixture)
      );
      expect(host(fixture).querySelector('.price')).toBeNull();
    });

    it('draws its own sentence when every chain was refused, still over a full list', async () => {
      const { fixture } = await render('refused');

      expect(rows(fixture)).toBeGreaterThan(5);
      expect(host(fixture).querySelector('.card')?.textContent).toContain(
        'catalog.refused.title'
      );
    });
  });
});
