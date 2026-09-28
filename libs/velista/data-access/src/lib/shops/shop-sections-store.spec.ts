import { TestBed } from '@angular/core/testing';
import type { ShopSections } from '@portfolio/velista/models';
import {
  MEMORY_SHOP_SECTIONS,
  ShopSectionsMemory,
} from './shop-sections-memory';
import {
  SHOP_SECTIONS_SERVICE,
  type ShopSectionsServiceI,
} from './shop-sections-service';
import { ShopSectionsStore } from './shop-sections-store';

/** A service answering what the spec says, one answer per call. */
function service(...answers: (ShopSections | null | Error)[]) {
  const asked: string[] = [];
  const double: ShopSectionsServiceI = {
    sections: async (locationId) => {
      asked.push(locationId);
      const answer = answers[Math.min(asked.length - 1, answers.length - 1)];
      if (answer instanceof Error) {
        throw answer;
      }
      return answer ?? null;
    },
  };
  return { double, asked };
}

function harness(double: ShopSectionsServiceI) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      ShopSectionsStore,
      { provide: SHOP_SECTIONS_SERVICE, useValue: double },
    ],
  });
  return TestBed.inject(ShopSectionsStore);
}

const TEJARES: ShopSections = {
  sections: MEMORY_SHOP_SECTIONS['loc-tejares'],
  source: 'CHAIN',
};

/** Velista `0120`, target 1: a shop's aisles, read once per shop per session. */
describe('ShopSectionsStore', () => {
  it('holds nothing for a shop before it is asked, or for no shop', () => {
    const store = harness(service(TEJARES).double);

    expect(store.sectionsOf('loc-tejares')).toBeNull();
    expect(store.sectionsOf(null)).toBeNull();
  });

  it('reads a shop once, however many callers ask', async () => {
    const { double, asked } = service(TEJARES);
    const store = harness(double);

    await Promise.all([
      store.ensure('loc-tejares'),
      store.ensure('loc-tejares'),
    ]);
    await store.ensure('loc-tejares');

    expect(asked).toEqual(['loc-tejares']);
    expect(store.sectionsOf('loc-tejares')?.map((one) => one.id)).toEqual([
      'sec-mercadona-eggs',
    ]);
  });

  it('reads each shop on its own', async () => {
    const { double, asked } = service(TEJARES, {
      sections: [],
      source: 'CHAIN',
    });
    const store = harness(double);

    await store.ensure('loc-tejares');
    await store.ensure('loc-dia');

    expect(asked).toEqual(['loc-tejares', 'loc-dia']);
    expect(store.sectionsOf('loc-dia')).toEqual([]);
  });

  it('forgets a failed read, and a throwing one, so the next ask tries again', async () => {
    const { double, asked } = service(null, new Error('down'), TEJARES);
    const store = harness(double);

    await store.ensure('loc-tejares');
    expect(store.sectionsOf('loc-tejares')).toBeNull();

    await store.ensure('loc-tejares');
    expect(store.sectionsOf('loc-tejares')).toBeNull();

    await store.ensure('loc-tejares');
    expect(asked).toHaveLength(3);
    expect(store.sectionsOf('loc-tejares')).toHaveLength(1);
  });

  it('works over the memory twin', async () => {
    const memory = new ShopSectionsMemory();
    const store = harness(memory);

    await store.ensure('loc-tejares');
    await store.ensure('loc-barcelona');

    expect(store.sectionsOf('loc-tejares')?.[0].name.es).toBe('Huevos');
    expect(store.sectionsOf('loc-barcelona')).toEqual([]);
    expect(memory.asked).toEqual(['loc-tejares', 'loc-barcelona']);
  });
});
