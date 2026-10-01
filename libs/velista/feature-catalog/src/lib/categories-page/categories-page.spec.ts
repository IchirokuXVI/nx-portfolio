import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  fakeCategoryStore,
  MEMORY_CATEGORIES,
  provideFakeCategoryStore,
  type FakeCategoryStore,
} from '@portfolio/velista/data-access';
import type { CategoryNode } from '@portfolio/velista/models';
import {
  PageNavigation,
  provideVelistaTesting,
} from '@portfolio/velista/platform';
import { CategoriesPage } from './categories-page';

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  for (let tick = 0; tick < 10; tick++) {
    await Promise.resolve();
  }
  fixture.detectChanges();
}

async function render(tree: FakeCategoryStore) {
  TestBed.resetTestingModule();
  const pages = { back: jest.fn().mockResolvedValue(undefined) };

  await TestBed.configureTestingModule({
    imports: [CategoriesPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      provideRouter([]),
      provideFakeCategoryStore(tree),
      { provide: PageNavigation, useValue: pages },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(CategoriesPage);
  fixture.detectChanges();
  await settle(fixture);
  return { fixture, pages };
}

function links(fixture: ComponentFixture<CategoriesPage>): HTMLAnchorElement[] {
  return [
    ...(
      fixture.nativeElement as HTMLElement
    ).querySelectorAll<HTMLAnchorElement>('lib-category-rows a'),
  ];
}

/** A root whose only child holds nothing, so neither is drawn. */
const EMPTY_ROOT: readonly CategoryNode[] = [
  {
    id: 'cat-baby',
    parentId: null,
    slug: 'baby',
    name: { en: 'Baby', es: 'Bebé' },
    position: 12,
    itemCount: 0,
  },
  {
    id: 'cat-nappies',
    parentId: 'cat-baby',
    slug: 'nappies',
    name: { en: 'Nappies', es: 'Pañales' },
    position: 0,
    itemCount: 0,
  },
];

describe('CategoriesPage (velista 0119)', () => {
  it('lists every root with a product under it, each a link to its children', async () => {
    const tree = fakeCategoryStore([...MEMORY_CATEGORIES, ...EMPTY_ROOT]);
    const { fixture } = await render(tree);

    expect(links(fixture).map((link) => link.getAttribute('href'))).toEqual([
      '/velista/en/catalog/categories/dairy-and-eggs',
      '/velista/en/catalog/categories/bakery',
      '/velista/en/catalog/categories/breakfast-and-sweets',
      '/velista/en/catalog/categories/pantry',
    ]);
    expect(links(fixture)[0]?.textContent).toContain('Dairy and eggs');
    expect(tree.ensured()).toBe(1);
  });

  it('names each row "name, count", with the count in words', async () => {
    const { fixture } = await render(fakeCategoryStore(MEMORY_CATEGORIES));

    const first = links(fixture)[0];
    expect(first?.getAttribute('aria-label')).toBe('catalog.categories.row');
    expect(first?.querySelector('.count')?.textContent).toBe(
      'catalog.categories.count'
    );
    expect(first?.hasAttribute('aria-current')).toBe(false);
  });

  it('heads the page with the one page header: a back chevron, the title and no action', async () => {
    const { fixture } = await render(fakeCategoryStore(MEMORY_CATEGORIES));
    const host = fixture.nativeElement as HTMLElement;
    const header = host.querySelector('lib-page-header');

    expect(header?.querySelector('h1')?.textContent).toContain(
      'catalog.categories.title'
    );
    expect(
      header?.querySelector('button.lead')?.getAttribute('aria-label')
    ).toBe('catalog.categories.back');
    expect(header?.querySelector('.actions button')).toBeNull();
    // One h1 on the page, and the header is outside the box that scrolls.
    expect(host.querySelectorAll('h1')).toHaveLength(1);
    expect(host.querySelector('main lib-page-header')).toBeNull();
  });

  it('draws the header while the tree is on its way', async () => {
    const { fixture } = await render(fakeCategoryStore());

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('lib-page-header h1')
        ?.textContent
    ).toContain('catalog.categories.title');
  });

  it('goes back one step, with the catalog tab as the fallback', async () => {
    const { fixture, pages } = await render(
      fakeCategoryStore(MEMORY_CATEGORIES)
    );

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('lib-page-header button.lead')
      ?.click();

    expect(pages.back).toHaveBeenCalledWith('/velista/en/catalog');
  });

  it('draws bones and a polite status while the tree is on its way', async () => {
    const { fixture } = await render(fakeCategoryStore());
    const host = fixture.nativeElement as HTMLElement;

    expect(links(fixture)).toHaveLength(0);
    expect(host.querySelectorAll('.bone').length).toBeGreaterThan(0);
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      'catalog.categories.loading'
    );
  });
});
