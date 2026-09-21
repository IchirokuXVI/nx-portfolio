import {
  BasketKind,
  GeneratedListStatus,
  isOpenBasket,
  RealtimeEvent,
} from '@portfolio/luna-shopper/contracts';
import {
  ConflictException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import type { GeneratedList } from '../entities';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import type { ProfileService } from '../profiles/profile.service';
import {
  fakeBasketTripRows,
  fakeUpdateDataSource,
  type FakeBasketTripRows,
} from './basket-trip-rows.fake';
import { GeneratedListSweepService } from './generated-list-sweep.service';
import { GeneratedListService } from './generated-list.service';
import { fakeLineClaims, type FakeLineClaims } from './line-claims.fake';

/**
 * What a basket's kind decides (plan 0133, sections 2, 3 and 6).
 *
 * Every case here puts a `LIVE` row in by hand, as it did when plan 0133 wrote
 * the rules and nothing created one yet. It still does: `BasketLiveService`
 * (plan 0136, section 4) is what creates one now, and this file is about what
 * the rules say of a row that exists, not about who wrote it.
 */

const OWNER = 'u-owner';
const TRIP = 'gl-trip';
const LIVE = 'gl-live';
const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-09-20T09:00:00.000Z');

function basket(overrides: Partial<GeneratedList> = {}): GeneratedList {
  return {
    id: TRIP,
    ownerUserId: OWNER,
    kind: BasketKind.GENERATED,
    name: null,
    status: GeneratedListStatus.OPEN,
    generatedAt: new Date(NOW),
    pricingProfileId: null,
    idempotencyKey: null,
    ...overrides,
  } as GeneratedList;
}

/** The permanent basket as plan 0136 writes it: unnamed, open, no key. */
const liveBasket = () =>
  basket({ id: LIVE, kind: BasketKind.LIVE, generatedAt: new Date(NOW - 1) });

interface Harness {
  service: GeneratedListService;
  rows: GeneratedList[];
  claims: FakeLineClaims;
  events: RealtimeEvent[];
  tripRows: FakeBasketTripRows;
}

/** The claim refs a basket is said to hold, so a transition has one to release. */
const CLAIMING = [{ zoneId: 'z-home', listId: 'l-flat', lineId: 'li-1' }];

function build(rows: GeneratedList[]): Harness {
  const events: RealtimeEvent[] = [];
  const claims = fakeLineClaims({}, () => CLAIMING);

  const lists = {
    findOne: async ({ where }: { where: { id: string } }) =>
      rows.find((row) => row.id === where.id) ?? null,
    save: async (row: GeneratedList) => row,
    delete: async ({ id }: { id: string }) => {
      const at = rows.findIndex((row) => row.id === id);
      if (at >= 0) {
        rows.splice(at, 1);
      }
      return { affected: 1 };
    },
    // The one raw read a transition makes: which lists the basket draws from.
    query: async () => [{ listId: 'l-flat' }],
  };

  const tripRows = fakeBasketTripRows();
  const service = new GeneratedListService(
    fakeUpdateDataSource(lists),
    lists as never,
    {} as unknown as ProfileService,
    claims.service,
    {
      emitToUsers: (event: RealtimeEvent) => events.push(event),
      emitTo: (event: RealtimeEvent) => events.push(event),
    } as unknown as CoreEventsPublisher,
    { liveRegistered: async () => [] } as never,
    { find: async () => [] } as never,
    tripRows.service,
    {} as never
  );

  return { service, rows, claims, events, tripRows };
}

describe('whether a basket still takes writes (section 3)', () => {
  it('is open, and nothing else', () => {
    expect(isOpenBasket(GeneratedListStatus.OPEN)).toBe(true);
    expect(isOpenBasket(GeneratedListStatus.FINISHED)).toBe(false);
    expect(isOpenBasket(GeneratedListStatus.ARCHIVED)).toBe(false);
  });
});

describe('what the permanent basket refuses (section 2)', () => {
  it('refuses a name, and says which field it was about', async () => {
    const { service } = build([liveBasket()]);

    const failed = await service
      .update({ userId: OWNER, generatedListId: LIVE, name: 'Saturday' })
      .catch((error: unknown) => error);

    // Refused here rather than by `ck_generated_lists_live_shape`, so the caller
    // is told which write was wrong instead of meeting a database error.
    expect(failed).toBeInstanceOf(ValidationException);
    expect((failed as ValidationException).messageArgs).toEqual({
      field: 'name',
    });
  });

  it('refuses a status, because it never ends', async () => {
    const { service } = build([liveBasket()]);

    const failed = await service
      .update({
        userId: OWNER,
        generatedListId: LIVE,
        status: GeneratedListStatus.FINISHED,
      })
      .catch((error: unknown) => error);

    expect(failed).toBeInstanceOf(ValidationException);
    expect((failed as ValidationException).messageArgs).toEqual({
      field: 'status',
    });
  });

  it('refuses those two and nothing else', async () => {
    // Was "takes a default target list, which is neither of those".
    // `defaultTargetListId` is deleted from the request and from the column
    // (plan 0136, sections 9 and 10), because a basket has no line of its own
    // for a default to target: the add names its list outright. So the two
    // refusals above are now the whole of what the permanent basket refuses,
    // and a write carrying neither still answers with the basket.
    const { service } = build([liveBasket()]);

    const view = await service.update({ userId: OWNER, generatedListId: LIVE });

    expect(view.kind).toBe(BasketKind.LIVE);
    expect(view.status).toBe(GeneratedListStatus.OPEN);
    expect(view.name).toBeNull();
  });

  it('refuses to be deleted, and leaves the row where it is', async () => {
    const { service, rows } = build([liveBasket()]);

    await expect(
      service.delete({ userId: OWNER, generatedListId: LIVE })
    ).rejects.toBeInstanceOf(ConflictException);
    expect(rows).toHaveLength(1);
  });

  it('is deleted with its owner’s account, like every other basket', async () => {
    // `deleteForUser` is unchanged (section 2): an account's deletion takes
    // every basket it owns, and the permanent one is one of them.
    const { service } = build([liveBasket()]);
    const deleted = jest.fn(async () => ({ affected: 1 }));
    (service as unknown as { lists: { delete: unknown } }).lists.delete =
      deleted;

    await service.deleteForUser(OWNER);

    expect(deleted).toHaveBeenCalledWith({ ownerUserId: OWNER });
  });

  it('announces no claim in either direction', async () => {
    // A `LIVE` basket is always open and claims nothing (section 6), so a write
    // to it must not tell a household that somebody has just picked up, or put
    // down, every line they can write.
    const { service, claims } = build([liveBasket()]);

    await service.update({ userId: OWNER, generatedListId: LIVE });

    expect(claims.calls).toEqual([]);
  });

  it('still announces one on a trip, which is what the check protects', async () => {
    const { service, claims } = build([basket()]);

    await service.update({
      userId: OWNER,
      generatedListId: TRIP,
      status: GeneratedListStatus.FINISHED,
    });

    expect(claims.calls).toEqual([
      { claimed: false, claimedByUserId: null, lineIds: ['li-1'] },
    ]);
  });
});

describe('the sweep leaves the permanent basket alone (section 6)', () => {
  /** The sweep, over a repository that honours the query it sends. */
  function sweeper(rows: GeneratedList[]) {
    const finished: string[] = [];
    const lists = {
      find: async (query: {
        where: {
          kind: BasketKind;
          status: GeneratedListStatus;
          generatedAt: { value: Date };
        };
        take: number;
      }) =>
        rows
          .filter(
            (row) =>
              row.kind === query.where.kind &&
              row.status === query.where.status &&
              row.generatedAt.getTime() <
                query.where.generatedAt.value.getTime()
          )
          .slice(0, query.take),
    };
    const generated = {
      update: async (req: { generatedListId: string }) => {
        finished.push(req.generatedListId);
        return {};
      },
    } as unknown as GeneratedListService;

    return {
      finished,
      service: new GeneratedListSweepService(
        lists as never,
        generated,
        { log: jest.fn(), error: jest.fn() } as never,
        {
          getOrThrow: () => ({
            generatedList: {
              claimWindowMs: 60 * HOUR,
              sweep: { enabled: true, intervalMs: 1000, batchSize: 100 },
            },
          }),
        } as never
      ),
    };
  }

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('finishes an old trip and leaves a permanent basket of the same age', async () => {
    // Without the kind the sweep would finish it after sixty hours, and the
    // settle would then refuse every write to it: the feature would stop working
    // on its third day.
    const old = new Date(NOW - 61 * HOUR);
    const w = sweeper([
      basket({ generatedAt: old }),
      { ...liveBasket(), generatedAt: old } as GeneratedList,
    ]);

    expect(await w.service.sweep()).toBe(1);
    expect(w.finished).toEqual([TRIP]);
  });
});
