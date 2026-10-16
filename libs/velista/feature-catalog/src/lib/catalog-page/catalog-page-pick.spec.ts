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
  MEMORY_CATEGORIES,
  ProductPickStore,
  provideFakeCategoryStore,
  type ProductPickRequest,
} from '@portfolio/velista/data-access';
import {
  CATALOG_PICK_DATA,
  PageNavigation,
  provideVelistaTesting,
} from '@portfolio/velista/platform';
import { BehaviorSubject } from 'rxjs';
import { fakeAdds, type FakeAdds } from '../catalog-adds.testing';
import { pathFromRootAt } from '../catalog-route.testing';
import { CatalogPage } from './catalog-page';

/**
 * The catalog page opened to choose one product for a line (velista `0140`,
 * section 3).
 *
 * The tab's own specs are `catalog-page.spec.ts`. These are the four differences
 * from the tab, a press that chooses and opens nothing, and the two ways back.
 */

const PAGE = '/velista/en/zones/z1/lists/l1/lines/zl-1/product';

const REQUEST: ProductPickRequest = {
  kind: 'one',
  lineId: 'zl-1',
  forLabel: 'For Cocina',
  forDetail: 'Leche para el café',
  chosenId: null,
  returnUrl: '/velista/en/shopping-lists/live/sheet/rows/zl-1/change/zl-1',
  returnDepth: 1,
  callerState: { keep: true },
};

interface Harness {
  readonly fixture: ComponentFixture<CatalogPage>;
  readonly pick: ProductPickStore;
  readonly backTo: jest.Mock;
  readonly navigateByUrl: jest.SpyInstance;
  readonly adds: FakeAdds;
}

async function render(
  options: { readonly request?: ProductPickRequest | null } = {}
): Promise<Harness> {
  TestBed.resetTestingModule();
  const memory = new CatalogBrowseMemory();
  const query = new BehaviorSubject<ParamMap>(convertToParamMap({}));
  const adds = fakeAdds();
  const backTo = jest.fn().mockResolvedValue(undefined);

  await TestBed.configureTestingModule({
    imports: [CatalogPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      provideRouter([]),
      provideFakeCategoryStore(fakeCategoryStore(MEMORY_CATEGORIES)),
      ...adds.providers,
      ProductPickStore,
      { provide: PageNavigation, useValue: { back: jest.fn(), backTo } },
      {
        provide: ActivatedRoute,
        useValue: {
          queryParamMap: query,
          snapshot: {
            data: { [CATALOG_PICK_DATA]: 'one' },
            paramMap: convertToParamMap({
              zoneId: 'z1',
              listId: 'l1',
              lineId: 'zl-1',
            }),
            pathFromRoot: pathFromRootAt(PAGE),
          },
        },
      },
      { provide: CATALOG_BROWSE_SERVICE, useValue: memory },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
    ],
  }).compileComponents();

  const pick = TestBed.inject(ProductPickStore);
  const request = options.request === undefined ? REQUEST : options.request;
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
  return { fixture, pick, backTo, navigateByUrl, adds };
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

function cards(fixture: ComponentFixture<CatalogPage>): HTMLInputElement[] {
  return [
    ...host(fixture).querySelectorAll<HTMLInputElement>(
      'lib-product-row input.pick'
    ),
  ];
}

describe('CatalogPage, opened to choose one product (velista 0140)', () => {
  it('closes from its header and says "Choose a product"', async () => {
    const { fixture } = await render();

    const header = host(fixture).querySelector('lib-page-header');
    expect(header?.textContent).toContain('basket.change.pickTitle');
    expect(header?.textContent).not.toContain('catalog.title');
    expect(
      header?.querySelector('button.lead')?.getAttribute('aria-label')
    ).toBe('basket.change.pickClose');
  });

  it('keeps the tools of the tab', async () => {
    const { fixture } = await render();

    expect(host(fixture).querySelector('#catalog-search')).not.toBeNull();
    expect(host(fixture).querySelector('lib-catalog-selectors')).not.toBeNull();
    expect(host(fixture).querySelector('lib-order-menu')).not.toBeNull();
  });

  it('names what the product is for at its foot, with the one button', async () => {
    const { fixture } = await render();

    const bar = host(fixture).querySelector('lib-choosing-bar');
    expect(bar?.textContent).toContain('For Cocina');
    expect(bar?.textContent).toContain('Leche para el café');
    expect(bar?.querySelector('button')?.textContent).toContain(
      'basket.change.use'
    );
  });

  it('adds to nothing: no plus, no line of lists, and no list is read', async () => {
    const { fixture, adds } = await render();

    expect(host(fixture).querySelector('lib-product-row .add')).toBeNull();
    expect(host(fixture).querySelector('lib-adding-bar')).toBeNull();
    expect(adds.zones.listMyZones).not.toHaveBeenCalled();
  });

  it('draws a radio on each card, and a press chooses it without opening the product', async () => {
    const { fixture, pick, navigateByUrl } = await render();
    expect(cards(fixture).length).toBeGreaterThan(1);
    expect(
      host(fixture).querySelector('lib-product-row button.open')
    ).toBeNull();

    cards(fixture)[1].click();
    fixture.detectChanges();

    expect(pick.chosen()).not.toBeNull();
    expect(cards(fixture)[1].checked).toBe(true);
    expect(
      host(fixture).querySelectorAll('lib-product-row .row.is-chosen')
    ).toHaveLength(1);
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it('opens with the product the caller had chosen', async () => {
    const memory = new CatalogBrowseMemory();
    const first = (
      await memory.browse({
        query: '',
        order: 'category',
        soldBy: null,
        categoryId: null,
        priceScopeIds: [],
        locationId: null,
        cursor: null,
        limit: 30,
      })
    )?.items[0];
    const { fixture } = await render({
      request: { ...REQUEST, chosenId: first?.id ?? null },
    });

    expect(cards(fixture)[0].checked).toBe(true);
  });

  it('goes back with the product chosen, past the pickers, and answers the caller', async () => {
    const { fixture, pick, backTo } = await render();
    cards(fixture)[2].click();
    fixture.detectChanges();
    const chosen = pick.chosen();

    host(fixture)
      .querySelector<HTMLButtonElement>('lib-choosing-bar button')
      ?.click();

    expect(backTo).toHaveBeenCalledWith(1, REQUEST.returnUrl);
    expect(pick.takeAnswer('zl-1')).toEqual({
      lineId: 'zl-1',
      itemId: chosen,
      callerState: { keep: true },
    });
  });

  it('says why the button does nothing until a product is chosen (velista 0146)', async () => {
    const { fixture, backTo } = await render();
    const button = host(fixture).querySelector<HTMLButtonElement>(
      'lib-choosing-bar button'
    );
    const note = () =>
      host(fixture).querySelector('.pick-note[aria-live="polite"]');

    expect(button?.getAttribute('aria-disabled')).toBe('true');
    expect(note()?.textContent?.trim()).toBe('');

    button?.click();
    fixture.detectChanges();
    expect(note()?.textContent).toContain('catalog.pick.first');
    expect(backTo).not.toHaveBeenCalled();

    cards(fixture)[1].click();
    fixture.detectChanges();
    expect(button?.hasAttribute('aria-disabled')).toBe(false);
    expect(note()?.textContent?.trim()).toBe('');
  });

  it('goes back with nothing changed from the close', async () => {
    const { fixture, pick, backTo } = await render();
    cards(fixture)[1].click();

    host(fixture)
      .querySelector<HTMLButtonElement>('lib-page-header button.lead')
      ?.click();

    expect(backTo).toHaveBeenCalledWith(1, REQUEST.returnUrl);
    expect(pick.takeAnswer('zl-1')).toEqual({
      lineId: 'zl-1',
      itemId: null,
      callerState: { keep: true },
    });
  });

  it('opens its pickers under its own route, so they come back to it', async () => {
    const { fixture, navigateByUrl } = await render();
    const last = () =>
      TestBed.inject(Router).serializeUrl(navigateByUrl.mock.calls.at(-1)?.[0]);

    host(fixture)
      .querySelector<HTMLButtonElement>(
        'lib-catalog-selectors [data-selector="supermarket"]'
      )
      ?.click();
    expect(last()).toBe(`${PAGE}/supermarket`);

    host(fixture)
      .querySelector<HTMLButtonElement>(
        'lib-catalog-selectors [data-selector="category"]'
      )
      ?.click();
    expect(last()).toBe(`${PAGE}/categories`);
  });

  it('goes to the list of the line when nothing opened it, in place', async () => {
    const { navigateByUrl } = await render({ request: null });

    expect(navigateByUrl).toHaveBeenCalledWith(
      '/velista/en/zones/z1/lists/l1',
      {
        replaceUrl: true,
      }
    );
  });
});
