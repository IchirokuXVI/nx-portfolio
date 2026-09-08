/**
 * The admin routes this library uses, and no others (plan 0001).
 *
 * Every one of them is a route the back office already calls, taken from
 * `apps/luna-shopper-backend/gateway/docs/openapi.json`. The transport, the
 * login and the one refresh a 401 buys belong to `curation-auth`; this file is
 * only which paths, which query parameters and how a page is walked.
 */

/** The gateway's own cap. Asking for more is a 400. */
const PAGE_SIZE = 100;

/** How many groups one search offers. */
export const CANDIDATE_LIMIT = 8;

export function makeGateway(session) {
  return {
    session,

    /**
     * GET /v1/admin/catalog/items?productGroupId=none, one page.
     *
     * `none` is the literal that asks for the products in no group, which is
     * the whole queue this decider works (admin plan 0012, section 2). The
     * order is `created`, so the walk is oldest first and stable: a listing
     * ordered by name would move rows under a cursor as the run renames
     * nothing but the catalog grows.
     */
    ungroupedPage({ cursor = undefined, limit = 20 } = {}) {
      return session.fetch('/v1/admin/catalog/items', {
        query: { productGroupId: 'none', order: 'created', limit, cursor },
      });
    },

    /**
     * GET /v1/admin/catalog/product-groups, searched.
     *
     * The `query` parameter is free text over a group's own name and its
     * synonyms, backed by the search vectors of plan 0048. It is the same read
     * production answers "show me milk" with, which is what makes a group this
     * run created in the rehearsal slot findable the ordinary way rather than
     * by a scan this library keeps in memory.
     */
    async searchGroups(query, limit = CANDIDATE_LIMIT) {
      if (!query) {
        return [];
      }
      const answer = await session.fetch('/v1/admin/catalog/product-groups', {
        query: { query, limit },
      });
      return answer?.items ?? [];
    },

    /** GET /v1/admin/catalog/product-groups/{id}, or null when there is none. */
    async getGroup(id) {
      try {
        return await session.fetch(
          `/v1/admin/catalog/product-groups/${encodeURIComponent(id)}`
        );
      } catch {
        return null;
      }
    },

    /** GET /v1/admin/catalog/items/{id}, or null when catalog holds no such id. */
    async getItem(id) {
      try {
        return await session.fetch(
          `/v1/admin/catalog/items/${encodeURIComponent(id)}`
        );
      } catch {
        return null;
      }
    },

    /**
     * POST /v1/admin/catalog/product-groups, the rehearsal write.
     *
     * A plain group create against the slot. Nothing is ever written to the
     * main catalog from `decide`: the slot exists so that the next product's
     * search sees this group the way production would, which is what stops the
     * run inventing the same group twice.
     */
    createGroup(body) {
      return session.fetch('/v1/admin/catalog/product-groups', {
        method: 'POST',
        body,
      });
    },

    /** Every page of the ungrouped listing, for the one counting pass. */
    async countUngrouped() {
      let cursor = undefined;
      let total = 0;
      for (;;) {
        const page = await this.ungroupedPage({ cursor, limit: PAGE_SIZE });
        total += page?.items?.length ?? 0;
        cursor = page?.nextCursor ?? null;
        if (!cursor) {
          return total;
        }
      }
    },
  };
}

/** The body `CreateProductGroupDto` names. */
export function toCreateGroupBody(group) {
  return {
    name: group.nameEn
      ? { es: group.nameEs, en: group.nameEn }
      : { es: group.nameEs },
    slug: group.slug,
    referenceUnit: group.referenceUnit,
    ...(group.synonyms ? { synonyms: group.synonyms } : {}),
  };
}
