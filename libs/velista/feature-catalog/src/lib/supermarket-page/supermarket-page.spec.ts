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
  SHOP_FINDER_SERVICE,
  SHOP_SERVICE,
  ShopFinderMemory,
  ShopMemory,
  ShoppingProfileStore,
} from '@portfolio/velista/data-access';
import {
  fakeGeolocationReader,
  PageNavigation,
  provideFakeBrowserFacade,
  provideFakeGeolocationReader,
  provideVelistaTesting,
} from '@portfolio/velista/platform';
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
    readonly chain?: string;
    readonly query?: Record<string, string>;
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
      provideFakeGeolocationReader(
        fakeGeolocationReader({ outcome: { state: 'denied' } })
      ),
      { provide: SHOP_SERVICE, useValue: new ShopMemory() },
      { provide: SHOP_FINDER_SERVICE, useValue: new ShopFinderMemory() },
      {
        provide: ShoppingProfileStore,
        useValue: {
          profiles: () => [{ id: 'profile-1', isDefault: true }],
          load: async () => undefined,
        },
      },
      { provide: PageNavigation, useValue: pages },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            paramMap: convertToParamMap(
              options.chain === undefined
                ? {}
                : { supermarketId: options.chain }
            ),
            queryParamMap: convertToParamMap(options.query ?? {}),
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
 * The catalog's supermarket picker (velista `0124`, target 8): the picker body as a
 * page, with the any rows that make a chain enough, and every answer replacing the
 * picker's entry.
 */
describe('CatalogSupermarketPage', () => {
  describe('the root', () => {
    it('draws All supermarkets first, checked while nothing is chosen, then the chains', async () => {
      const { fixture } = await render();

      const any = host(fixture).querySelector('.any') as HTMLElement;
      expect(any.textContent).toContain('catalog.supermarket.all');
      expect(any.querySelector<HTMLInputElement>('input')?.checked).toBe(true);
      expect(
        host(fixture).querySelectorAll('lib-franchise-buttons .chip').length
      ).toBeGreaterThan(1);
      expect(host(fixture).querySelector('lib-near-me-button')).not.toBeNull();
      expect(host(fixture).querySelector('h1')?.textContent).toContain(
        'catalog.supermarket.title'
      );
    });

    it('says nothing about the matches until the search for the typed text has answered', async () => {
      const { fixture } = await render();
      jest.useFakeTimers();
      try {
        const input = host(fixture).querySelector(
          '.search-input'
        ) as HTMLInputElement;
        input.value = 'no such street anywhere';
        input.dispatchEvent(new Event('input'));
        fixture.detectChanges();

        // The buttons have gone at once, but the debounce has not fired: no
        // "0 results" and no "no match", seen or announced.
        expect(host(fixture).querySelector('lib-franchise-buttons')).toBeNull();
        expect(
          host(fixture).querySelector('.result-count')?.textContent?.trim()
        ).toBe('');
        expect(host(fixture).querySelector('.empty')).toBeNull();

        jest.advanceTimersByTime(250);
        await settle(fixture);
        await settle(fixture);

        expect(
          host(fixture).querySelector('.result-count')?.textContent?.trim()
        ).toBe('shops.search.results');
        expect(host(fixture).querySelector('.empty')).not.toBeNull();
      } finally {
        jest.useRealTimers();
      }
    });

    it('opens a chain on its own screen in place of this entry, carrying the choice', async () => {
      const { fixture, navigate } = await render({
        query: { category: 'milk' },
      });

      host(fixture)
        .querySelector<HTMLButtonElement>('lib-franchise-buttons .chip')
        ?.click();

      expect(last(navigate)).toEqual({
        url: '/velista/en/catalog/supermarket/sm-mercadona?category=milk',
        replace: true,
      });
    });

    it('answers every supermarket with the any row, replacing the picker, keeping the category', async () => {
      const { fixture, navigate } = await render({
        query: { category: 'milk', chain: 'sm-dia' },
      });

      host(fixture).querySelector<HTMLInputElement>('.any input')?.click();

      expect(last(navigate)).toEqual({
        url: '/velista/en/catalog?category=milk',
        replace: true,
      });
    });

    it('ticks the chain the catalog is narrowed to', async () => {
      const { fixture } = await render({ query: { chain: 'sm-dia' } });

      const pressed = [
        ...host(fixture).querySelectorAll('lib-franchise-buttons .chip'),
      ].map((chip) => chip.getAttribute('aria-pressed'));
      expect(pressed).toContain('true');
      expect(
        host(fixture).querySelector<HTMLInputElement>('.any input')?.checked
      ).toBe(false);
    });

    it('goes back to the catalog with its choice, by popping', async () => {
      const { fixture, pages } = await render({ query: { chain: 'sm-dia' } });

      host(fixture).querySelector<HTMLButtonElement>('.back')?.click();

      expect(pages.back).toHaveBeenCalledWith(
        '/velista/en/catalog?chain=sm-dia'
      );
    });
  });

  describe('a chain’s screen', () => {
    it('draws the chain’s head, Any Mercadona shop, then its shops and no search', async () => {
      const { fixture } = await render({ chain: 'sm-mercadona' });

      const head = host(fixture).querySelector('.chain-head') as HTMLElement;
      expect(head.querySelector('lib-chain-logo')).not.toBeNull();
      expect(head.textContent).toContain('Mercadona');
      expect(head.textContent).toContain('shops.chain.inAreas');
      expect(host(fixture).querySelector('.any')?.textContent).toContain(
        'catalog.supermarket.any'
      );
      expect(host(fixture).querySelector('.search-input')).toBeNull();
      expect(host(fixture).querySelector('lib-near-me-button')).toBeNull();
      expect(
        host(fixture).querySelectorAll('lib-shop-list label.row').length
      ).toBeGreaterThan(0);
    });

    it('answers the whole chain with the any row', async () => {
      const { fixture, navigate } = await render({ chain: 'sm-mercadona' });

      host(fixture).querySelector<HTMLInputElement>('.any input')?.click();

      expect(last(navigate)).toEqual({
        url: '/velista/en/catalog?chain=sm-mercadona',
        replace: true,
      });
    });

    it('answers one shop with its chain, replacing the picker', async () => {
      const { fixture, navigate } = await render({
        chain: 'sm-mercadona',
        query: { category: 'milk' },
      });

      host(fixture)
        .querySelector<HTMLInputElement>('lib-shop-list label.row input')
        ?.click();

      const answer = last(navigate);
      expect(answer.replace).toBe(true);
      expect(answer.url).toMatch(
        /^\/velista\/en\/catalog\?category=milk&chain=sm-mercadona&shop=shop-mercadona-[a-z]+$/
      );
    });

    it('goes back to every chain in place of this entry, never out of the picker', async () => {
      const { fixture, navigate, pages } = await render({
        chain: 'sm-mercadona',
        query: { chain: 'sm-dia' },
      });

      host(fixture).querySelector<HTMLButtonElement>('.back')?.click();
      await settle(fixture);

      expect(pages.back).not.toHaveBeenCalled();
      expect(last(navigate)).toEqual({
        url: '/velista/en/catalog/supermarket?chain=sm-dia',
        replace: true,
      });
    });
  });
});
