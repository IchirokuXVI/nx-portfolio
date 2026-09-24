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
     * Every query word has to be answered, the way production's tsquery joins
     * its terms with AND. Production also falls back to trigram similarity on
     * the whole query, which only rescues a query about as short as a group
     * name. A product named `Leche semidesnatada Hacendado 1 L` therefore finds
     * nothing by its whole name, and the group `Leche semidesnatada` is found
     * by a shorter key from the ladder in `itemSearchKeys`.
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
            .toLowerCase()
            // Production folds accents too: `champu` finds `Champú`.
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
          const score = words.filter((word) => haystack.includes(word)).length;
          return { group, score };
        })
        .filter((hit) => hit.score === words.length)
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

      // The gateway's own validation: a search text over 120 characters is a
      // 400 on both the item and the group search, and one long product name
      // used to end a whole walk on it (plan 0002).
      if (typeof query?.query === 'string' && query.query.length > 120) {
        const error = new Error(
          `GET ${path} answered 400: query must be shorter than or equal to 120 characters`
        );
        error.status = 400;
        throw error;
      }

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
