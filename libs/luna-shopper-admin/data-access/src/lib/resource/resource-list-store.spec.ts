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
/**
 * A count is what a route says beside a page, where it counts at all
 * (backend plan 0187). The store holds it and decides nothing from it.
 */
describe('ResourceListStore total', () => {
  const row = (id: string): ResourceRow => ({ id, name: id });

  it('is null where the route does not count its rows', async () => {
    const gateway = new FakeGateway();
    gateway.pages = [{ items: [row('a')], nextCursor: null }];
    const store = storeWith(gateway);

    await store.load();

    expect(store.total()).toBeNull();
  });

  it('holds the count of the page, and keeps it across "Load more"', async () => {
    const gateway = new FakeGateway();
    gateway.pages = [
      { items: [row('a')], nextCursor: 'c1', total: 3 },
      { items: [row('b')], nextCursor: null, total: 3 },
    ];
    const store = storeWith(gateway);

    await store.load();
    expect(store.total()).toBe(3);
    // The cursor alone says whether there is more, whatever the count says.
    expect(store.hasMore()).toBe(true);

    await store.loadMore();
    expect(store.total()).toBe(3);
    expect(store.hasMore()).toBe(false);
  });

  it('forgets the count when the next read carries none', async () => {
    const gateway = new FakeGateway();
    gateway.pages = [
      { items: [row('a')], nextCursor: null, total: 1 },
      { items: [row('a'), row('b')], nextCursor: null },
    ];
    const store = storeWith(gateway);

    await store.load();
    expect(store.total()).toBe(1);

    await store.setFilter('query', 'x');
    expect(store.total()).toBeNull();
  });

  it('takes the count a refresh reads', async () => {
    const gateway = new FakeGateway();
    gateway.pages = [
      { items: [row('a'), row('b')], nextCursor: null, total: 2 },
      { items: [row('a')], nextCursor: null, total: 1 },
    ];
    const store = storeWith(gateway);

    await store.load();
    await store.refresh();

    expect(store.total()).toBe(1);
  });
});

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

/**
 * A list that stays on screen while one of its rows is written reads again
 * (admin plan 0042). It keeps as many rows as were loaded, so the row that is
 * open beside it does not leave the column when it was on a later page.
 */
describe('ResourceListStore refresh', () => {
  const page = (names: string[], nextCursor: string | null) => ({
    items: names.map((name) => ({ id: name.toLowerCase(), name })),
    nextCursor,
  });

  async function twoPages() {
    const gateway = new FakeGateway();
    gateway.pages = [page(['Aldi', 'Bonpreu'], 'c1'), page(['Consum'], null)];
    const store = new ResourceListStore<ResourceRow>(descriptor, gateway);
    await store.load();
    await store.loadMore();
    expect(store.rows()).toHaveLength(3);
    return { gateway, store };
  }

  it('reads every page that was loaded, and shows the rows as they are now', async () => {
    const { gateway, store } = await twoPages();
    gateway.queries.length = 0;
    gateway.pages = [
      page(['Aldi', 'Bonpreu'], 'c1'),
      page(['Consum Centro'], null),
    ];

    await store.refresh();

    expect(gateway.queries.map((query) => query.cursor)).toEqual([
      undefined,
      'c1',
    ]);
    expect(store.rows().map((row) => row['name'])).toEqual([
      'Aldi',
      'Bonpreu',
      'Consum Centro',
    ]);
    expect(store.hasMore()).toBe(false);
  });

  it('keeps the rows on screen while it reads, with no loading state', async () => {
    const { gateway, store } = await twoPages();
    gateway.pages = [page(['Aldi', 'Bonpreu'], 'c1'), page(['Consum'], null)];

    const reading = store.refresh();

    expect(store.status()).toBe('ready');
    expect(store.rows()).toHaveLength(3);
    await reading;
    expect(store.rows()).toHaveLength(3);
  });

  it('stops at as many rows as were shown, and still offers the rest', async () => {
    const gateway = new FakeGateway();
    gateway.pages = [page(['Aldi', 'Bonpreu'], 'c1')];
    const store = new ResourceListStore<ResourceRow>(descriptor, gateway);
    await store.load();
    gateway.queries.length = 0;
    gateway.pages = [page(['Aldi', 'Bonpreu'], 'c1'), page(['Consum'], null)];

    await store.refresh();

    expect(gateway.queries).toHaveLength(1);
    expect(store.rows()).toHaveLength(2);
    expect(store.hasMore()).toBe(true);
  });

  it('keeps the rows and says so when the read fails', async () => {
    const { gateway, store } = await twoPages();
    gateway.failWith = new Error('nothing answered');

    await store.refresh();

    expect(store.rows()).toHaveLength(3);
    expect(store.status()).toBe('ready');
    expect(store.error()).not.toBeNull();
  });

  it('reads from the start when nothing is loaded', async () => {
    const gateway = new FakeGateway();
    const store = new ResourceListStore<ResourceRow>(descriptor, gateway);
    gateway.pages = [page(['Aldi'], null)];

    await store.refresh();

    expect(store.rows()).toHaveLength(1);
  });

  it('gives way to a filter that is set while it reads', async () => {
    const { gateway, store } = await twoPages();
    gateway.pages = [
      page(['Aldi', 'Bonpreu'], 'c1'),
      page(['Zeta'], null),
      page(['Consum'], null),
    ];

    const refreshing = store.refresh();
    const filtering = store.setFilter('query', 'zeta');
    await Promise.all([refreshing, filtering]);

    // The filter's own read is what is left on screen.
    expect(store.rows().map((row) => row['name'])).toEqual(['Zeta']);
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

  it('lowers the count by the row it took off', async () => {
    const gateway = new FakeGateway();
    gateway.pages = [
      {
        items: [
          { id: 'a', name: 'Aldi' },
          { id: 'b', name: 'Bonpreu' },
        ],
        nextCursor: 'c1',
        total: 5,
      },
    ];
    const store = storeWith(gateway);
    await store.load();

    await store.remove('a');

    expect(store.total()).toBe(4);
    expect(gateway.queries).toHaveLength(1);
  });

  it('leaves the count alone for a row that was not on screen', async () => {
    const gateway = new FakeGateway();
    gateway.pages = [
      { items: [{ id: 'a', name: 'Aldi' }], nextCursor: 'c1', total: 5 },
    ];
    const store = storeWith(gateway);
    await store.load();

    await store.remove('z');

    expect(gateway.removed).toEqual(['z']);
    expect(store.rows()).toHaveLength(1);
    expect(store.total()).toBe(5);
  });

  it('never counts below zero', async () => {
    const gateway = new FakeGateway();
    gateway.pages = [
      { items: [{ id: 'a', name: 'Aldi' }], nextCursor: null, total: 0 },
    ];
    const store = storeWith(gateway);
    await store.load();

    await store.remove('a');

    expect(store.total()).toBe(0);
  });

  it('keeps no count where the route gave none', async () => {
    const gateway = new FakeGateway();
    gateway.pages = [{ items: [{ id: 'a', name: 'Aldi' }], nextCursor: null }];
    const store = storeWith(gateway);
    await store.load();

    await store.remove('a');

    expect(store.rows()).toHaveLength(0);
    expect(store.total()).toBeNull();
  });

  it('keeps the count when the delete fails', async () => {
    const gateway = new FakeGateway();
    gateway.pages = [
      { items: [{ id: 'a', name: 'Aldi' }], nextCursor: null, total: 1 },
    ];
    const store = storeWith(gateway);
    await store.load();

    gateway.failWith = new GatewayError({
      code: 'conflict',
      status: 409,
      correlationId: '',
    });
    await store.remove('a');

    expect(store.total()).toBe(1);
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
