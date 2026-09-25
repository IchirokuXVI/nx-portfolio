import {
  ITEM_PATTERNS,
  type CatalogScopeView,
  type ItemPage,
  type ProductGroupOfferPage,
} from '@portfolio/luna-shopper/contracts';
import type { CurrentUser } from '../auth/jwt.strategy';
import { CatalogSuggestService } from './catalog-suggest.service';
import { CatalogSuggestController } from './catalog.controller';
import { SuggestQueryDto } from './catalog.dto';

/**
 * The composer's dropdown, for a caller who has no scopes (plan 0069, section
 * 5).
 *
 * It is the one route that fans out to two subjects off a single resolution, so
 * it is also the one place a refusal used to take out a whole screen: an empty
 * profile threw before either read started, and the composer showed nothing on a
 * catalog full of exactly the right answers. Both halves now answer unpriced,
 * and this file asserts the fan out reaches them.
 *
 * The interleave itself, and the rule that a group beats an item for a bare
 * word, belong to plan 0048 and are not re-proven here.
 */

const USER: CurrentUser = { userId: 'user-1' } as CurrentUser;

const groupPage: ProductGroupOfferPage = {
  items: [
    { id: 'g-milk', cheapestItem: null, offer: null },
  ] as unknown as ProductGroupOfferPage['items'],
  nextCursor: null,
};

const itemPage: ItemPage = {
  items: [
    { id: 'i-hacendado', bestOffer: null },
  ] as unknown as ItemPage['items'],
  nextCursor: null,
};

function build() {
  const send = jest.fn(async (subject: string) => {
    if (subject === ITEM_PATTERNS.searchOffers) {
      return groupPage;
    }
    if (subject === ITEM_PATTERNS.search) {
      return itemPage;
    }
    throw new Error(`unexpected subject ${subject}`);
  });
  // No scopes at all, which since plan 0069 is what an empty profile and a
  // profile that refused every shop near it both resolve to.
  const describe = jest.fn(
    async (): Promise<CatalogScopeView> => ({
      priceScopeIds: [],
      scopes: [],
      coverage: [],
      approximate: false,
      profileId: null,
      explicit: false,
    })
  );
  const controller = new CatalogSuggestController(
    new CatalogSuggestService({ send } as never),
    {
      describe,
    } as never
  );
  return { controller, send, describe };
}

function query(): SuggestQueryDto {
  const dto = new SuggestQueryDto();
  dto.q = 'milk';
  return dto;
}

describe('GET /v1/catalog/suggest with no scopes', () => {
  it('runs both reads rather than refusing the dropdown', async () => {
    const { controller, send } = build();

    const result = await controller.suggest(USER, query());

    expect(send.mock.calls.map((call) => call[0]).sort()).toEqual(
      [ITEM_PATTERNS.search, ITEM_PATTERNS.searchOffers].sort()
    );
    // Groups first, then products: the ordering is the whole reason the route
    // exists, and having no prices does not change it.
    expect(result.suggestions.map((entry) => entry.kind)).toEqual([
      'group',
      'item',
    ]);
  });

  it('sends the same empty scope set to both halves', async () => {
    const { controller, send, describe } = build();

    const result = await controller.suggest(USER, query());

    // Resolved once, so the two reads cannot quote prices from different
    // places; empty here means neither quotes any.
    expect(describe).toHaveBeenCalledTimes(1);
    // Nothing priced, so no chain to name and no listing asked for.
    expect(result.scopes).toEqual([]);
    for (const call of send.mock.calls) {
      expect(call[1]).toMatchObject({ priceScopeIds: [] });
    }
  });
});
