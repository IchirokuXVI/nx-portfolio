import type { ResourceSource } from '@portfolio/luna-shopper-admin/data-access';
import type { Wire } from '@portfolio/luna-shopper-admin/models';
import {
  BRAND_SEED,
  BRAND_SPELLING_SEED,
  BRAND_SUGGESTION_SEED,
  type SeededSpelling,
} from './brand-seed';

/**
 * The three reads behind this section, and how each departs from ordinary CRUD
 * (backend plan 0115, sections 5, 7 and 8).
 *
 * All three go through {@link ResourceSource} rather than a hand written HTTP
 * client, and that is worth a line: the source is what gives every read an in
 * memory twin for nothing, because `RESOURCE_GATEWAYS` is already the thing that
 * chooses between the memory table and the gateway. A second client here would
 * have needed a second token, a second memory class and a line in the app's
 * provider list, to spell three URLs that the existing one already spells.
 *
 * | Read              | What is different                                               |
 * | ----------------- | --------------------------------------------------------------- |
 * | brands            | nothing. A list, a member, a `POST` and a `PATCH`, and no delete |
 * | brand suggestions | read only, no member, no `order`: the server's order is the only one |
 * | spellings         | hangs off one brand, and answers `{ spellings }` rather than a page |
 */

/** Where the back office reads and writes brands. */
export const BRANDS_PATH = '/v1/admin/catalog/brands';

/** Where the back office reads the keys nothing has registered. */
export const BRAND_SUGGESTIONS_PATH = '/v1/admin/catalog/brand-suggestions';

/**
 * Where a suggestion is registered under a name of its own choosing.
 *
 * Not a {@link ResourceSource}, and that is the one read or write of this
 * section that is not. It creates up to two brands and links them in one
 * transaction (backend plan 0124, section 5), so it answers neither a row nor a
 * page: `{ brand, linked, canonicalCreated, linkedItems }`. A source describes a
 * collection, and this is a command.
 */
export const BRAND_REGISTER_SUGGESTION_PATH = `${BRANDS_PATH}/register-suggestion`;

/**
 * The spellings read, as a template rather than a URL.
 *
 * Nothing ever requests this string: the collection is always addressed through
 * `collectionPath` and there is no member to read. It is here because the memory
 * table is keyed on a source's `path`, so a spellings source that reused
 * {@link BRANDS_PATH} would share one table with the brands themselves and be
 * seeded with both lists.
 */
export const BRAND_SPELLINGS_PATH = `${BRANDS_PATH}/{brandId}/spellings`;

/**
 * Brands: ordinary CRUD minus the delete.
 *
 * There is no `DELETE /brands/{id}` (plan 0115, section 9), and the descriptor
 * says so by declaring no delete action, so nothing ever reaches `remove`.
 */
export function brandSource(): ResourceSource<Wire.CatalogBrandView> {
  return { path: BRANDS_PATH, seed: BRAND_SEED };
}

/**
 * Suggested brands: a cursor paged read and nothing else.
 *
 * No member route, no create and no order. The rows are ordered by how many
 * queued products carry the key and the route offers no second order, so the
 * screen offers none either.
 *
 * `idField` is the key, because a suggestion has no id: it is a key nothing has
 * registered yet, which is also why the list dedupes on it (section 7.2 of the
 * plan: counts move as the queue is worked, so a row can appear on two pages).
 */
export function brandSuggestionSource(): ResourceSource<Wire.HarvestBrandSuggestionView> {
  return {
    path: BRAND_SUGGESTIONS_PATH,
    idField: 'key',
    seed: BRAND_SUGGESTION_SEED,
  };
}

/**
 * How the chains spell one brand.
 *
 * Two departures, both the route's own. The collection hangs off a brand, so it
 * has no address until one is named; and the answer is `{ spellings }` rather
 * than `{ items, nextCursor }`, because a brand has a handful of spellings and
 * paging them would be a ceremony.
 *
 * `brandId` is a path parameter, so it is not also a query parameter, and it is
 * stamped back onto every row that comes out. The memory table needs it for a
 * second reason: it holds every brand's spellings in one list, and the filter is
 * what picks one brand's out of it.
 */
export function brandSpellingsSource(): ResourceSource<SeededSpelling> {
  return {
    path: BRAND_SPELLINGS_PATH,
    collectionPath: (values) => {
      const brandId = values['brandId'];
      return typeof brandId === 'string' && brandId !== ''
        ? `${BRANDS_PATH}/${encodeURIComponent(brandId)}/spellings`
        : null;
    },
    pathParams: ['brandId'],
    page: (body) => ({
      items: ((body as { spellings?: SeededSpelling[] }).spellings ??
        []) as SeededSpelling[],
      nextCursor: null,
    }),
    seed: BRAND_SPELLING_SEED,
  };
}
