import {
  BasketKind,
  GeneratedListStatus,
  RealtimeEvent,
} from '@portfolio/luna-shopper/contracts';
import { NotFoundException } from '@portfolio/luna-shopper/platform';
import { QueryFailedError, type DataSource } from 'typeorm';
import type { BasketReadService } from '../baskets/basket-read.service';
import { BasketSource, GeneratedList } from '../entities';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import { BASKET_TRIP_LISTS_SQL } from '../lists/trips/trips.sql';
import type { ProfileService } from '../profiles/profile.service';
import {
  fakeBasketTripRows,
  type FakeBasketTripRows,
} from './basket-trip-rows.fake';
import type { GeneratedListMembersService } from './generated-list-members.service';
import { GeneratedListService } from './generated-list.service';
import { WRITABLE_LISTS_SQL } from './generated-list.sql';
import { fakeLineClaims, type FakeLineClaims } from './line-claims.fake';

/**
 * The generation run (plan 0050, sections 2, 3 and 4; plan 0136, section 1).
 *
 * **The run composes nothing since plan 0136.** It writes a `generated_lists`
 * header, the `basket_sources` rows saying which lists the basket covers, and
 * the people it is shared with, and that is all: the rows are read from
 * `list_lines` on every request. So this file is about **what a basket ends up
 * covering**, where it used to be about what a basket ends up holding, and the
 * assertions that pinned composed lines are kept here as assertions that nothing
 * was composed.
 *
 * The reads the run makes are faked by matching on the SQL constants themselves
 * rather than on a string, and every other query throws. That is load bearing
 * now: a run that started reading candidate lines again would fail here as an
 * unmocked read rather than pass silently.
 *
 * The one thing this file cannot prove is the idempotency index, which is what
 * makes a double tap return the first basket rather than usually returning it. A
 * mocked repository has no unique constraint to violate, so the transaction's
 * loser path is asserted here by making the write throw and the re-read succeed,
 * and the constraint itself lives in the migration.
 */

const OWNER = 'u-owner';
const ZONE_A = 'z-flat';
const ZONE_B = 'z-parents';
const LIST_A = 'l-flat';
const LIST_B = 'l-parents';

/**
 * The source rows a run wrote, as (zone, list) pairs, so an assertion reads like
 * the table in plan 0133 section 4.2 rather than like an insert.
 */
const sourcesOf = (written: Harness['written']) =>
  written.sources.map((row) => ({ zoneId: row.zoneId, listId: row.listId }));

interface Harness {
  service: GeneratedListService;
  /** Rows written inside the run's transaction, in write order. */
  written: {
    lists: Partial<GeneratedList>[];
    /** What the run recorded it was asked to draw from (plan 0133, section 4). */
    sources: Partial<BasketSource>[];
  };
  events: { event: RealtimeEvent; userIds: readonly string[] }[];
  /**
   * The lists told to read their trips again (plan 0122, section 6). Kept apart
   * from `events`, which pins who hears about the **basket**: this one is
   * addressed to a list's room and names no person.
   */
  tripsChanged: (string | undefined)[];
  claims: FakeLineClaims;
  tripRows: FakeBasketTripRows;
  /** Every entity the run's transaction asked for a repository of. */
  repositoriesTouched: () => string[];
}

function build(options: {
  writable?: { listId: string; zoneId: string }[];
  profileSources?: { zoneId: string; listId: string | null }[];
  profileId?: string;
  /**
   * A profile id the caller does not own, refused by the load the pricing
   * ladder makes (plan 0078, section 3, rule 1).
   */
  unownedProfileId?: string;
  /** An existing basket the idempotency key already produced. */
  existing?: Partial<GeneratedList> | null;
  /**
   * Make the write lose the unique index, for the two taps that raced.
   *
   * The first `findOne` still answers null, because at that moment the winner had
   * not committed. That ordering is the race, and it is why the loser path exists
   * at all rather than the up front check being enough.
   */
  loseTheRace?: Partial<GeneratedList>;
  /**
   * The lines this basket covers, for the transitions in plan 0052 section 3 and
   * for the trips of plan 0122 section 6.
   *
   * Stated here rather than derived from the write, because since plan 0136 the
   * run writes no row a query could derive them from: both reads stand on the
   * coverage, which is a join through `basket_sources` to `list_lines`.
   */
  covering?: { zoneId: string; listId: string; lineId: string }[];
}): Harness {
  const writable = options.writable ?? [
    { listId: LIST_A, zoneId: ZONE_A },
    { listId: LIST_B, zoneId: ZONE_B },
  ];

  const written: Harness['written'] = {
    lists: [],
    sources: [],
  };
  const events: Harness['events'] = [];
  const tripsChanged: Harness['tripsChanged'] = [];

  let nextId = 0;
  const id = (prefix: string) => `${prefix}-${++nextId}`;

  const query = async (sql: string): Promise<unknown[]> => {
    if (sql === WRITABLE_LISTS_SQL) {
      return writable;
    }
    if (sql === BASKET_TRIP_LISTS_SQL) {
      // `DISTINCT`, as the real read is, and answered from the coverage rather
      // than from anything the run wrote (plan 0136, section 7.2).
      return [
        ...new Set((options.covering ?? []).map((row) => row.listId)),
      ].map((listId) => ({ listId }));
    }
    throw new Error(`unmocked query: ${sql.slice(0, 60)}`);
  };

  let findOneCalls = 0;
  const listRepo = {
    query,
    findOne: async () => {
      findOneCalls += 1;
      if (options.loseTheRace) {
        // Null the first time (the winner had not committed), the winner's row
        // the second time (after the constraint refused ours).
        return findOneCalls > 1 ? options.loseTheRace : null;
      }
      return options.existing ?? null;
    },
    // Only reached by the paths this file does not exercise (update, delete).
    save: async (row: Partial<GeneratedList>) => row,
    delete: async () => ({ affected: 0 }),
    createQueryBuilder: () => {
      throw new Error('the run does not page');
    },
  };

  const repositoriesTouched: string[] = [];

  const manager = {
    // The basket `update` locks and re-reads inside its transaction (plan 0135,
    // section 3.1). The same row the load above answered with, because this
    // harness stores one.
    findOne: async () => options.existing ?? null,
    getRepository: (entity: unknown) => {
      if (entity === GeneratedList) {
        repositoriesTouched.push('GeneratedList');
        return {
          create: (data: Partial<GeneratedList>) => ({ ...data }),
          // A row that already has an id is an update rather than the run's
          // insert, and it keeps the id it arrived with.
          save: async (row: Partial<GeneratedList>) => {
            if (row.id) {
              return row;
            }
            if (options.loseTheRace) {
              throw uniqueViolation();
            }
            const stored = { ...row, id: id('gl') };
            written.lists.push(stored);
            return stored;
          },
        };
      }
      if (entity === BasketSource) {
        repositoriesTouched.push('BasketSource');
        return {
          insert: async (rows: Partial<BasketSource>[]) => {
            written.sources.push(
              ...rows.map((row) => ({ ...row, id: id('bs') }))
            );
          },
        };
      }
      // The whole of plan 0136 section 10, stated as a failure rather than as a
      // comment: there is no third table for the run to reach for. A run that
      // asked for one would land here.
      throw new Error(
        'the run writes a header, its sources and its people, and nothing else'
      );
    },
  };

  const dataSource = {
    transaction: async <T>(work: (m: unknown) => Promise<T>): Promise<T> =>
      work(manager),
  } as unknown as DataSource;

  const profiles = {
    resolveGenerationSources: async () => ({
      profileId: options.profileId ?? 'p-default',
      scope: 'ALL',
      sources: options.profileSources ?? [],
    }),
    // Plan 0078's ladder, faked at the same depth as the one above it: a named
    // profile is loaded and answered back, a profile this caller does not own is
    // refused there rather than here, and no name at all takes the default.
    pricingProfileId: async (_userId: string, profileId?: string | null) => {
      if (profileId) {
        if (profileId === options.unownedProfileId) {
          throw new NotFoundException('no such profile');
        }
        return profileId;
      }
      return options.profileId ?? 'p-default';
    },
  } as unknown as ProfileService;

  const publisher = {
    emitToUsers: (event: RealtimeEvent, userIds: readonly string[]) => {
      events.push({ event, userIds });
    },
    // A deletion names the basket room beside the owner since plan 0114, so it
    // goes through the explicit audience. Recorded by its users, as before.
    emitTo: (
      event: RealtimeEvent,
      audience: { userIds?: readonly string[]; listId?: string }
    ) => {
      if (event === RealtimeEvent.ListTripsChanged) {
        tripsChanged.push(audience.listId);
        return;
      }
      events.push({ event, userIds: audience.userIds ?? [] });
    },
  } as unknown as CoreEventsPublisher;

  // Nobody is shared a basket in these runs (plan 0114): no members are named,
  // and a deletion finds nobody to tell.
  const members = {
    liveRegistered: async () => [],
  } as unknown as GeneratedListMembersService;

  const claims = fakeLineClaims({}, () => options.covering ?? []);

  const tripRows = fakeBasketTripRows();
  // The history counts an open basket through this (plan 0136, section 7.4), and
  // nothing in this file lists a page, so an empty progress is the whole of what
  // the run needs it for.
  const basketRead = {
    progressOf: async () => ({
      done: 0,
      unavailable: 0,
      total: 0,
      pending: 0,
    }),
  } as unknown as BasketReadService;

  const service = new GeneratedListService(
    dataSource,
    listRepo as never,
    profiles,
    claims.service,
    publisher,
    members,
    // The source rows the run wrote, read back by every view of the basket.
    { find: async () => written.sources } as never,
    tripRows.service,
    basketRead
  );

  return {
    service,
    written,
    events,
    tripsChanged,
    claims,
    tripRows,
    repositoriesTouched: () => repositoriesTouched,
  };
}

/**
 * What Postgres raises when the partial unique index on the idempotency key
 * refuses a second basket.
 *
 * Built by hand rather than provoked, because the service recognises it by
 * `driverError.code` and that is exactly the coupling worth pinning: a refactor
 * that started reading `error.code` instead would pass every other test in this
 * file and turn a lost race into a 500.
 */
function uniqueViolation(): QueryFailedError {
  return new QueryFailedError('INSERT', [], {
    code: '23505',
  } as unknown as Error);
}

describe('the generation run', () => {
  it('composes no line at all, because a basket is a view of its lists', async () => {
    // The reversal of "composes one line per qualifying zone line" (plan 0136,
    // section 1). The run reads no candidate line and writes no row to a line
    // table: the harness's transaction hands out two repositories and throws for
    // anything else, so this assertion is made by the run completing.
    const { service, written, repositoriesTouched } = build({});

    const result = await service.create({ userId: OWNER });

    expect(written.lists).toHaveLength(1);
    expect(new Set(repositoriesTouched())).toEqual(
      new Set(['GeneratedList', 'BasketSource'])
    );
    // The result is the basket and nothing else since plan 0133 section 7: the
    // run refuses no line, so there is nothing left behind to report.
    expect(Object.keys(result)).toEqual(['list']);
    expect(result.list).not.toHaveProperty('lines');
  });

  it('merges nothing, because there is no row to merge into', async () => {
    // The reversal of "merges lines carrying the same product set and sums their
    // quantities". Milk in the flat list and in the parents' list is still one
    // line to buy once, and it is one **row** now, grouped on `mergeKey` by
    // `baskets/line-dedup.ts` on every read. The run records that it covers both
    // lists and stops there.
    const { service, written } = build({});

    await service.create({
      userId: OWNER,
      sources: [
        { zoneId: ZONE_A, listId: LIST_A },
        { zoneId: ZONE_B, listId: LIST_B },
      ],
    });

    expect(sourcesOf(written)).toEqual([
      { zoneId: ZONE_A, listId: LIST_A },
      { zoneId: ZONE_B, listId: LIST_B },
    ]);
  });

  it('stores no product set and no pick, which the read composes instead', async () => {
    // The reversal of "unions the options of the lines it merged" and of "leaves
    // a free text line with no pick and no options". `generated_list_line_options`
    // is dropped (plan 0136, section 9), and a row's `optionIds` are the union of
    // its entries' `list_line_items`, read per request. Nothing the run writes
    // carries either, so the header is asserted whole.
    const { service, written } = build({});

    await service.create({ userId: OWNER });

    const row = written.lists[0];
    expect(row).not.toHaveProperty('itemId');
    expect(Object.keys(row).sort()).toEqual([
      'generatedAt',
      'id',
      'idempotencyKey',
      'kind',
      'name',
      'ownerUserId',
      'pricingProfileId',
      'status',
    ]);
  });

  it('keeps no text of its own, so a rename of a zone line needs no copy', async () => {
    // The reversal of "merges free text lines on normalized text and keeps
    // different words apart". The normalization is still the rule and still
    // conservative, and it lives in `baskets/line-dedup.ts` with its own spec;
    // what changed is that it decides a grouping at read time rather than a
    // stored `content`, so a run writes no text at all.
    const { service, written } = build({});

    await service.create({ userId: OWNER, name: 'Saturday' });

    // The basket's own name, which is the only text a run writes.
    expect(written.lists[0].name).toBe('Saturday');
  });

  it('takes a line another basket of the owner’s is carrying (plan 0133)', async () => {
    // Plan 0050 section 3 refused it and plan 0133 section 7 reversed that. The
    // rule was true of two frozen copies of one line and false of two views of
    // it, and with a permanent basket over every list it would refuse
    // everything. Since plan 0136 both baskets are views, so there is nothing
    // left that could refuse.
    const { service, written } = build({
      covering: [{ zoneId: ZONE_A, listId: LIST_A, lineId: 'a1' }],
    });

    const result = await service.create({ userId: OWNER });

    expect(written.lists).toHaveLength(1);
    expect(result).toEqual({ list: expect.objectContaining({ id: 'gl-1' }) });
  });

  it('draws from every writable list when nothing narrows it', async () => {
    const { service, written } = build({});

    await service.create({ userId: OWNER });

    // `ALL` names no source of its own, so it is recorded as one whole zone row
    // per zone the caller can draw from (plan 0133, section 4.2).
    expect(written.lists[0].pricingProfileId).toBe('p-default');
    expect(sourcesOf(written)).toEqual([
      { zoneId: ZONE_A, listId: null },
      { zoneId: ZONE_B, listId: null },
    ]);
  });

  it('narrows to the sources the request names, and never widens past access', async () => {
    const { service, written } = build({});

    await service.create({
      userId: OWNER,
      // A zone the caller may not draw from contributes nothing rather than
      // failing the run, which is the same thing as it having been taken away.
      sources: [{ zoneId: ZONE_A }, { zoneId: 'z-stranger' }],
    });

    // The run belongs to somebody who shops somewhere even when it read no
    // profile's sources (plan 0078, section 3).
    expect(written.lists[0].pricingProfileId).toBe('p-default');
    // The zone was named, so the zone is what is recorded, and the stranger's
    // zone narrowed to nothing and wrote no row at all.
    expect(sourcesOf(written)).toEqual([{ zoneId: ZONE_A, listId: null }]);
  });

  it('narrows to a named list inside a zone', async () => {
    const { service, written } = build({});

    await service.create({
      userId: OWNER,
      sources: [{ zoneId: ZONE_B, listId: LIST_B }],
    });

    expect(sourcesOf(written)).toEqual([{ zoneId: ZONE_B, listId: LIST_B }]);
  });

  it('writes the whole zone row alone when a source names one of its lists too', async () => {
    // Section 4.1's second rule: both rows would describe the same coverage, and
    // the pair would make `listsOf` ask two questions where one answers.
    const { service, written } = build({
      writable: [
        { listId: LIST_A, zoneId: ZONE_A },
        { listId: 'l-second', zoneId: ZONE_A },
      ],
    });

    await service.create({
      userId: OWNER,
      sources: [{ zoneId: ZONE_A }, { zoneId: ZONE_A, listId: LIST_A }],
    });

    expect(sourcesOf(written)).toEqual([{ zoneId: ZONE_A, listId: null }]);
  });

  it('writes no row for a source that narrows to nothing', async () => {
    // Plan 0050 section 2's rule kept: a source is only ever a narrowing, and
    // one that names nothing is silently nothing.
    const { service, written } = build({});

    await service.create({
      userId: OWNER,
      sources: [
        { zoneId: ZONE_A, listId: LIST_A },
        { zoneId: ZONE_B, listId: 'l-gone' },
      ],
    });

    expect(sourcesOf(written)).toEqual([{ zoneId: ZONE_A, listId: LIST_A }]);
  });

  it('falls back to the profile sources when the request names none', async () => {
    const { service, written } = build({
      profileSources: [{ zoneId: ZONE_A, listId: null }],
      profileId: 'p-weekly',
    });

    await service.create({ userId: OWNER });

    expect(written.lists[0].pricingProfileId).toBe('p-weekly');
    // The profile named the whole zone, so the whole zone is recorded, even
    // though it narrowed to one list today.
    expect(sourcesOf(written)).toEqual([{ zoneId: ZONE_A, listId: null }]);
  });

  describe('what the basket is priced against (plan 0078, section 3)', () => {
    it('records the named profile for pricing while the sources stay the caller’s own', async () => {
      // The shape every run velista creates takes: the sheet always sends
      // `sources`, and sends `profileId` beside them whenever one is chosen.
      const { service, written } = build({});

      await service.create({
        userId: OWNER,
        sources: [{ zoneId: ZONE_A }],
        profileId: 'p-weekly',
      });

      expect(written.lists[0].pricingProfileId).toBe('p-weekly');
      expect(sourcesOf(written)).toEqual([{ zoneId: ZONE_A, listId: null }]);
    });

    it('refuses a profile the caller does not own before writing anything', async () => {
      const { service, written } = build({
        unownedProfileId: 'p-stranger',
      });

      await expect(
        service.create({
          userId: OWNER,
          sources: [{ zoneId: ZONE_A }],
          profileId: 'p-stranger',
        })
      ).rejects.toBeInstanceOf(NotFoundException);
      // A stranger's profile can never price a run, and a refused run leaves no
      // basket behind to price.
      expect(written.lists).toEqual([]);
    });
  });

  it('starts a basket OPEN and GENERATED, and tells only the owner', async () => {
    // Was "starts a basket as a DRAFT of DERIVED lines". `GeneratedLineOrigin`
    // and `settledQuantity` went with the line table (plan 0136, section 10), so
    // what a run decides about the thing it made is its kind and its status: a
    // run composes a **trip**, and the permanent basket is made by nothing here.
    const { service, written, events } = build({});

    await service.create({ userId: OWNER });

    expect(written.lists[0].status).toBe(GeneratedListStatus.OPEN);
    expect(written.lists[0].kind).toBe(BasketKind.GENERATED);
    // A basket is private, so the owner's own sessions are the only audience an
    // event about it can have (section 8).
    expect(events).toEqual([
      {
        event: RealtimeEvent.GeneratedListCreated,
        userIds: [OWNER],
      },
    ]);
  });

  it('returns the first basket for a repeated idempotency key rather than a second one', async () => {
    const { service, written } = build({
      existing: {
        id: 'gl-first',
        ownerUserId: OWNER,
        name: null,
        status: GeneratedListStatus.OPEN,
        generatedAt: new Date('2026-09-01T10:00:00.000Z'),
        kind: BasketKind.GENERATED,
        pricingProfileId: null,
      },
    });

    const result = await service.create({
      userId: OWNER,
      idempotencyKey: 'tap-1',
    });

    expect(result.list.id).toBe('gl-first');
    // Nothing was written a second time, which is the whole point of the key.
    expect(written.lists).toEqual([]);
    expect(written.sources).toEqual([]);
  });

  it('hands back the winner when two taps race past the up front check', async () => {
    // The half a repeated key cannot cover: both taps read no existing basket,
    // both write, and the index refuses the second. The loser must answer with
    // the winner's basket rather than with a 500.
    const { service } = build({
      loseTheRace: {
        id: 'gl-winner',
        ownerUserId: OWNER,
        name: null,
        status: GeneratedListStatus.OPEN,
        generatedAt: new Date('2026-09-01T10:00:00.000Z'),
        kind: BasketKind.GENERATED,
        pricingProfileId: null,
      },
    });

    const result = await service.create({
      userId: OWNER,
      idempotencyKey: 'tap-1',
    });

    expect(result.list.id).toBe('gl-winner');
  });

  it('covers nothing when no list qualifies, rather than failing', async () => {
    // Was "composes nothing when no list qualifies". A basket over no list is
    // still a basket, and reading it answers no rows rather than an error (plan
    // 0136, section 3.1): a person in no zone has one too.
    const { service, written } = build({ writable: [] });

    const result = await service.create({ userId: OWNER });

    expect(result.list.sources).toEqual([]);
    expect(written.sources).toEqual([]);
  });
});

/**
 * The one zone event a generated list emits (plan 0052).
 *
 * Plan 0050 section 8 said generated lists never emit zone events, and this is
 * the declared exception rather than a contradiction to be discovered later: a
 * household has to be able to see that somebody is already out buying the milk.
 *
 * What a basket claims is its **coverage** since plan 0136 section 7.1, where it
 * used to be its provenance rows. The refs are stated by the harness for exactly
 * that reason: there is no written row left to derive them from.
 */
describe('a basket claims the lines it covers (plan 0052, section 3)', () => {
  const COVERING = [
    { zoneId: ZONE_A, listId: LIST_A, lineId: 'li-1' },
    { zoneId: ZONE_A, listId: LIST_A, lineId: 'li-2' },
  ];

  it('claims every covered line, naming the owner', async () => {
    const w = build({ covering: COVERING });

    await w.service.create({ userId: OWNER });

    // One call carrying both lines, not one call each: a run covers every wanted
    // line of every list it drew from, and a per line fan out into a household
    // room is a self inflicted problem (section 3.1).
    expect(w.claims.calls).toEqual([
      { claimed: true, claimedByUserId: OWNER, lineIds: ['li-1', 'li-2'] },
    ]);
  });

  it('releases them when the trip is over', async () => {
    const w = build({
      existing: {
        id: 'gl-old',
        ownerUserId: OWNER,
        status: GeneratedListStatus.OPEN,
        name: null,
        generatedAt: new Date('2026-03-01T00:00:00.000Z'),
        kind: BasketKind.GENERATED,
        pricingProfileId: null,
      },
      covering: COVERING,
    });

    await w.service.update({
      userId: OWNER,
      generatedListId: 'gl-old',
      status: GeneratedListStatus.FINISHED,
    });

    expect(w.claims.calls).toEqual([
      { claimed: false, claimedByUserId: null, lineIds: ['li-1', 'li-2'] },
    ]);
  });

  it('says nothing when a rename leaves the status where it was', async () => {
    const w = build({
      existing: {
        id: 'gl-old',
        ownerUserId: OWNER,
        status: GeneratedListStatus.OPEN,
        name: null,
        generatedAt: new Date('2026-03-01T00:00:00.000Z'),
        kind: BasketKind.GENERATED,
        pricingProfileId: null,
      },
      covering: COVERING,
    });

    await w.service.update({
      userId: OWNER,
      generatedListId: 'gl-old',
      name: 'Saturday',
    });

    expect(w.claims.calls).toEqual([]);
  });

  it('releases them when the basket is deleted', async () => {
    const w = build({
      existing: {
        id: 'gl-old',
        ownerUserId: OWNER,
        status: GeneratedListStatus.OPEN,
        name: null,
        generatedAt: new Date('2026-03-01T00:00:00.000Z'),
      },
      covering: COVERING,
    });

    await w.service.delete({ userId: OWNER, generatedListId: 'gl-old' });

    expect(w.claims.calls).toEqual([
      { claimed: false, claimedByUserId: null, lineIds: ['li-1', 'li-2'] },
    ]);
  });

  it('says nothing when deleting a basket that was already finished', async () => {
    const w = build({
      existing: {
        id: 'gl-old',
        ownerUserId: OWNER,
        status: GeneratedListStatus.FINISHED,
        name: null,
        generatedAt: new Date('2026-03-01T00:00:00.000Z'),
      },
      covering: COVERING,
    });

    await w.service.delete({ userId: OWNER, generatedListId: 'gl-old' });

    expect(w.claims.calls).toEqual([]);
  });
});

/**
 * Plan 0122, section 6: a list's room is told to read its trips again when a
 * basket that touches it changes. One event per list per write, never one per
 * line (plan 0052, section 3.1).
 */
describe('a basket tells the lists it touches (plan 0122, section 6)', () => {
  const existing = {
    id: 'gl-old',
    ownerUserId: OWNER,
    status: GeneratedListStatus.OPEN,
    name: null,
    generatedAt: new Date('2026-03-01T00:00:00.000Z'),
    kind: BasketKind.GENERATED,
    pricingProfileId: null,
  };
  const COVERING = [
    { zoneId: ZONE_A, listId: LIST_A, lineId: 'li-1' },
    { zoneId: ZONE_A, listId: LIST_A, lineId: 'li-2' },
    { zoneId: ZONE_B, listId: LIST_B, lineId: 'li-3' },
  ];

  it('tells each list the run covers once, however many lines it holds', async () => {
    const w = build({ covering: COVERING });

    await w.service.create({ userId: OWNER });

    expect(w.tripsChanged).toEqual([LIST_A, LIST_B]);
  });

  it('tells nobody when the run covers no list', async () => {
    const w = build({ covering: [] });

    await w.service.create({ userId: OWNER });

    expect(w.tripsChanged).toEqual([]);
  });

  it('tells them on a rename, which the claim has nothing to say about', async () => {
    const w = build({ existing, covering: COVERING });

    await w.service.update({
      userId: OWNER,
      generatedListId: 'gl-old',
      name: 'Saturday',
    });

    expect(w.tripsChanged).toEqual([LIST_A, LIST_B]);
  });

  it('says nothing when a write moves neither the name nor the status', async () => {
    // Was "says nothing when only the default target list moved".
    // `defaultTargetListId` is deleted from the request and from the column
    // (plan 0136, sections 9 and 10), because there is no line for it to target
    // any more: the add names its list outright. What is left of the rule is the
    // one it always stated, that a trip's head is the basket's name and whether
    // it is live, so a write moving neither tells nobody.
    // Its own copy of the row, because the rename above writes through the one
    // the harness was handed.
    const w = build({ existing: { ...existing }, covering: COVERING });

    await w.service.update({
      userId: OWNER,
      generatedListId: 'gl-old',
      status: GeneratedListStatus.OPEN,
    });

    expect(w.tripsChanged).toEqual([]);
  });

  it('tells them when the basket is deleted, finished or not', async () => {
    const w = build({
      existing: { ...existing, status: GeneratedListStatus.FINISHED },
      covering: COVERING,
    });

    await w.service.delete({ userId: OWNER, generatedListId: 'gl-old' });

    expect(w.tripsChanged).toEqual([LIST_A, LIST_B]);
  });
});
