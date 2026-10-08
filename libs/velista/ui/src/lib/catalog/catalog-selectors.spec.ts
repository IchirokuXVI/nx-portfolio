import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  RokuTranslatorService,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import type {
  CategorySelectorView,
  SupermarketSelectorView,
} from '@portfolio/velista/models';
import { CatalogSelectors } from './catalog-selectors';

/**
 * The catalog's two selectors (velista `0134`, section 2): each one names what the
 * list shows, and a chosen one is two controls, the body and its own cross.
 */
const NO_SUPERMARKET: SupermarketSelectorView = {
  chosen: false,
  name: '',
  logoUrl: null,
  anyShop: false,
};

const ANY_MERCADONA: SupermarketSelectorView = {
  chosen: true,
  name: 'Mercadona',
  logoUrl: null,
  anyShop: true,
};

const NO_CATEGORY: CategorySelectorView = {
  chosen: false,
  name: '',
  root: null,
};

const COFFEE: CategorySelectorView = {
  chosen: true,
  name: 'Coffee',
  root: 'Drinks',
};

/** Every translator call of the render, to read the values a name was given. */
let asked: jest.SpyInstance;

async function render(
  supermarket: SupermarketSelectorView = NO_SUPERMARKET,
  category: CategorySelectorView = NO_CATEGORY
): Promise<ComponentFixture<CatalogSelectors>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [CatalogSelectors, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();
  asked = jest.spyOn(TestBed.inject(RokuTranslatorService), 't');

  const fixture = TestBed.createComponent(CatalogSelectors);
  fixture.componentRef.setInput('supermarket', supermarket);
  fixture.componentRef.setInput('category', category);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture;
}

function host(fixture: ComponentFixture<CatalogSelectors>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

type Which = 'supermarket' | 'category';

function body(
  fixture: ComponentFixture<CatalogSelectors>,
  which: Which
): HTMLButtonElement {
  return host(fixture).querySelector(
    `[data-selector="${which}"]`
  ) as HTMLButtonElement;
}

/** The selector's box, which holds the body and, when chosen, the cross. */
function pick(
  fixture: ComponentFixture<CatalogSelectors>,
  which: Which
): HTMLElement {
  return body(fixture, which).parentElement as HTMLElement;
}

function clear(
  fixture: ComponentFixture<CatalogSelectors>,
  which: Which
): HTMLButtonElement | null {
  return pick(fixture, which).querySelector<HTMLButtonElement>('.clear');
}

/** The values the last call for a key was given. */
function valuesOf(key: string): unknown {
  const calls = asked.mock.calls.filter((call) => call[0] === key);
  return calls[calls.length - 1]?.[3];
}

function record(fixture: ComponentFixture<CatalogSelectors>): string[] {
  const heard: string[] = [];
  const selectors = fixture.componentInstance;
  selectors.supermarketOpened.subscribe(() => heard.push('supermarketOpened'));
  selectors.supermarketCleared.subscribe(() =>
    heard.push('supermarketCleared')
  );
  selectors.categoryOpened.subscribe(() => heard.push('categoryOpened'));
  selectors.categoryCleared.subscribe(() => heard.push('categoryCleared'));
  return heard;
}

describe('CatalogSelectors', () => {
  describe('with nothing chosen', () => {
    it('says All supermarkets and All categories', async () => {
      const fixture = await render();

      expect(body(fixture, 'supermarket').textContent).toContain(
        'catalog.supermarket.all'
      );
      expect(body(fixture, 'category').textContent).toContain(
        'catalog.categories.all'
      );
    });

    it('is one button each, with nothing to clear', async () => {
      const fixture = await render();

      expect(host(fixture).querySelectorAll('button')).toHaveLength(2);
      expect(clear(fixture, 'supermarket')).toBeNull();
      expect(clear(fixture, 'category')).toBeNull();
      expect(pick(fixture, 'supermarket').classList.contains('is-set')).toBe(
        false
      );
      expect(pick(fixture, 'category').classList.contains('is-set')).toBe(
        false
      );
    });

    it('draws the store glyph and no logo', async () => {
      const fixture = await render();

      expect(
        body(fixture, 'supermarket').querySelector('lib-store-icon')
      ).not.toBeNull();
      expect(host(fixture).querySelector('lib-chain-logo')).toBeNull();
    });

    it('opens each picker from its own body', async () => {
      const fixture = await render();
      const heard = record(fixture);

      body(fixture, 'supermarket').click();
      body(fixture, 'category').click();

      expect(heard).toEqual(['supermarketOpened', 'categoryOpened']);
    });
  });

  describe('with a supermarket chosen', () => {
    it('draws the chain, its logo and the set look', async () => {
      const fixture = await render(ANY_MERCADONA);

      expect(body(fixture, 'supermarket').textContent).toContain('Mercadona');
      expect(body(fixture, 'supermarket').textContent).not.toContain(
        'catalog.supermarket.all'
      );
      expect(
        body(fixture, 'supermarket')
          .querySelector('lib-chain-logo')
          ?.classList.contains('is-xs')
      ).toBe(true);
      expect(pick(fixture, 'supermarket').classList.contains('is-set')).toBe(
        true
      );
    });

    it('draws a cross with its own name, as a sibling of the body', async () => {
      const fixture = await render(ANY_MERCADONA);

      const cross = clear(fixture, 'supermarket');
      expect(cross?.getAttribute('aria-label')).toBe(
        'catalog.supermarket.clear'
      );
      expect(cross?.closest('[data-selector]')).toBeNull();
      expect(host(fixture).querySelector('button button')).toBeNull();
    });

    it('leaves the category selector as it was', async () => {
      const fixture = await render(ANY_MERCADONA);

      expect(clear(fixture, 'category')).toBeNull();
      expect(pick(fixture, 'category').classList.contains('is-set')).toBe(
        false
      );
    });

    it('opens from the body and clears from the cross, each with its own event', async () => {
      const fixture = await render(ANY_MERCADONA);
      const heard = record(fixture);

      body(fixture, 'supermarket').click();
      expect(heard).toEqual(['supermarketOpened']);

      clear(fixture, 'supermarket')?.click();
      expect(heard).toEqual(['supermarketOpened', 'supermarketCleared']);
    });
  });

  describe('with a category chosen', () => {
    it('draws the leaf alone and the set look', async () => {
      const fixture = await render(NO_SUPERMARKET, COFFEE);

      const text = body(fixture, 'category').querySelector('.text');
      expect(text?.textContent?.trim()).toBe('Coffee');
      expect(pick(fixture, 'category').classList.contains('is-set')).toBe(true);
    });

    it('draws a cross with its own name', async () => {
      const fixture = await render(NO_SUPERMARKET, COFFEE);

      expect(clear(fixture, 'category')?.getAttribute('aria-label')).toBe(
        'catalog.categories.clear'
      );
      expect(clear(fixture, 'supermarket')).toBeNull();
    });

    it('opens from the body and clears from the cross, each with its own event', async () => {
      const fixture = await render(NO_SUPERMARKET, COFFEE);
      const heard = record(fixture);

      body(fixture, 'category').click();
      expect(heard).toEqual(['categoryOpened']);

      clear(fixture, 'category')?.click();
      expect(heard).toEqual(['categoryOpened', 'categoryCleared']);
    });
  });

  it('clears one choice and not the other with both chosen', async () => {
    const fixture = await render(ANY_MERCADONA, COFFEE);
    const heard = record(fixture);

    expect(host(fixture).querySelectorAll('button')).toHaveLength(4);
    clear(fixture, 'category')?.click();
    clear(fixture, 'supermarket')?.click();

    expect(heard).toEqual(['categoryCleared', 'supermarketCleared']);
  });

  describe('the accessible names', () => {
    it('says all supermarkets and all categories', async () => {
      const fixture = await render();

      expect(body(fixture, 'supermarket').getAttribute('aria-label')).toBe(
        'catalog.selector.supermarketAll'
      );
      expect(body(fixture, 'category').getAttribute('aria-label')).toBe(
        'catalog.selector.categoryAll'
      );
    });

    it('says any shop for a chain with no shop picked', async () => {
      const fixture = await render(ANY_MERCADONA);

      expect(body(fixture, 'supermarket').getAttribute('aria-label')).toBe(
        'catalog.selector.supermarketAny'
      );
      expect(valuesOf('catalog.selector.supermarketAny')).toEqual({
        chain: 'Mercadona',
      });
    });

    it('says one shop for a chain with a shop picked', async () => {
      const fixture = await render({ ...ANY_MERCADONA, anyShop: false });

      expect(body(fixture, 'supermarket').getAttribute('aria-label')).toBe(
        'catalog.selector.supermarketShop'
      );
      expect(valuesOf('catalog.selector.supermarketShop')).toEqual({
        chain: 'Mercadona',
      });
    });

    it('says the root and the leaf for a leaf, which the text has no room for', async () => {
      const fixture = await render(NO_SUPERMARKET, COFFEE);

      expect(body(fixture, 'category').getAttribute('aria-label')).toBe(
        'catalog.selector.categoryLeaf'
      );
      expect(valuesOf('catalog.selector.categoryLeaf')).toEqual({
        root: 'Drinks',
        leaf: 'Coffee',
      });
    });

    it('says the root alone when the root is the choice', async () => {
      const fixture = await render(NO_SUPERMARKET, {
        chosen: true,
        name: 'Drinks',
        root: null,
      });

      expect(body(fixture, 'category').getAttribute('aria-label')).toBe(
        'catalog.selector.categoryRoot'
      );
      expect(valuesOf('catalog.selector.categoryRoot')).toEqual({
        root: 'Drinks',
      });
    });
  });
});
