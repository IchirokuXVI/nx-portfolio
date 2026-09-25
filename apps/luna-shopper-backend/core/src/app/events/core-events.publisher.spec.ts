import {
  BASKET_FAN_OUT_MAX,
  RealtimeEvent,
  type DomainEvent,
} from '@portfolio/luna-shopper/contracts';
import { CoreEventsPublisher } from './core-events.publisher';

/**
 * What the publisher does with a basket audience (plan 0139, section 1).
 *
 * Two rules that are the publisher's alone, because the consumer cannot make
 * either decision: an audience of no baskets is not a fault, and an audience
 * larger than one envelope may carry is several envelopes.
 */

/** The envelopes a publisher sent, unwrapped from the NATS record. */
function publisherWithSent(): {
  publisher: CoreEventsPublisher;
  sent: DomainEvent[];
  warnings: unknown[][];
} {
  const sent: DomainEvent[] = [];
  const client = {
    emit: (_subject: string, record: { data: DomainEvent }) => {
      sent.push(record.data);
    },
  };
  const publisher = new CoreEventsPublisher(client as never);
  const warnings: unknown[][] = [];
  (publisher as unknown as { logger: { warn: unknown } }).logger = {
    warn: (...args: unknown[]) => warnings.push(args),
  };
  return { publisher, sent, warnings };
}

describe('an audience of baskets', () => {
  it('publishes nothing when no basket is named and nothing else is', () => {
    const { publisher, sent } = publisherWithSent();

    publisher.emitTo(
      RealtimeEvent.BasketLinesChanged,
      { basketIds: [] },
      { lineIds: ['li-1'] }
    );

    // A write to a list no open basket covers is the ordinary case, not an
    // event addressed to nobody. The consumer treats an empty audience as a
    // fault, so this must never reach it.
    expect(sent).toEqual([]);
  });

  it('still publishes when the baskets are empty but somebody else is named', () => {
    const { publisher, sent } = publisherWithSent();

    publisher.emitTo(
      RealtimeEvent.BasketLinesChanged,
      { basketIds: [], userIds: ['u-owner'] },
      { lineIds: ['li-1'] }
    );

    expect(sent).toHaveLength(1);
    expect(sent[0].userIds).toEqual(['u-owner']);
    expect(sent[0].basketIds).toBeUndefined();
  });

  it('writes basketIds and never the old name', () => {
    const { publisher, sent } = publisherWithSent();

    publisher.emitToBaskets(RealtimeEvent.BasketLinesChanged, ['b1', 'b2'], {
      lineIds: ['li-1'],
    });

    expect(sent[0].basketIds).toEqual(['b1', 'b2']);
    expect(sent[0].basketId).toBeUndefined();
  });

  it('splits 450 baskets into three envelopes with three event ids', () => {
    const { publisher, sent, warnings } = publisherWithSent();
    const baskets = Array.from({ length: 450 }, (_, i) => `b${i}`);

    publisher.emitToBaskets(RealtimeEvent.BasketLinesChanged, baskets, {
      lineIds: ['li-1'],
    });

    expect(sent).toHaveLength(3);
    expect(sent.map((envelope) => envelope.basketIds?.length)).toEqual([
      BASKET_FAN_OUT_MAX,
      BASKET_FAN_OUT_MAX,
      50,
    ]);
    // One envelope is one event id and therefore one dedupe key, which is what
    // stops the consumer dropping the second and third as repeats of the first.
    expect(new Set(sent.map((envelope) => envelope.eventId)).size).toBe(3);
    // Every basket exactly once, in order.
    expect(sent.flatMap((envelope) => [...(envelope.basketIds ?? [])])).toEqual(
      baskets
    );
    // A list with this many open baskets over it is a number somebody wants to
    // know about.
    expect(warnings).toHaveLength(1);
  });

  it('names the other audience on the first envelope alone', () => {
    const { publisher, sent } = publisherWithSent();
    const baskets = Array.from({ length: 250 }, (_, i) => `b${i}`);

    publisher.emitTo(
      RealtimeEvent.BasketLinesChanged,
      { basketIds: baskets, userIds: ['u-owner'] },
      { lineIds: ['li-1'] }
    );

    // Repeating the user room on both would deliver the same nudge twice to the
    // one person least likely to be in a basket room.
    expect(sent.map((envelope) => envelope.userIds)).toEqual([
      ['u-owner'],
      undefined,
    ]);
  });

  it('leaves an audience within the bound as one envelope', () => {
    const { publisher, sent, warnings } = publisherWithSent();
    const baskets = Array.from(
      { length: BASKET_FAN_OUT_MAX },
      (_, i) => `b${i}`
    );

    publisher.emitToBaskets(RealtimeEvent.BasketLinesChanged, baskets, {
      lineIds: [],
    });

    expect(sent).toHaveLength(1);
    expect(warnings).toEqual([]);
  });

  it('publishes an ordinary zone event with no basket field at all', () => {
    const { publisher, sent } = publisherWithSent();

    publisher.emit(RealtimeEvent.LineAdded, 'z1', { id: 'li-1' }, 'l1');

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ zoneId: 'z1', listId: 'l1' });
    expect(sent[0].basketIds).toBeUndefined();
  });
});
