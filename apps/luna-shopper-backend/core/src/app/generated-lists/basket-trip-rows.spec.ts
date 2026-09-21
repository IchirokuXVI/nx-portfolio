import {
  BasketKind,
  GeneratedListStatus,
  RealtimeEvent,
} from '@portfolio/luna-shopper/contracts';
import type { GeneratedList } from '../entities';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import type { ProfileService } from '../profiles/profile.service';
import {
  fakeBasketTripRows,
  fakeUpdateDataSource,
  type FakeBasketTripRows,
} from './basket-trip-rows.fake';
import { GeneratedListService } from './generated-list.service';
import { fakeLineClaims } from './line-claims.fake';

/**
 * The numbers are frozen by the finish (plan 0135, sections 3.1 and 9, tests 1
 * and 2).
 *
 * The invariant is "a basket has trip rows exactly while it is not `OPEN`", and
 * the integration spec is what proves it against a database. What is proved here
 * is the decision: which transition calls which of the two, that a rename and a
 * status set to itself call neither, and that the write happens before the
 * announcements rather than beside them.
 *
 * Plan 0136 section 6 changes **where the freeze reads from** and nothing about
 * that decision: `BASKET_TRIP_ROWS_FREEZE_SQL` composes each trip's ask from the
 * covered lines instead of from the deleted origin rows. That is the seam the
 * fake stands in for, which is why this file did not have to move with it.
 */

const OWNER = 'u-owner';
const BASKET = 'gl-1';
const LIST = 'l-flat';

const { OPEN, FINISHED, ARCHIVED } = GeneratedListStatus;

function basketWith(status: GeneratedListStatus): GeneratedList {
  return {
    id: BASKET,
    ownerUserId: OWNER,
    kind: BasketKind.GENERATED,
    name: 'Saturday',
    status,
    generatedAt: new Date('2026-03-01T10:00:00.000Z'),
    pricingProfileId: null,
    idempotencyKey: null,
  } as GeneratedList;
}

interface Harness {
  service: GeneratedListService;
  row: GeneratedList;
  tripRows: FakeBasketTripRows;
  events: RealtimeEvent[];
  claims: ReturnType<typeof fakeLineClaims>;
}

function build(
  status: GeneratedListStatus,
  throwOn?: 'freeze' | 'thaw'
): Harness {
  const row = basketWith(status);
  const events: RealtimeEvent[] = [];
  const claims = fakeLineClaims({}, () => [
    { zoneId: 'z-home', listId: LIST, lineId: 'li-1' },
  ]);
  const tripRows = fakeBasketTripRows(throwOn);

  const lists = {
    findOne: async ({ where }: { where: { id: string } }) =>
      where.id === row.id ? row : null,
    save: async (list: GeneratedList) => list,
    // The one raw read an update makes: which lists the basket covers.
    query: async () => [{ listId: LIST }],
  };

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

  return { service, row, tripRows, events, claims };
}

describe('which transition freezes and which thaws (section 3.1)', () => {
  it.each([
    [
      'open to finished',
      OPEN,
      FINISHED,
      [{ call: 'freeze', basketId: BASKET }],
    ],
    [
      'open to archived',
      OPEN,
      ARCHIVED,
      [{ call: 'freeze', basketId: BASKET }],
    ],
    ['finished to open', FINISHED, OPEN, [{ call: 'thaw', basketId: BASKET }]],
    ['archived to open', ARCHIVED, OPEN, [{ call: 'thaw', basketId: BASKET }]],
    ['finished to archived', FINISHED, ARCHIVED, []],
    ['archived to finished', ARCHIVED, FINISHED, []],
    ['open to open', OPEN, OPEN, []],
    ['finished to finished', FINISHED, FINISHED, []],
  ])(
    '%s',
    async (
      _name,
      from: GeneratedListStatus,
      to: GeneratedListStatus,
      expected: { call: string; basketId: string }[]
    ) => {
      const w = build(from);

      await w.service.update({
        userId: OWNER,
        generatedListId: BASKET,
        status: to,
      });

      expect(w.tripRows.calls).toEqual(expected);
    }
  );

  it('says nothing on a rename, which moves no status', async () => {
    // Archiving says nothing about whether a basket was shopped (plan 0110),
    // and a rename says nothing about anything: the ask is unchanged, so the
    // rows it already has are the rows it keeps.
    const w = build(FINISHED);

    await w.service.update({
      userId: OWNER,
      generatedListId: BASKET,
      name: 'Sunday',
    });

    expect(w.tripRows.calls).toEqual([]);
  });

  it('says nothing on a write that carries neither field', async () => {
    // Was "says nothing when only the default target list moved".
    // `defaultTargetListId` is deleted (plan 0136, sections 9 and 10), and what
    // it stood for here is any write that moves no status: the ask is
    // unchanged, so the rows it already has are the rows it keeps.
    const w = build(OPEN);

    await w.service.update({ userId: OWNER, generatedListId: BASKET });

    expect(w.tripRows.calls).toEqual([]);
  });
});

describe('the freeze is inside the write and before the announcements', () => {
  it('freezes before the claim release is announced', async () => {
    // Both happen on the same finish, and the order is the point: the rows are
    // written in the transaction that moved the status, and everything a client
    // hears is told afterwards, off the committed row.
    const w = build(OPEN);
    const order: string[] = [];
    w.claims.service.announceReleased = async () => {
      order.push('announced');
    };
    const freeze = w.tripRows.service.freeze.bind(w.tripRows.service);
    w.tripRows.service.freeze = async (manager, basketId) => {
      order.push('froze');
      return freeze(manager, basketId);
    };

    await w.service.update({
      userId: OWNER,
      generatedListId: BASKET,
      status: FINISHED,
    });

    expect(order).toEqual(['froze', 'announced']);
  });

  it('a freeze that throws announces nothing', async () => {
    // The announcements are after the commit, so a freeze that fails reaches
    // none of them. That the status goes back with it is the transaction's
    // doing, which only a real database can show: the integration spec's
    // invariant test is where that is proved.
    const w = build(OPEN, 'freeze');

    await expect(
      w.service.update({
        userId: OWNER,
        generatedListId: BASKET,
        status: FINISHED,
      })
    ).rejects.toThrow('the freeze failed');

    expect(w.events).toEqual([]);
    expect(w.claims.calls).toEqual([]);
  });
});
