/**
 * The admin routes this library uses, and no others (plan 0001).
 *
 * Every one of them is a route the back office already calls, taken from
 * `apps/luna-shopper-backend/gateway/docs/openapi.json`. The transport, the
 * login and the one refresh a 401 buys belong to `curation-auth`; this file is
 * only which paths, which query parameters and how a page is walked.
 */

import { capSearchText } from './rules.mjs';

/** The gateway's own cap. Asking for more is a 400. */
const PAGE_SIZE = 100;

/** How many catalog products one search offers. */
export const CANDIDATE_LIMIT = 8;

/** A safety net on the queue walk, not a limit anybody should reach. */
const MAX_PAGES = 200;

export function makeGateway(session) {
  async function pageThrough(path, query, cap = MAX_PAGES) {
    const items = [];
    let cursor = undefined;
    for (let page = 0; page < cap; page++) {
      const answer = await session.fetch(path, {
        query: { ...query, limit: PAGE_SIZE, cursor },
      });
      items.push(...(answer?.items ?? []));
      cursor = answer?.nextCursor ?? null;
      if (!cursor) {
        return items;
      }
    }
    return items;
  }

  return {
    session,

    /** GET /v1/admin/catalog/supermarkets, every page. */
    listSupermarkets() {
      return pageThrough('/v1/admin/catalog/supermarkets', { order: 'name' });
    },

    /**
     * GET /v1/admin/catalog/brands, every page (plan 0115).
     *
     * Read once, by `start`, and written into the run directory. Every later
     * step reads the file, so a brand registered while a walk runs is seen by
     * the next walk and not by this one.
     */
    listBrands() {
      return pageThrough('/v1/admin/catalog/brands', { order: 'label' });
    },

    /**
     * GET /v1/catalog/categories, the whole tree in one answer (backend plan
     * 0166): roots, then children, each by `position`.
     *
     * `start` reads it from the main gateway for the vocabulary, and `decide`
     * reads it from the rehearsal slot to turn slugs into that slot's ids.
     */
    async listCategories() {
      const answer = await session.fetch('/v1/catalog/categories');
      return answer?.categories ?? [];
    },

    /**
     * GET /v1/admin/harvest/entries, one page of one chain's queue.
     *
     * Absent `status` is the queue itself: CANDIDATE and UNRESOLVED, the two
     * statuses waiting for a person. The walk pages a chain at a time and keeps
     * the cursor in the run directory, so a killed run resumes where it stopped
     * rather than re-reading four thousand rows.
     */
    queuePage(supermarketId, { cursor = undefined, limit = 20 } = {}) {
      return session.fetch('/v1/admin/harvest/entries', {
        query: { supermarketId, limit, cursor },
      });
    },

    /**
     * GET /v1/admin/catalog/items, ranked.
     *
     * The text is cut to the gateway's own cap first (plan 0006), here rather
     * than at each caller, so no search this library makes can be the 400 a
     * long printed name used to be.
     */
    async searchItems(query, limit = CANDIDATE_LIMIT) {
      const text = capSearchText(query);
      if (!text) {
        return [];
      }
      const answer = await session.fetch('/v1/admin/catalog/items', {
        query: { query: text, order: 'relevance', limit },
      });
      return answer?.items ?? [];
    },

    /**
     * GET /v1/admin/catalog/items/{id}, or null when catalog holds no such id.
     *
     * Only a 404 is an answer of null (plan 0006). Any other failure is thrown,
     * because a timeout or a 500 says nothing about whether the product exists,
     * and reading it as missing used to drop a real candidate without a word.
     */
    async getItem(id) {
      try {
        return await session.fetch(
          `/v1/admin/catalog/items/${encodeURIComponent(id)}`
        );
      } catch (error) {
        if (error?.status === 404) {
          return null;
        }
        throw error;
      }
    },

    /**
     * The EAN lookup, through the search route.
     *
     * No admin route exposes catalog's own `findItemByEan`; the search route is
     * what the back office uses, and it matches a whole barcode exactly and
     * ranks that row first. The answer is filtered on equality here, so a text
     * hit that merely scored well is not mistaken for the barcode's owner.
     */
    async findByEan(ean) {
      if (!ean) {
        return null;
      }
      const items = await this.searchItems(ean, 5);
      return items.find((item) => item.ean === ean) ?? null;
    },

    /**
     * POST /v1/admin/catalog/items, the rehearsal write.
     *
     * A plain catalog item create, not a harvest decision. No harvester runs in
     * the rehearsal slot and no entry rows exist there; the slot exists so the
     * production search can see what this run created, which is the whole point
     * of rehearsing (plan 0001). Nothing is ever written to the main catalog
     * from `decide`.
     */
    createItem(body) {
      return session.fetch('/v1/admin/catalog/items', { method: 'POST', body });
    },
  };
}

/**
 * The item with the rehearsal slot's own ids for its slugs (backend plan 0166).
 *
 * The catalog create route takes `categoryIds` where the harvest routes take
 * slugs, so the rehearsal write needs the slot's ids. They are kept on the
 * recorded item, because a resume replays that write into a new slot with
 * `toCreateItemBody(record.item)`, and a seeded category's id is derived from
 * its slug, so it is the same in every slot. `apply` never sends them: the bulk
 * op carries the slugs.
 *
 * A slug the slot does not hold is thrown, which `decide` records as
 * `REHEARSAL_WRITE_FAILED`.
 */
export function withCategoryIds(item, rows) {
  const ids = new Map(
    (rows ?? [])
      .filter((row) => row?.parentId && row.slug && row.id)
      .map((row) => [row.slug, row.id])
  );
  const slugs = item.categorySlugs ?? [];
  const missing = slugs.filter((slug) => !ids.has(slug));
  if (missing.length > 0) {
    throw new Error(
      `the rehearsal slot holds no leaf category ${missing.join(', ')}`
    );
  }
  return { ...item, categoryIds: slugs.map((slug) => ids.get(slug)) };
}

/**
 * The body `CreateItemDto` names: the catalog create, with category ids.
 *
 * `rowPackCount` is the count the queue row itself read (backend plan 0162).
 * The bulk route falls back to it when a decision states none, and this
 * rehearsal create knows no row, so the caller passes it: the product a later
 * entry of the same run is compared against then carries the count the real
 * create will write.
 */
export function toCreateItemBody(item, rowPackCount = null) {
  const packCount = item.packCount ?? rowPackCount ?? null;
  return {
    name: item.nameEn
      ? { es: item.nameEs, en: item.nameEn }
      : { es: item.nameEs },
    brand: item.brand,
    ean: item.ean,
    unitSize: item.unitSize,
    ...(packCount === null ? {} : { packCount }),
    categoryIds: item.categoryIds,
    defaultUnit: item.defaultUnit,
  };
}

/**
 * The `item` of the harvest bulk `createItem` op, which takes category slugs
 * as they are and resolves them itself (backend plan 0166, section 3).
 */
export function toBulkCreateItem(item) {
  return {
    name: item.nameEn
      ? { es: item.nameEs, en: item.nameEn }
      : { es: item.nameEs },
    brand: item.brand,
    ean: item.ean,
    unitSize: item.unitSize,
    // Only a count the decision stated (backend plan 0177). Absent is how the
    // bulk route is told to take the count the row itself read, and a null
    // here would create the product with none.
    ...(item.packCount === null || item.packCount === undefined
      ? {}
      : { packCount: item.packCount }),
    categorySlugs: item.categorySlugs,
    defaultUnit: item.defaultUnit,
  };
}
