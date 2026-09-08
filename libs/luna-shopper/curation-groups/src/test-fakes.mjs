/**
 * A fake pair of gateways, for the tests only.
 *
 * It answers the routes this library calls out of two in-memory catalogs, one
 * standing for the main gateway and one for the rehearsal slot. No test in this
 * library touches a network, and every one of them can therefore assert on
 * exactly what a `next` saw and when.
 */

/**
 * A catalog: its products, and its product groups.
 *
 * Both live here because the two reads this library makes are of one catalog,
 * and a test that creates a group in the rehearsal slot has to see it in the
 * rehearsal slot's own search and nowhere else.
 */
export function makeCatalog({ items = [], groups = [] } = {}) {
  const itemRows = items.map((item) => ({ ...item }));
  const groupRows = groups.map((group) => ({ ...group }));
  let nextId = 1;

  return {
    items: itemRows,
    groups: groupRows,

    /** The ungrouped listing, ordered as given, paged by index. */
    ungrouped({ cursor, limit = 20 }) {
      const all = itemRows.filter((item) => !item.productGroupId);
      const from = cursor ? Number(cursor) : 0;
      const page = all.slice(from, from + limit);
      const to = from + page.length;
      return { items: page, nextCursor: to < all.length ? String(to) : null };
    },

    /**
     * The group search, standing in for the tsvector ranked one.
     *
     * A group scores one per query word it holds, over its names and its
     * synonyms, and the best score comes first. Requiring every word would be a
     * stricter search than production's and would make the fake, not the
     * library, decide what a candidate is.
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

    getItem(id) {
      return itemRows.find((item) => item.id === id) ?? null;
    },

    createGroup(body) {
      const row = {
        id: `created-${nextId++}`,
        name: body.name,
        slug: body.slug,
        referenceUnit: body.referenceUnit,
        synonyms: body.synonyms ?? null,
      };
      groupRows.push(row);
      return row;
    },
  };
}

/**
 * A session that answers the admin routes out of the catalog above.
 *
 * `calls` records every path, which is what the candidate merge tests read to
 * prove a search happened at `next` time and not before it.
 */
export function makeFakeSession({
  catalog,
  label = null,
  verifyFails = false,
  createGroupFails = false,
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
      calls.push({
        path,
        query: init.query ?? null,
        method: init.method ?? 'GET',
      });

      if (path === '/v1/admin/catalog/items' && init.method !== 'POST') {
        return catalog.ungrouped({
          cursor: init.query?.cursor,
          limit: init.query?.limit,
        });
      }
      if (
        path === '/v1/admin/catalog/product-groups' &&
        init.method === 'POST'
      ) {
        if (createGroupFails) {
          throw new Error('POST /v1/admin/catalog/product-groups answered 409');
        }
        return catalog.createGroup(init.body);
      }
      if (path === '/v1/admin/catalog/product-groups') {
        const found = catalog.searchGroups(init.query?.query);
        return {
          items: found.slice(0, init.query?.limit ?? 8),
          nextCursor: null,
        };
      }
      if (path.startsWith('/v1/admin/catalog/product-groups/')) {
        const id = decodeURIComponent(path.split('/').pop());
        const row = catalog.getGroup(id);
        if (!row) {
          const error = new Error(`GET ${path} answered 404`);
          error.status = 404;
          throw error;
        }
        return row;
      }
      if (path.startsWith('/v1/admin/catalog/items/')) {
        const id = decodeURIComponent(path.split('/').pop());
        const row = catalog.getItem(id);
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
}

/** The unit families every test judges against, from the real vocabulary. */
export const TEST_UNITS = [
  'UNIT',
  'GRAM',
  'KILOGRAM',
  'MILLILITER',
  'LITER',
  'PACK',
];
