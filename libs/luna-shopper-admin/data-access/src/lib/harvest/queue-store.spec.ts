import { GatewayError } from '../gateway-error';
import { QueueStore, type QueuePage } from './queue-store';

interface Item {
  id: string;
  seen?: boolean;
}

const items = (...ids: string[]): Item[] => ids.map((id) => ({ id }));

/** Let every microtask that is ready run, which is how a worker pool settles. */
const drain = async (): Promise<void> => {
  for (let turn = 0; turn < 20; turn++) {
    await Promise.resolve();
  }
};

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

/**
 * Plan 0020, section 7. The list view's half of the store: what is ticked, how
 * more rows arrive without a decision to trigger the prefetch, and what a row
 * that is decided where it sits does.
 */
describe('QueueStore, as a list', () => {
  /**
   * A list view has no decisions to trigger the queue's own prefetch, so it asks
   * for the next page itself. The selection is by id and the rows it names are
   * still loaded, so nothing about it changes.
   */
  it('keeps the selection when a later page arrives', async () => {
    const source = pages(
      { items: items('a', 'b'), nextCursor: '2' },
      { items: items('c', 'd'), nextCursor: null }
    );
    const queue = new QueueStore(source.read, (item) => item.id);
    await queue.load();

    queue.toggle('a');
    await queue.loadMore();

    expect([...queue.selected()]).toEqual(['a']);
    expect(queue.items().map((item) => item.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('offers no more to load once the last page has arrived', async () => {
    const source = pages({ items: items('a'), nextCursor: null });
    const queue = new QueueStore(source.read, (item) => item.id);
    await queue.load();

    expect(queue.canLoadMore()).toBe(false);

    await queue.loadMore();
    expect(source.calls).toBe(1);
  });

  /**
   * The store holds the rows it has fetched and knows no more than that, so the
   * control names the number it is actually about rather than claiming four
   * thousand it cannot see.
   */
  it('selects the loaded rows and no more', async () => {
    const source = pages(
      { items: items('a', 'b'), nextCursor: '2' },
      { items: items('c'), nextCursor: null }
    );
    const queue = new QueueStore(source.read, (item) => item.id);
    await queue.load();

    queue.selectLoaded();

    expect([...queue.selected()].sort()).toEqual(['a', 'b']);
    expect(queue.selectedCount()).toBe(2);
  });

  it('takes a decided row out of the selection', async () => {
    const source = pages({ items: items('a', 'b'), nextCursor: null });
    const queue = new QueueStore(source.read, (item) => item.id);
    await queue.load();

    queue.selectLoaded();
    await queue.decide(async () => undefined);

    expect([...queue.selected()]).toEqual(['b']);
  });

  it('untoggles a row that was already ticked', async () => {
    const source = pages({ items: items('a', 'b'), nextCursor: null });
    const queue = new QueueStore(source.read, (item) => item.id);
    await queue.load();

    queue.toggle('a');
    queue.toggle('a');

    expect(queue.selectedCount()).toBe(0);
  });

  it('puts a clicked row in front without deciding it', async () => {
    const source = pages({ items: items('a', 'b', 'c'), nextCursor: null });
    const queue = new QueueStore(source.read, (item) => item.id);
    await queue.load();

    queue.focus('c');

    expect(queue.items().map((item) => item.id)).toEqual(['c', 'a', 'b']);
    expect(queue.decided()).toBe(0);
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
    expect(queue.decided()).toBe(1);
  });

  it('refuses to decide a row that is not in the queue', async () => {
    const source = pages({ items: items('a'), nextCursor: null });
    const queue = new QueueStore(source.read, (item) => item.id);
    await queue.load();

    const went = await queue.decideAt('nowhere', async () => null);

    expect(went).toBe(false);
    expect(queue.decided()).toBe(0);
  });
});

/**
 * Plan 0020, sections 5, 6 and 7. There is no bulk route and this plan does not
 * add one, so all of the honesty about one call per row lives here.
 */
describe('QueueStore, over a selection', () => {
  /**
   * Section 5's number, and the reason for it: enough that two hundred rows are
   * not two hundred round trips end to end, few enough that draining a queue
   * does not arrive at the gateway as a burst.
   */
  it('runs at most four calls at once', async () => {
    const source = pages({
      items: items('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'),
      nextCursor: null,
    });
    const queue = new QueueStore(source.read, (item) => item.id);
    await queue.load();
    queue.selectLoaded();

    let running = 0;
    let most = 0;
    const release: (() => void)[] = [];

    const run = queue.decideMany(async () => {
      running += 1;
      most = Math.max(most, running);
      await new Promise<void>((resolve) => release.push(resolve));
      running -= 1;
      return null;
    });

    // Every worker that is going to start has started by now.
    await drain();
    expect(most).toBe(4);

    while (release.length > 0) {
      const next = release.pop();
      next?.();
      await drain();
    }

    await run;
    expect(most).toBe(4);
  });

  /**
   * Section 6, the rule the whole feature rests on. Two hundred calls will not
   * all succeed, and a bulk that reports one word is a bulk an operator cannot
   * recover from.
   */
  it('names what failed, leaves it in the queue and leaves it selected', async () => {
    const source = pages({ items: items('a', 'b', 'c'), nextCursor: null });
    const queue = new QueueStore(source.read, (item) => item.id);
    await queue.load();
    queue.selectLoaded();

    const result = await queue.decideMany(async (item) => {
      if (item.id === 'b') {
        throw new GatewayError({
          code: 'conflict',
          status: 409,
          correlationId: '',
        });
      }
      return null;
    });

    expect([...result.succeeded].sort()).toEqual(['a', 'c']);
    expect(result.failed).toEqual([
      { id: 'b', error: expect.objectContaining({ code: 'conflict' }) },
    ]);
    expect(queue.items().map((item) => item.id)).toEqual(['b']);
    // Pressing the action again retries exactly the failure, with nothing to
    // reselect. A row that went through is done and must not be sent twice.
    expect([...queue.selected()]).toEqual(['b']);
  });

  /**
   * "I did not try" and "I tried and it was refused" are different sentences,
   * so they are two lists and the skipped row never reaches the act at all.
   */
  it('never passes a row the act cannot apply to, and reports it apart', async () => {
    const source = pages({ items: items('a', 'b'), nextCursor: null });
    const queue = new QueueStore(source.read, (item) => item.id);
    await queue.load();
    queue.selectLoaded();

    const seen: string[] = [];
    const result = await queue.decideMany(
      async (item) => {
        seen.push(item.id);
        return null;
      },
      (item) => item.id === 'a'
    );

    expect(seen).toEqual(['a']);
    expect(result.skipped).toEqual(['b']);
    expect(result.failed).toEqual([]);
    expect(result.total).toBe(1);
    // Never attempted, so still there and still ticked.
    expect([...queue.selected()]).toEqual(['b']);
  });

  it('acts only on the rows that are ticked', async () => {
    const source = pages({ items: items('a', 'b', 'c'), nextCursor: null });
    const queue = new QueueStore(source.read, (item) => item.id);
    await queue.load();
    queue.toggle('b');

    const seen: string[] = [];
    await queue.decideMany(async (item) => {
      seen.push(item.id);
      return null;
    });

    expect(seen).toEqual(['b']);
    expect(queue.items().map((item) => item.id)).toEqual(['a', 'c']);
  });

  /**
   * A "cancel" read as an undo on a screen that writes to the catalog is the
   * worst possible misreading, so stopping stops between rows and the rows
   * behind it are simply untouched.
   */
  it('stops between rows and leaves what went through alone', async () => {
    const source = pages({
      items: items('a', 'b', 'c', 'd', 'e', 'f'),
      nextCursor: null,
    });
    const queue = new QueueStore(source.read, (item) => item.id);
    await queue.load();
    queue.selectLoaded();

    const seen: string[] = [];
    const result = await queue.decideMany(async (item) => {
      seen.push(item.id);
      if (seen.length === 2) {
        queue.stopBulk();
      }
      return null;
    });

    expect(result.stopped).toBe(true);
    // Whatever had already been sent finishes; no row behind the stop starts.
    expect(seen).toEqual(['a', 'b']);
    expect(result.succeeded).toEqual(['a', 'b']);
    expect(queue.items().map((item) => item.id)).toEqual(['c', 'd', 'e', 'f']);
    expect([...queue.selected()].sort()).toEqual(['c', 'd', 'e', 'f']);
  });

  it('reports what it set out to do, so a stopped run can say what it did not', async () => {
    const source = pages({ items: items('a', 'b'), nextCursor: null });
    const queue = new QueueStore(source.read, (item) => item.id);
    await queue.load();
    queue.selectLoaded();

    const result = await queue.decideMany(async () => null);

    expect(result.total).toBe(2);
    expect(result.stopped).toBe(false);
    expect(queue.bulk()).toBeNull();
    expect(queue.result()).toBe(result);
  });

  it('refuses a single decision while a bulk run is going', async () => {
    const source = pages({ items: items('a', 'b'), nextCursor: null });
    const queue = new QueueStore(source.read, (item) => item.id);
    await queue.load();
    queue.selectLoaded();

    const release: (() => void)[] = [];
    const run = queue.decideMany(async () => {
      await new Promise<void>((resolve) => release.push(resolve));
      return null;
    });
    await drain();

    await queue.decide(async () => undefined);
    expect(queue.decided()).toBe(0);

    for (const let_go of release) {
      let_go();
    }
    await run;
  });
});
