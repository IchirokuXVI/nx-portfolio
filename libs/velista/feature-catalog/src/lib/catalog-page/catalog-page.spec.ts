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
    convertToParamMap(
      options.category === undefined ? {} : { category: options.category }
    )
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

function chip(
  fixture: ComponentFixture<CatalogPage>,
  name: string
): HTMLButtonElement {
  const found = [
    ...host(fixture).querySelectorAll<HTMLButtonElement>(
      'lib-chain-chips button'
    ),
  ].find((button) => button.textContent?.trim() === name);
  if (found === undefined) {
    throw new Error(`no chip ${name}`);
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

  it('narrows to one chain, prices from its scopes, and names it in the placeholder', async () => {
    const { fixture, browse } = await render();
    expect(field(fixture).placeholder).toBe('catalog.search.all');

    chip(fixture, 'Deza').click();
    await settle(fixture);

    expect(lastQuery(browse)).toMatchObject({
      soldBy: 'chain-deza',
      priceScopeIds: ['scope-chain-deza'],
    });
    expect(field(fixture).placeholder).toBe('catalog.search.chain');
    expect(chip(fixture, 'Deza').getAttribute('aria-pressed')).toBe('true');
    expect(host(fixture).textContent).toContain('catalog.chain.shops');
  });

  it('puts every chain back when the chosen chip is pressed again', async () => {
    const { fixture, browse } = await render();

    chip(fixture, 'Deza').click();
    await settle(fixture);
    chip(fixture, 'Deza').click();
    await settle(fixture);

    expect(lastQuery(browse)).toMatchObject({
      soldBy: null,
      priceScopeIds: [],
    });
    expect(field(fixture).placeholder).toBe('catalog.search.all');
    expect(
      chip(fixture, 'catalog.chips.all').getAttribute('aria-pressed')
    ).toBe('true');
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
      expect(rows(fixture)).toBe(3);
      expect(categoriesLink(fixture)).toBeNull();

      const chipBody = categoryChip(fixture);
      expect(chipBody?.textContent).toContain('Dairy and eggs');
      expect(chipBody?.textContent).toContain('Milk');
      expect(chipBody?.getAttribute('aria-label')).toBe(
        'catalog.categories.chip'
      );
      // Its body reopens the root's children page, carrying the choice to mark.
      expect(chipBody?.getAttribute('href')).toBe(
        '/velista/en/catalog/categories/dairy-and-eggs?category=milk'
      );
      expect(field(fixture).placeholder).toBe('catalog.categories.search');
    });

    it('draws a chosen root by its name alone', async () => {
      const { fixture, browse } = await render('priced', {
        category: 'dairy-and-eggs',
      });

      expect(lastQuery(browse)).toMatchObject({
        categoryId: 'cat-dairy-and-eggs',
      });
      expect(rows(fixture)).toBe(5);
      expect(host(fixture).querySelector('.category-chip-root')).toBeNull();
      expect(categoryChip(fixture)?.getAttribute('aria-label')).toBe(
        'catalog.categories.chipRoot'
      );
    });

    it('keeps the choice through a chain chip and a search, and the chain through the choice', async () => {
      const { fixture, browse, query } = await render('priced', {
        category: 'milk',
      });
      jest.useFakeTimers();

      chip(fixture, 'Deza').click();
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
      query.next(convertToParamMap({}));
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

      expect(navigate).toHaveBeenCalledWith('/velista/en/catalog');
      expect(
        host(fixture)
          .querySelector('.category-chip-clear')
          ?.getAttribute('aria-label')
      ).toBe('catalog.categories.clear');
    });

    it('names the leaf and the chain when the chain has nothing in it', async () => {
      const { fixture } = await render('priced', { category: 'eggs' });

      chip(fixture, 'Deza').click();
      await settle(fixture);

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

      expect(navigate).toHaveBeenCalledWith('/velista/en/catalog', {
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
