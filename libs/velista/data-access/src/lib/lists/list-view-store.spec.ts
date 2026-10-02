import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RokuLocaleStore } from '@portfolio/localization/rokutranslator-angular';
import type {
  CatalogItem,
  CategoryNode,
  Line,
} from '@portfolio/velista/models';
import {
  provideFakeBrowserFacade,
  StorageKeys,
} from '@portfolio/velista/platform';
import { memoryCategory } from '../catalog/category-memory';
import { CategoryStore } from '../catalog/category-store';
import { ItemNames } from '../catalog/item-names';
import { LineStore } from '../lines/line-store';
import {
  fakeCategoryStore,
  fakeItemNames,
  type FakeCategoryStore,
} from '../testing/store-doubles';
import { parseListViewMemory } from './list-view-memory';
import { ListViewStore } from './list-view-store';

function line(id: string, content: string, itemIds: string[] = []): Line {
  return { id, content, itemIds } as unknown as Line;
}

function product(id: string, en: string, ...slugs: string[]): CatalogItem {
  return {
    id,
    name: { es: en, en },
    brand: null,
    size: null,
    unit: 'UNIT',
    productGroupId: null,
    categories: slugs.map(memoryCategory),
    offer: null,
    unitBasis: null,
    chainPrices: [],
    imageUrl: null,
    packCount: null,
  };
}

const LINES = [
  line('l1', 'Atún', ['tuna']),
  line('l2', 'Leche', ['milk', 'oat']),
  line('l3', 'Bolsas'),
];

const CATALOG = [
  product('tuna', 'Light tuna', 'tuna-and-bonito'),
  product('milk', 'Whole milk', 'milk'),
  product('oat', 'Oat drink', 'plant-based-drinks-and-horchata', 'milk'),
];

/** Three rows of the tree, in an order that is not the order the list meets them. */
const TREE: readonly CategoryNode[] = [
  root('canned-food-broths-and-creams', 12),
  leaf('tuna-and-bonito', 'canned-food-broths-and-creams', 0),
  root('eggs-milk-and-butter', 6),
  leaf('plant-based-drinks-and-horchata', 'eggs-milk-and-butter', 3),
  leaf('milk', 'eggs-milk-and-butter', 1),
];

function root(slug: string, position: number): CategoryNode {
  return { ...node(slug, position), parentId: null };
}

function leaf(slug: string, parent: string, position: number): CategoryNode {
  return { ...node(slug, position), parentId: `cat-${parent}` };
}

function node(slug: string, position: number): CategoryNode {
  return {
    id: `cat-${slug}`,
    parentId: null,
    slug,
    name: { en: slug, es: slug },
    position,
    itemCount: 1,
  };
}

/** A store over one list, on a storage the spec owns, so a reload is a new store. */
function harness(
  storage: Map<string, string>,
  tree: FakeCategoryStore = fakeCategoryStore(),
  locale = 'en'
) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      ListViewStore,
      provideFakeBrowserFacade(storage),
      { provide: RokuLocaleStore, useValue: { locale: signal(locale) } },
      { provide: LineStore, useValue: { linesIn: () => LINES } },
      { provide: ItemNames, useValue: fakeItemNames({ items: CATALOG }) },
      { provide: CategoryStore, useValue: tree },
    ],
  });

  const view = TestBed.inject(ListViewStore);
  view.open('list-1');
  return view;
}

const ids = (lines: readonly { id: string }[]) => lines.map((row) => row.id);

describe('ListViewStore', () => {
  it('counts the categories on the list, named from the data, with No category for a line with no products', () => {
    const view = harness(new Map());

    // First appearance order, because the tree has not landed.
    expect(view.categoryCounts()).toEqual([
      { category: 'cat-tuna-and-bonito', lines: 1, name: 'Tuna and bonito' },
      { category: 'cat-milk', lines: 1, name: 'Milk' },
      {
        category: 'cat-plant-based-drinks-and-horchata',
        lines: 1,
        name: 'Plant-based drinks and horchata',
      },
      { category: 'NONE', lines: 1, name: null },
    ]);
  });

  it('names the radios in the reader’s language', () => {
    const view = harness(new Map(), fakeCategoryStore(), 'es');

    expect(view.categoryCounts().map((row) => row.name)).toEqual([
      'Atún y bonito',
      'Leche',
      'Bebidas vegetales y horchatas',
      null,
    ]);
    expect(view.categoryName('cat-milk')).toBe('Leche');
    expect(view.categoryName('NONE')).toBe('');
  });

  it('asks for the tree when a list opens, and re-sorts when it lands', () => {
    const tree = fakeCategoryStore();
    const view = harness(new Map(), tree);
    expect(tree.ensured()).toBe(1);

    tree.land(TREE);

    expect(view.categoryCounts().map((row) => row.category)).toEqual([
      'cat-milk',
      'cat-plant-based-drinks-and-horchata',
      'cat-tuna-and-bonito',
      'NONE',
    ]);
  });

  it('searches product names and category names', () => {
    const view = harness(new Map());

    view.search('oat drink');
    expect(ids(view.compose(LINES).lines)).toEqual(['l2']);

    view.search('bonito');
    expect(ids(view.compose(LINES).lines)).toEqual(['l1']);
  });

  it('searches the category name in the reader’s language, folded', () => {
    const view = harness(new Map(), fakeCategoryStore(), 'es');

    view.search('BEBIDAS');
    expect(ids(view.compose(LINES).lines)).toEqual(['l2']);
  });

  it('changes nothing for One category until one is picked, and settles back to all lines', () => {
    const view = harness(new Map());

    view.setView('category');
    expect(view.visibleCount()).toBe(3);
    expect(view.activeCount()).toBe(0);

    view.settle();
    expect(view.view()).toBe('all');

    view.setView('category');
    view.pickCategory('cat-milk');
    view.settle();
    expect(view.view()).toBe('category');
    expect(ids(view.compose(LINES).lines)).toEqual(['l2']);
    expect(view.activeCount()).toBe(1);
  });

  it('holds reorder while a search is on, and lets it go when the search is cleared', () => {
    const view = harness(new Map());

    view.search('milk');
    expect(view.holdsReorder()).toBe(true);

    view.search('');
    expect(view.holdsReorder()).toBe(false);
  });

  describe('what the device remembers (section 8)', () => {
    it('keeps the order across a reload', () => {
      const storage = new Map<string, string>();
      harness(storage).setOrder('alpha');

      const reloaded = harness(storage);

      expect(reloaded.order()).toBe('alpha');
    });

    it('never keeps the category view, nor writes it', () => {
      const storage = new Map<string, string>();
      const view = harness(storage);
      view.setView('category');
      view.pickCategory('cat-milk');

      const reloaded = harness(storage);

      expect(reloaded.view()).toBe('all');
      expect(reloaded.picked()).toBeNull();
      const stored = parseListViewMemory(
        storage.get(StorageKeys.listView) ?? null
      );
      expect(stored?.view).toBeUndefined();
    });

    it('ignores a view an older record holds', () => {
      const storage = new Map([
        [
          StorageKeys.listView,
          JSON.stringify({
            version: 1,
            order: { value: 'alpha', until: null },
            view: { value: 'category', until: null },
          }),
        ],
      ]);

      const view = harness(storage);

      expect(view.order()).toBe('alpha');
      expect(view.view()).toBe('all');
    });

    it('forgets everything on Reset', () => {
      const storage = new Map<string, string>();
      const view = harness(storage);
      view.setOrder('alpha');

      view.reset();

      expect(view.order()).toBe('list');
      expect(harness(storage).order()).toBe('list');
    });
  });

  it('gives the instance back on leave, unsearched and on all lines', () => {
    const view = harness(new Map());
    view.search('milk');
    view.pickCategory('cat-milk');

    view.leave();

    expect(view.query()).toBe('');
    expect(view.picked()).toBeNull();
    expect(view.visibleCount()).toBe(0);
  });
});

/** Velista `0088`, section 4: what is open is remembered for the visit. */
describe('ListViewStore: open trips', () => {
  it('opens the newest live trip once per visit, and a closed one stays closed', () => {
    const view = harness(new Map());

    view.seedOpenTrip('BASKET:b-live');
    expect([...view.openTrips()]).toEqual(['BASKET:b-live']);

    view.toggleTrip('BASKET:b-live');
    view.seedOpenTrip('BASKET:b-live');
    expect([...view.openTrips()]).toEqual([]);
  });

  it('keeps what is open through a search, and forgets it when the list changes', () => {
    const view = harness(new Map());
    view.toggleTrip('SESSION:s-1');

    view.search('leche');
    view.search('');
    expect([...view.openTrips()]).toEqual(['SESSION:s-1']);

    view.open('list-2');
    expect([...view.openTrips()]).toEqual([]);
    view.seedOpenTrip('BASKET:b-2');
    expect([...view.openTrips()]).toEqual(['BASKET:b-2']);
  });
});
