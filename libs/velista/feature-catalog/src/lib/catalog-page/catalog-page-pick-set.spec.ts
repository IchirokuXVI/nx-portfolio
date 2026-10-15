import { signal } from '@angular/core';
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
  CatalogBrowseMemory,
  fakeCategoryStore,
  fakeItemNames,
  fakeLineStore,
  MEMORY_CATEGORIES,
  ProductPickStore,
  provideFakeCategoryStore,
  provideFakeItemNames,
  provideFakeLineStore,
  type FakeLineStore,
  type ProductPickRequest,
} from '@portfolio/velista/data-access';
import {
  LINE_ITEM_SET_MAX,
  type CatalogItem,
  type CatalogProduct,
  type Line,
} from '@portfolio/velista/models';
import {
  CATALOG_PICK_DATA,
  PageNavigation,
  provideVelistaTesting,
} from '@portfolio/velista/platform';
import { BehaviorSubject } from 'rxjs';
import { fakeAdds } from '../catalog-adds.testing';
import { pathFromRootAt } from '../catalog-route.testing';
import { CatalogPage } from './catalog-page';

/**
 * The catalog page opened to choose the whole set of products of a line (velista
 * `0146`, section 3), and leaving it with a change (section 4).
 */

const LINE_PAGE = '/velista/en/zones/z1/lists/l1/lines/zl-1';
const PAGE = `${LINE_PAGE}/products`;

/** The first products the memory catalog lists, read once for every spec. */
let catalog: readonly CatalogProduct[] = [];

beforeAll(async () => {
  const page = await new CatalogBrowseMemory().browse({
    query: '',
    order: 'category',
    soldBy: null,
    categoryId: null,
    priceScopeIds: [],
    locationId: null,
    cursor: null,
    limit: 30,
  });
  catalog = page?.items ?? [];
});

function asItem(product: CatalogProduct): CatalogItem {
  return {
    ...product,
    productGroupId: null,
    chainPrices: [],
    packCount: null,
  };
}

function line(overrides: Partial<Line> = {}): Line {
  return {
    id: 'zl-1',
    listId: 'l1',
    content: 'Leche',
    quantity: 1,
    itemIds: [],
    productGroupId: null,
    groupItemIds: [],
    favoriteItemId: null,
    preferredSupermarketId: null,
    position: 1,
    approvalStatus: 'PENDING',
    boughtCount: 0,
    lastSettlementOutcome: null,
    claimed: false,
    named: true,
    claimedByUserId: null,
    createdByUserId: 'me',
    approvedByUserId: null,
    version: 1,
    ...overrides,
  } as Line;
}

interface Options {
  /** The products the line arrives with. The first two of the catalog by default. */
  readonly before?: readonly string[];
  readonly request?: ProductPickRequest | null;
  readonly favorite?: string | null;
  readonly failed?: readonly string[];
}

interface Harness {
  readonly fixture: ComponentFixture<CatalogPage>;
  readonly pick: ProductPickStore;
  readonly lines: FakeLineStore;
  readonly backTo: jest.Mock;
  readonly navigateByUrl: jest.SpyInstance;
  readonly query: BehaviorSubject<ParamMap>;
  readonly before: readonly string[];
}

async function render(options: Options = {}): Promise<Harness> {
  TestBed.resetTestingModule();
  const before = options.before ?? [catalog[0].id, catalog[1].id];
  const query = new BehaviorSubject<ParamMap>(convertToParamMap({}));
  const backTo = jest.fn().mockResolvedValue(undefined);
  const lines = fakeLineStore({
    lines: [
      line({ itemIds: before, favoriteItemId: options.favorite ?? null }),
    ],
  });
  const adds = fakeAdds();

  await TestBed.configureTestingModule({
    imports: [CatalogPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      provideRouter([]),
      provideFakeCategoryStore(fakeCategoryStore(MEMORY_CATEGORIES)),
      ...adds.providers,
      provideFakeLineStore(lines),
      provideFakeItemNames(
        fakeItemNames({
          items: catalog.map(asItem),
          failed: options.failed,
        })
      ),
      ProductPickStore,
      { provide: PageNavigation, useValue: { back: jest.fn(), backTo } },
      {
        provide: ActivatedRoute,
        useValue: {
          queryParamMap: query,
          snapshot: {
            data: { [CATALOG_PICK_DATA]: 'set' },
            paramMap: convertToParamMap({
              zoneId: 'z1',
              listId: 'l1',
              lineId: 'zl-1',
            }),
            pathFromRoot: pathFromRootAt(PAGE),
          },
        },
      },
      { provide: CATALOG_BROWSE_SERVICE, useValue: new CatalogBrowseMemory() },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
    ],
  }).compileComponents();

  const pick = TestBed.inject(ProductPickStore);
  const request =
    options.request === undefined
      ? {
          kind: 'set' as const,
          lineId: 'zl-1',
          forLabel: 'For Leche',
          forDetail: 'Compra semanal',
          chosenId: null,
          chosenIds: before,
          returnUrl: LINE_PAGE,
          returnDepth: 3,
          callerState: null,
        }
      : options.request;
  if (request !== null) {
    pick.open(request);
  }
  const navigateByUrl = jest
    .spyOn(TestBed.inject(Router), 'navigateByUrl')
    .mockResolvedValue(true);

  const fixture = TestBed.createComponent(CatalogPage);
  fixture.detectChanges();
  await settle(fixture);
  await settle(fixture);
  return { fixture, pick, lines, backTo, navigateByUrl, query, before };
}

async function settle(fixture: ComponentFixture<CatalogPage>): Promise<void> {
  for (let tick = 0; tick < 20; tick++) {
    await Promise.resolve();
  }
  fixture.detectChanges();
}

function host(fixture: ComponentFixture<CatalogPage>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

/** The ticks, each with the accessible name its card gives it. */
function ticks(fixture: ComponentFixture<CatalogPage>): HTMLInputElement[] {
  return [
    ...host(fixture).querySelectorAll<HTMLInputElement>(
      'lib-product-row input.pick'
    ),
  ];
}

/** The ticks of the cards whose name is this, in the order they are drawn. */
function tickNamed(
  fixture: ComponentFixture<CatalogPage>,
  name: string
): HTMLInputElement[] {
  return [...host(fixture).querySelectorAll('lib-product-row')]
    .filter((row) => row.querySelector('.name')?.textContent?.trim() === name)
    .map((row) => row.querySelector('input.pick') as HTMLInputElement);
}

/** The tick of one product of the catalog. */
function tickOf(
  fixture: ComponentFixture<CatalogPage>,
  product: CatalogProduct
): HTMLInputElement[] {
  return tickNamed(fixture, product.name.en);
}

function bar(fixture: ComponentFixture<CatalogPage>): Element | null {
  return host(fixture).querySelector('lib-choosing-bar');
}

function save(fixture: ComponentFixture<CatalogPage>): void {
  host(fixture)
    .querySelector<HTMLButtonElement>('lib-choosing-bar button')
    ?.click();
}

function close(fixture: ComponentFixture<CatalogPage>): void {
  host(fixture)
    .querySelector<HTMLButtonElement>('lib-page-header button.lead')
    ?.click();
}

const updates = (lines: FakeLineStore) =>
  lines.calls.filter((call) => call.kind === 'update');

describe('CatalogPage, opened to choose the products of a line (velista 0146)', () => {
  describe('what it draws', () => {
    it('says "Choose products", closes from its header and saves from its foot', async () => {
      const { fixture } = await render();

      const header = host(fixture).querySelector('lib-page-header');
      expect(header?.textContent).toContain('catalog.pick.titleSet');
      expect(
        header?.querySelector('button.lead')?.getAttribute('aria-label')
      ).toBe('catalog.pick.closeSet');
      expect(bar(fixture)?.textContent).toContain('For Leche');
      expect(bar(fixture)?.textContent).toContain('Compra semanal');
      expect(bar(fixture)?.querySelector('button')?.textContent).toContain(
        'catalog.pick.save'
      );
      // Save is one button, the same with a change and without.
      expect(
        bar(fixture)?.querySelector('button')?.hasAttribute('aria-disabled')
      ).toBe(false);
      expect(host(fixture).querySelector('lib-adding-bar')).toBeNull();
      expect(host(fixture).querySelector('lib-product-row .add')).toBeNull();
    });

    it('draws the products of the line first and ticked, then the others, none twice', async () => {
      const { fixture } = await render();

      const headings = [...host(fixture).querySelectorAll('.pick-heading')].map(
        (heading) => heading.textContent?.trim()
      );
      expect(headings).toEqual(['catalog.pick.onLine', 'catalog.pick.all']);

      const all = ticks(fixture);
      expect(all[0].checked).toBe(true);
      expect(all[1].checked).toBe(true);
      expect(all[0].getAttribute('aria-label')).toContain(
        'catalog.pick.onLineLabel'
      );
      expect(all.slice(2).every((input) => !input.checked)).toBe(true);
      expect(all).toHaveLength(catalog.length);
      expect(tickOf(fixture, catalog[0])).toHaveLength(1);
    });

    it('draws no headings once a search is typed, and a product of the line only where the read finds it', async () => {
      const { fixture, query } = await render();
      const word = catalog[0].name.en.split(' ')[0];

      query.next(convertToParamMap({ q: word }));
      await settle(fixture);
      await settle(fixture);

      expect(host(fixture).querySelector('.pick-heading')).toBeNull();
      const found = tickOf(fixture, catalog[0]);
      expect(found).toHaveLength(1);
      expect(found[0].checked).toBe(true);
    });

    it('keeps a product of the line in the set when the search does not find it', async () => {
      const { fixture, query, pick, before } = await render();

      query.next(convertToParamMap({ q: 'zzzz nothing' }));
      await settle(fixture);
      await settle(fixture);

      expect(ticks(fixture)).toHaveLength(0);
      expect(pick.ticked()).toEqual(before);
    });

    it('draws a product the catalog no longer has, so it can be taken off', async () => {
      const { fixture, pick } = await render({
        before: [catalog[0].id, 'gone-1'],
      });

      const [gone] = tickNamed(fixture, 'catalog.pick.gone');
      expect(host(fixture).textContent).toContain('catalog.pick.gone');
      expect(gone?.checked).toBe(true);

      gone?.click();
      fixture.detectChanges();
      expect(pick.ticked()).toEqual([catalog[0].id]);
    });
  });

  describe('a tick', () => {
    it('adds a product, a second press takes it out, and the bar counts both ways', async () => {
      const { fixture, pick, before } = await render();

      tickOf(fixture, catalog[2])[0].click();
      fixture.detectChanges();
      expect(pick.ticked()).toEqual([...before, catalog[2].id]);
      expect(tickOf(fixture, catalog[2])[0].checked).toBe(true);
      expect(bar(fixture)?.textContent).toContain('catalog.pick.added');
      expect(bar(fixture)?.textContent).not.toContain('catalog.pick.removed');
      expect(bar(fixture)?.textContent).not.toContain('For Leche');

      tickOf(fixture, catalog[0])[0].click();
      fixture.detectChanges();
      expect(bar(fixture)?.textContent).toContain('catalog.pick.added');
      expect(bar(fixture)?.textContent).toContain('catalog.pick.removed');

      tickOf(fixture, catalog[2])[0].click();
      tickOf(fixture, catalog[0])[0].click();
      fixture.detectChanges();
      expect(bar(fixture)?.textContent).toContain('For Leche');
    });

    it('is refused past the cap, with the sentence of the products page', async () => {
      const full = Array.from(
        { length: LINE_ITEM_SET_MAX },
        (_, at) => `full-${at}`
      );
      const { fixture, pick } = await render({ before: full });

      tickOf(fixture, catalog[0])[0].click();
      fixture.detectChanges();

      expect(pick.ticked()).toEqual(full);
      expect(tickOf(fixture, catalog[0])[0].checked).toBe(false);
      expect(host(fixture).querySelector('.pick-note')?.textContent).toContain(
        'catalog.pick.full'
      );
    });
  });

  describe('Save', () => {
    it('sends nothing with no change, and goes back to the line', async () => {
      const { fixture, lines, backTo, pick } = await render();

      save(fixture);
      await settle(fixture);

      expect(updates(lines)).toHaveLength(0);
      expect(backTo).toHaveBeenCalledWith(3, LINE_PAGE);
      expect(pick.request()).toBeNull();
    });

    it('sends the whole set in one write, with no adopt, and goes back to the line', async () => {
      const { fixture, lines, backTo, before } = await render();

      tickOf(fixture, catalog[2])[0].click();
      save(fixture);
      await settle(fixture);

      expect(updates(lines)).toEqual([
        {
          kind: 'update',
          lineId: 'zl-1',
          itemIds: [...before, catalog[2].id],
        },
      ]);
      expect(backTo).toHaveBeenCalledWith(3, LINE_PAGE);
    });

    it('saves an empty set', async () => {
      const { fixture, lines } = await render({ before: [catalog[0].id] });

      tickOf(fixture, catalog[0])[0].click();
      save(fixture);
      await settle(fixture);

      expect(updates(lines)).toEqual([
        { kind: 'update', lineId: 'zl-1', itemIds: [] },
      ]);
    });

    it('clears the favourite in the same write when the set no longer holds it', async () => {
      const { fixture, lines } = await render({ favorite: catalog[0].id });

      tickOf(fixture, catalog[0])[0].click();
      save(fixture);
      await settle(fixture);

      expect(updates(lines)).toEqual([
        {
          kind: 'update',
          lineId: 'zl-1',
          itemIds: [catalog[1].id],
          favoriteItemId: null,
        },
      ]);
    });

    it('keeps the page and the ticks after a failed save, and says so with a second try', async () => {
      const { fixture, lines, backTo, pick, before } = await render();
      lines.answerNextUpdate({ state: 'failed', error: new Error('down') });

      tickOf(fixture, catalog[2])[0].click();
      save(fixture);
      await settle(fixture);

      expect(backTo).not.toHaveBeenCalled();
      expect(pick.ticked()).toEqual([...before, catalog[2].id]);
      const alert = host(fixture).querySelector('[role="alert"]');
      expect(alert?.textContent).toContain('catalog.pick.saveFailed');

      alert?.querySelector('button')?.click();
      await settle(fixture);
      expect(updates(lines)).toHaveLength(2);
      expect(backTo).toHaveBeenCalledWith(3, LINE_PAGE);
    });
  });

  describe('leaving (section 4)', () => {
    it('leaves at once with no change', async () => {
      const { fixture, backTo } = await render();

      close(fixture);
      await settle(fixture);

      expect(host(fixture).querySelector('lib-leave-question')).toBeNull();
      expect(backTo).toHaveBeenCalledWith(3, LINE_PAGE);
    });

    it('asks first with a change; Keep choosing stays with the ticks', async () => {
      const { fixture, backTo, pick, before } = await render();
      tickOf(fixture, catalog[2])[0].click();

      close(fixture);
      await settle(fixture);
      const question = host(fixture).querySelector('lib-leave-question');
      expect(question?.textContent).toContain('catalog.pick.leaveQuestion');

      question?.querySelector<HTMLButtonElement>('button.keep')?.click();
      await settle(fixture);

      expect(host(fixture).querySelector('lib-leave-question')).toBeNull();
      expect(backTo).not.toHaveBeenCalled();
      expect(pick.ticked()).toEqual([...before, catalog[2].id]);
    });

    it('asks first with a change; Leave goes back with nothing sent', async () => {
      const { fixture, backTo, lines, pick } = await render();
      tickOf(fixture, catalog[2])[0].click();

      close(fixture);
      await settle(fixture);
      host(fixture)
        .querySelector<HTMLButtonElement>('lib-leave-question button.leave')
        ?.click();
      await settle(fixture);

      expect(backTo).toHaveBeenCalledWith(3, LINE_PAGE);
      expect(updates(lines)).toHaveLength(0);
      expect(pick.request()).toBeNull();
    });

    it('asks the back of the browser through the guard, and lets its own pickers through', async () => {
      const { fixture } = await render();
      const page = fixture.componentInstance;
      tickOf(fixture, catalog[2])[0].click();
      fixture.detectChanges();

      expect(page.canLeave(`${PAGE}/supermarket?q=x`)).toBe(true);
      expect(page.canLeave(`${PAGE}?chain=c1`)).toBe(true);

      const leaving = page.canLeave(LINE_PAGE);
      await settle(fixture);
      expect(leaving).toBeInstanceOf(Promise);
      host(fixture)
        .querySelector<HTMLButtonElement>('lib-leave-question button.leave')
        ?.click();
      await expect(leaving).resolves.toBe(true);
    });

    it('lets the back of the browser through with no change, and ends the set', async () => {
      const { fixture, pick } = await render();

      expect(fixture.componentInstance.canLeave(LINE_PAGE)).toBe(true);
      expect(pick.request()).toBeNull();
    });

    it('closes from Escape, but not from the field', async () => {
      const { fixture, backTo } = await render();

      host(fixture)
        .querySelector('#catalog-search')
        ?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
        );
      expect(backTo).not.toHaveBeenCalled();

      host(fixture)
        .querySelector('.list')
        ?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
        );
      await settle(fixture);
      expect(backTo).toHaveBeenCalledWith(3, LINE_PAGE);
    });
  });

  it('opens its pickers under its own route, so they come back to it', async () => {
    const { fixture, navigateByUrl } = await render();

    host(fixture)
      .querySelector<HTMLButtonElement>(
        'lib-catalog-selectors [data-selector="supermarket"]'
      )
      ?.click();

    expect(
      TestBed.inject(Router).serializeUrl(navigateByUrl.mock.calls.at(-1)?.[0])
    ).toBe(`${PAGE}/supermarket`);
  });

  it('keeps the ticks across a picker: a page opened again finds the same set', async () => {
    const first = await render();
    tickOf(first.fixture, catalog[2])[0].click();
    const ticked = first.pick.ticked();
    first.fixture.destroy();

    const again = TestBed.createComponent(CatalogPage);
    again.detectChanges();
    await settle(again);

    expect(tickOf(again, catalog[2])[0].checked).toBe(true);
    expect(TestBed.inject(ProductPickStore).ticked()).toEqual(ticked);
  });

  it('goes to the line page when nothing opened it, in place, which is where a reader lands', async () => {
    const { navigateByUrl } = await render({ request: null });

    expect(navigateByUrl).toHaveBeenCalledWith(LINE_PAGE, { replaceUrl: true });
  });
});
