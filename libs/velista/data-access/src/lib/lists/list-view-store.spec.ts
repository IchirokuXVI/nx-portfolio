import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  RokuLocaleStore,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import type {
  CatalogItem,
  Line,
  ProductCategory,
} from '@portfolio/velista/models';
import {
  provideFakeBrowserFacade,
  StorageKeys,
} from '@portfolio/velista/platform';
import { ItemNames } from '../catalog/item-names';
import { LineStore } from '../lines/line-store';
import { fakeItemNames } from '../testing/store-doubles';
import { parseListViewMemory } from './list-view-memory';
import { ListViewStore } from './list-view-store';

function line(id: string, content: string, itemIds: string[] = []): Line {
  return { id, content, itemIds } as unknown as Line;
}

function product(
  id: string,
  en: string,
  category: ProductCategory
): CatalogItem {
  return {
    id,
    name: { es: en, en },
    brand: null,
    size: null,
    unit: 'UNIT',
    productGroupId: null,
    category,
    offer: null,
  };
}

const LINES = [
  line('l1', 'Zanahorias', ['carrot']),
  line('l2', 'Leche', ['milk', 'oat']),
  line('l3', 'Bolsas'),
];

const CATALOG = [
  product('carrot', 'Carrots', 'PRODUCE'),
  product('milk', 'Whole milk', 'DAIRY'),
  product('oat', 'Oat drink', 'BEVERAGES'),
];

/** A store over one list, on a storage the spec owns, so a reload is a new store. */
function harness(storage: Map<string, string>) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      ListViewStore,
      provideFakeBrowserFacade(storage),
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
      {
        provide: RokuTranslatorService,
        // "basket.category.DAIRY" answers "dairy", which is enough for a search.
        useValue: { t: (key: string) => key.split('.').pop()?.toLowerCase() },
      },
      { provide: LineStore, useValue: { linesIn: () => LINES } },
      { provide: ItemNames, useValue: fakeItemNames({ items: CATALOG }) },
    ],
  });

  const view = TestBed.inject(ListViewStore);
  view.open('list-1');
  return view;
}

const ids = (lines: readonly { id: string }[]) => lines.map((row) => row.id);

describe('ListViewStore', () => {
  it('counts the categories on the list, with No category for a line with no products', () => {
    const view = harness(new Map());

    expect(view.categoryCounts()).toEqual([
      { category: 'PRODUCE', lines: 1 },
      { category: 'DAIRY', lines: 1 },
      { category: 'BEVERAGES', lines: 1 },
      { category: 'NONE', lines: 1 },
    ]);
  });

  it('searches product names and category labels', () => {
    const view = harness(new Map());

    view.search('oat drink');
    expect(ids(view.compose(LINES).lines)).toEqual(['l2']);

    view.search('produce');
    expect(ids(view.compose(LINES).lines)).toEqual(['l1']);
  });

  it('changes nothing for One category until one is picked, and settles back to all lines', () => {
    const view = harness(new Map());

    view.setView('category');
    expect(view.visibleCount()).toBe(3);
    expect(view.activeCount()).toBe(0);

    view.settle();
    expect(view.view()).toBe('all');

    view.setView('category');
    view.pickCategory('DAIRY');
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
      view.pickCategory('DAIRY');

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
    view.pickCategory('DAIRY');

    view.leave();

    expect(view.query()).toBe('');
    expect(view.picked()).toBeNull();
    expect(view.visibleCount()).toBe(0);
  });
});
