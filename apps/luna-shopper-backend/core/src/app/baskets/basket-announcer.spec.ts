import {
  RealtimeEvent,
  type BasketLinesChangedEvent,
} from '@portfolio/luna-shopper/contracts';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import { BasketAnnouncer } from './basket-announcer.service';
import type { BasketCoverageService } from './basket-coverage.service';
import type { CoveringBasket } from './basket-coverage.sql';

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
}

function build(options: {
  covering?: CoveringBasket[];
  zoneBaskets?: CoveringBasket[];
  fails?: boolean;
}): Harness {
  const emitted: Harness['emitted'] = [];
  const errors: unknown[][] = [];

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

  const announcer = new BasketAnnouncer(coverage, events);
  (announcer as unknown as { logger: { error: unknown } }).logger = {
    error: (...args: unknown[]) => errors.push(args),
  };
  return { announcer, emitted, errors };
}

const basket = (id: string, owner: string): CoveringBasket => ({
  basketId: id,
  ownerUserId: owner,
});

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

describe('BasketAnnouncer.basketChanged', () => {
  it('reaches its own basket and its owner, and no other basket', async () => {
    const h = build({ covering: [basket('b-other', 'u-luis')] });

    h.announcer.basketChanged({ id: 'b1', ownerUserId: 'u-ana' }, ['li-1']);
    await Promise.resolve();

    // A skip is one trip's "not today" on a line the trip still covers, so the
    // line did not move and nobody else's basket changed. The coverage is not
    // even asked.
    expect(h.emitted).toEqual([
      {
        event: RealtimeEvent.BasketLinesChanged,
        basketIds: ['b1'],
        userIds: ['u-ana'],
        payload: { lineIds: ['li-1'] },
      },
    ]);
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
