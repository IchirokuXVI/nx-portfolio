import { TestBed } from '@angular/core/testing';
import {
  ITEM_LOOKUP_MAX_IDS,
  type CatalogItem,
} from '@portfolio/velista/models';
import { CATALOG_SERVICE, type CatalogServiceI } from './catalog-service';
import { ItemNames } from './item-names';

function product(id: string): CatalogItem {
  return {
    id,
    name: { es: id, en: id },
    brand: null,
    size: null,
    unit: 'UNIT',
    productGroupId: null,
    category: 'DAIRY',
    offer: null,
  };
}

/** A catalog that records every request and answers each id it was asked for. */
function setup(fail: (ids: readonly string[]) => boolean = () => false) {
  const requests: string[][] = [];
  const catalog: Partial<CatalogServiceI> = {
    itemsByIds: async (ids) => {
      requests.push([...ids]);
      return fail(ids) ? null : ids.map(product);
    },
  };

  TestBed.configureTestingModule({
    providers: [ItemNames, { provide: CATALOG_SERVICE, useValue: catalog }],
  });

  return { names: TestBed.inject(ItemNames), requests };
}

function ids(count: number, prefix = 'item'): string[] {
  return Array.from({ length: count }, (_, at) => `${prefix}-${at}`);
}

describe('ItemNames.ensure', () => {
  /**
   * Velista `0082`, section 3: the zone list page asks for every line's products at
   * once, and the gateway refuses a lookup naming more than its cap.
   */
  it('splits a set larger than the lookup cap into requests the gateway accepts', async () => {
    const { names, requests } = setup();
    const wanted = ids(ITEM_LOOKUP_MAX_IDS * 2 + 1);

    await names.ensure(wanted);

    expect(requests.map((request) => request.length)).toEqual([
      ITEM_LOOKUP_MAX_IDS,
      ITEM_LOOKUP_MAX_IDS,
      1,
    ]);
    expect(requests.flat()).toEqual(wanted);
    expect(names.nameOf(wanted[wanted.length - 1])?.category).toBe('DAIRY');
  });

  it('asks one request for a set at the cap', async () => {
    const { names, requests } = setup();

    await names.ensure(ids(ITEM_LOOKUP_MAX_IDS));

    expect(requests).toHaveLength(1);
  });

  it('asks only for ids nothing is known about', async () => {
    const { names, requests } = setup();

    await names.ensure(['a', 'b']);
    await names.ensure(['a', 'b', 'c']);

    expect(requests).toEqual([['a', 'b'], ['c']]);
  });

  it('marks only the chunk that failed, and resolves the rest', async () => {
    const wanted = ids(ITEM_LOOKUP_MAX_IDS + 2);
    const { names } = setup((request) => request.includes(wanted[0]));

    await names.ensure(wanted);

    expect(names.anyFailed([wanted[0]])).toBe(true);
    expect(names.anyFailed(wanted.slice(ITEM_LOOKUP_MAX_IDS))).toBe(false);
    expect(names.nameOf(wanted[ITEM_LOOKUP_MAX_IDS])).not.toBeNull();
  });
});
