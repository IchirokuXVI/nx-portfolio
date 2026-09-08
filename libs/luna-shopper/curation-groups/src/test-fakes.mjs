/**
 * A fake pair of gateways, for the tests only.
 *
 * It answers the routes this library calls out of two in-memory catalogs, one
 * standing for the main gateway and one for the rehearsal slot. No test in this
 * library touches a network, and every one of them can therefore assert on
 * exactly what a `next` saw and when.
 */

/**
 * A catalog: its ungrouped products and its product groups.
 *
 * The two are separate lists because this library reads them through two
 * different routes and only ever writes the second one.
 */
export function makeCatalog({ items = [], groups = [] } = {}) {
  const rows = items.map((item) => ({ ...item }));
  const groupRows = groups.map((group) => ({ ...group }));
  let nextId = 1;

  return {
    rows,
    groups: groupRows,

    /**
     * One page of the products in no group.
     *
     * Paging is by index and the cursor is the index of the next row, so a test
     * can assert that the walk resumed where it stopped.
     */
    ungroupedPage({ cursor, limit = 20 }) {
      const all = rows.filter((row) => !row.productGroupId);
      const from = cursor ? Number(cursor) : 0;
      const page = all.slice(from, from + limit);
      const to = from + page.length;
      return { items: page, nextCursor: to < all.length ? String(to) : null };
    },

    /**
     * The admin group search, standing in for the tsvector ranked one.
     *
     * A group scores one per query word it answers to and the best score comes
     * first, which is the property the library depends on. Requiring every word
     * would be a stricter search than production's and would make the fake, not
     * the library, decide what a candidate is: a product is named `Leche
     * semidesnatada Hacendado 1 L` and the group it belongs to is named `Leche
     * semidesnatada`.
     */
    searchGroups(query) {
      const words = String(query ?? '')
        .toLowerCase()
        .split(' ')
        .filter((word) => word.length >= 3);
      if (words.length === 0) {
        return [];
      }
      return groupRows
        .map((group) => {
          const haystack = [
            group.name?.es,
            group.name?.en,
            group.slug,
            ...(group.synonyms?.es ?? []),
            ...(group.synonyms?.en ?? []),
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          const score = words.filter((word) => haystack.includes(word)).length;
          return { group, score };
        })
        .filter((hit) => hit.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((hit) => hit.group);
    },

    getGroup(id) {
      return groupRows.find((group) => group.id === id) ?? null;
    },

    createGroup(body) {
      const group = {
        id: `created-${nextId++}`,
        name: body.name,
        slug: body.slug,
        referenceUnit: body.referenceUnit,
        synonyms: body.synonyms ?? { es: [], en: [] },
      };
      groupRows.push(group);
      return group;
    },
  };
}

/**
 * A session that answers the admin routes out of the fake above.
 *
 * `calls` records every path, which is what the candidate merge tests read to
 * prove a search happened at `next` time and not before it.
 */
export function makeFakeSession({
  catalog,
  label = null,
  verifyFails = false,
  createFails = false,
}) {
  const calls = [];
  return {
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
      const query = init.query ?? null;
      calls.push({ path, query, method: init.method ?? 'GET' });

      if (path === '/v1/admin/catalog/items') {
        return catalog.ungroupedPage({
          cursor: query?.cursor,
          limit: query?.limit,
        });
      }
      if (
        path === '/v1/admin/catalog/product-groups' &&
        init.method === 'POST'
      ) {
        if (createFails) {
          throw new Error('POST /v1/admin/catalog/product-groups answered 409');
        }
        return catalog.createGroup(init.body);
      }
      if (path === '/v1/admin/catalog/product-groups') {
        const found = catalog.searchGroups(query?.query);
        return { items: found.slice(0, query?.limit ?? 8), nextCursor: null };
      }
      if (path.startsWith('/v1/admin/catalog/product-groups/')) {
        const id = decodeURIComponent(path.split('/').pop());
        const group = catalog.getGroup(id);
        if (!group) {
          const error = new Error(`GET ${path} answered 404`);
          error.status = 404;
          throw error;
        }
        return group;
      }
      throw new Error(
        `the fake session was asked for ${path}, which it does not answer`
      );
    },
  };
}
