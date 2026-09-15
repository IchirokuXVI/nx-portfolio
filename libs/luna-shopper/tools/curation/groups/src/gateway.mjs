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

/** A safety net on the counting pass, not a limit anybody should reach. */
const MAX_PAGES = 500;

/**
 * The bulk route plan 0100 added beside the per row group routes.
 *
 * `apply` is the only caller. The path lives in one constant because plan 0100
 * owns it and this library only replays into it; `--route` overrides it without
 * a code change if the two ever disagree.
 */
export const BULK_GROUP_ASSIGNMENTS_PATH =
  '/v1/admin/catalog/product-groups/assignments';

const ITEMS_PATH = '/v1/admin/catalog/items';
const GROUPS_PATH = '/v1/admin/catalog/product-groups';

export function makeGateway(session) {
  return {
    session,

    /**
     * GET /v1/admin/catalog/items, one page of the products in no group.
     *
     * `productGroupId=none` is the filter, not a boolean: the gateway spells
     * "the rows pointing at nothing" with that literal on the reference
     * parameter itself (admin plan 0012, section 2), and turns it into
     * catalog's own `withoutProductGroup`.
     *
     * `order=created` is creation order, newest first, and it is the only
     * creation order the route offers. It is taken because what a walk needs is
     * an order that does not shift under it, which keyset paging over `created`
     * gives whichever way it points. Nothing this run does removes a row from
     * the answer either: an assignment is written by `apply` afterwards and
     * never during the walk.
     */
    ungroupedPage({ cursor = undefined, limit = 20 } = {}) {
      return session.fetch(ITEMS_PATH, {
        query: { productGroupId: 'none', order: 'created', limit, cursor },
      });
    },

    /** Every ungrouped product there is, counted rather than kept. */
    async countUngrouped(cap = MAX_PAGES) {
      let total = 0;
      let cursor = undefined;
      for (let page = 0; page < cap; page++) {
        const answer = await this.ungroupedPage({ cursor, limit: PAGE_SIZE });
        total += answer?.items?.length ?? 0;
        cursor = answer?.nextCursor ?? null;
        if (!cursor) {
          break;
        }
      }
      return total;
    },

    /**
     * GET /v1/admin/catalog/product-groups, ranked by the same search
     * production answers.
     *
     * This is the whole reason a rehearsal slot exists. A group an earlier
     * product in this run created is found here by the tsvector search rather
     * than by a local scan, so the duplicate check and the candidate list are
     * one thing rather than two that can disagree.
     */
    async searchGroups(query, limit = CANDIDATE_LIMIT) {
      if (!query) {
        return [];
      }
      const answer = await session.fetch(GROUPS_PATH, {
        query: { query, limit },
      });
      return answer?.items ?? [];
    },

    /** GET /v1/admin/catalog/product-groups/{id}, or null when there is none. */
    async getGroup(id) {
      try {
        return await session.fetch(`${GROUPS_PATH}/${encodeURIComponent(id)}`);
      } catch {
        return null;
      }
    },

    /**
     * POST /v1/admin/catalog/product-groups, the rehearsal write.
     *
     * A plain product group create against the slot, so the next product's
     * search sees this group the way production would. Nothing is ever written
     * to the main catalog from `decide`.
     */
    createGroup(body) {
      return session.fetch(GROUPS_PATH, { method: 'POST', body });
    },
  };
}

/** The body `CreateProductGroupDto` names. */
export function toCreateGroupBody(group) {
  return {
    name: { es: group.nameEs, en: group.nameEn },
    slug: String(group.slug ?? '')
      .trim()
      .toLowerCase(),
    referenceUnit: group.referenceUnit,
    synonyms: {
      es: group.synonyms?.es ?? [],
      en: group.synonyms?.en ?? [],
    },
  };
}
