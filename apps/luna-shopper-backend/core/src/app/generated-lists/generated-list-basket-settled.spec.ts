import {
  SettlementOutcome,
  type GeneratedListBasketLineView,
  type GeneratedListView,
} from '@portfolio/luna-shopper/contracts';
import type { DataSource, FindManyOptions } from 'typeorm';
import type {
  GeneratedListLine,
  GeneratedListLineOrigin,
  LineSettlement,
} from '../entities';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import type { ProfileService } from '../profiles/profile.service';
import { GeneratedListService } from './generated-list.service';
import { fakeLineClaims } from './line-claims.fake';

/**
 * What each origin got (plan 0109, section 4).
 *
 * A basket line sums what several households asked for, and the page draws one
 * row per household under a list heading. Without this number such a row has a
 * target and no starting point: it can say a list asked for six and cannot say
 * how many of the six are already in the trolley.
 *
 * It is the number `GeneratedListOriginsService.settledPerOrigin` already
 * answers one line at a time, and the rules it encodes are asserted here because
 * they are exactly what cannot be derived from the line: a reverted purchase was
 * given back, and a shop that had none bought nothing.
 *
 * Faked at the repository boundary, in the style `waiting-settlement.spec.ts`
 * established. The settlements repository is counted, because section 4 says the
 * whole basket costs one read of it rather than one per line.
 */

const BASKET = 'gl-1';
const LINE_A = 'gll-a';
const LINE_B = 'gll-b';
const ZONE = 'z-flat';
const LIST_FLAT = 'l-flat';
const LIST_MUM = 'l-mum';
/** The zone lines the origins point at, which is what a purchase lands on. */
const ZONE_LINE_FLAT = 'zl-flat';
const ZONE_LINE_MUM = 'zl-mum';

const origin = (
  id: string,
  over: Partial<GeneratedListLineOrigin> = {}
): GeneratedListLineOrigin =>
  ({
    id,
    generatedListLineId: LINE_A,
    zoneId: ZONE,
    listId: LIST_FLAT,
    lineId: ZONE_LINE_FLAT,
    quantity: 6,
    lineVersion: 1,
    createdAt: new Date('2026-01-01T09:00:00.000Z'),
    ...over,
  }) as GeneratedListLineOrigin;

const settlement = (over: Partial<LineSettlement> = {}): LineSettlement =>
  ({
    id: 's1',
    generatedListLineId: LINE_A,
    lineId: ZONE_LINE_FLAT,
    listId: LIST_FLAT,
    outcome: SettlementOutcome.BOUGHT,
    quantity: 2,
    settledAt: new Date('2026-01-02T10:00:00.000Z'),
    revertedAt: null,
    ...over,
  }) as LineSettlement;

const line = (id: string): GeneratedListLine =>
  ({
    id,
    generatedListId: BASKET,
    content: 'Milk',
    quantity: 6,
    settledQuantity: 0,
    itemId: null,
    position: 1,
    origin: 'DERIVED',
    targetListId: null,
  }) as unknown as GeneratedListLine;

interface World {
  readonly lines?: GeneratedListLine[];
  readonly origins?: GeneratedListLineOrigin[];
  readonly settlements?: LineSettlement[];
}

function build(world: World = {}) {
  /** Every read of the settlements table, so both the count and the filter. */
  const settlementReads: FindManyOptions<LineSettlement>[] = [];
  const service = new GeneratedListService(
    { transaction: async () => undefined } as unknown as DataSource,
    {} as never,
    { find: async () => world.lines ?? [line(LINE_A)] } as never,
    { find: async () => world.origins ?? [origin('o-flat')] } as never,
    { find: async () => [] } as never,
    {
      find: async (options: FindManyOptions<LineSettlement>) => {
        settlementReads.push(options);
        return world.settlements ?? [];
      },
    } as never,
    {} as unknown as ProfileService,
    fakeLineClaims({}).service,
    { emitToUsers: () => undefined } as unknown as CoreEventsPublisher,
    {} as never
  );
  return { service, reads: () => settlementReads };
}

const basket = (
  world: World,
  seesZoneData = true
): Promise<GeneratedListBasketLineView[]> =>
  build(world).service.basketLineViewsFor(BASKET, seesZoneData);

const owner = (world: World): Promise<GeneratedListView['lines']> =>
  build(world).service.lineViewsFor(BASKET);

describe('what each origin got (plan 0109, section 4)', () => {
  it('sums the live purchases made for that origin', async () => {
    const lines = await basket({
      settlements: [
        settlement({ id: 's1', quantity: 2 }),
        settlement({ id: 's2', quantity: 1 }),
      ],
    });

    expect(lines[0].origins?.[0]).toMatchObject({
      id: 'o-flat',
      quantity: 6,
      settled: 3,
    });
  });

  it('counts each origin separately, on the zone line the purchase landed on', async () => {
    // One basket line summing two households. A purchase settles against the
    // zone line it was allocated to, which is what an origin row is unique on
    // beside its basket line.
    const lines = await basket({
      origins: [
        origin('o-flat'),
        origin('o-mum', { listId: LIST_MUM, lineId: ZONE_LINE_MUM }),
      ],
      settlements: [
        settlement({ id: 's1', quantity: 2 }),
        settlement({
          id: 's2',
          quantity: 5,
          lineId: ZONE_LINE_MUM,
          listId: LIST_MUM,
        }),
      ],
    });

    expect(lines[0].origins?.map((row) => [row.listId, row.settled])).toEqual([
      [LIST_FLAT, 2],
      [LIST_MUM, 5],
    ]);
  });

  it('never sees a purchase somebody took back', async () => {
    // Plan 0054, section 3.3: a reverted settlement says nothing about the line
    // any more, and counting it would hold units against a list that has already
    // given them back.
    //
    // Asserted on the filter rather than on the answer, because that is where
    // the rule lives: the rows never reach this service, so a fake that handed
    // them over anyway would be testing a query it had just replaced. It is the
    // same clause `waitingSettled` is already read under, which is the point of
    // reading both off one query.
    const harness = build({ settlements: [settlement({ id: 's1' })] });

    await harness.service.basketLineViewsFor(BASKET, true);

    const where = harness.reads()[0].where as Record<string, { type?: string }>;
    expect(where['revertedAt'].type).toBe('isNull');
  });

  it('counts a shop that had none as zero, and not as a purchase', async () => {
    // `NOT_AVAILABLE` closes the outstanding amount without buying anything, so
    // it cannot raise what a household can be said to have received.
    const lines = await basket({
      settlements: [
        settlement({
          id: 's1',
          outcome: SettlementOutcome.NOT_AVAILABLE,
          quantity: 0,
        }),
      ],
    });

    expect(lines[0].origins?.[0].settled).toBe(0);
  });

  it('is zero for an origin nothing has been bought for', async () => {
    expect((await basket({})).at(0)?.origins?.[0].settled).toBe(0);
  });

  it('does not count a purchase made before the line reached any list', async () => {
    // A waiting settlement belongs to no origin (plan 0093, section 2.2), and
    // it is already reported on the line itself as `waitingSettled`.
    const lines = await basket({
      settlements: [settlement({ id: 's1', lineId: null, listId: null })],
    });

    expect(lines[0].origins?.[0].settled).toBe(0);
    expect(lines[0].waitingSettled).toBe(2);
  });

  it('rides on the origins, so a guest is told neither', async () => {
    // Section 5.2 redacts by absence, and this number names a zone line. A
    // reader who is not told where a line came from is not told what that place
    // has received either.
    const lines = await basket(
      { settlements: [settlement({ id: 's1', quantity: 2 })] },
      false
    );

    expect(lines[0].origins).toBeUndefined();
  });

  it('costs the basket one read of the settlements, not one per line', async () => {
    // Section 4: computed once for the whole basket. The facts the read already
    // needed and this number come off the same rows, so a second line adds no
    // query at all.
    const harness = build({
      lines: [line(LINE_A), line(LINE_B)],
      origins: [
        origin('o-flat'),
        origin('o-b', { generatedListLineId: LINE_B, lineId: ZONE_LINE_MUM }),
      ],
      settlements: [
        settlement({ id: 's1', quantity: 2 }),
        settlement({
          id: 's2',
          quantity: 4,
          generatedListLineId: LINE_B,
          lineId: ZONE_LINE_MUM,
        }),
      ],
    });

    const lines = await harness.service.basketLineViewsFor(BASKET, true);

    expect(lines.map((row) => row.origins?.[0].settled)).toEqual([2, 4]);
    expect(harness.reads()).toHaveLength(1);
  });

  it('reaches the read the owner makes of their own basket', async () => {
    // `GeneratedListLineOriginView` is one shape and the field is required on
    // it, so a read that answered origins without the number would be a second
    // answer to the same question.
    const lines = await owner({
      settlements: [settlement({ id: 's1', quantity: 2 })],
    });

    expect(lines[0].origins[0].settled).toBe(2);
  });
});
