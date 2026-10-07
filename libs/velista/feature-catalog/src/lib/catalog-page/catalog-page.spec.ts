import { Location } from '@angular/common';
import { Component, signal, type Provider } from '@angular/core';
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
  LINE_SERVICE,
  LIST_SERVICE,
  MEMORY_CATEGORIES,
  provideFakeCategoryStore,
  SessionStore,
  ZONE_SERVICE,
  type FakeCategoryStore,
} from '@portfolio/velista/data-access';
import type {
  CatalogBrowseQuery,
  CatalogLocation,
  CatalogPriceState,
  ListPermission,
} from '@portfolio/velista/models';
import {
  provideFakeBrowserFacade,
  provideVelistaTesting,
} from '@portfolio/velista/platform';
import { AddingBar } from '@portfolio/velista/ui';
import { BehaviorSubject } from 'rxjs';
import { CATALOG_SEARCH_DEBOUNCE_MS, CatalogPage } from './catalog-page';

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

interface AddOptions {
  /** The lists of the person. One list they can write to unless a test says. */
  readonly lists?: readonly FakeList[];
  /** A guest, who is never asked for lists. */
  readonly guest?: boolean;
}

/**
 * The real `CatalogAddStore` over doubles of what it reads and writes. The line
 * double keeps each quantity, so a step answers what the server would.
 */
function fakeAdds(options: AddOptions = {}) {
  const lists = options.lists ?? [WEEKLY];
  const zones = [
    ...new Map(
      lists.map((list) => [
        list.zoneId,
        { id: list.zoneId, name: list.zoneName, myStatus: 'APPROVED' },
      ])
    ).values(),
  ];
  const quantities = new Map<string, number>();
  const lines = {
    addLineResult: jest.fn(
      async (
        listId: string,
        _content: string,
        quantity = 1,
        itemIds: readonly string[] = []
      ) => {
        const id = `line-${listId}-${itemIds[0]}`;
        quantities.set(id, quantity);
        return {
          line: { id, quantity, approvalStatus: 'APPROVED' },
          merged: false,
        };
      }
    ),
    addQuantity: jest.fn(async (lineId: string, delta: number) => {
      const quantity = (quantities.get(lineId) ?? 0) + delta;
      quantities.set(lineId, quantity);
      return { id: lineId, quantity, approvalStatus: 'APPROVED' };
    }),
    deleteLine: jest.fn(async (lineId: string) => lineId),
  };
  const providers: Provider[] = [
    CatalogAddStore,
    provideFakeBrowserFacade(new Map()),
    {
      provide: SessionStore,
      useValue: { isGuest: signal(options.guest === true) },
    },
    {
      provide: ZONE_SERVICE,
      useValue: {
        listMyZones: async () => ({ items: zones, nextCursor: null }),
      },
    },
    {
      provide: LIST_SERVICE,
      useValue: {
        listLists: async (zoneId: string) => ({
          items: lists.filter((list) => list.zoneId === zoneId),
          nextCursor: null,
        }),
      },
    },
    { provide: LINE_SERVICE, useValue: lines },
  ];
  return { lines, providers };
}

interface Harness {
  readonly fixture: ComponentFixture<CatalogPage>;
  readonly memory: CatalogBrowseMemory;
  readonly browse: jest.SpyInstance;
  /** The tab's query parameters, which a test moves as a navigation would. */
  readonly query: BehaviorSubject<ParamMap>;
  readonly tree: FakeCategoryStore;
  /** The line service double the store writes through. */
  readonly lines: ReturnType<typeof fakeAdds>['lines'];
}

interface RenderOptions extends AddOptions {
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
  for (let tick = 0; tick < 10; tick++) {
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

  return { fixture, memory, browse, query, tree, lines: adds.lines };
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

/** The trailing control of each row: the plus, or the count after an add. */
function plusses(fixture: ComponentFixture<CatalogPage>): HTMLButtonElement[] {
  return [
    ...host(fixture).querySelectorAll<HTMLButtonElement>(
      'lib-product-row button.add'
    ),
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
      orders: ['name'],
      checked: 'name',
      shown: 'catalog.order.short.name',
    });
    expect(lastQuery(browse)).toMatchObject({
      query: '',
      order: 'name',
      soldBy: null,
      priceScopeIds: [],
    });
    expect(rows(fixture)).toBeGreaterThan(5);
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
      orders: ['relevance', 'name'],
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
      orders: ['name'],
      checked: 'name',
    });
    expect(lastQuery(browse)).toMatchObject({ query: '', order: 'name' });
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

    host(fixture)
      .querySelector<HTMLButtonElement>('lib-product-row button.open')
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

    it('offers the catalog order alone with an empty field, and Best match beside it with text', async () => {
      const plain = await render();
      expect(orderMenu(plain.fixture).orders).toEqual(['name']);

      const typed = await render('priced', { q: 'leche' });
      expect(orderMenu(typed.fixture)).toEqual({
        orders: ['relevance', 'name'],
        checked: 'relevance',
        shown: 'catalog.order.short.relevance',
      });
    });

    it('reads again in the order a row of the menu names', async () => {
      const { fixture, browse } = await render('priced', { q: 'leche' });

      chooseOrder(fixture, 'name');
      await settle(fixture);

      expect(lastQuery(browse)).toMatchObject({
        query: 'leche',
        order: 'name',
      });
      expect(orderMenu(fixture).checked).toBe('name');
    });
  });

  describe('adding from a row (velista 0134, section 4)', () => {
    it('draws a plus on every row and the line that names the list', async () => {
      const { fixture } = await render();

      expect(plusses(fixture)).toHaveLength(rows(fixture));
      expect(plusses(fixture)[0]?.getAttribute('aria-label')).toBe(
        'catalog.add.label'
      );
      // A sibling of the row's own button, never a child of it.
      expect(plusses(fixture)[0]?.closest('button.open')).toBeNull();

      const bar = addingBar(fixture);
      expect(bar?.querySelector('.list-name')?.textContent?.trim()).toBe(
        'Weekly shop'
      );
      // Nothing added yet, so no count.
      expect(bar?.querySelector('[data-adding="count"]')).toBeNull();
      // Outside the scroller, so it stays above the tab bar.
      expect(bar?.closest('.page')).toBeNull();
    });

    it('draws no plus and no line for a guest', async () => {
      const { fixture } = await render('priced', { guest: true });

      expect(rows(fixture)).toBeGreaterThan(5);
      expect(plusses(fixture)).toHaveLength(0);
      expect(addingBar(fixture)).toBeNull();
    });

    it('draws no plus and no line for a person with no list they can write to', async () => {
      const { fixture } = await render('priced', {
        lists: [{ ...WEEKLY, myPermissions: ['READ'] }],
      });

      expect(rows(fixture)).toBeGreaterThan(5);
      expect(plusses(fixture)).toHaveLength(0);
      expect(addingBar(fixture)).toBeNull();
    });

    it('adds one of the product, by its id and its name, when the plus is pressed', async () => {
      const { fixture, lines } = await render();
      const add = jest.spyOn(TestBed.inject(CatalogAddStore), 'add');

      plusses(fixture)[0]?.click();
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
      // The plus now shows the count for that list.
      expect(plusses(fixture)[0]?.classList.contains('has-count')).toBe(true);
      expect(plusses(fixture)[0]?.textContent?.trim()).toBe('1');
    });

    it('opens one stepper at a time from a count, and every press on it saves', async () => {
      const { fixture, lines } = await render();
      plusses(fixture)[0]?.click();
      plusses(fixture)[1]?.click();
      await settle(fixture);
      const steppers = () =>
        host(fixture).querySelectorAll('lib-product-row lib-quantity-stepper');

      plusses(fixture)[0]?.click();
      fixture.detectChanges();
      expect(steppers()).toHaveLength(1);

      // The other row's count: its stepper opens and the first one closes.
      plusses(fixture)[0]?.click();
      fixture.detectChanges();
      expect(steppers()).toHaveLength(1);
      expect(
        steppers()[0]
          ?.closest('li')
          ?.querySelector('button.open')
          ?.getAttribute('aria-label')
      ).toContain('Short grain rice');

      steppers()[0]
        ?.querySelectorAll<HTMLButtonElement>('button.step')[1]
        ?.click();
      await settle(fixture);
      expect(lines.addQuantity).toHaveBeenCalledWith(
        'line-list-weekly-item-rice',
        1
      );
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

    it('says a failed add once, puts the count back, and takes the sentence down on the next press', async () => {
      const { fixture, lines } = await render();
      expect(addFailed(fixture)).toBe('');
      const live = host(fixture).querySelector('.add-failed');
      expect(live?.getAttribute('role')).toBe('status');
      expect(live?.getAttribute('aria-live')).toBe('polite');

      lines.addLineResult.mockRejectedValueOnce(new Error('offline'));
      plusses(fixture)[0]?.click();
      await settle(fixture);

      expect(TestBed.inject(CatalogAddStore).failures()).toBe(1);
      expect(addFailed(fixture)).toBe('catalog.add.failed');
      expect(plusses(fixture)[0]?.classList.contains('has-count')).toBe(false);
      expect(
        addingBar(fixture)?.querySelector('[data-adding="count"]')
      ).toBeNull();

      // The next press writes, and the sentence is gone and stays gone.
      plusses(fixture)[1]?.click();
      fixture.detectChanges();
      expect(addFailed(fixture)).toBe('');
      await settle(fixture);
      expect(addFailed(fixture)).toBe('');
      expect(plusses(fixture)[1]?.textContent?.trim()).toBe('1');
    });
  });

  describe('no filter is reset by choosing another', () => {
    it('opens with the text and the order the URL holds, as a picker hands them back', async () => {
      const { fixture, browse } = await render('priced', {
        chain: 'chain-deza',
        q: 'leche',
        order: 'name',
      });

      expect(field(fixture).value).toBe('leche');
      expect(orderMenu(fixture)).toMatchObject({
        orders: ['relevance', 'name'],
        checked: 'name',
      });
      expect(lastQuery(browse)).toMatchObject({
        query: 'leche',
        order: 'name',
        soldBy: 'chain-deza',
      });
    });

    it('opens text alone on Best match, and ignores an order the text does not offer', async () => {
      const typed = await render('priced', { q: 'leche' });
      expect(lastQuery(typed.browse)).toMatchObject({ order: 'relevance' });

      const plain = await render('priced', { order: 'relevance' });
      expect(lastQuery(plain.browse)).toMatchObject({
        query: '',
        order: 'name',
      });

      // An order the read no longer has, as an old link still names it.
      const old = await render('priced', { q: 'leche', order: 'created' });
      expect(lastQuery(old.browse)).toMatchObject({ order: 'relevance' });
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

      chooseOrder(fixture, 'name');
      await settle(fixture);

      expect(lastUrl(navigate)).toBe(
        '/velista/en/catalog?chain=chain-deza&q=leche&order=name'
      );
    });

    it('hands the text and the order to both pickers', async () => {
      const { fixture } = await render('priced', {
        chain: 'chain-deza',
        q: 'leche',
        order: 'name',
      });
      const navigate = jest
        .spyOn(TestBed.inject(Router), 'navigateByUrl')
        .mockResolvedValue(true);

      selector(fixture, 'supermarket').body.click();
      expect(lastUrl(navigate)).toBe(
        '/velista/en/catalog/supermarket?chain=chain-deza&q=leche&order=name'
      );
      selector(fixture, 'category').body.click();
      expect(lastUrl(navigate)).toBe(
        '/velista/en/catalog/categories?chain=chain-deza&q=leche&order=name'
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
        order: 'name',
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
        .find((option) => option.dataset['order'] === 'name')
        ?.click();
      await wait(harness);
      expect(router.url).toBe(
        '/velista/en/catalog?chain=chain-deza&q=leche&order=name'
      );
      expect(input()?.value).toBe('leche');

      // The picker, a page of its own: the tab is destroyed under it.
      page()
        .querySelector<HTMLButtonElement>('[data-selector="supermarket"]')
        ?.click();
      await wait(harness);
      expect(router.url).toBe(
        '/velista/en/catalog/supermarket?chain=chain-deza&q=leche&order=name'
      );

      // The chevron pops onto the tab's entry, which was written in place.
      location.back();
      await wait(harness);
      expect(router.url).toBe(
        '/velista/en/catalog?chain=chain-deza&q=leche&order=name'
      );
      expect(input()?.value).toBe('leche');
      expect(shown()).toContain('catalog.order.short.name');
      expect(lastQuery(browse)).toMatchObject({
        query: 'leche',
        order: 'name',
        soldBy: 'chain-deza',
      });

      // An answer from the picker: another chain, everything else as it was.
      await harness.navigateByUrl(
        '/velista/en/catalog?chain=chain-mercadona&q=leche&order=name'
      );
      await wait(harness);
      expect(input()?.value).toBe('leche');
      expect(shown()).toContain('catalog.order.short.name');
      expect(lastQuery(browse)).toMatchObject({
        query: 'leche',
        order: 'name',
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
