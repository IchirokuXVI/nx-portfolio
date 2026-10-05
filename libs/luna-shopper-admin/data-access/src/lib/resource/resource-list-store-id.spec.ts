import {
  defineResource,
  type ResourceGateway,
  type ResourcePage,
  type ResourceQuery,
  type ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import { GatewayError, notFoundError } from '../gateway-error';
import { readRecordById } from './read-record-by-id';
import { ResourceListStore } from './resource-list-store';

/**
 * A list whose search box holds a record ID (admin plan 0051).
 *
 * The list stops searching and reads the one row of its own resource that has
 * the ID. A missing ID is its own state, with its own sentence.
 */
const ID = '3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f';
const OTHER = '11111111-2222-4333-8444-555555555555';

interface Shop extends ResourceRow {
  id: string;
  name: string;
  supermarketId: string;
}

const descriptor = defineResource<Shop>({
  name: 'shops',
  segment: 'shops',
  labels: { one: 'shops.one', many: 'shops.many' },
  title: (row) => row.name,
  fields: [{ kind: 'text', name: 'name', label: 'shops.name' }],
  list: { columns: ['name'], compact: ['name'] },
  filters: [
    { kind: 'search', param: 'query', label: 'shops.search' },
    { kind: 'boolean', param: 'open', label: 'shops.open' },
  ],
  gateway: () => {
    throw new Error('not used');
  },
});

class FakeGateway implements ResourceGateway<ResourceRow> {
  readonly queries: ResourceQuery[] = [];
  readonly reads: { id: string; shown: ResourceQuery['filters'] }[] = [];
  rows: ResourceRow[] = [
    { id: ID, name: 'Gran Via', supermarketId: 'chain-a' },
  ];
  failWith: unknown = null;

  async list(query: ResourceQuery): Promise<ResourcePage<ResourceRow>> {
    this.queries.push(query);
    return { items: this.rows, nextCursor: null };
  }

  async read(
    id: string,
    shown?: ResourceQuery['filters']
  ): Promise<ResourceRow> {
    this.reads.push({ id, shown });
    if (this.failWith !== null) {
      throw this.failWith;
    }
    const row = this.rows.find((candidate) => candidate['id'] === id);
    if (row === undefined) {
      throw notFoundError();
    }
    return row;
  }

  async create(): Promise<ResourceRow> {
    throw new Error('not used');
  }

  async update(): Promise<ResourceRow> {
    throw new Error('not used');
  }

  async remove(): Promise<void> {
    throw new Error('not used');
  }
}

describe('ResourceListStore with an ID in the search', () => {
  it('shows exactly the record that has the ID, read by ID', async () => {
    const gateway = new FakeGateway();
    const store = new ResourceListStore<ResourceRow>(descriptor, gateway);

    await store.setFilter('query', `  ${ID.toUpperCase()} `);

    expect(store.rows().map((row) => row['name'])).toEqual(['Gran Via']);
    expect(gateway.reads.map((read) => read.id)).toEqual([ID]);
    // The ID never goes out as a word to search names for.
    expect(gateway.queries).toEqual([]);
    expect(store.hasMore()).toBe(false);
    expect(store.idNotFound()).toBe(false);
  });

  it('says the ID was not found, and not that a filter hides rows', async () => {
    const gateway = new FakeGateway();
    const store = new ResourceListStore<ResourceRow>(descriptor, gateway);

    await store.setFilter('query', OTHER);

    expect(store.rows()).toEqual([]);
    expect(store.idNotFound()).toBe(true);
    expect(store.noMatch()).toBe(false);
    expect(store.empty()).toBe(false);
  });

  it('finds the record whatever else narrows the list', async () => {
    const gateway = new FakeGateway();
    const store = new ResourceListStore<ResourceRow>(descriptor, gateway);

    await store.setFilter('open', 'false');
    await store.setFilter('query', ID);

    expect(store.rows()).toHaveLength(1);
    // The gateway is told what the list shows, for a row that gains columns
    // from a filter. It narrows nothing.
    expect(gateway.reads.at(-1)?.shown).toEqual({ open: 'false', query: ID });
  });

  it('finds nothing for the ID of a row under another parent', async () => {
    const gateway = new FakeGateway();
    const store = new ResourceListStore<ResourceRow>(
      descriptor,
      gateway,
      {},
      { supermarketId: 'chain-b' }
    );

    await store.setFilter('query', ID);

    expect(store.rows()).toEqual([]);
    expect(store.idNotFound()).toBe(true);
  });

  it('goes back to searching when the box holds words again', async () => {
    const gateway = new FakeGateway();
    const store = new ResourceListStore<ResourceRow>(descriptor, gateway);

    await store.setFilter('query', OTHER);
    await store.setFilter('query', 'gran');

    expect(store.idNotFound()).toBe(false);
    expect(gateway.queries.at(-1)?.filters).toEqual({ query: 'gran' });
  });

  it('keeps the one row through a refresh', async () => {
    const gateway = new FakeGateway();
    const store = new ResourceListStore<ResourceRow>(descriptor, gateway);
    await store.setFilter('query', ID);

    await store.refresh();

    expect(store.rows()).toHaveLength(1);
    expect(gateway.queries).toEqual([]);
  });

  it('shows a failure as a failure, not as a missing record', async () => {
    const gateway = new FakeGateway();
    gateway.failWith = new GatewayError({
      code: 'unavailable',
      status: 503,
      correlationId: 'c',
    });
    const store = new ResourceListStore<ResourceRow>(descriptor, gateway);

    await store.setFilter('query', ID);

    expect(store.status()).toBe('error');
    expect(store.idNotFound()).toBe(false);
  });

  it('leaves the ID as text where the resource has no read by ID', async () => {
    const walked = defineResource<Shop>({
      ...(descriptor as never as Parameters<typeof defineResource<Shop>>[0]),
      readById: false,
    });
    const gateway = new FakeGateway();
    const store = new ResourceListStore<ResourceRow>(walked, gateway);

    await store.setFilter('query', ID);

    expect(gateway.reads).toEqual([]);
    expect(gateway.queries.at(-1)?.filters).toEqual({ query: ID });
  });
});

describe('readRecordById', () => {
  it('answers nothing for an ID the route refuses as malformed', async () => {
    const gateway = new FakeGateway();
    gateway.failWith = new GatewayError({
      code: 'validation_failed',
      status: 400,
      correlationId: 'c',
    });

    await expect(readRecordById(descriptor, gateway, ID)).resolves.toBeNull();
  });

  it('throws what is not an answer about the record', async () => {
    const gateway = new FakeGateway();
    gateway.failWith = new GatewayError({
      code: 'forbidden',
      status: 403,
      correlationId: 'c',
    });

    await expect(readRecordById(descriptor, gateway, ID)).rejects.toThrow();
  });
});
