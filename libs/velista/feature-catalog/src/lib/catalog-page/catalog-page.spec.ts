import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
  Router,
  type ParamMap,
  type UrlTree,
} from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  CATALOG_BROWSE_SERVICE,
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
import { BehaviorSubject } from 'rxjs';
import { CATALOG_SEARCH_DEBOUNCE_MS, CatalogPage } from './catalog-page';

interface Harness {
  readonly fixture: ComponentFixture<CatalogPage>;
  readonly memory: CatalogBrowseMemory;
  readonly browse: jest.SpyInstance;
  /** The tab's query parameters, which a test moves as a navigation would. */
  readonly query: BehaviorSubject<ParamMap>;
  readonly tree: FakeCategoryStore;
}

interface RenderOptions {
  /** The slug in `?category=` on arrival. */
  readonly category?: string;
  /** The chain in `?chain=` on arrival (velista 0124). */
  readonly chain?: string;
  /** The shop in `?shop=` on arrival (velista 0124). */
  readonly shop?: string;
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
    })
  );
  const tree = options.tree ?? fakeCategoryStore(MEMORY_CATEGORIES);

  await TestBed.configureTestingModule({
    imports: [CatalogPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      provideRouter([]),
      provideFakeCategoryStore(tree),
      { provide: ActivatedRoute, useValue: { queryParamMap: query } },
      { provide: CATALOG_BROWSE_SERVICE, useValue: memory },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(CatalogPage);
  fixture.detectChanges();
  await settle(fixture);
  await settle(fixture);

  return { fixture, memory, browse, query, tree };
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

/** The pills, as the order values of their radios, and which one is checked. */
function pills(fixture: ComponentFixture<CatalogPage>): {
  orders: string[];
  checked: string | null;
} {
  const radios = [
    ...host(fixture).querySelectorAll<HTMLInputElement>(
      'lib-order-pills input'
    ),
  ];
  return {
    orders: radios.map((radio) => radio.value),
    checked: radios.find((radio) => radio.checked)?.value ?? null,
  };
}

/** The Supermarket button's body (velista 0124). */
function supermarket(fixture: ComponentFixture<CatalogPage>): HTMLElement {
  const found = host(fixture).querySelector<HTMLElement>(
    'lib-supermarket-button'
  );
  if (found === null) {
    throw new Error('no Supermarket button');
  }
  return found;
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

  it('opens on A to Z, with no Best match and a full list', async () => {
    const { fixture, browse } = await render();

    expect(pills(fixture)).toEqual({
      orders: ['name', 'created'],
      checked: 'name',
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

  it('says where the prices are from at the end of the tools row, not in the header', async () => {
    const { fixture } = await render();
    const near = host(fixture).querySelector('.near');

    expect(near?.textContent).toContain('catalog.near');
    expect(near?.closest('.tools')).not.toBeNull();
    expect(near?.closest('lib-page-header')).toBeNull();
    expect(near?.previousElementSibling?.tagName).toBe('LIB-ORDER-PILLS');
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
    expect(pills(fixture)).toEqual({
      orders: ['relevance', 'name', 'created'],
      checked: 'relevance',
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

    expect(pills(fixture)).toEqual({
      orders: ['name', 'created'],
      checked: 'name',
    });
    expect(lastQuery(browse)).toMatchObject({ query: '', order: 'name' });
  });

  it('draws one Supermarket button, reading All supermarkets, and no chain chips', async () => {
    const { fixture } = await render();

    expect(host(fixture).querySelector('lib-chain-chips')).toBeNull();
    const button = supermarket(fixture);
    expect(button.textContent).toContain('catalog.supermarket.label');
    expect(button.textContent).toContain('catalog.supermarket.all');
    // Nothing chosen: a chevron, and no x.
    expect(button.querySelector('.clear')).toBeNull();
    expect(field(fixture).placeholder).toBe('catalog.search.all');
  });

  it('opens the picker page with the choice it holds', async () => {
    const { fixture } = await render('priced', {
      category: 'milk',
      chain: 'chain-deza',
    });
    const navigate = jest
      .spyOn(TestBed.inject(Router), 'navigateByUrl')
      .mockResolvedValue(true);

    supermarket(fixture).querySelector<HTMLButtonElement>('.body')?.click();

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
    // "Deza · any shop", with the x in place of the chevron.
    const button = supermarket(fixture);
    expect(button.textContent).toContain('Deza');
    expect(button.textContent).toContain('catalog.supermarket.anyShop');
    expect(button.querySelector('.clear')?.getAttribute('aria-label')).toBe(
      'catalog.supermarket.clear'
    );
    expect(host(fixture).textContent).toContain('catalog.chain.shops');
  });

  it('goes back to every supermarket with the x, pushed, keeping the category', async () => {
    const { fixture, browse, query } = await render('priced', {
      category: 'milk',
      chain: 'chain-deza',
    });
    const navigate = jest
      .spyOn(TestBed.inject(Router), 'navigateByUrl')
      .mockResolvedValue(true);

    supermarket(fixture).querySelector<HTMLButtonElement>('.clear')?.click();
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
    expect(supermarket(fixture).textContent).toContain('Calle Mayor 3');
    expect(host(fixture).querySelector('.note')?.textContent).toContain(
      'catalog.supermarket.pricesAt'
    );
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
      expect(supermarket(fixture).textContent).toContain('Calle Mayor 3');
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

    const status = host(fixture).querySelector('[role="status"]');
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

  it('opens a product sheet under the sheet segment', async () => {
    const { fixture } = await render();
    const router = TestBed.inject(Router);
    const navigate = jest
      .spyOn(router, 'navigateByUrl')
      .mockResolvedValue(true);

    host(fixture)
      .querySelector<HTMLButtonElement>('lib-product-row button')
      ?.click();

    expect(lastUrl(navigate)).toMatch(
      /^\/velista\/en\/catalog\/sheet\/products\/item-[a-z-]+$/
    );
  });

  describe('a category (velista 0119)', () => {
    function categoriesLink(fixture: ComponentFixture<CatalogPage>) {
      return host(fixture).querySelector<HTMLAnchorElement>(
        'a.categories-link'
      );
    }

    function categoryChip(fixture: ComponentFixture<CatalogPage>) {
      return host(fixture).querySelector<HTMLAnchorElement>(
        'a.category-chip-body'
      );
    }

    it('leads the chip row with a link to the page of parents, outside the Shops group', async () => {
      const { fixture, browse } = await render();

      const link = categoriesLink(fixture);
      expect(link?.getAttribute('href')).toBe('/velista/en/catalog/categories');
      expect(link?.textContent).toContain('catalog.categories.open');
      expect(link?.closest('[role="group"]')).toBeNull();
      expect(lastQuery(browse)).toMatchObject({ categoryId: null });
    });

    it('reads a leaf from the URL, sends its id, and draws root and leaf on the chip', async () => {
      const { fixture, browse } = await render('priced', { category: 'milk' });

      expect(lastQuery(browse)).toMatchObject({ categoryId: 'cat-milk' });
      expect(rows(fixture)).toBe(2);
      expect(categoriesLink(fixture)).toBeNull();

      const chipBody = categoryChip(fixture);
      expect(chipBody?.textContent).toContain('Eggs, milk, and butter');
      expect(chipBody?.textContent).toContain('Milk');
      expect(chipBody?.getAttribute('aria-label')).toBe(
        'catalog.categories.chip'
      );
      // Its body reopens the root's children page, carrying the choice to mark.
      expect(chipBody?.getAttribute('href')).toBe(
        '/velista/en/catalog/categories/eggs-milk-and-butter?category=milk'
      );
      expect(field(fixture).placeholder).toBe('catalog.categories.search');
    });

    it('draws a chosen root by its name alone', async () => {
      const { fixture, browse } = await render('priced', {
        category: 'eggs-milk-and-butter',
      });

      expect(lastQuery(browse)).toMatchObject({
        categoryId: 'cat-eggs-milk-and-butter',
      });
      expect(rows(fixture)).toBe(4);
      expect(host(fixture).querySelector('.category-chip-root')).toBeNull();
      expect(categoryChip(fixture)?.getAttribute('aria-label')).toBe(
        'catalog.categories.chipRoot'
      );
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

      // The chip cleared: the URL loses the parameter and the chain stays.
      query.next(convertToParamMap({ chain: 'chain-deza' }));
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

      host(fixture)
        .querySelector<HTMLButtonElement>('.category-chip-clear')
        ?.click();

      expect(lastUrl(navigate)).toBe('/velista/en/catalog');
      expect(
        host(fixture)
          .querySelector('.category-chip-clear')
          ?.getAttribute('aria-label')
      ).toBe('catalog.categories.clear');
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

    it('keeps the choice in the URL of the product sheet it opens', async () => {
      const { fixture } = await render('priced', { category: 'milk' });
      const navigate = jest
        .spyOn(TestBed.inject(Router), 'navigateByUrl')
        .mockResolvedValue(true);

      host(fixture)
        .querySelector<HTMLButtonElement>('lib-product-row button')
        ?.click();

      expect(lastUrl(navigate)).toMatch(
        /^\/velista\/en\/catalog\/sheet\/products\/item-milk[a-z-]*\?category=milk$/
      );
    });

    it('keeps the chain and the shop in the URL of the product sheet too (velista 0124)', async () => {
      const { fixture } = await render('priced', {
        category: 'milk',
        chain: 'chain-mercadona',
        shop: 'location-mercadona-mayor',
      });
      const navigate = jest
        .spyOn(TestBed.inject(Router), 'navigateByUrl')
        .mockResolvedValue(true);

      host(fixture)
        .querySelector<HTMLButtonElement>('lib-product-row button')
        ?.click();

      expect(lastUrl(navigate)).toMatch(
        /\?category=milk&chain=chain-mercadona&shop=location-mercadona-mayor$/
      );
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
