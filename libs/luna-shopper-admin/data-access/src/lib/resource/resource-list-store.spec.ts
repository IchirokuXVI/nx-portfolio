import {
  defineResource,
  type ResourceGateway,
  type ResourcePage,
  type ResourceQuery,
  type ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import { GatewayError } from '../gateway-error';
import { ResourceListStore } from './resource-list-store';

interface Shop extends ResourceRow {
  id: string;
  name: string;
}

const descriptor = defineResource<Shop>({
  name: 'shops',
  segment: 'shops',
  labels: { one: 'shops.one', many: 'shops.many' },
  title: (row) => row.name,
  fields: [{ kind: 'text', name: 'name', label: 'shops.name' }],
  list: { columns: ['name'], compact: ['name'] },
  filters: [{ kind: 'search', param: 'query', label: 'shops.search' }],
  gateway: () => {
    throw new Error('not used');
  },
});

/** A gateway that answers whatever the test lines up. */
class FakeGateway implements ResourceGateway<ResourceRow> {
  readonly queries: ResourceQuery[] = [];
  pages: ResourcePage<ResourceRow>[] = [];
  failWith: unknown = null;
  removed: string[] = [];

  async list(query: ResourceQuery): Promise<ResourcePage<ResourceRow>> {
    this.queries.push(query);
    if (this.failWith !== null) {
      throw this.failWith;
    }
    return this.pages.shift() ?? { items: [], nextCursor: null };
  }

  async read(): Promise<ResourceRow> {
    throw new Error('not used');
  }

  async create(): Promise<ResourceRow> {
    throw new Error('not used');
  }

  async update(): Promise<ResourceRow> {
    throw new Error('not used');
  }

  async remove(id: string): Promise<void> {
    if (this.failWith !== null) {
      throw this.failWith;
    }
    this.removed.push(id);
  }
}

const storeWith = (gateway: FakeGateway) =>
  new ResourceListStore<ResourceRow>(descriptor, gateway);

describe('ResourceListStore states', () => {
  it('is empty when nothing came back and nothing was filtered', async () => {
    const gateway = new FakeGateway();
    gateway.pages = [{ items: [], nextCursor: null }];
    const store = storeWith(gateway);

    await store.load();

    expect(store.empty()).toBe(true);
    expect(store.noMatch()).toBe(false);
  });

  /**
   * A different sentence with a different remedy, and only this one offers a
   * way out.
   */
  it('is a no match when a filter is set and nothing came back', async () => {
    const gateway = new FakeGateway();
    gateway.pages = [
      { items: [{ id: 'a', name: 'Aldi' }], nextCursor: null },
      { items: [], nextCursor: null },
    ];
    const store = storeWith(gateway);
    await store.load();

    await store.setFilter('query', 'zzz');

    expect(store.noMatch()).toBe(true);
    expect(store.empty()).toBe(false);
  });

  /** An order does not exclude anything, so a sorted empty list is just empty. */
  it('stays empty rather than a no match when only the order is set', async () => {
    const gateway = new FakeGateway();
    gateway.pages = [
      { items: [], nextCursor: null },
      { items: [], nextCursor: null },
    ];
    const store = storeWith(gateway);
    await store.load();

    await store.setOrder('name');

    expect(store.empty()).toBe(true);
    expect(store.noMatch()).toBe(false);
  });

  it('clearing puts every filter back and reads again', async () => {
    const gateway = new FakeGateway();
    gateway.pages = [
      { items: [], nextCursor: null },
      { items: [], nextCursor: null },
      { items: [{ id: 'a', name: 'Aldi' }], nextCursor: null },
    ];
    const store = storeWith(gateway);
    await store.load();
    await store.setFilter('query', 'zzz');

    await store.clear();

    expect(store.filters()).toEqual({});
    expect(store.rows()).toHaveLength(1);
  });

  it('reports a failure with nothing else to draw as an error', async () => {
    const gateway = new FakeGateway();
    gateway.failWith = new GatewayError({
      code: 'internal',
      status: 500,
      correlationId: 'abc',
    });
    const store = storeWith(gateway);

    await store.load();

    expect(store.status()).toBe('error');
    expect(store.error()?.status).toBe(500);
  });
});

describe('ResourceListStore pagination', () => {
  /**
   * There is more if and only if the cursor says so. A page holding exactly the
   * requested number is not proof another exists, and a short one is not proof
   * that none does (plan 0004, section 4).
   */
  it('takes the cursor as the only word on whether there is more', async () => {
    const gateway = new FakeGateway();
    gateway.pages = [{ items: [], nextCursor: 'c1' }];
    const store = storeWith(gateway);

    await store.load();

    expect(store.rows()).toHaveLength(0);
    expect(store.hasMore()).toBe(true);
  });

  /**
   * The defect this guards: a cursor timestamp loses microseconds, so a row can
   * come back on both sides of a boundary.
   */
  it('shows a row that repeats across a page boundary once', async () => {
    const gateway = new FakeGateway();
    gateway.pages = [
      {
        items: [
          { id: 'a', name: 'Aldi' },
          { id: 'b', name: 'Bonpreu' },
        ],
        nextCursor: 'c1',
      },
      {
        items: [
          { id: 'b', name: 'Bonpreu' },
          { id: 'c', name: 'Consum' },
        ],
        nextCursor: null,
      },
    ];
    const store = storeWith(gateway);
    await store.load();

    await store.loadMore();

    expect(store.rows().map((row) => row['id'])).toEqual(['a', 'b', 'c']);
    expect(store.hasMore()).toBe(false);
  });

  it('sends the cursor it was given back', async () => {
    const gateway = new FakeGateway();
    gateway.pages = [
      { items: [{ id: 'a', name: 'Aldi' }], nextCursor: 'c1' },
      { items: [], nextCursor: null },
    ];
    const store = storeWith(gateway);
    await store.load();

    await store.loadMore();

    expect(gateway.queries[0].cursor).toBeUndefined();
    expect(gateway.queries[1].cursor).toBe('c1');
  });

  it('does not ask for more when there is no cursor', async () => {
    const gateway = new FakeGateway();
    gateway.pages = [{ items: [{ id: 'a', name: 'Aldi' }], nextCursor: null }];
    const store = storeWith(gateway);
    await store.load();

    await store.loadMore();

    expect(gateway.queries).toHaveLength(1);
  });

  /**
   * The rows already shown are still true. Clearing them would turn a failed
   * request for more into the loss of everything the operator had.
   */
  it('keeps the rows when a later page fails', async () => {
    const gateway = new FakeGateway();
    gateway.pages = [{ items: [{ id: 'a', name: 'Aldi' }], nextCursor: 'c1' }];
    const store = storeWith(gateway);
    await store.load();

    gateway.failWith = new GatewayError({
      code: 'internal',
      status: 500,
      correlationId: '',
    });
    await store.loadMore();

    expect(store.rows()).toHaveLength(1);
    expect(store.status()).toBe('ready');
    expect(store.error()).not.toBeNull();
  });
});

/**
 * What the address already decided (admin plan 0042). A chain's shops sit at
 * `/chains/{chainId}/shops`, so the chain goes out on every read and is never
 * one of the filters the operator set.
 */
describe('ResourceListStore fixed filters', () => {
  const fixed = { supermarketId: 'sm_mercadona' };

  const under = (gateway: FakeGateway, initial: Record<string, string> = {}) =>
    new ResourceListStore<ResourceRow>(descriptor, gateway, initial, fixed);

  it('sends them on the first read', async () => {
    const gateway = new FakeGateway();
    const store = under(gateway);

    await store.load();

    expect(gateway.queries[0].filters).toEqual(fixed);
  });

  it('sends them with the next page', async () => {
    const gateway = new FakeGateway();
    gateway.pages = [
      { items: [{ id: 'a', name: 'Aldi' }], nextCursor: 'c1' },
      { items: [], nextCursor: null },
    ];
    const store = under(gateway);
    await store.load();

    await store.loadMore();

    expect(gateway.queries[1].cursor).toBe('c1');
    expect(gateway.queries[1].filters).toEqual(fixed);
  });

  it('sends them beside a filter and an order the operator set', async () => {
    const gateway = new FakeGateway();
    const store = under(gateway);
    await store.load();

    await store.setFilter('query', 'sevilla');
    await store.setOrder('name');

    expect(gateway.queries[1].filters).toEqual({ ...fixed, query: 'sevilla' });
    expect(gateway.queries[2].filters).toEqual({ ...fixed, query: 'sevilla' });
    expect(gateway.queries[2].order).toBe('name');
  });

  it('sends them beside the filters the link opened the list with', async () => {
    const gateway = new FakeGateway();
    const store = under(gateway, { query: 'sevilla' });

    await store.load();

    expect(gateway.queries[0].filters).toEqual({ ...fixed, query: 'sevilla' });
  });

  /** The address wins: a filter cannot point the list at another chain. */
  it('does not let a filter of the same name replace one', async () => {
    const gateway = new FakeGateway();
    const store = under(gateway);

    await store.setFilter('supermarketId', 'sm_other');

    expect(gateway.queries[0].filters).toEqual(fixed);
  });

  it('keeps them when the filters are cleared', async () => {
    const gateway = new FakeGateway();
    const store = under(gateway);
    await store.setFilter('query', 'zzz');

    await store.clear();

    expect(store.filters()).toEqual({});
    expect(gateway.queries[1].filters).toEqual(fixed);
  });

  it('does not show them among the filters the operator set', async () => {
    const gateway = new FakeGateway();
    const store = under(gateway);

    await store.load();

    expect(store.filters()).toEqual({});
  });

  /**
   * A chain with no shops is an empty list. Counting the chain as a filter
   * would draw "nothing matched" with a way out that clears nothing.
   */
  it('is empty and not a no match when nothing else narrows the list', async () => {
    const gateway = new FakeGateway();
    const store = under(gateway);

    await store.load();

    expect(store.narrowed()).toBe(false);
    expect(store.empty()).toBe(true);
    expect(store.noMatch()).toBe(false);
  });

  it('is a no match once the operator narrows it as well', async () => {
    const gateway = new FakeGateway();
    const store = under(gateway);

    await store.setFilter('query', 'zzz');

    expect(store.narrowed()).toBe(true);
    expect(store.noMatch()).toBe(true);
  });
});

describe('ResourceListStore delete', () => {
  it('takes the row off the screen without reading the list again', async () => {
    const gateway = new FakeGateway();
    gateway.pages = [
      {
        items: [
          { id: 'a', name: 'Aldi' },
          { id: 'b', name: 'Bonpreu' },
        ],
        nextCursor: null,
      },
    ];
    const store = storeWith(gateway);
    await store.load();

    const failure = await store.remove('a');

    expect(failure).toBeNull();
    expect(gateway.removed).toEqual(['a']);
    expect(store.rows().map((row) => row['id'])).toEqual(['b']);
    expect(gateway.queries).toHaveLength(1);
  });

  it('leaves the row exactly where it was when the delete fails', async () => {
    const gateway = new FakeGateway();
    gateway.pages = [{ items: [{ id: 'a', name: 'Aldi' }], nextCursor: null }];
    const store = storeWith(gateway);
    await store.load();

    gateway.failWith = new GatewayError({
      code: 'conflict',
      status: 409,
      correlationId: '',
    });
    const failure = await store.remove('a');

    expect(failure?.code).toBe('conflict');
    expect(store.rows()).toHaveLength(1);
  });
});
