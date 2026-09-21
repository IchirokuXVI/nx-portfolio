import {
  BasketKind,
  GeneratedListStatus,
  ParticipantKind,
  RealtimeEvent,
  SettlementOutcome,
} from '@portfolio/luna-shopper/contracts';
import {
  DomainException,
  NotFoundException,
} from '@portfolio/luna-shopper/platform';
import type { DataSource } from 'typeorm';
import { fakeBasketAnnouncer } from '../baskets/basket-announcer.fake';
import { BasketDemandService } from '../baskets/basket-demand.service';
import { BasketLineAddService } from '../baskets/basket-line-add.service';
import type { BasketReadService } from '../baskets/basket-read.service';
import { BasketRevertService } from '../baskets/basket-revert.service';
import { BasketRowRenameService } from '../baskets/basket-row-rename.service';
import type { BasketRowResolver } from '../baskets/basket-row-resolver';
import { BasketSettleService } from '../baskets/basket-settle.service';
import { BasketWriteContext } from '../baskets/basket-write.context';
import type { GeneratedList } from '../entities';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import type { LineService } from '../lists/line.service';
import type { ListAccessService } from '../lists/list-access.service';
import type { ProfileService } from '../profiles/profile.service';
import {
  fakeBasketTripRows,
  fakeUpdateDataSource,
} from './basket-trip-rows.fake';
import type { GeneratedListSharingService } from './generated-list-sharing.service';
import { GeneratedListService } from './generated-list.service';
import type { ZoneLineClaimRef } from './line-claim.sql';
import { fakeLineClaims, type FakeLineClaims } from './line-claims.fake';

/**
 * Plan 0139 gave this service a basket announcer. Every write here is asserted
 * through the events it publishes, and the announcement is not one of them: it
 * is a nudge the basket rooms hear, tested in `basket-announcer.spec.ts`.
 */
const announcer = fakeBasketAnnouncer();

/**
 * A finished basket refuses every write (plan 0059, section 3).
 *
 * One test per write path, and the file exists to stop the gap reopening: the
 * refusal used to live in three of the basket's eight write paths, added as each
 * of plans 0055, 0057 and 0058 needed it, and the paths that predate them were
 * never revisited. The next write path to land goes in {@link WRITES} or this
 * file is the wrong shape.
 *
 * **There are five write paths since plan 0136**, not twelve. The stored basket
 * line is gone and with it the line add, the line edit, the delete, the reorder,
 * the split, the outstanding move, both origin writes and the guest composer
 * (section 10). Settle, revert, demand, add and rename act on a **row of list
 * lines** instead, and each of them asks the status the same way, immediately
 * after {@link BasketWriteContext.open} and before it resolves a row. The table
 * below is that list, and it shrinking is the point rather than a loss of
 * coverage: there are fewer places for the gap to reopen in.
 *
 * It asserts the **code**, `generated_list_finished`, and never the message. The
 * messages differ per path, and the code is what a client branches on (plan
 * 0054, section 4).
 *
 * Every service is constructed with the thinnest fakes that reach the guard, and
 * every write collaborator throws, so "writes nothing when it refuses" is a fact
 * about the harness surviving rather than about a spy that was not called. The
 * same table is run once more against an `OPEN` basket to prove each refusal
 * came from the status rather than from an earlier check the thin fakes tripped.
 */

const OWNER = 'u-owner';
const ACTOR = 'p-actor';
const BASKET = 'gl-1';
const ZONE = 'z-flat';
const LIST = 'l-flat';
const ZONE_LINE = 'zl-1';
const ITEM = 'item-1';
const FINISHED = 'generated_list_finished';

/** What the promise settled to: null on success, the domain code on refusal. */
async function codeOf(work: Promise<unknown>): Promise<string | null> {
  try {
    await work;
    return null;
  } catch (err) {
    if (err instanceof DomainException) {
      return err.code;
    }
    return `threw: ${(err as Error).message}`;
  }
}

function basketWith(status: GeneratedListStatus): GeneratedList {
  return {
    id: BASKET,
    ownerUserId: OWNER,
    kind: BasketKind.GENERATED,
    name: null,
    status,
    generatedAt: new Date('2026-08-28T10:00:00.000Z'),
    pricingProfileId: null,
    idempotencyKey: null,
  } as GeneratedList;
}

interface Harness {
  /** Every write of section 3.1's table, as plan 0136 section 5 leaves it. */
  writes: Record<string, () => Promise<unknown>>;
  /** Everything that was said out loud, which on a refusal must be nothing. */
  events: RealtimeEvent[];
  claims: FakeLineClaims;
  /** The write context every one of the five opens the basket through. */
  context: BasketWriteContext;
}

function build(status: GeneratedListStatus): Harness {
  const basket = basketWith(status);
  const events: RealtimeEvent[] = [];

  const refuse = (what: string) => () => {
    throw new Error(`a finished basket ${what}`);
  };

  const baskets = { findOne: async () => basket };
  const dataSource = {
    transaction: refuse('opened a transaction'),
  } as unknown as DataSource;

  const publisher = new Proxy({} as CoreEventsPublisher, {
    get:
      () =>
      (event: RealtimeEvent): void => {
        events.push(event);
      },
  });

  const claims = fakeLineClaims({}, () => [
    { zoneId: ZONE, listId: LIST, lineId: ZONE_LINE },
  ]);

  // A registered participant who passes every access rule, so that the only
  // thing standing between the request and the write is the basket's status.
  const participant = {
    id: ACTOR,
    userId: OWNER,
    kind: ParticipantKind.REGISTERED,
    generatedListId: BASKET,
    invitedAt: new Date('2026-08-28T10:00:00.000Z'),
  };
  const sharing = {
    liveParticipantById: async () => participant,
    livePresenceEntry: async () => ({
      participantId: ACTOR,
      kind: ParticipantKind.REGISTERED,
      displayName: null,
      guestNumber: null,
      userId: OWNER,
    }),
    ensureOwnerParticipant: async () => ({ id: ACTOR }),
    // The redaction, per list since plan 0136 section 3.4: this actor writes
    // the one list the basket covers, so nothing below is refused for want of
    // access and the status is left as the only reason a write can fail.
    writableAmong: async (_userId: string, listIds: string[]) =>
      new Set(listIds),
  } as unknown as GeneratedListSharingService;

  // The coverage, stated rather than queried: one list in one zone.
  const coverage = {
    listsOf: async () => [{ listId: LIST, zoneId: ZONE }],
  };

  // The resolver refuses every key, which is what lets the `OPEN` run below
  // prove the refusal it got was the status: a basket that is open gets past
  // the status check and fails here instead, with a different code.
  const resolver = {
    resolve: async () => {
      throw new NotFoundException('Row not found');
    },
  } as unknown as BasketRowResolver;

  const read = {
    view: refuse('read itself back'),
    progressOf: refuse('counted itself'),
  } as unknown as BasketReadService;

  const context = new BasketWriteContext(
    baskets as never,
    coverage as never,
    sharing,
    resolver,
    read,
    announcer
  );

  const zoneLines = {
    add: refuse('added a zone line'),
    addQuantity: refuse('changed what a list asks for'),
    rename: refuse('renamed a zone line'),
  } as unknown as LineService;
  const listAccess = {
    requireWrite: refuse('checked write access'),
    requireDecide: refuse('checked the demand rule'),
  } as unknown as ListAccessService;
  const profiles = {
    pricingProfileId: refuse('priced anything'),
  } as unknown as ProfileService;

  const settle = new BasketSettleService(
    dataSource,
    baskets as never,
    context,
    claims.service,
    publisher
  );
  const revert = new BasketRevertService(
    dataSource,
    context,
    claims.service,
    publisher
  );
  const demand = new BasketDemandService(
    context,
    zoneLines,
    listAccess,
    publisher
  );
  const add = new BasketLineAddService(context, zoneLines, profiles, publisher);
  const rename = new BasketRowRenameService(
    dataSource,
    context,
    zoneLines,
    listAccess,
    sharing,
    publisher
  );

  const writes: Harness['writes'] = {
    'settle a row': () =>
      settle.settle({
        basketId: BASKET,
        participantId: ACTOR,
        rowKey: ZONE_LINE,
        outcome: SettlementOutcome.BOUGHT,
        quantity: 1,
        from: 2,
      }),
    'take units back': () =>
      revert.revert({
        basketId: BASKET,
        participantId: ACTOR,
        rowKey: ZONE_LINE,
        target: 'UNITS',
        units: 1,
        from: 1,
      }),
    'change what a household asks for': () =>
      demand.setDemand({
        basketId: BASKET,
        participantId: ACTOR,
        rowKey: ZONE_LINE,
        quantity: 1,
        from: 2,
      }),
    'put a line on one of the basket’s lists': () =>
      add.add({
        basketId: BASKET,
        participantId: ACTOR,
        userId: OWNER,
        targetListId: LIST,
        content: 'Batteries',
        itemIds: [ITEM],
      }),
    'rename a row': () =>
      rename.rename({
        basketId: BASKET,
        participantId: ACTOR,
        userId: OWNER,
        rowKey: ZONE_LINE,
        content: 'Semi skimmed milk',
      }),
  };

  return { writes, events, claims, context };
}

const WRITES = Object.keys(build(GeneratedListStatus.FINISHED).writes);

describe('a finished basket refuses every write (section 3)', () => {
  it('covers every write a basket still has', () => {
    // Five, and the number is the plan's: settle, revert, demand, add and
    // rename (plan 0136, section 5). Twelve rows became five because eleven of
    // the old ones wrote to a table that no longer exists.
    expect(WRITES).toHaveLength(5);
  });

  describe.each(WRITES)('%s', (name) => {
    it('is refused on a FINISHED basket with the code the client branches on', async () => {
      const harness = build(GeneratedListStatus.FINISHED);
      expect(await codeOf(harness.writes[name]())).toBe(FINISHED);
    });

    it('is refused on an ARCHIVED basket the same way', async () => {
      const harness = build(GeneratedListStatus.ARCHIVED);
      expect(await codeOf(harness.writes[name]())).toBe(FINISHED);
    });

    it('says nothing and writes nothing when it refuses', async () => {
      const harness = build(GeneratedListStatus.FINISHED);
      await codeOf(harness.writes[name]());
      expect(harness.events).toEqual([]);
      expect(harness.claims.calls).toEqual([]);
    });

    it('asks the status before it resolves a row, so nothing is read first', async () => {
      // Was "leaves a purchase with no list where it is (plan 0093,
      // section 3.3)". Waiting settlements are deleted (plan 0136, section 9),
      // so the rule that replaces it is the one that made them unnecessary:
      // every one of the five asks the status immediately after
      // `BasketWriteContext.open` and before `opened.row(...)`. The harness's
      // resolver throws `not_found`, so a path that resolved first would answer
      // with that code instead of this one.
      const harness = build(GeneratedListStatus.FINISHED);
      expect(await codeOf(harness.writes[name]())).toBe(FINISHED);
    });

    it('gets past the status on an OPEN basket, so the refusal above was the status', async () => {
      const harness = build(GeneratedListStatus.OPEN);
      expect(await codeOf(harness.writes[name]())).not.toBe(FINISHED);
    });
  });
});

/**
 * Section 3.4: everything that is not a write still works, because a finished
 * trip is a receipt somebody will want to look at.
 */
describe('what a finished basket still does (section 3.4)', () => {
  it('still opens for a guest who was already in it', async () => {
    // Was "still answers the basket to a guest who was already in it", which
    // read through `GeneratedListBasketService.getBasket`. That service is
    // deleted (plan 0136, section 10) and the read is `BasketReadService`, which
    // has its own specs in `baskets/`. What this file can still say, and what
    // the test was always about, is that **the status gates the writes and
    // nothing else**: finishing revokes no participant, so the context every
    // write opens through resolves one on a finished basket and hands back the
    // basket, the coverage and the redaction. Each of the five then refuses on
    // its own, which is the table above.
    const harness = build(GeneratedListStatus.FINISHED);

    const opened = await harness.context.open({
      basketId: BASKET,
      participantId: ACTOR,
    });

    expect(opened.basket.status).toBe(GeneratedListStatus.FINISHED);
    expect(opened.participant.id).toBe(ACTOR);
    expect(opened.coveredListIds).toEqual([LIST]);
  });

  it('lists trips, and hides ARCHIVED among them', async () => {
    const clauses: string[] = [];
    const qb = {
      where: () => qb,
      andWhere: (clause: string) => {
        clauses.push(clause);
        return qb;
      },
      orderBy: () => qb,
      addOrderBy: () => qb,
      take: () => qb,
      getMany: async () => [],
    };
    const service = new GeneratedListService(
      {} as DataSource,
      { createQueryBuilder: () => qb } as never,
      {} as unknown as ProfileService,
      fakeLineClaims().service,
      {} as unknown as CoreEventsPublisher,
      {} as never,
      { find: async () => [] } as never,
      {} as never,
      {} as never
    );

    await service.listMine({ userId: OWNER });

    // The kind is asked on every listing and the status only when `ARCHIVED` is
    // not wanted: the history is the baskets somebody made, and the permanent
    // one was made by nobody (plan 0133, section 6).
    expect(clauses).toEqual(['gl.kind = :generated', 'gl.status != :archived']);
  });
});

/**
 * Section 2: finishing and unfinishing are the same route in two directions,
 * and the route answers nobody but the owner.
 */
describe('finishing and unfinishing (section 2)', () => {
  const CLAIMING: ZoneLineClaimRef[] = [
    { zoneId: ZONE, listId: LIST, lineId: ZONE_LINE },
    { zoneId: ZONE, listId: LIST, lineId: 'zl-2' },
  ];

  function owned(status: GeneratedListStatus) {
    const row = basketWith(status);
    const saved: GeneratedList[] = [];
    const events: {
      event: RealtimeEvent;
      userIds: readonly string[];
      basketIds: readonly string[];
      payload: unknown;
    }[] = [];
    const claims = fakeLineClaims({}, () => CLAIMING);
    // The lists told to read their trips again (plan 0122, section 6).
    const tripsChanged: (string | undefined)[] = [];
    const tripRows = fakeBasketTripRows();
    const lists = {
      // The one raw read an update makes: which lists the basket covers. Two
      // lines in one list, so the answer has to come back once.
      query: async () => [{ listId: LIST }],
      // The owner's `where`, honoured: anybody else gets not found.
      findOne: async ({
        where,
      }: {
        where: { id: string; ownerUserId: string };
      }) =>
        where.id === row.id && where.ownerUserId === row.ownerUserId
          ? row
          : null,
      save: async (list: GeneratedList) => {
        saved.push({ ...list });
        return list;
      },
    };
    const service = new GeneratedListService(
      fakeUpdateDataSource(lists),
      lists as never,
      {} as unknown as ProfileService,
      claims.service,
      {
        emitToUsers: (
          event: RealtimeEvent,
          userIds: readonly string[],
          payload: unknown
        ) => {
          events.push({ event, userIds, basketIds: [], payload });
        },
        emitTo: (
          event: RealtimeEvent,
          audience: {
            listId?: string;
            userIds?: readonly string[];
            basketIds?: readonly string[];
          },
          payload: unknown
        ) => {
          if (event === RealtimeEvent.ListTripsChanged) {
            tripsChanged.push(audience.listId);
            return;
          }
          // `basket.updated` names two audiences since plan 0139: the owner's
          // own sessions and the basket's room.
          events.push({
            event,
            userIds: audience.userIds ?? [],
            basketIds: audience.basketIds ?? [],
            payload,
          });
        },
      } as unknown as CoreEventsPublisher,
      {} as never,
      { find: async () => [] } as never,
      tripRows.service,
      {} as never
    );
    return { service, saved, events, claims, tripsChanged, tripRows };
  }

  it('unfinishes through the same PATCH, and the claims come back with it', async () => {
    const w = owned(GeneratedListStatus.FINISHED);

    const view = await w.service.update({
      userId: OWNER,
      generatedListId: BASKET,
      status: GeneratedListStatus.OPEN,
    });

    expect(view.status).toBe(GeneratedListStatus.OPEN);
    // Two audiences since plan 0139 section 4: the owner's own sessions, as
    // before, and the basket's own room, where a reopen used to reach nobody.
    // The payload is the four header fields rather than the whole view, which
    // names the basket's sources and a guest is in the room.
    expect(w.events).toEqual([
      {
        event: RealtimeEvent.BasketUpdated,
        userIds: [OWNER],
        basketIds: [BASKET],
        payload: {
          basketId: BASKET,
          kind: BasketKind.GENERATED,
          name: view.name,
          status: GeneratedListStatus.OPEN,
        },
      },
    ]);
    // Re-announced as claimed by the owner, which is what a cold read would now
    // say, so a live socket shows no less than a refresh (section 2.2).
    expect(w.claims.calls).toEqual([
      {
        claimed: true,
        claimedByUserId: OWNER,
        lineIds: [ZONE_LINE, 'zl-2'],
      },
    ]);
    // And the trip rows frozen at the finish are thawed in the same transaction
    // (plan 0136, section 6): a basket has rows in `basket_trip_rows` exactly
    // while it is not `OPEN`.
    expect(w.tripRows.calls).toEqual([{ call: 'thaw', basketId: BASKET }]);
    // And the list it covers reads its trips again (plan 0122, section 6): a
    // trip's head says whether it is live, and that has just changed.
    expect(w.tripsChanged).toEqual([LIST]);
  });

  it('answers not found to a participant who is not the owner, and moves nothing', async () => {
    const w = owned(GeneratedListStatus.OPEN);

    await expect(
      w.service.update({
        userId: 'u-registered-participant',
        generatedListId: BASKET,
        status: GeneratedListStatus.FINISHED,
      })
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(w.saved).toEqual([]);
    expect(w.events).toEqual([]);
    expect(w.claims.calls).toEqual([]);
    expect(w.tripRows.calls).toEqual([]);
    expect(w.tripsChanged).toEqual([]);
  });
});
