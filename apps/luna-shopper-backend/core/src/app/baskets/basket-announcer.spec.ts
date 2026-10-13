import {
  BASKET_LIMITS,
  BasketKind,
  BasketRowState,
  LineApprovalStatus,
  RealtimeEvent,
  type BasketEntryPatch,
  type BasketLinesChangedEvent,
} from '@portfolio/luna-shopper/contracts';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import { BasketAnnouncer } from './basket-announcer.service';
import type { BasketCoverageService } from './basket-coverage.service';
import type { CoveringBasket } from './basket-coverage.sql';
import type { BasketPatchReader, PatchedBasket } from './basket-patch.reader';

/**
 * Who hears that a write reached a basket (plan 0139, section 3).
 *
 * The coverage query itself is proven against a real database in
 * `basket-coverage.integration.spec.ts`. What is decided here is what the
 * announcer does with the answer: the audience it composes, the one event per
 * write, and the failure it swallows.
 */

interface Harness {
  announcer: BasketAnnouncer;
  emitted: {
    event: RealtimeEvent;
    basketIds: readonly string[];
    userIds: readonly string[];
    payload: BasketLinesChangedEvent;
  }[];
  errors: unknown[][];
  /** Every patch that was asked for, in the order it was asked. */
  asked: { basketId: string; listIds: string[]; lineIds: string[] }[];
}

function build(options: {
  covering?: CoveringBasket[];
  zoneBaskets?: CoveringBasket[];
  fails?: boolean;
  /** What each basket reads of the lines. A basket named here with `'throws'` fails. */
  patches?: Record<string, BasketEntryPatch[] | 'throws'>;
}): Harness {
  const emitted: Harness['emitted'] = [];
  const errors: unknown[][] = [];
  const asked: Harness['asked'] = [];

  const patches = {
    entriesOf: async (
      target: PatchedBasket,
      listIds: readonly string[],
      lineIds: readonly string[]
    ) => {
      asked.push({
        basketId: target.basketId,
        listIds: [...listIds],
        lineIds: [...lineIds],
      });
      const answer = options.patches?.[target.basketId] ?? [];
      if (answer === 'throws') {
        throw new Error('the patch read failed');
      }
      return answer;
    },
  } as unknown as BasketPatchReader;

  const coverage = {
    coveringBaskets: async () => {
      if (options.fails) {
        throw new Error('the pool is gone');
      }
      return options.covering ?? [];
    },
    basketsOfZoneMembers: async () => {
      if (options.fails) {
        throw new Error('the pool is gone');
      }
      return options.zoneBaskets ?? [];
    },
  } as unknown as BasketCoverageService;

  const events = {
    emitTo: (
      event: RealtimeEvent,
      audience: { basketIds?: readonly string[]; userIds?: readonly string[] },
      payload: BasketLinesChangedEvent
    ) => {
      emitted.push({
        event,
        basketIds: audience.basketIds ?? [],
        userIds: audience.userIds ?? [],
        payload,
      });
    },
  } as unknown as CoreEventsPublisher;

  const announcer = new BasketAnnouncer(coverage, events, patches);
  (announcer as unknown as { logger: { error: unknown } }).logger = {
    error: (...args: unknown[]) => errors.push(args),
  };
  return { announcer, emitted, errors, asked };
}

const basket = (
  id: string,
  owner: string,
  kind: BasketKind = BasketKind.LIVE
): CoveringBasket => ({
  basketId: id,
  ownerUserId: owner,
  kind,
});

/** One line as one basket reads it. Only the numbers differ between baskets. */
const patch = (
  lineId: string,
  over: Partial<BasketEntryPatch> = {}
): BasketEntryPatch => ({
  lineId,
  version: 2,
  left: 2,
  bought: 0,
  boughtElsewhere: 0,
  state: BasketRowState.WANTED,
  approvalStatus: LineApprovalStatus.APPROVED,
  skipped: false,
  closed: false,
  act: null,
  // No buy in this trip named a product (plan 0201, section 1).
  tripItemId: null,
  ...over,
});

/** Let the announcements that were not awaited run to their publish. */
const settled = () => new Promise((resolve) => setImmediate(resolve));

describe('BasketAnnouncer.linesChanged', () => {
  it('names every covering basket and every owner on one event', async () => {
    const h = build({
      covering: [basket('b1', 'u-ana'), basket('b2', 'u-luis')],
    });

    await h.announcer.linesChanged('l1', ['li-1']);

    expect(h.emitted).toEqual([
      {
        event: RealtimeEvent.BasketLinesChanged,
        basketIds: ['b1', 'b2'],
        userIds: ['u-ana', 'u-luis'],
        payload: { lineIds: ['li-1'] },
      },
    ]);
  });

  it('names an owner once when they hold two covering baskets', async () => {
    const h = build({
      covering: [basket('b1', 'u-ana'), basket('b2', 'u-ana')],
    });

    await h.announcer.linesChanged('l1', ['li-1']);

    expect(h.emitted[0].basketIds).toEqual(['b1', 'b2']);
    expect(h.emitted[0].userIds).toEqual(['u-ana']);
  });

  it('carries line ids and nothing else', async () => {
    const h = build({ covering: [basket('b1', 'u-ana')] });

    await h.announcer.linesChanged('l1', ['li-1', 'li-2']);

    // A guest is in the room, so the payload names no list, no household and no
    // quantity (plan 0130, section 6).
    expect(Object.keys(h.emitted[0].payload)).toEqual(['lineIds']);
  });

  it('says each line once, however often the caller named it', async () => {
    const h = build({ covering: [basket('b1', 'u-ana')] });

    await h.announcer.linesChanged('l1', ['li-1', 'li-1', 'li-2']);

    expect(h.emitted[0].payload.lineIds).toEqual(['li-1', 'li-2']);
  });

  it('announces nothing for a write that touched no line', async () => {
    const h = build({ covering: [basket('b1', 'u-ana')] });

    await h.announcer.linesChanged('l1', []);

    expect(h.emitted).toEqual([]);
  });

  it('hands an empty audience to the publisher, which refuses it', async () => {
    const h = build({ covering: [] });

    await h.announcer.linesChanged('l1', ['li-1']);

    // One rule in one place: the publisher decides what an unaddressed envelope
    // means, rather than this and the publisher both deciding and disagreeing.
    expect(h.emitted).toEqual([
      {
        event: RealtimeEvent.BasketLinesChanged,
        basketIds: [],
        userIds: [],
        payload: { lineIds: ['li-1'] },
      },
    ]);
  });

  it('swallows a failed coverage read and logs it', async () => {
    const h = build({ fails: true });

    await expect(
      h.announcer.linesChanged('l1', ['li-1'])
    ).resolves.toBeUndefined();

    // The write it follows has committed and the household's own list event has
    // gone out, so a failure here costs one client a nudge and nothing else.
    expect(h.emitted).toEqual([]);
    expect(h.errors).toHaveLength(1);
  });
});

describe('BasketAnnouncer.linesChangedAcross', () => {
  it('announces once per list, carrying that list’s lines', async () => {
    const h = build({ covering: [basket('b1', 'u-ana')] });

    await h.announcer.linesChangedAcross([
      { listId: 'l1', lineId: 'li-1' },
      { listId: 'l2', lineId: 'li-2' },
      { listId: 'l1', lineId: 'li-3' },
    ]);

    // Two lists have two coverages, so two envelopes.
    expect(h.emitted).toHaveLength(2);
    expect(h.emitted[0].payload.lineIds).toEqual(['li-1', 'li-3']);
    expect(h.emitted[1].payload.lineIds).toEqual(['li-2']);
  });

  it('announces once for a write that stayed on one list', async () => {
    const h = build({ covering: [basket('b1', 'u-ana')] });

    await h.announcer.linesChangedAcross([
      { listId: 'l1', lineId: 'li-1' },
      { listId: 'l1', lineId: 'li-2' },
    ]);

    expect(h.emitted).toHaveLength(1);
    expect(h.emitted[0].payload.lineIds).toEqual(['li-1', 'li-2']);
  });
});

describe('BasketAnnouncer.linesMoved (plan 0204, section 3)', () => {
  it('sends each covering basket its own envelope, with its own entries', async () => {
    const mine = patch('li-1', { bought: 1, state: BasketRowState.PARTLY });
    const theirs = patch('li-1', { boughtElsewhere: 1 });
    const h = build({
      covering: [
        basket('b1', 'u-ana'),
        basket('b2', 'u-luis', BasketKind.GENERATED),
      ],
      patches: { b1: [mine], b2: [theirs] },
    });

    await h.announcer.linesMoved('l1', ['li-1']);

    // What one basket bought is what the other reads as bought elsewhere, so
    // one payload cannot serve both rooms.
    expect(h.emitted).toEqual([
      {
        event: RealtimeEvent.BasketLinesChanged,
        basketIds: ['b1'],
        userIds: ['u-ana'],
        payload: { lineIds: ['li-1'], entries: [mine] },
      },
      {
        event: RealtimeEvent.BasketLinesChanged,
        basketIds: ['b2'],
        userIds: ['u-luis'],
        payload: { lineIds: ['li-1'], entries: [theirs] },
      },
    ]);
    expect(h.asked).toEqual([
      { basketId: 'b1', listIds: ['l1'], lineIds: ['li-1'] },
      { basketId: 'b2', listIds: ['l1'], lineIds: ['li-1'] },
    ]);
  });

  it('sends entries with no patch for a line that left the basket', async () => {
    const h = build({
      covering: [basket('b1', 'u-ana')],
      patches: { b1: [patch('li-1')] },
    });

    await h.announcer.linesMoved('l1', ['li-1', 'li-2']);

    // `li-2` is in the ids and has no patch, which is how a client learns that
    // it is no row of this basket any more.
    expect(h.emitted[0].payload).toEqual({
      lineIds: ['li-1', 'li-2'],
      entries: [patch('li-1')],
    });
  });

  it('says the marks moved only when the write recorded a change', async () => {
    const h = build({
      covering: [basket('b1', 'u-ana')],
      patches: { b1: [patch('li-1')] },
    });

    await h.announcer.linesMoved('l1', ['li-1']);
    await h.announcer.linesMoved('l1', ['li-1'], true);

    expect(Object.keys(h.emitted[0].payload)).toEqual(['lineIds', 'entries']);
    expect(h.emitted[1].payload.marksMoved).toBe(true);
  });

  it('does not tell the basket a buy was made through (plan 0203, section 2)', async () => {
    const h = build({
      covering: [basket('b1', 'u-ana'), basket('b2', 'u-luis')],
      patches: { b1: [patch('li-1')], b2: [patch('li-1')] },
    });

    await h.announcer.linesMoved('l1', ['li-1'], true, 'b1');

    const byBasket = new Map(
      h.emitted.map((sent) => [sent.basketIds[0], sent.payload])
    );
    // The acting basket still hears its entries. It is shown no change, so it
    // is not told to read its marks.
    expect(Object.keys(byBasket.get('b1') ?? {})).toEqual([
      'lineIds',
      'entries',
    ]);
    expect(byBasket.get('b2')?.marksMoved).toBe(true);
  });

  it('tells every basket about a buy on the list page, which has no basket', async () => {
    const h = build({
      covering: [basket('b1', 'u-ana'), basket('b2', 'u-luis')],
      patches: { b1: [patch('li-1')], b2: [patch('li-1')] },
    });

    await h.announcer.linesMoved('l1', ['li-1'], true);

    expect(h.emitted.map((sent) => sent.payload.marksMoved)).toEqual([
      true,
      true,
    ]);
  });

  it('sends the ids alone to a basket whose patch failed, and entries to the others', async () => {
    const h = build({
      covering: [
        basket('b1', 'u-ana'),
        basket('b2', 'u-luis'),
        basket('b3', 'u-ana', BasketKind.GENERATED),
      ],
      patches: { b1: [patch('li-1')], b2: 'throws', b3: [patch('li-1')] },
    });

    await h.announcer.linesMoved('l1', ['li-1'], true);

    const byBasket = new Map(
      h.emitted.map((sent) => [sent.basketIds[0], sent.payload])
    );
    expect(byBasket.get('b2')).toEqual({ lineIds: ['li-1'] });
    expect(byBasket.get('b1')?.entries).toEqual([patch('li-1')]);
    expect(byBasket.get('b3')?.entries).toEqual([patch('li-1')]);
    expect(h.errors).toHaveLength(1);
  });

  it('sends the ids alone, on one envelope, for a write over the bound', async () => {
    const lineIds = Array.from(
      { length: BASKET_LIMITS.patchMaxLines + 1 },
      (_, at) => `li-${at}`
    );
    const h = build({
      covering: [basket('b1', 'u-ana'), basket('b2', 'u-luis')],
    });

    await h.announcer.linesMoved('l1', lineIds, true);

    expect(h.asked).toEqual([]);
    expect(h.emitted).toEqual([
      {
        event: RealtimeEvent.BasketLinesChanged,
        basketIds: ['b1', 'b2'],
        userIds: ['u-ana', 'u-luis'],
        payload: { lineIds },
      },
    ]);
  });

  it('still sends entries for a write at the bound', async () => {
    const lineIds = Array.from(
      { length: BASKET_LIMITS.patchMaxLines },
      (_, at) => `li-${at}`
    );
    const h = build({ covering: [basket('b1', 'u-ana')] });

    await h.announcer.linesMoved('l1', lineIds);

    expect(h.emitted[0].payload.entries).toEqual([]);
  });

  it('says each line once, and announces nothing for no line', async () => {
    const h = build({ covering: [basket('b1', 'u-ana')] });

    await h.announcer.linesMoved('l1', []);
    await h.announcer.linesMoved('l1', ['li-1', 'li-1']);

    expect(h.emitted).toHaveLength(1);
    expect(h.emitted[0].payload.lineIds).toEqual(['li-1']);
  });

  it('publishes nothing when no basket covers the list', async () => {
    const h = build({ covering: [] });

    await h.announcer.linesMoved('l1', ['li-1']);

    expect(h.emitted).toEqual([]);
  });

  it('swallows a failed coverage read and logs it', async () => {
    const h = build({ fails: true });

    await expect(
      h.announcer.linesMoved('l1', ['li-1'])
    ).resolves.toBeUndefined();

    expect(h.emitted).toEqual([]);
    expect(h.errors).toHaveLength(1);
  });

  it('holds no list, zone, user or basket id in any payload', async () => {
    const h = build({
      covering: [basket('b1', 'u-ana'), basket('b2', 'u-luis')],
      patches: { b1: [patch('li-1')], b2: 'throws' },
    });

    await h.announcer.linesMoved('l1', ['li-1'], true);

    for (const sent of h.emitted) {
      const text = JSON.stringify(sent.payload);
      for (const secret of ['l1', 'b1', 'b2', 'u-ana', 'u-luis']) {
        expect(text).not.toContain(secret);
      }
    }
  });
});

describe('BasketAnnouncer.linesMovedAcross', () => {
  it('announces each list with its own lines', async () => {
    const h = build({ covering: [basket('b1', 'u-ana')] });

    await h.announcer.linesMovedAcross([
      { listId: 'l1', lineId: 'li-1' },
      { listId: 'l2', lineId: 'li-2' },
      { listId: 'l1', lineId: 'li-3' },
    ]);

    // Two lists have two coverages, so the one basket hears two envelopes.
    expect(h.emitted.map((sent) => sent.payload.lineIds).sort()).toEqual([
      ['li-1', 'li-3'],
      ['li-2'],
    ]);
  });

  it('says the marks moved for the lists that recorded a change, to the other baskets', async () => {
    const h = build({
      covering: [basket('b1', 'u-ana'), basket('b2', 'u-luis')],
      patches: {
        b1: [patch('li-1'), patch('li-2')],
        b2: [patch('li-1'), patch('li-2')],
      },
    });

    await h.announcer.linesMovedAcross(
      [
        { listId: 'l1', lineId: 'li-1', recorded: true },
        // "They had none" on the other list moved no quantity.
        { listId: 'l2', lineId: 'li-2' },
      ],
      'b1'
    );

    const told = h.emitted
      .filter((sent) => sent.payload.marksMoved)
      .map((sent) => [sent.basketIds[0], sent.payload.lineIds]);
    expect(told).toEqual([['b2', ['li-1']]]);
    expect(h.emitted).toHaveLength(4);
  });
});

describe('BasketAnnouncer.basketMoved', () => {
  const own = { id: 'b1', ownerUserId: 'u-ana', kind: BasketKind.LIVE };

  it('reaches its own basket and its owner, and no other basket', async () => {
    const skipped = patch('li-1', {
      skipped: true,
      state: BasketRowState.SKIPPED,
    });
    const h = build({
      covering: [basket('b-other', 'u-luis')],
      patches: { b1: [skipped] },
    });

    h.announcer.basketMoved(own, [{ listId: 'l1', lineId: 'li-1' }]);
    await settled();

    // A skip is one trip's "not today" on a line the trip still covers, so the
    // line did not move and nobody else's basket changed. The coverage is not
    // even asked.
    expect(h.emitted).toEqual([
      {
        event: RealtimeEvent.BasketLinesChanged,
        basketIds: ['b1'],
        userIds: ['u-ana'],
        payload: { lineIds: ['li-1'], entries: [skipped] },
      },
    ]);
  });

  it('asks the patch over every list its lines are in', async () => {
    const h = build({});

    h.announcer.basketMoved(own, [
      { listId: 'l1', lineId: 'li-1' },
      { listId: 'l2', lineId: 'li-2' },
    ]);
    await settled();

    expect(h.asked).toEqual([
      { basketId: 'b1', listIds: ['l1', 'l2'], lineIds: ['li-1', 'li-2'] },
    ]);
  });

  it('sends the ids alone when its patch fails', async () => {
    const h = build({ patches: { b1: 'throws' } });

    h.announcer.basketMoved(own, [{ listId: 'l1', lineId: 'li-1' }]);
    await settled();

    expect(h.emitted[0].payload).toEqual({ lineIds: ['li-1'] });
  });

  it('announces nothing for no line', async () => {
    const h = build({});

    h.announcer.basketMoved(own, []);
    await settled();

    expect(h.emitted).toEqual([]);
  });
});

describe('BasketAnnouncer.coverageMoved', () => {
  it('tells every open basket of the household, with no line ids', async () => {
    const h = build({
      zoneBaskets: [basket('b1', 'u-ana'), basket('b2', 'u-luis')],
    });

    await h.announcer.coverageMoved('z1');
    await Promise.resolve();

    // An empty payload is the event saying "which lists you read has moved",
    // which costs a client one debounced read and names nothing it may not see.
    expect(h.emitted).toEqual([
      {
        event: RealtimeEvent.BasketLinesChanged,
        basketIds: ['b1', 'b2'],
        userIds: ['u-ana', 'u-luis'],
        payload: { lineIds: [] },
      },
    ]);
  });

  it('reads the baskets and announces them in two steps, for a deletion', async () => {
    const h = build({ zoneBaskets: [basket('b1', 'u-ana')] });

    const baskets = await h.announcer.openBaskets('z1');
    expect(baskets).toEqual([basket('b1', 'u-ana')]);
    expect(h.emitted).toEqual([]);

    h.announcer.coverageMovedTo(baskets);
    await Promise.resolve();

    // The zone's memberships cascade with the zone, so the read has to happen
    // before the delete and the announcement after it.
    expect(h.emitted[0].basketIds).toEqual(['b1']);
  });

  it('swallows a failed read and answers no baskets', async () => {
    const h = build({ fails: true });

    await expect(h.announcer.openBaskets('z1')).resolves.toEqual([]);
    expect(h.errors).toHaveLength(1);
  });
});
