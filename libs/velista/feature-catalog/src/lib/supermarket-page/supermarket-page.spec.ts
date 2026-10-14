import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
  Router,
  type UrlTree,
} from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  SHOP_SERVICE,
  ShopMemory,
  ShoppingProfileStore,
} from '@portfolio/velista/data-access';
import {
  PageNavigation,
  provideFakeBrowserFacade,
  provideVelistaTesting,
} from '@portfolio/velista/platform';
import { pathFromRootAt } from '../catalog-route.testing';
import { CatalogSupermarketPage } from './supermarket-page';

interface Harness {
  readonly fixture: ComponentFixture<CatalogSupermarketPage>;
  readonly navigate: jest.SpyInstance;
  readonly pages: { back: jest.Mock };
}

/** Lets every pending promise run, then draws. */
async function settle(
  fixture: ComponentFixture<CatalogSupermarketPage>
): Promise<void> {
  for (let tick = 0; tick < 20; tick++) {
    await Promise.resolve();
  }
  fixture.detectChanges();
}

async function render(
  options: {
    readonly query?: Record<string, string>;
    /** A person with no shopping profile, who has no chains to offer. */
    readonly noProfile?: boolean;
    /** Where the picker is, which says what opened it. The tab by default. */
    readonly under?: string;
  } = {}
): Promise<Harness> {
  TestBed.resetTestingModule();
  const pages = { back: jest.fn().mockResolvedValue(undefined) };

  await TestBed.configureTestingModule({
    imports: [CatalogSupermarketPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      provideRouter([]),
      provideFakeBrowserFacade(new Map()),
      { provide: SHOP_SERVICE, useValue: new ShopMemory() },
      {
        provide: ShoppingProfileStore,
        useValue: {
          profiles: () =>
            options.noProfile === true
              ? []
              : [{ id: 'profile-1', isDefault: true }],
          load: async () => undefined,
        },
      },
      { provide: PageNavigation, useValue: pages },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            queryParamMap: convertToParamMap(options.query ?? {}),
            pathFromRoot: pathFromRootAt(
              options.under ?? '/velista/en/catalog/supermarket'
            ),
          },
        },
      },
    ],
  }).compileComponents();

  const navigate = jest
    .spyOn(TestBed.inject(Router), 'navigateByUrl')
    .mockResolvedValue(true);
  const fixture = TestBed.createComponent(CatalogSupermarketPage);
  fixture.detectChanges();
  await settle(fixture);
  await settle(fixture);

  return { fixture, navigate, pages };
}

function host(fixture: ComponentFixture<CatalogSupermarketPage>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

/** The chain buttons, in the order they are drawn. */
function chips(
  fixture: ComponentFixture<CatalogSupermarketPage>
): readonly HTMLButtonElement[] {
  return [
    ...host(fixture).querySelectorAll<HTMLButtonElement>(
      'lib-franchise-buttons .chip'
    ),
  ];
}

/** The chain button that names this chain. */
function chip(
  fixture: ComponentFixture<CatalogSupermarketPage>,
  name: string
): HTMLButtonElement | undefined {
  return chips(fixture).find((button) => button.textContent?.includes(name));
}

/** Where the router was last sent, and whether it replaced the entry. */
function last(navigate: jest.SpyInstance): {
  readonly url: string;
  readonly replace: boolean;
} {
  const call = navigate.mock.calls[navigate.mock.calls.length - 1];
  const target = call?.[0] as string | UrlTree;
  return {
    url:
      typeof target === 'string'
        ? target
        : TestBed.inject(Router).serializeUrl(target),
    replace:
      (call?.[1] as { replaceUrl?: boolean } | undefined)?.replaceUrl === true,
  };
}

/**
 * The catalog's supermarket picker (velista `0124`, target 8): a page that asks for
 * a chain and never for a shop, where one press is the answer and every answer
 * replaces the picker's entry.
 */
describe('CatalogSupermarketPage', () => {
  it('draws All supermarkets first, checked while nothing is chosen, then the chains', async () => {
    const { fixture } = await render();

    const any = host(fixture).querySelector('.any') as HTMLElement;
    expect(any.textContent).toContain('catalog.supermarket.all');
    expect(any.textContent).toContain('catalog.supermarket.allDetail');
    expect(any.querySelector<HTMLInputElement>('input')?.checked).toBe(true);
    expect(chips(fixture).length).toBeGreaterThan(1);
    const buttons = host(fixture).querySelector(
      'lib-franchise-buttons'
    ) as HTMLElement;
    expect(
      any.compareDocumentPosition(buttons) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('heads the page with the title and the way back, and no action', async () => {
    const { fixture } = await render();
    const header = host(fixture).querySelector('lib-page-header');

    expect(header?.querySelector('h1')?.textContent?.trim()).toBe(
      'catalog.supermarket.title'
    );
    expect(
      header
        ?.querySelector<HTMLButtonElement>('button.lead')
        ?.getAttribute('aria-label')
    ).toBe('catalog.supermarket.back');
    expect(header?.querySelectorAll('.actions button')).toHaveLength(0);
    expect(host(fixture).querySelectorAll('h1')).toHaveLength(1);
  });

  it('asks for a chain and nothing about a shop: no search, no shop row, no Near me', async () => {
    const { fixture } = await render();

    expect(host(fixture).querySelector('lib-shop-picker')).toBeNull();
    expect(host(fixture).querySelector('lib-shop-list')).toBeNull();
    expect(host(fixture).querySelector('input[type="search"]')).toBeNull();
    expect(host(fixture).querySelector('button.near')).toBeNull();
  });

  it('offers no button for the independents, which are not one chain', async () => {
    const { fixture } = await render();

    expect(chip(fixture, 'shops.other')).toBeUndefined();
  });

  it('answers a chain with one press, replacing the picker, keeping the category', async () => {
    const { fixture, navigate } = await render({
      query: { category: 'milk' },
    });

    chip(fixture, 'Mercadona')?.click();

    expect(last(navigate)).toEqual({
      url: '/velista/en/catalog?category=milk&chain=sm-mercadona',
      replace: true,
    });
  });

  it('answers every supermarket with All supermarkets, replacing the picker, keeping the category', async () => {
    const { fixture, navigate } = await render({
      query: { category: 'milk', chain: 'sm-dia' },
    });

    host(fixture).querySelector<HTMLInputElement>('.any input')?.click();

    expect(last(navigate)).toEqual({
      url: '/velista/en/catalog?category=milk',
      replace: true,
    });
  });

  it('hands the text and the order back as they came, whatever is answered', async () => {
    const { fixture, navigate } = await render({
      query: { category: 'milk', chain: 'sm-dia', q: 'leche', order: 'price' },
    });

    chip(fixture, 'Mercadona')?.click();
    expect(last(navigate)).toEqual({
      url: '/velista/en/catalog?category=milk&chain=sm-mercadona&q=leche&order=price',
      replace: true,
    });

    host(fixture).querySelector<HTMLInputElement>('.any input')?.click();
    expect(last(navigate)).toEqual({
      url: '/velista/en/catalog?category=milk&q=leche&order=price',
      replace: true,
    });
  });

  it('answers the catalog that chooses when that is what opened it (velista 0140)', async () => {
    const opener = '/velista/en/zones/z1/lists/l1/lines/zl-1/product';
    const { fixture, navigate } = await render({
      query: { q: 'leche' },
      under: `${opener}/supermarket`,
    });

    chip(fixture, 'Mercadona')?.click();

    expect(last(navigate)).toEqual({
      url: `${opener}?chain=sm-mercadona&q=leche`,
      replace: true,
    });
  });

  it('ticks the chain the catalog is narrowed to', async () => {
    const { fixture } = await render({ query: { chain: 'sm-dia' } });

    const pressed = chips(fixture).map((button) =>
      button.getAttribute('aria-pressed')
    );
    expect(pressed.filter((value) => value === 'true')).toHaveLength(1);
    expect(
      host(fixture).querySelector<HTMLInputElement>('.any input')?.checked
    ).toBe(false);
  });

  it('goes back to the catalog with its choice, by popping', async () => {
    const { fixture, pages } = await render({ query: { chain: 'sm-dia' } });

    host(fixture)
      .querySelector<HTMLButtonElement>('lib-page-header button.lead')
      ?.click();

    expect(pages.back).toHaveBeenCalledWith('/velista/en/catalog?chain=sm-dia');
  });

  it('offers All supermarkets alone to a person with no profile, and does not load forever', async () => {
    const { fixture } = await render({ noProfile: true });

    expect(host(fixture).querySelector('.any')).not.toBeNull();
    expect(host(fixture).querySelector('.note')).toBeNull();
    expect(chips(fixture)).toHaveLength(0);
  });
});
