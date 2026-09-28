import { TestBed } from '@angular/core/testing';
import type { CategoryNode } from '@portfolio/velista/models';
import { CatalogMemory } from './catalog-memory';
import { CATALOG_SERVICE, type CatalogServiceI } from './catalog-service';
import { MEMORY_CATEGORIES } from './category-memory';
import { CategoryStore } from './category-store';

/** A catalog whose tree read answers what the spec says, one answer per call. */
function catalog(...answers: (readonly CategoryNode[] | null | Error)[]) {
  const calls: number[] = [];
  const service: Pick<CatalogServiceI, 'categories'> = {
    categories: async () => {
      calls.push(calls.length);
      const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
      if (answer instanceof Error) {
        throw answer;
      }
      return answer ?? null;
    },
  };
  return { service, calls };
}

function harness(service: Pick<CatalogServiceI, 'categories'>) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [CategoryStore, { provide: CATALOG_SERVICE, useValue: service }],
  });
  return TestBed.inject(CategoryStore);
}

/** Velista `0118`, section 4: the tree, read once per session. */
describe('CategoryStore', () => {
  it('holds nothing and ranks nothing before it is asked', () => {
    const store = harness(catalog(MEMORY_CATEGORIES).service);

    expect(store.state()).toBe('idle');
    expect(store.roots()).toEqual([]);
    expect(store.byId('cat-milk')).toBeNull();
    expect(store.rank('cat-milk')).toBeNull();
  });

  it('reads the tree once, however many screens ask', async () => {
    const { service, calls } = catalog(MEMORY_CATEGORIES);
    const store = harness(service);

    await Promise.all([store.ensure(), store.ensure()]);
    await store.ensure();

    expect(calls).toHaveLength(1);
    expect(store.state()).toBe('loaded');
    expect(store.loaded()).toBe(true);
  });

  it('answers the roots with their children, by id, by slug and by rank', async () => {
    const store = harness(catalog(MEMORY_CATEGORIES).service);
    await store.ensure();

    expect(store.roots().map((branch) => branch.root.slug)).toEqual([
      'dairy-and-eggs',
      'bakery',
      'breakfast-and-sweets',
      'pantry',
    ]);
    expect(store.roots()[0].children.map((child) => child.slug)).toEqual([
      'milk',
      'plant-drinks',
      'yogurts-and-desserts',
      'eggs',
    ]);
    expect(store.byId('cat-bread')?.name).toEqual({ en: 'Bread', es: 'Pan' });
    expect(store.bySlug('ice-cream')).toBeNull();
    expect(store.bySlug('eggs')?.id).toBe('cat-eggs');
    // A root, then its children, then the next root.
    expect(store.rank('cat-dairy-and-eggs')).toBe(0);
    expect(store.rank('cat-milk')).toBe(1);
    expect(store.rank('cat-bakery')).toBe(5);
    expect(store.rank('cat-nothing')).toBeNull();
  });

  it('keeps nothing from a failed read, and the next ask tries again', async () => {
    const { service, calls } = catalog(null, MEMORY_CATEGORIES);
    const store = harness(service);

    await store.ensure();
    expect(store.state()).toBe('failed');
    expect(store.rank('cat-milk')).toBeNull();

    await store.ensure();
    expect(calls).toHaveLength(2);
    expect(store.state()).toBe('loaded');
    expect(store.rank('cat-milk')).toBe(1);
  });

  it('never throws out of a catalog that does', async () => {
    const store = harness(catalog(new Error('boom')).service);

    await expect(store.ensure()).resolves.toBeUndefined();
    expect(store.state()).toBe('failed');
  });

  it('never throws out of a catalog double that has no tree read at all', async () => {
    const store = harness({} as Pick<CatalogServiceI, 'categories'>);

    await expect(store.ensure()).resolves.toBeUndefined();
    expect(store.state()).toBe('failed');
  });

  it('is what the memory catalog answers with', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        CategoryStore,
        CatalogMemory,
        { provide: CATALOG_SERVICE, useExisting: CatalogMemory },
      ],
    });
    const store = TestBed.inject(CategoryStore);

    await store.ensure();

    expect(store.tree().byId.size).toBe(MEMORY_CATEGORIES.length);
  });
});
