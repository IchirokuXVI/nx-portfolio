import {
  GeneratedLineOrigin,
  GeneratedListStatus,
  ParticipantKind,
  RealtimeEvent,
  SettlementOutcome,
  type GeneratedListView,
} from '@portfolio/luna-shopper/contracts';
import {
  DomainException,
  NotFoundException,
} from '@portfolio/luna-shopper/platform';
import type { DataSource } from 'typeorm';
import type { GeneratedList, GeneratedListLine } from '../entities';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import type { LineService } from '../lists/line.service';
import type { ListAccessService } from '../lists/list-access.service';
import type { ProfileService } from '../profiles/profile.service';
import { GeneratedListBasketService } from './generated-list-basket.service';
import { GeneratedListBindService } from './generated-list-bind.service';
import { GeneratedListLineService } from './generated-list-line.service';
import { GeneratedListOriginsService } from './generated-list-origins.service';
import { GeneratedListOutstandingService } from './generated-list-outstanding.service';
import { GeneratedListReopenService } from './generated-list-reopen.service';
import { GeneratedListSettleService } from './generated-list-settle.service';
import type { GeneratedListSharingService } from './generated-list-sharing.service';
import { GeneratedListService } from './generated-list.service';
import type { ZoneLineClaimRef } from './line-claim.sql';
import { fakeLineClaims, type FakeLineClaims } from './line-claims.fake';

/**
 * A finished basket refuses every write (plan 0059, section 3).
 *
 * One test per write path, and the file exists to stop the gap reopening: the
 * refusal used to live in three of the basket's eight write paths, added as each
 * of plans 0055, 0057 and 0058 needed it, and the paths that predate them were
 * never revisited. The next write path to land goes in {@link WRITES} or this
 * file is the wrong shape.
 *
 * It asserts the **code**, `generated_list_finished`, and never the message. The
 * messages differ per path, and the code is what a client branches on (plan
 * 0054, section 4).
 *
 * Every service is constructed with the thinnest fakes that reach the guard, and
 * every write repository throws, so "writes nothing when it refuses" is a fact
 * about the harness surviving rather than about a spy that was not called. The
 * same table is run once more against an `ACTIVE` basket to prove each refusal
 * came from the status rather than from an earlier check the thin fakes tripped.
 */

const OWNER = 'u-owner';
const ACTOR = 'p-actor';
const BASKET = 'gl-1';
const LINE = 'gll-1';
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
    name: null,
    status,
    generatedAt: new Date('2026-08-28T10:00:00.000Z'),
    sourceSnapshot: {
      profileId: null,
      sources: [{ zoneId: ZONE, listIds: [LIST] }],
    },
    defaultTargetListId: null,
    idempotencyKey: null,
  } as GeneratedList;
}

function lineOf(basket: GeneratedList): GeneratedListLine {
  return {
    id: LINE,
    generatedListId: basket.id,
    content: 'Milk',
    quantity: 2,
    settledQuantity: 1,
    itemId: null,
    origin: GeneratedLineOrigin.ADDED,
    targetListId: null,
    position: 1,
  } as GeneratedListLine;
}

interface Harness {
  /** Every write of section 3.1's table, plus the two the table omits. */
  writes: Record<string, () => Promise<unknown>>;
  /** Everything that was said out loud, which on a refusal must be nothing. */
  events: RealtimeEvent[];
  claims: FakeLineClaims;
}

function build(status: GeneratedListStatus): Harness {
  const basket = basketWith(status);
  const line = lineOf(basket);
  const events: RealtimeEvent[] = [];

  const refuse = (what: string) => () => {
    throw new Error(`a finished basket ${what}`);
  };

  const lists = { findOne: async () => basket };
  const lines = {
    findOne: async () => line,
    find: async () => [line],
    count: async () => 1,
    save: refuse('saved a line'),
    delete: refuse('deleted a line'),
  };
  const options = {
    findOne: async () => ({ generatedListLineId: LINE, itemId: ITEM }),
    find: async () => [],
    insert: refuse('inserted an option'),
  };
  const origins = {
    findOne: async () => ({
      generatedListLineId: LINE,
      lineId: ZONE_LINE,
      listId: LIST,
      quantity: 2,
    }),
    find: async () => [],
  };
  const zoneLines = {
    findOne: async () => ({ id: ZONE_LINE, listId: LIST, quantity: 2 }),
    find: async () => [],
    save: refuse('saved a zone line'),
  };
  const noRows = { find: async () => [], findOne: async () => null };
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
    seesZoneData: async () => true,
    ensureOwnerParticipant: async () => ({ id: ACTOR }),
    writableAmong: async (listIds: string[]) => listIds,
    writableIntersection: async (listIds: string[]) => listIds,
  } as unknown as GeneratedListSharingService;

  const generated = {
    load: async () => basket,
    viewFor: async () => ({ id: BASKET }),
    lineViewFor: async () => ({ id: LINE }),
    basketLineViewFor: async () => ({ id: LINE }),
    basketLineViewsFor: async () => [],
  } as unknown as GeneratedListService;

  const lineWrites = new GeneratedListLineService(
    lines as never,
    options as never,
    generated,
    {} as unknown as ListAccessService,
    {} as unknown as LineService,
    claims.service,
    sharing,
    publisher
  );
  const settle = new GeneratedListSettleService(
    dataSource,
    lists as never,
    lines as never,
    origins as never,
    options as never,
    noRows as never,
    sharing,
    generated,
    claims.service,
    publisher
  );
  const reopen = new GeneratedListReopenService(
    dataSource,
    lists as never,
    lines as never,
    sharing,
    generated,
    claims.service,
    publisher
  );
  const outstanding = new GeneratedListOutstandingService(
    dataSource,
    lists as never,
    lines as never,
    sharing,
    generated,
    settle,
    publisher
  );
  const basketWrites = new GeneratedListBasketService(
    lists as never,
    lines as never,
    options as never,
    noRows as never,
    generated,
    sharing,
    lineWrites,
    publisher
  );
  const bind = new GeneratedListBindService(
    lists as never,
    lines as never,
    noRows as never,
    sharing,
    generated,
    lineWrites,
    claims.service,
    publisher
  );
  const originWrites = new GeneratedListOriginsService(
    dataSource,
    lists as never,
    lines as never,
    origins as never,
    zoneLines as never,
    noRows as never,
    noRows as never,
    sharing,
    generated,
    claims.service,
    publisher
  );

  const writes: Harness['writes'] = {
    'settle a line': () =>
      settle.settle({
        generatedListId: BASKET,
        lineId: LINE,
        participantId: ACTOR,
        outcome: SettlementOutcome.BOUGHT,
      }),
    'reopen a settled line': () =>
      reopen.reopen({
        generatedListId: BASKET,
        lineId: LINE,
        participantId: ACTOR,
      }),
    'owner adds a line': () =>
      lineWrites.addLine({
        userId: OWNER,
        generatedListId: BASKET,
        content: 'Bread',
      }),
    'owner edits a line': () =>
      lineWrites.updateLine({
        userId: OWNER,
        generatedListId: BASKET,
        lineId: LINE,
        quantity: 3,
      }),
    'owner deletes a line': () =>
      lineWrites.deleteLine({
        userId: OWNER,
        generatedListId: BASKET,
        lineId: LINE,
      }),
    'owner reorders the lines': () =>
      lineWrites.reorderLines({
        userId: OWNER,
        generatedListId: BASKET,
        lineIds: [LINE],
      }),
    'swap the product pick': () =>
      basketWrites.setPick({
        generatedListId: BASKET,
        lineId: LINE,
        participantId: ACTOR,
        itemId: ITEM,
      }),
    'participant adds a line': () =>
      basketWrites.addLine({
        generatedListId: BASKET,
        participantId: ACTOR,
        content: 'Batteries',
      }),
    'move what is outstanding': () =>
      outstanding.setOutstanding({
        generatedListId: BASKET,
        lineId: LINE,
        participantId: ACTOR,
        outstanding: 0,
        from: 1,
      }),
    'bind an added line to a list': () =>
      bind.bindLine({
        generatedListId: BASKET,
        lineId: LINE,
        participantId: ACTOR,
        listId: LIST,
      }),
    'change what a household asked for': () =>
      originWrites.setOriginQuantity({
        generatedListId: BASKET,
        lineId: LINE,
        participantId: ACTOR,
        sourceListId: LIST,
        sourceLineId: ZONE_LINE,
        quantity: 1,
        from: 2,
      }),
  };

  return { writes, events, claims };
}

const WRITES = Object.keys(build(GeneratedListStatus.COMPLETED).writes);

describe('a finished basket refuses every write (section 3)', () => {
  it('covers every row of the table, and the two rows it omits', () => {
    // Nine rows in section 3.1, plus reorder (which saves every line of the
    // basket) and the origin quantity edit (which saves the basket line as well
    // as the zone line). Section 3.2's one rule covers both.
    expect(WRITES).toHaveLength(11);
  });

  describe.each(WRITES)('%s', (name) => {
    it('is refused on a COMPLETED basket with the code the client branches on', async () => {
      const harness = build(GeneratedListStatus.COMPLETED);
      expect(await codeOf(harness.writes[name]())).toBe(FINISHED);
    });

    it('is refused on an ARCHIVED basket the same way', async () => {
      const harness = build(GeneratedListStatus.ARCHIVED);
      expect(await codeOf(harness.writes[name]())).toBe(FINISHED);
    });

    it('says nothing and writes nothing when it refuses', async () => {
      const harness = build(GeneratedListStatus.COMPLETED);
      await codeOf(harness.writes[name]());
      expect(harness.events).toEqual([]);
      expect(harness.claims.calls).toEqual([]);
    });

    it('gets past the status on an ACTIVE basket, so the refusal above was the status', async () => {
      const harness = build(GeneratedListStatus.ACTIVE);
      expect(await codeOf(harness.writes[name]())).not.toBe(FINISHED);
    });
  });
});

/**
 * Section 3.4: everything that is not a write still works, because a finished
 * trip is a receipt somebody will want to look at.
 */
describe('what a finished basket still does (section 3.4)', () => {
  it('still answers the basket to a guest who was already in it', async () => {
    const basket = basketWith(GeneratedListStatus.COMPLETED);
    const guest = {
      id: 'p-guest',
      userId: null,
      kind: ParticipantKind.GUEST,
      generatedListId: BASKET,
    };
    const sharing = {
      // The participant row is still live: finishing revokes nobody.
      liveParticipantById: async () => guest,
      seesZoneData: async () => false,
      listParticipants: async () => ({
        participants: [{ id: 'p-guest', kind: ParticipantKind.GUEST }],
      }),
    } as unknown as GeneratedListSharingService;
    const generated = {
      basketLineViewsFor: async () => [{ id: LINE }],
    } as unknown as GeneratedListService;

    const service = new GeneratedListBasketService(
      { findOne: async () => basket } as never,
      {} as never,
      {} as never,
      {} as never,
      generated,
      sharing,
      {} as unknown as GeneratedListLineService,
      {} as unknown as CoreEventsPublisher
    );

    const view = await service.getBasket({
      generatedListId: BASKET,
      participantId: 'p-guest',
    });

    // The read carries the status rather than hiding the basket, which is what
    // lets the screen draw the trip as over instead of drawing a 404.
    expect(view.status).toBe(GeneratedListStatus.COMPLETED);
    expect(view.me.id).toBe('p-guest');
    expect(view.lines).toEqual([{ id: LINE }]);
  });

  it('still lists it in the history, which hides ARCHIVED alone', async () => {
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
      { query: async () => [] } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as unknown as ProfileService,
      fakeLineClaims().service,
      {} as unknown as CoreEventsPublisher
    );

    await service.listMine({ userId: OWNER });

    expect(clauses).toEqual(['gl.status != :archived']);
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
      view: GeneratedListView;
    }[] = [];
    const claims = fakeLineClaims({}, () => CLAIMING);
    const service = new GeneratedListService(
      {} as DataSource,
      {
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
      } as never,
      { find: async () => [] } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as unknown as ProfileService,
      claims.service,
      {
        emitToUsers: (
          event: RealtimeEvent,
          userIds: readonly string[],
          view: GeneratedListView
        ) => {
          events.push({ event, userIds, view });
        },
      } as unknown as CoreEventsPublisher
    );
    return { service, saved, events, claims };
  }

  it('unfinishes through the same PATCH, and the claims come back with it', async () => {
    const w = owned(GeneratedListStatus.COMPLETED);

    const view = await w.service.update({
      userId: OWNER,
      generatedListId: BASKET,
      status: GeneratedListStatus.ACTIVE,
    });

    expect(view.status).toBe(GeneratedListStatus.ACTIVE);
    expect(w.events).toEqual([
      {
        event: RealtimeEvent.GeneratedListUpdated,
        userIds: [OWNER],
        view,
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
  });

  it('answers not found to a participant who is not the owner, and moves nothing', async () => {
    const w = owned(GeneratedListStatus.ACTIVE);

    await expect(
      w.service.update({
        userId: 'u-registered-participant',
        generatedListId: BASKET,
        status: GeneratedListStatus.COMPLETED,
      })
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(w.saved).toEqual([]);
    expect(w.events).toEqual([]);
    expect(w.claims.calls).toEqual([]);
  });
});
