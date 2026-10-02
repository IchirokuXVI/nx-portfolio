import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  fakeCategoryStore,
  fakeItemNames,
  ItemNames,
  LineStore,
  ListViewStore,
  MEMORY_CATEGORIES,
  memoryCategory,
  provideFakeCategoryStore,
  type FakeCategoryStore,
} from '@portfolio/velista/data-access';
import type { CatalogItem, Line } from '@portfolio/velista/models';
import {
  provideFakeBrowserFacade,
  provideVelistaTesting,
  SheetNavigation,
} from '@portfolio/velista/platform';
import { ListFilterSheet } from './list-filter-sheet';

const ZONE_ID = '8f14e45f-ceea-4e2c-9e0b-9c1a6a3f2b71';
const LIST_ID = '3c9a1d02-5f47-4b8e-9a1c-7d2e6b4f0a35';

function line(id: string, itemIds: string[]): Line {
  return { id, content: id, itemIds, position: 1 } as unknown as Line;
}

function product(id: string, slug: string): CatalogItem {
  return {
    id,
    name: { es: id, en: id },
    brand: null,
    size: null,
    unit: 'UNIT',
    productGroupId: null,
    categories: [memoryCategory(slug)],
    offer: null,
    unitBasis: null,
    chainPrices: [],
    imageUrl: null,
    packCount: null,
  };
}

/**
 * One rice line, two milk lines, one with no products. The rice line comes first,
 * so the tree's order (milk before rice) is not the order the list meets them in.
 */
const LINES = [
  line('rice', ['p-rice']),
  line('milk', ['p-milk']),
  line('milk-six', ['p-milk-six']),
  line('bags', []),
];

const ITEMS = [
  product('p-milk', 'milk'),
  product('p-milk-six', 'milk'),
  product('p-rice', 'rice'),
];

function render(
  tree: FakeCategoryStore = fakeCategoryStore(MEMORY_CATEGORIES)
) {
  TestBed.resetTestingModule();

  const sheets = {
    dismiss: jest.fn().mockResolvedValue(undefined),
    leaveTo: jest.fn().mockResolvedValue(undefined),
  };
  const paramMap = convertToParamMap({ zoneId: ZONE_ID, listId: LIST_ID });

  TestBed.configureTestingModule({
    imports: [ListFilterSheet, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '' }),
      ListViewStore,
      { provide: LineStore, useValue: { linesIn: () => LINES } },
      { provide: ItemNames, useValue: fakeItemNames({ items: ITEMS }) },
      provideFakeCategoryStore(tree),
      provideFakeBrowserFacade(new Map()),
      { provide: SheetNavigation, useValue: sheets },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: { paramMap, parent: null },
          paramMap: { subscribe: () => ({ unsubscribe: () => undefined }) },
          parent: null,
        },
      },
    ],
  });

  const view = TestBed.inject(ListViewStore);
  view.open(LIST_ID);

  const fixture = TestBed.createComponent(ListFilterSheet);
  fixture.detectChanges();

  return { fixture, sheets, view };
}

function radios(
  fixture: ReturnType<typeof render>['fixture'],
  name: string
): HTMLInputElement[] {
  return fixture.debugElement
    .queryAll(By.css(`input[name="${name}"]`))
    .map((node) => node.nativeElement as HTMLInputElement);
}

function choose(
  fixture: ReturnType<typeof render>['fixture'],
  input: HTMLInputElement
): void {
  input.checked = true;
  input.dispatchEvent(new Event('change'));
  fixture.detectChanges();
}

/** The list filter sheet (velista `0082`, section 4). */
describe('ListFilterSheet', () => {
  it('offers the two orders and the two views, List order and All lines chosen', () => {
    const { fixture } = render();

    expect(radios(fixture, 'list-order').map((input) => input.value)).toEqual([
      'list',
      'alpha',
    ]);
    expect(radios(fixture, 'list-order')[0].checked).toBe(true);
    expect(radios(fixture, 'list-view')[0].checked).toBe(true);
    expect(radios(fixture, 'list-category')).toHaveLength(0);
  });

  it('applies A to Z at once', () => {
    const { fixture, view } = render();

    choose(fixture, radios(fixture, 'list-order')[1]);

    expect(view.order()).toBe('alpha');
  });

  it('reveals only the categories present on the list, in tree order, with counts and No category last', () => {
    const { fixture } = render();

    choose(fixture, radios(fixture, 'list-view')[1]);

    expect(
      radios(fixture, 'list-category').map((input) => input.value)
    ).toEqual(['cat-milk', 'cat-rice', 'NONE']);
    const counts = fixture.debugElement
      .queryAll(By.css('.categories .choice-count'))
      .map((node) => (node.nativeElement as HTMLElement).textContent?.trim());
    expect(counts).toEqual(['2', '1', '1']);
  });

  it('names each category from its data, and No category from the copy', () => {
    const { fixture } = render();

    choose(fixture, radios(fixture, 'list-view')[1]);

    const names = fixture.debugElement
      .queryAll(By.css('.categories .choice-title'))
      .map((node) => (node.nativeElement as HTMLElement).textContent?.trim());
    expect(names).toEqual(['Milk', 'Rice', 'list.view.noCategory']);
  });

  it('draws the categories in first appearance order before the tree lands, and re-sorts when it does', () => {
    const tree = fakeCategoryStore();
    const { fixture } = render(tree);

    choose(fixture, radios(fixture, 'list-view')[1]);
    expect(
      radios(fixture, 'list-category').map((input) => input.value)
    ).toEqual(['cat-rice', 'cat-milk', 'NONE']);

    tree.land(MEMORY_CATEGORIES);
    fixture.detectChanges();

    expect(
      radios(fixture, 'list-category').map((input) => input.value)
    ).toEqual(['cat-milk', 'cat-rice', 'NONE']);
  });

  it('draws the categories as a radiogroup with a visible legend', () => {
    const { fixture } = render();

    choose(fixture, radios(fixture, 'list-view')[1]);

    const group = fixture.debugElement.query(By.css('[role="radiogroup"]'))
      .nativeElement as HTMLElement;
    const legend = group.querySelector('legend');
    expect(group.getAttribute('aria-labelledby')).toBe(legend?.id);
    expect(legend?.classList.contains('visually-hidden')).toBe(false);
  });

  it('applies nothing until a category is picked', () => {
    const { fixture, view } = render();

    choose(fixture, radios(fixture, 'list-view')[1]);

    expect(view.picked()).toBeNull();
    expect(view.visibleCount()).toBe(4);

    choose(fixture, radios(fixture, 'list-category')[0]);

    expect(view.picked()).toBe('cat-milk');
    expect(view.visibleCount()).toBe(2);
  });

  it('puts All lines back when it closes with no category picked', () => {
    const { fixture, view } = render();
    choose(fixture, radios(fixture, 'list-view')[1]);

    fixture.destroy();

    expect(view.view()).toBe('all');
  });

  it('keeps a picked category when it closes', () => {
    const { fixture, view } = render();
    choose(fixture, radios(fixture, 'list-view')[1]);
    choose(fixture, radios(fixture, 'list-category')[1]);

    fixture.destroy();

    expect(view.picked()).toBe('cat-rice');
  });

  it('puts both sections back on Reset', () => {
    const { fixture, view } = render();
    choose(fixture, radios(fixture, 'list-order')[1]);
    choose(fixture, radios(fixture, 'list-view')[1]);
    choose(fixture, radios(fixture, 'list-category')[0]);

    (
      fixture.nativeElement.querySelector('.reset') as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    expect(view.order()).toBe('list');
    expect(view.view()).toBe('all');
    expect(radios(fixture, 'list-category')).toHaveLength(0);
  });

  it('dismisses back to the list page', () => {
    const { fixture, sheets } = render();

    (
      fixture.nativeElement.querySelector('.confirm') as HTMLButtonElement
    ).click();

    expect(sheets.dismiss).toHaveBeenCalledWith(
      `/en/zones/${ZONE_ID}/lists/${LIST_ID}`
    );
  });
});
