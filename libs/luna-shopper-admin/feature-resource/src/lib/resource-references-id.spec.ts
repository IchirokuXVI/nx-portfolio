import { inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ContentLocaleStore,
  RESOURCE_GATEWAYS,
} from '@portfolio/luna-shopper-admin/data-access';
import { defineResource } from '@portfolio/luna-shopper-admin/models';
import { provideResources } from './admin-section';
import { ResourceReferences } from './resource-registry';

/**
 * The typeahead's lookup, handed a record ID (admin plan 0051).
 *
 * A term that is an ID is read on the resource the picker is over, by that
 * resource's own read. So the ID of a row of another table finds nothing.
 */
const GRAN_VIA = '3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f';
const TOMATO = '11111111-2222-4333-8444-555555555555';
const REGION = '99999999-2222-4333-8444-555555555555';

interface Shop {
  id: string;
  label: string;
  supermarketId: string;
}

const shops = defineResource<Shop>({
  name: 'locations',
  segment: 'locations',
  labels: { one: 'shops.one', many: 'shops.many' },
  title: (row) => row.label,
  fields: [{ kind: 'text', name: 'label', label: 'shops.label' }],
  list: { columns: ['label'], compact: ['label'] },
  filters: [{ kind: 'search', param: 'query', label: 'shops.search' }],
  gateway: () =>
    inject(RESOURCE_GATEWAYS).for<Shop>({
      path: '/v1/admin/catalog/locations',
      seed: [{ id: GRAN_VIA, label: 'Gran Via', supermarketId: 'chain-a' }],
    }),
});

const products = defineResource<{ id: string; label: string }>({
  name: 'items',
  segment: 'items',
  labels: { one: 'items.one', many: 'items.many' },
  title: (row) => row.label,
  fields: [{ kind: 'text', name: 'label', label: 'items.label' }],
  list: { columns: ['label'], compact: ['label'] },
  filters: [{ kind: 'search', param: 'query', label: 'items.search' }],
  gateway: () =>
    inject(RESOURCE_GATEWAYS).for<{ id: string; label: string }>({
      path: '/v1/admin/catalog/items',
      seed: [{ id: TOMATO, label: 'Tomato' }],
    }),
});

/** No read by ID, as the price scopes have none. */
const scopes = defineResource<{ id: string; label: string }>({
  name: 'price-scopes',
  segment: 'price-scopes',
  labels: { one: 'scopes.one', many: 'scopes.many' },
  readById: false,
  title: (row) => row.label,
  fields: [{ kind: 'text', name: 'label', label: 'scopes.label' }],
  list: { columns: ['label'], compact: ['label'] },
  gateway: () =>
    inject(RESOURCE_GATEWAYS).for<{ id: string; label: string }>({
      path: '/v1/admin/catalog/price-scopes',
      seed: [
        { id: REGION, label: 'Region' },
        { id: 'ps_2', label: 'Madrid' },
      ],
    }),
});

const ROOT = 'aaaaaaaa-2222-4333-8444-555555555555';
const LEAF = 'bbbbbbbb-2222-4333-8444-555555555555';

interface Category {
  id: string;
  label: string;
  parentId: string | null;
}

/**
 * A tree whose list is filtered by a `kind` no row carries, as the catalog's
 * categories are. `one` is written as a heading, so it names a sentence form.
 */
const categories = defineResource<Category>({
  name: 'categories',
  segment: 'categories',
  labels: { one: 'Category', many: 'categories.many', noun: 'category' },
  title: (row) => row.label,
  within: (row, scope) =>
    scope['kind'] === 'root'
      ? row.parentId === null
      : scope['kind'] === 'leaf'
        ? row.parentId !== null
        : true,
  fields: [{ kind: 'text', name: 'label', label: 'categories.label' }],
  list: { columns: ['label'], compact: ['label'] },
  gateway: () =>
    inject(RESOURCE_GATEWAYS).for<Category>({
      path: '/v1/admin/catalog/categories',
      seed: [
        { id: ROOT, label: 'Food', parentId: null },
        { id: LEAF, label: 'Fruit', parentId: ROOT },
      ],
    }),
});

describe('ResourceReferences with a record ID', () => {
  let references: ResourceReferences;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ContentLocaleStore,
        provideResources(shops, products, scopes, categories),
      ],
    });
    references = TestBed.inject(ResourceReferences);
  });

  it('answers the one row that has the ID', async () => {
    const found = await references.search('locations', ` ${GRAN_VIA} `);

    expect(found.map((option) => [option.id, option.title])).toEqual([
      [GRAN_VIA, 'Gran Via'],
    ]);
  });

  it('answers nothing for an ID that no row has', async () => {
    await expect(references.search('locations', TOMATO)).resolves.toEqual([]);
  });

  it('reads the ID on its own table and on no other', async () => {
    // The ID of a shop, in a picker of products.
    await expect(references.search('items', GRAN_VIA)).resolves.toEqual([]);
  });

  it('answers nothing for a row outside what the screen fixed', async () => {
    await expect(
      references.search('locations', GRAN_VIA, { supermarketId: 'chain-b' })
    ).resolves.toEqual([]);
    await expect(
      references.search('locations', GRAN_VIA, { supermarketId: 'chain-a' })
    ).resolves.toHaveLength(1);
  });

  it('leaves an ID as text where the resource has no read by ID', async () => {
    // No search filter either, so the term is ignored and the first page
    // comes back, as it does for any typed text on this resource.
    await expect(
      references.search('price-scopes', REGION)
    ).resolves.toHaveLength(2);
  });

  /**
   * The read by ID sends no filter, so a scope that is no column of the row
   * is the resource's to judge. A root pasted into a picker of leaves was
   * chosen at once, and the save was refused with `category_not_a_leaf`.
   */
  it('answers nothing for a root in a picker of leaves', async () => {
    await expect(
      references.search('categories', ROOT, { kind: 'leaf' })
    ).resolves.toEqual([]);
    await expect(
      references.search('categories', LEAF, { kind: 'leaf' })
    ).resolves.toHaveLength(1);
  });

  it('answers nothing for a leaf in a picker of roots', async () => {
    await expect(
      references.search('categories', LEAF, { kind: 'root' })
    ).resolves.toEqual([]);
    await expect(
      references.search('categories', ROOT, { kind: 'root' })
    ).resolves.toHaveLength(1);
  });

  it('answers either where the screen fixed no kind', async () => {
    await expect(references.search('categories', ROOT)).resolves.toHaveLength(
      1
    );
    await expect(references.search('categories', LEAF)).resolves.toHaveLength(
      1
    );
  });

  it('names what one row is called', () => {
    expect(references.nounOf('items')).toBe('items.one');
    expect(references.nounOf('nothing')).toBeNull();
  });

  it('names it in its sentence form where the resource has one', () => {
    expect(references.nounOf('categories')).toBe('category');
  });

  /** The picker asks this, so it and the search cannot disagree. */
  it('says a term is an ID only where the search reads it as one', () => {
    expect(references.recordIdFor('locations', ` ${GRAN_VIA} `)).toBe(GRAN_VIA);
    expect(references.recordIdFor('locations', 'gran via')).toBeNull();
    expect(references.recordIdFor('price-scopes', REGION)).toBeNull();
    expect(references.recordIdFor('nothing', REGION)).toBeNull();
  });
});
