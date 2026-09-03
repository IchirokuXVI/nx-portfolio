import { GatewayError } from '../gateway-error';
import { QueueStore, type QueuePage } from './queue-store';

interface Item {
  id: string;
}

const items = (...ids: string[]): Item[] => ids.map((id) => ({ id }));

function pages(...answers: QueuePage<Item>[]) {
  let call = 0;
  const reads: (string | undefined)[] = [];

  return {
    reads,
    get calls() {
      return call;
    },
    read: async (cursor: string | undefined) => {
      reads.push(cursor);
      const answer = answers[Math.min(call, answers.length - 1)];
      call += 1;
      return answer;
    },
  };
}

describe('QueueStore', () => {
  it('offers the first item and keeps the rest as what is coming', async () => {
    const source = pages({ items: items('a', 'b', 'c'), nextCursor: null });
    const queue = new QueueStore(source.read, (item) => item.id);

    await queue.load();

    expect(queue.current()).toEqual({ id: 'a' });
    expect(queue.upcoming()).toEqual(items('b', 'c'));
    expect(queue.empty()).toBe(false);
  });

  /**
   * The whole point of a queue rather than a list: the next item arrives without
   * anybody navigating anywhere.
   */
  it('advances to the next item when one is decided', async () => {
    const source = pages({ items: items('a', 'b'), nextCursor: null });
    const queue = new QueueStore(source.read, (item) => item.id);
    await queue.load();

    await queue.decide(async () => undefined);

    expect(queue.current()).toEqual({ id: 'b' });
    expect(queue.decided()).toBe(1);
  });

  it('calls the action with the item being decided', async () => {
    const source = pages({ items: items('a', 'b'), nextCursor: null });
    const queue = new QueueStore(source.read, (item) => item.id);
    await queue.load();

    const seen: Item[] = [];
    await queue.decide(async (item) => void seen.push(item));

    expect(seen).toEqual([{ id: 'a' }]);
  });

  /**
   * A failed decision leaves the item exactly where it was. The alternative is
   * an operator who believes they have rejected something they have not.
   */
  it('keeps the item when the decision fails', async () => {
    const source = pages({ items: items('a', 'b'), nextCursor: null });
    const queue = new QueueStore(source.read, (item) => item.id);
    await queue.load();

    await queue.decide(async () => {
      throw new GatewayError({
        code: 'conflict',
        status: 409,
        correlationId: '',
      });
    });

    expect(queue.current()).toEqual({ id: 'a' });
    expect(queue.decided()).toBe(0);
    expect(queue.error()?.code).toBe('conflict');
  });

  it('puts a skipped item at the back rather than deciding it', async () => {
    const source = pages({ items: items('a', 'b', 'c'), nextCursor: null });
    const queue = new QueueStore(source.read, (item) => item.id);
    await queue.load();

    queue.skip();

    expect(queue.current()).toEqual({ id: 'b' });
    expect(queue.upcoming()).toEqual(items('c', 'a'));
    expect(queue.decided()).toBe(0);
  });

  /**
   * Fetching ahead rather than at the boundary, so a page change is not a wait
   * in front of somebody working through items in a rhythm.
   */
  it('fetches the next page before running out', async () => {
    const source = pages(
      { items: items('a', 'b', 'c', 'd'), nextCursor: '4' },
      { items: items('e', 'f'), nextCursor: null }
    );
    const queue = new QueueStore(source.read, (item) => item.id);
    await queue.load();
    expect(source.calls).toBe(1);

    await queue.decide(async () => undefined);
    await Promise.resolve();
    await Promise.resolve();

    expect(source.calls).toBe(2);
    expect(source.reads[1]).toBe('4');
  });

  /**
   * A cursor timestamp in this backend loses microseconds, so a row can arrive
   * on both sides of a page boundary. Being asked the same question twice is
   * worse in a queue than in a list: the second answer fails.
   */
  it('does not offer the same item twice across a page boundary', async () => {
    const source = pages(
      { items: items('a', 'b', 'c', 'd'), nextCursor: '4' },
      { items: items('d', 'e'), nextCursor: null }
    );
    const queue = new QueueStore(source.read, (item) => item.id);
    await queue.load();

    await queue.decide(async () => undefined);
    await Promise.resolve();
    await Promise.resolve();

    expect(queue.items().map((item) => item.id)).toEqual(['b', 'c', 'd', 'e']);
  });

  it('stops asking for more once a page says it is the last', async () => {
    const source = pages({ items: items('a', 'b'), nextCursor: null });
    const queue = new QueueStore(source.read, (item) => item.id);
    await queue.load();

    await queue.decide(async () => undefined);
    await queue.decide(async () => undefined);
    await Promise.resolve();

    expect(source.calls).toBe(1);
    expect(queue.empty()).toBe(true);
  });

  /**
   * Empty and broken are different sentences with different remedies, and only
   * one of them means the work is finished.
   */
  it('is failed rather than empty when the first read fails', async () => {
    const queue = new QueueStore<Item>(
      async () => {
        throw new GatewayError({ code: '', status: 0, correlationId: '' });
      },
      (item) => item.id
    );

    await queue.load();

    expect(queue.failed()).toBe(true);
    expect(queue.empty()).toBe(false);
  });

  it('refuses a second decision while one is in flight', async () => {
    const source = pages({ items: items('a', 'b'), nextCursor: null });
    const queue = new QueueStore(source.read, (item) => item.id);
    await queue.load();

    let release = (): void => undefined;
    const slow = queue.decide(
      () => new Promise<void>((resolve) => (release = resolve))
    );

    await queue.decide(async () => undefined);
    expect(queue.decided()).toBe(0);

    release();
    await slow;
    expect(queue.decided()).toBe(1);
  });
});
