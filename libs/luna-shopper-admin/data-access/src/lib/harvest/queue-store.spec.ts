import { GatewayError } from '../gateway-error';
import { QueueStore, type QueuePage } from './queue-store';

interface Item {
  id: string;
  seen?: boolean;
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
    expect(queue.items()).toEqual(items('b'));
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
    expect(queue.items()).toEqual(items('a', 'b'));
    expect(queue.error()?.code).toBe('conflict');
  });

  /**
   * Admin plan 0049, target 5. Skipping moves on and moves nothing: the row
   * that was skipped is where the operator left it.
   */
  it('goes to the next item on a skip and leaves every row in its place', async () => {
    const source = pages({ items: items('a', 'b', 'c'), nextCursor: null });
    const queue = new QueueStore(source.read, (item) => item.id);
    await queue.load();

    queue.skip();

    expect(queue.current()).toEqual({ id: 'b' });
    expect(queue.upcoming()).toEqual(items('c', 'a'));
    expect(queue.items()).toEqual(items('a', 'b', 'c'));
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
    expect(queue.items()).toEqual(items('a', 'b'));

    release();
    await slow;
    expect(queue.items()).toEqual(items('b'));
  });
});

/**
 * Admin plan 0049, target 5. The row being decided is named by its id, and the
 * rows keep the order the gateway gave them.
 *
 * Choosing the fifth row used to turn the list until the fifth was first, so
 * the four above it went to the end and the column jumped under the pointer.
 */
describe('QueueStore, the row in front', () => {
  it('chooses a row and moves no row', async () => {
    const source = pages({
      items: items('a', 'b', 'c', 'd', 'e', 'f'),
      nextCursor: null,
    });
    const queue = new QueueStore(source.read, (item) => item.id);
    await queue.load();

    queue.focus('e');

    expect(queue.current()).toEqual({ id: 'e' });
    expect(queue.items()).toEqual(items('a', 'b', 'c', 'd', 'e', 'f'));
    // The rows after it, then the rows before it.
    expect(queue.upcoming()).toEqual(items('f', 'a', 'b', 'c', 'd'));
  });

  it('ignores a row that is not in the queue', async () => {
    const source = pages({ items: items('a', 'b'), nextCursor: null });
    const queue = new QueueStore(source.read, (item) => item.id);
    await queue.load();

    queue.focus('nowhere');

    expect(queue.current()).toEqual({ id: 'a' });
  });

  /** The row under the decided one comes up, and the rows above stay. */
  it('brings up the row under a decided row, and keeps the rows above it', async () => {
    const source = pages({
      items: items('a', 'b', 'c', 'd', 'e', 'f'),
      nextCursor: null,
    });
    const queue = new QueueStore(source.read, (item) => item.id);
    await queue.load();

    queue.focus('e');
    await queue.decide(async () => undefined);

    expect(queue.items()).toEqual(items('a', 'b', 'c', 'd', 'f'));
    expect(queue.current()).toEqual({ id: 'f' });
  });

  it('goes back to the first row after the last one is decided', async () => {
    const source = pages({ items: items('a', 'b', 'c'), nextCursor: null });
    const queue = new QueueStore(source.read, (item) => item.id);
    await queue.load();

    queue.focus('c');
    await queue.decide(async () => undefined);

    expect(queue.items()).toEqual(items('a', 'b'));
    expect(queue.current()).toEqual({ id: 'a' });
  });

  it('goes from the last row to the first on a skip', async () => {
    const source = pages({ items: items('a', 'b'), nextCursor: null });
    const queue = new QueueStore(source.read, (item) => item.id);
    await queue.load();

    queue.skip();
    queue.skip();

    expect(queue.current()).toEqual({ id: 'a' });
    expect(queue.items()).toEqual(items('a', 'b'));
  });

  /** A row decided where it sits, while another one is in front. */
  it('stays on the row in front when another row is decided', async () => {
    const source = pages({ items: items('a', 'b', 'c'), nextCursor: null });
    const queue = new QueueStore(source.read, (item) => item.id);
    await queue.load();

    queue.focus('b');
    await queue.decideAt('a', async () => null);

    expect(queue.items()).toEqual(items('b', 'c'));
    expect(queue.current()).toEqual({ id: 'b' });
  });

  it('keeps the row in front when a later page arrives', async () => {
    const source = pages(
      { items: items('a', 'b', 'c', 'd', 'e'), nextCursor: '5' },
      { items: items('f', 'g'), nextCursor: null }
    );
    const queue = new QueueStore(source.read, (item) => item.id);
    await queue.load();

    queue.focus('b');
    await queue.loadMore();

    expect(queue.current()).toEqual({ id: 'b' });
    expect(queue.items()).toEqual(items('a', 'b', 'c', 'd', 'e', 'f', 'g'));
  });

  /**
   * An operator who chose a row far down the column is as close to the end of
   * what is loaded as one who decided every row above it.
   */
  it('reads the next page when few rows are left under the row in front', async () => {
    const source = pages(
      { items: items('a', 'b', 'c', 'd', 'e', 'f'), nextCursor: '6' },
      { items: items('g', 'h'), nextCursor: null }
    );
    const queue = new QueueStore(source.read, (item) => item.id);
    await queue.load();

    queue.focus('b');
    await Promise.resolve();
    expect(source.calls).toBe(1);

    queue.focus('e');
    await Promise.resolve();
    await Promise.resolve();

    expect(source.calls).toBe(2);
    expect(queue.items()).toEqual(
      items('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h')
    );
    expect(queue.current()).toEqual({ id: 'e' });
  });

  /**
   * A press on a row, a skip and a decision can each ask for the next page.
   * Quick presses ask several times before the first answer, and the cursor
   * must still be sent once.
   */
  it('sends a cursor once, however many presses ask for the next page', async () => {
    const source = pages(
      { items: items('a', 'b', 'c'), nextCursor: '3' },
      { items: items('d', 'e', 'f', 'g', 'h'), nextCursor: null }
    );
    const queue = new QueueStore(source.read, (item) => item.id);
    await queue.load();

    queue.focus('b');
    queue.focus('c');
    queue.focus('a');
    void queue.loadMore();
    for (let turn = 0; turn < 6; turn++) {
      await Promise.resolve();
    }

    expect(source.reads).toEqual([undefined, '3']);
    expect(queue.items()).toEqual(
      items('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h')
    );
  });

  /**
   * The last row that is loaded is not the last row of the queue while the
   * gateway holds another page. Going back to the first row there would hide
   * every row that was not read yet.
   */
  it('waits for the next page on a skip at the last loaded row, and opens its first row', async () => {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let call = 0;
    const queue = new QueueStore<Item>(
      async () => {
        call += 1;
        if (call === 1) {
          return { items: items('a', 'b', 'c', 'd', 'e'), nextCursor: '5' };
        }
        await gate;
        return { items: items('f', 'g'), nextCursor: null };
      },
      (item) => item.id
    );
    await queue.load();
    queue.focus('e');

    const skipped = queue.skip();
    await Promise.resolve();
    // Not the first row, and not yet the next one: the page is being read.
    expect(queue.current()).toEqual({ id: 'e' });

    release();
    await skipped;

    expect(queue.current()).toEqual({ id: 'f' });
    expect(queue.items()).toEqual(items('a', 'b', 'c', 'd', 'e', 'f', 'g'));
    expect(call).toBe(2);
  });

  it('leaves the row the operator chose while the next page was read', async () => {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let call = 0;
    const queue = new QueueStore<Item>(
      async () => {
        call += 1;
        if (call === 1) {
          return { items: items('a', 'b', 'c', 'd', 'e'), nextCursor: '5' };
        }
        await gate;
        return { items: items('f'), nextCursor: null };
      },
      (item) => item.id
    );
    await queue.load();
    queue.focus('e');

    const skipped = queue.skip();
    queue.focus('b');
    release();
    await skipped;

    expect(queue.current()).toEqual({ id: 'b' });
  });

  it('goes back to the first row when the next page brings nothing', async () => {
    const source = pages(
      { items: items('a', 'b', 'c', 'd', 'e'), nextCursor: '5' },
      { items: [], nextCursor: null }
    );
    const queue = new QueueStore(source.read, (item) => item.id);
    await queue.load();
    // Chosen with no read ahead in the way: the page is asked for by the skip.
    queue.focus('e');
    for (let turn = 0; turn < 6; turn++) {
      await Promise.resolve();
    }

    await queue.skip();

    expect(queue.current()).toEqual({ id: 'a' });
  });

  it('opens on the first row again after a reload', async () => {
    const source = pages({ items: items('a', 'b', 'c'), nextCursor: null });
    const queue = new QueueStore(source.read, (item) => item.id);
    await queue.load();

    queue.focus('c');
    await queue.load();

    expect(queue.current()).toEqual({ id: 'a' });
  });
});

describe('QueueStore, a row decided where it sits', () => {
  it('offers no more to load once the last page has arrived', async () => {
    const source = pages({ items: items('a'), nextCursor: null });
    const queue = new QueueStore(source.read, (item) => item.id);
    await queue.load();

    expect(queue.canLoadMore()).toBe(false);

    await queue.loadMore();
    expect(source.calls).toBe(1);
  });

  /**
   * A row that stays is still decided. The shops queue is the screen that needs
   * it: ignoring a shop with no filter on leaves it in the queue wearing a new
   * badge, and losing your place on every press is what a queue exists to avoid.
   */
  it('puts a decided row back changed when the act says it stays', async () => {
    const source = pages({ items: items('a', 'b'), nextCursor: null });
    const queue = new QueueStore(source.read, (item) => item.id);
    await queue.load();

    await queue.decideAt('a', async () => ({ id: 'a', seen: true }));

    expect(queue.items()[0]).toEqual({ id: 'a', seen: true });
    expect(queue.current()).toEqual({ id: 'a', seen: true });
  });

  it('refuses to decide a row that is not in the queue', async () => {
    const source = pages({ items: items('a'), nextCursor: null });
    const queue = new QueueStore(source.read, (item) => item.id);
    await queue.load();

    const went = await queue.decideAt('nowhere', async () => null);

    expect(went).toBe(false);
    expect(queue.items()).toEqual(items('a'));
  });
});

/**
 * A row that was decided somewhere else leaves as a decided row does, and
 * the refusal that said so goes with it.
 */
describe('QueueStore, a row that somebody else decided', () => {
  const refused = () =>
    Promise.reject(
      new GatewayError({ code: 'conflict', status: 409, correlationId: '' })
    );

  it('takes the row out, brings the next one up, and holds no refusal', async () => {
    const source = pages({ items: items('a', 'b', 'c'), nextCursor: null });
    const queue = new QueueStore(source.read, (item) => item.id);
    await queue.load();
    queue.focus('b');
    await queue.decide(refused);
    expect(queue.error()).not.toBeNull();

    queue.drop('b');

    expect(queue.items()).toEqual(items('a', 'c'));
    expect(queue.current()).toEqual({ id: 'c' });
    expect(queue.error()).toBeNull();
  });

  it('leaves a queue that it empties empty, and not broken', async () => {
    const source = pages({ items: items('a'), nextCursor: null });
    const queue = new QueueStore(source.read, (item) => item.id);
    await queue.load();
    await queue.decide(refused);

    queue.drop('a');

    expect(queue.current()).toBeNull();
    expect(queue.empty()).toBe(true);
    expect(queue.failed()).toBe(false);
  });
});
