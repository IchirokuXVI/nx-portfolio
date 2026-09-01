import {
  ITEM_LOOKUP_LIMITS,
  ITEM_PATTERNS,
} from '@portfolio/luna-shopper/contracts';
import { validate } from 'class-validator';
import { CatalogItemsController } from './catalog.controller';
import { LookupItemsDto } from './catalog.dto';

/**
 * Reading a set of product names over HTTP (plan 0053, section 1).
 *
 * `ITEM_PATTERNS.getMany` existed and had exactly one consumer, the participant
 * surface velista `0044` added so a guest could read the names in a basket.
 * There was no general route in front of it, which is why velista's line screens
 * resolved products through a hand written fixture and told a user with a real
 * catalog that their line has no products when it does.
 *
 * Two things are asserted, and they are the two the route is responsible for:
 * the cap is enforced here rather than merely documented, and the caller is not
 * named in the request. Which products come back, and the fact that unknown ids
 * are omitted rather than raised, are catalog's and are proven there.
 */

const ID = '11111111-2222-4333-8444-555555555555';

function ids(count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `1111111${index % 10}-2222-4333-8444-555555555555`
  );
}

async function errorsOn(value: string[]): Promise<string[]> {
  const dto = new LookupItemsDto();
  dto.ids = value;
  const failures = await validate(dto);
  return failures.flatMap((failure) => Object.keys(failure.constraints ?? {}));
}

function build() {
  const send = jest.fn(async () => ({ items: [] }));
  const controller = new CatalogItemsController({ send } as never, {} as never);
  return { controller, send };
}

describe('POST /v1/catalog/items/lookup', () => {
  it('passes the ids straight through to the batch pattern', async () => {
    const { controller, send } = build();
    const dto = new LookupItemsDto();
    dto.ids = [ID];

    await controller.lookup(dto);

    expect(send).toHaveBeenCalledWith(ITEM_PATTERNS.getMany, { ids: [ID] });
  });

  it('names no caller, because a product name is not private', async () => {
    const { controller, send } = build();
    const dto = new LookupItemsDto();
    dto.ids = [ID];

    await controller.lookup(dto);

    // The subject takes no `userId` by design: the gateway's own guard is what
    // decides who may reach the route, and catalog has no per user answer to
    // give about a product's name.
    expect(send.mock.calls[0][1]).not.toHaveProperty('userId');
  });

  it('accepts a request naming exactly the documented maximum', async () => {
    expect(await errorsOn(ids(ITEM_LOOKUP_LIMITS.maxIds))).toEqual([]);
  });

  it('refuses one product past it, at the route', async () => {
    // A batch read with no ceiling is a listing, and plan 0049 section 3
    // deliberately stopped the catalog being listable. Documenting the cap and
    // not enforcing it would have left that hole open through this route.
    expect(await errorsOn(ids(ITEM_LOOKUP_LIMITS.maxIds + 1))).toContain(
      'arrayMaxSize'
    );
  });

  it('refuses an id that is not an item reference', async () => {
    expect(await errorsOn(['milk'])).toContain('isUuid');
  });

  it('accepts an empty request, which is a page with nothing to name', async () => {
    // A line with no products asks for none, and answering it with a bad
    // request would make an ordinary empty basket an error.
    expect(await errorsOn([])).toEqual([]);
  });
});
