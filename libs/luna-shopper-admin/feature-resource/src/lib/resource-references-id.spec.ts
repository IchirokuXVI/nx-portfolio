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

describe('ResourceReferences with a record ID', () => {
  let references: ResourceReferences;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ContentLocaleStore,
        provideResources(shops, products, scopes),
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

  it('names what one row is called', () => {
    expect(references.nounOf('items')).toBe('items.one');
    expect(references.nounOf('nothing')).toBeNull();
  });
});
