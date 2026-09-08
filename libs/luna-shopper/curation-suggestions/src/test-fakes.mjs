/**
 * A fake pair of gateways, for the tests only.
 *
 * It answers the routes this library calls out of two in-memory catalogs, one
 * standing for the main gateway and one for the rehearsal slot. No test in this
 * library touches a network, and every one of them can therefore assert on
 * exactly what a `next` saw and when.
 */

export function makeCatalog(items = []) {
  const rows = items.map((item) => ({ ...item }));
  let nextId = 1;
  return {
    rows,
    /**
     * The admin search, standing in for the tsvector ranked one.
     *
     * A row scores one per query word it holds and the best score comes first,
     * which is the property the library depends on. Requiring every word would
     * be a stricter search than production's and would make the fake, not the
     * library, decide what a candidate is: a queue row is named `Leche entera 1
     * L` and the catalog product it belongs to is named `Leche entera`.
     */
    search(query) {
      const words = String(query ?? '')
        .toLowerCase()
        .split(' ')
        .filter((word) => word.length >= 3);
      if (words.length === 0) {
        return [];
      }
      return rows
        .map((row) => {
          const haystack = [row.name?.es, row.name?.en, row.brand, row.ean]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          const score = words.filter((word) => haystack.includes(word)).length;
          return { row, score };
        })
        .filter((hit) => hit.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((hit) => hit.row);
    },
    get(id) {
      return rows.find((row) => row.id === id) ?? null;
    },
    create(body) {
      const row = {
        id: `created-${nextId++}`,
        name: body.name,
        brand: body.brand ?? null,
        ean: body.ean ?? null,
        unitSize: body.unitSize ?? null,
        category: body.category,
        defaultUnit: body.defaultUnit,
      };
      rows.push(row);
      return row;
    },
  };
}

/**
 * A queue: chains, each holding an ordered list of entries.
 *
 * Paging is by index, and the cursor is the index of the next row, so a test
 * can assert that the walk resumed where it stopped.
 */
export function makeQueue(pages = {}) {
  return {
    pages,
    page(supermarketId, { cursor, limit = 20 }) {
      const all = pages[supermarketId] ?? [];
      const from = cursor ? Number(cursor) : 0;
      const items = all.slice(from, from + limit);
      const to = from + items.length;
      return { items, nextCursor: to < all.length ? String(to) : null };
    },
  };
}

/**
 * A session that answers the admin routes out of the two fakes above.
 *
 * `calls` records every path, which is what the candidate merge tests read to
 * prove a search happened at `next` time and not before it.
 */
export function makeFakeSession({
  catalog,
  queue = makeQueue(),
  supermarkets = [],
  label = null,
  verifyFails = false,
}) {
  const calls = [];
  const session = {
    label,
    baseUrl: `http://localhost/${label ?? 'gateway'}`,
    username: 'dev-admin',
    calls,
    catalog,
    async verify() {
      if (verifyFails) {
        throw new Error(`could not sign in on the ${label} gateway`);
      }
      return { admin: { username: 'dev-admin' }, environment: 'test' };
    },
    async fetch(path, init = {}) {
      calls.push({
        path,
        query: init.query ?? null,
        method: init.method ?? 'GET',
      });

      if (path === '/v1/admin/catalog/supermarkets') {
        return { items: supermarkets, nextCursor: null };
      }
      if (path === '/v1/admin/harvest/entries') {
        return queue.page(init.query.supermarketId, {
          cursor: init.query.cursor,
          limit: init.query.limit,
        });
      }
      if (path === '/v1/admin/catalog/items' && init.method === 'POST') {
        return catalog.create(init.body);
      }
      if (path === '/v1/admin/catalog/items') {
        const found = catalog.search(init.query.query);
        return {
          items: found.slice(0, init.query.limit ?? 8),
          nextCursor: null,
        };
      }
      if (path.startsWith('/v1/admin/catalog/items/')) {
        const id = decodeURIComponent(path.split('/').pop());
        const row = catalog.get(id);
        if (!row) {
          const error = new Error(`GET ${path} answered 404`);
          error.status = 404;
          throw error;
        }
        return row;
      }
      throw new Error(
        `the fake session was asked for ${path}, which it does not answer`
      );
    },
  };
  return session;
}
