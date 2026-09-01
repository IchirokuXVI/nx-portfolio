import { TestBed } from '@angular/core/testing';
import type { Line, Page } from '@portfolio/velista/models';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { Mutations } from '../mutations';
import { REALTIME_CLIENT } from '../realtime/realtime-client';
import { RealtimeMemory } from '../realtime/realtime-memory';
import { LINE_SERVICE, type LineServiceI } from './line-service';
import { LineStore } from './line-store';

const LIST = 'list-1';
const ME = 'user-me';

/**
 * The approval facts an add carries, for a caller who decides nothing on a list that
 * asks. It is the ordinary case and the one the placeholder must draw as `PENDING`.
 */
const ASKS_FIRST = { canDecide: false, autoApproveLines: false };

function line(id: string, overrides: Partial<Line> = {}): Line {
  return {
    id,
    listId: LIST,
    content: 'Sourdough loaf',
    quantity: 1,
    itemIds: [],
    position: 1,
    approvalStatus: 'APPROVED',
    boughtCount: 0,
    lastSettlementOutcome: null,
    claimed: false,
    claimedByUserId: null,
    createdByUserId: ME,
    approvedByUserId: ME,
    version: 1,
    ...overrides,
  };
}

/**
 * A service whose answers a spec can steer.
 *
 * Deliberately not `LineMemory`: these are assertions about the **store**, and a fake
 * that also holds state would make it ambiguous which of the two produced a result.
 */
function service(seed: readonly Line[]) {
  let served = seed;
  let nextCursor: string | null = null;
  let failWith: Error | null = null;
  /** What the next write answers, so a version race can be staged rather than raced. */
  let answerWith: Line | null = null;
  /** Set while writes are held open, resolved by `releaseWrites`. */
  let held: Promise<void> | null = null;
  let release: (() => void) | null = null;
  const calls: string[] = [];

  const answer = async (fallback: Line): Promise<Line> => {
    calls.push('write');
    if (held !== null) {
      // The write is left in flight so a spec can stage what reaches the store while
      // it is out. A deployed environment does this by itself: the echo off the socket
      // is quicker than the response back through the gateway.
      await held;
    }
    if (failWith !== null) {
      const error = failWith;
      failWith = null;
      throw error;
    }
    const value = answerWith ?? fallback;
    answerWith = null;
    return value;
  };

  let readFailsWith: Error | null = null;

  const impl: LineServiceI = {
    listLines: async (): Promise<Page<Line>> => {
      calls.push('list');
      if (readFailsWith !== null) {
        const error = readFailsWith;
        readFailsWith = null;
        throw error;
      }

      // The cursor is handed out once, exactly as a real endpoint does it: the follow
      // up page is the last one. A fake that repeated its own cursor would describe a
      // server that does not exist.
      const cursor = nextCursor;
      nextCursor = null;
      return { items: served, nextCursor: cursor };
    },
    addLine: async (listId, content, quantity) =>
      answer(
        line('server-id', {
          listId,
          content,
          quantity: quantity ?? 1,
          version: 1,
        })
      ),
    updateLine: async (lineId, changes) =>
      answer(line(lineId, { ...changes, version: 2 })),
    addQuantity: async (lineId, delta) =>
      answer(line(lineId, { quantity: 1 + delta, version: 2 })),
    settle: async (lineId, outcome, options) => {
      // Awaited, and that matters: `answer` is what `failNext` throws from, and an
      // unawaited rejection here takes the whole jest worker down rather than failing
      // the one spec that staged it.
      const settled = await answer(
        line(lineId, {
          quantity: outcome === 'BOUGHT' ? 0 : 1,
          boughtCount: outcome === 'BOUGHT' ? 1 : 0,
          lastSettlementOutcome: outcome,
          version: 2,
        })
      );
      return {
        line: settled,
        settlement: {
          id: 's1',
          lineId,
          listId: LIST,
          itemId: options?.itemId ?? null,
          outcome,
          quantity: outcome === 'BOUGHT' ? (options?.quantity ?? 1) : 0,
          settledByUserId: ME,
          settledAt: new Date('2026-09-01T10:00:00.000Z'),
        },
      };
    },
    listSettlements: async () => ({ items: [], nextCursor: null }),
    listItemSettlements: async () => ({ items: [], nextCursor: null }),
    setApproval: async (lineId, approvalStatus) =>
      answer(line(lineId, { approvalStatus, version: 2 })),
    reorder: async () => {
      calls.push('reorder');
      if (failWith !== null) {
        const error = failWith;
        failWith = null;
        throw error;
      }
    },
    deleteLine: async (lineId) => {
      calls.push('delete');
      if (failWith !== null) {
        const error = failWith;
        failWith = null;
        throw error;
      }
      return lineId;
    },
  };

  return {
    ...impl,
    calls,
    setServed: (next: readonly Line[], cursor: string | null = null) => {
      served = next;
      nextCursor = cursor;
    },
    failNext: (error: Error) => {
      failWith = error;
    },
    failNextRead: (error: Error) => {
      readFailsWith = error;
    },
    answerNext: (value: Line) => {
      answerWith = value;
    },
    holdWrites: () => {
      held = new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    releaseWrites: () => {
      held = null;
      release?.();
      release = null;
    },
  };
}

async function build(seed: readonly Line[] = []) {
  TestBed.resetTestingModule();

  const lines = service(seed);
  const realtime = new RealtimeMemory();

  await TestBed.configureTestingModule({
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      Mutations,
      LineStore,
      { provide: LINE_SERVICE, useValue: lines },
      { provide: REALTIME_CLIENT, useValue: realtime },
    ],
  }).compileComponents();

  return { store: TestBed.inject(LineStore), lines, realtime };
}

describe('LineStore', () => {
  describe('loading', () => {
    it('loads a list and reports its state', async () => {
      const { store } = await build([line('a')]);

      await store.load(LIST);

      expect(store.stateOf(LIST)).toBe('loaded');
      expect(store.linesIn(LIST)).toHaveLength(1);
    });

    it('reports a failed read rather than an empty list', async () => {
      // An empty list and a list that failed to load look identical on screen unless
      // the store keeps them apart: one offers a composer, the other offers a retry.
      const { store, lines } = await build([line('a')]);
      lines.failNextRead(new Error('offline'));

      await store.load(LIST);

      expect(store.stateOf(LIST)).toBe('failed');
      expect(store.errorOf(LIST)).toBeInstanceOf(Error);
    });

    it('is complete when the first page is the only page (rule L4)', async () => {
      const { store } = await build([line('a')]);

      await store.load(LIST);

      expect(store.isComplete(LIST)).toBe(true);
    });

    it('fetches the rest behind the first page', async () => {
      // Rule L4's cost, paid in the background rather than in front of the reader: a
      // long list keeps every other function and loses only drag until this finishes.
      const { store, lines } = await build([line('a')]);
      lines.setServed([line('a')], 'cursor-1');

      await store.load(LIST);
      // The first page is on screen and the follow up has been issued.
      expect(store.linesIn(LIST).length).toBeGreaterThan(0);
      expect(
        lines.calls.filter((call) => call === 'list').length
      ).toBeGreaterThan(1);
    });
  });

  describe('an optimistic add, and its identity problem', () => {
    it('shows the row before the server answers', async () => {
      const { store } = await build();
      await store.load(LIST);

      const adding = store.addLine(LIST, 'Milk', 2, ME, ASKS_FIRST);

      // Already on screen, under a client key, because there is no server id yet.
      expect(store.linesIn(LIST)).toHaveLength(1);
      expect(store.linesIn(LIST)[0].content).toBe('Milk');

      await adding;
    });

    it('replaces the local row with the server one rather than adding a second', async () => {
      const { store } = await build();
      await store.load(LIST);

      const outcome = await store.addLine(LIST, 'Milk', 2, ME, ASKS_FIRST);

      expect(outcome.state).toBe('added');
      expect(store.linesIn(LIST)).toHaveLength(1);
      expect(store.linesIn(LIST)[0].id).toBe('server-id');
    });

    it('does not draw a second row when its own event echoes back', async () => {
      // The identity problem section 5.2 is about: the event cannot be matched by id
      // against a row that had none, so the store remembers the ids it minted.
      const { store, realtime } = await build();
      await store.load(LIST);
      await store.addLine(LIST, 'Milk', 2, ME, ASKS_FIRST);

      realtime.emit(
        'line.added',
        line('server-id', { content: 'Milk', quantity: 2 })
      );

      expect(store.linesIn(LIST)).toHaveLength(1);
    });

    it('does not draw a second row when the echo arrives before the response', async () => {
      // The order a deployed environment actually produces, and the one this store got
      // wrong: `line.added` travels core to NATS to the socket while the response is
      // still coming back through the gateway, so the id is not claimed yet when the
      // event lands. The event inserted a row, the response then rewrote the client
      // keyed row into the same server row, and the list held one id twice, which
      // `track line.id` draws as two identical items until the next load. Locally the
      // response wins the race, which is why only staging and production showed it.
      const { store, realtime, lines } = await build();
      await store.load(LIST);

      lines.holdWrites();
      const adding = store.addLine(LIST, 'Milk', 2, ME, ASKS_FIRST);
      realtime.emit(
        'line.added',
        line('server-id', { content: 'Milk', quantity: 2 })
      );
      lines.releaseWrites();
      await adding;

      expect(store.linesIn(LIST)).toHaveLength(1);
      expect(store.linesIn(LIST)[0].id).toBe('server-id');
      expect(store.linesIn(LIST)[0].content).toBe('Milk');
    });

    it('inserts somebody else’s line', async () => {
      const { store, realtime } = await build([line('a')]);
      await store.load(LIST);

      realtime.emit('line.added', line('theirs', { position: 2 }));

      expect(store.linesIn(LIST).map((l) => l.id)).toEqual(['a', 'theirs']);
    });

    it('draws the placeholder as PENDING when the adder cannot decide', async () => {
      const { store } = await build();
      await store.load(LIST);

      const adding = store.addLine(LIST, 'Milk', 2, ME, ASKS_FIRST);

      expect(store.linesIn(LIST)[0].approvalStatus).toBe('PENDING');
      expect(store.linesIn(LIST)[0].approvedByUserId).toBeNull();
      await adding;
    });

    it('draws it approved, by the adder, when the adder holds DECIDE', async () => {
      // Backend plan 0037 section 2, rule 1: they are the person the approval would
      // have been asked of, so adding the line is them giving it. Drawing PENDING here
      // is the approve button that flashes on your own line.
      const { store } = await build();
      await store.load(LIST);

      const adding = store.addLine(LIST, 'Milk', 2, ME, {
        canDecide: true,
        autoApproveLines: false,
      });

      expect(store.linesIn(LIST)[0].approvalStatus).toBe('APPROVED');
      expect(store.linesIn(LIST)[0].approvedByUserId).toBe(ME);
      await adding;
    });

    it('draws it approved with no approver on an auto-approving list', async () => {
      // Rule 2. Nobody decided: the list is configured not to ask, and a null approver
      // is the honest record of that.
      const { store } = await build();
      await store.load(LIST);

      const adding = store.addLine(LIST, 'Milk', 2, ME, {
        canDecide: false,
        autoApproveLines: true,
      });

      expect(store.linesIn(LIST)[0].approvalStatus).toBe('APPROVED');
      expect(store.linesIn(LIST)[0].approvedByUserId).toBeNull();
      await adding;
    });

    it('takes the row away again when the add fails', async () => {
      // Unlike an edit there is nothing to snap back to: the line never existed, and
      // leaving it would be an item somebody believes is on a shared list.
      const { store, lines } = await build();
      await store.load(LIST);
      lines.failNext(new Error('offline'));

      const outcome = await store.addLine(LIST, 'Milk', 1, ME, ASKS_FIRST);

      expect(outcome.state).toBe('failed');
      expect(store.linesIn(LIST)).toHaveLength(0);
    });
  });

  /**
   * The reel's write (velista plan 0043, section 4.1), which replaced ticking off.
   *
   * The three endings are the same three `0012` gave the tick, because they are
   * `Mutations.run`'s and not the gesture's. What is new is the **shape of the write**:
   * the row shows the snapped number at once while the request carries a signed delta,
   * and those are two answers to two different problems.
   */
  describe('moving a quantity (section 4.1)', () => {
    it('changes the row before the request resolves', async () => {
      const { store } = await build([line('a', { quantity: 2 })]);
      await store.load(LIST);

      const writing = store.addQuantity('a', 3);

      expect(store.linesIn(LIST)[0].quantity).toBe(5);
      expect(store.writeNoteOf('a')?.outcome).toBe('pending');

      await writing;
    });

    it('floors the optimistic number at zero rather than going negative', async () => {
      const { store } = await build([line('a', { quantity: 2 })]);
      await store.load(LIST);

      const writing = store.addQuantity('a', -9);

      expect(store.linesIn(LIST)[0].quantity).toBe(0);

      await writing;
    });

    it('reports nothing at all on success, because the change was the feedback', async () => {
      const { store } = await build([line('a')]);
      await store.load(LIST);

      const outcome = await store.addQuantity('a', 1);

      expect(outcome).toBe('succeeded');
      expect(store.writeNoteOf('a')).toBeNull();
    });

    it('sends nothing for a delta of zero', async () => {
      // A gesture that ended where it began is not an adjustment, and a delta of zero
      // is a 400 at the gateway.
      const { store } = await build([line('a')]);
      await store.load(LIST);

      expect(await store.addQuantity('a', 0)).toBe('failed');
      expect(store.writeNoteOf('a')).toBeNull();
    });

    it('snaps the row back and leaves an inline note when it fails', async () => {
      const { store, lines } = await build([line('a', { quantity: 2 })]);
      await store.load(LIST);
      lines.failNext(new Error('offline'));

      const outcome = await store.addQuantity('a', 3);

      expect(outcome).toBe('failed');
      // Back to what it was **before this adjustment**, and not the negation of the
      // delta: somebody else's may have landed while ours was out.
      expect(store.linesIn(LIST)[0].quantity).toBe(2);
      expect(store.writeNoteOf('a')?.outcome).toBe('failed');
    });

    it('reports overwritten when the server moved further than this write alone', async () => {
      const { store, lines } = await build([line('a', { version: 1 })]);
      await store.load(LIST);
      // Version 3 off a base of 1: somebody else's change landed in between.
      lines.answerNext(line('a', { quantity: 9, version: 3 }));

      const outcome = await store.addQuantity('a', 1);

      expect(outcome).toBe('overwritten');
      expect(store.writeNoteOf('a')?.outcome).toBe('overwritten');
    });

    it('shows the server’s value once the write has landed', async () => {
      const { store, lines } = await build([line('a')]);
      await store.load(LIST);
      lines.answerNext(line('a', { content: 'Theirs', version: 3 }));

      await store.addQuantity('a', 1);

      expect(store.linesIn(LIST)[0].content).toBe('Theirs');
    });
  });

  /**
   * Settling, which is **not** optimistic and is the one deliberate exception on this
   * screen (section 5.2).
   *
   * Every other write here is a gesture whose result the person already knows. This
   * one's result is a derivation the server performs over history the client does not
   * hold, so guessing it to save a round trip on a gesture made once per shop would be
   * optimism spent in the wrong place.
   */
  describe('settling a line (section 5.2)', () => {
    it('takes the server’s line and its moved indicators', async () => {
      const { store } = await build([line('a', { quantity: 2 })]);
      await store.load(LIST);

      const result = await store.settle('a', 'BOUGHT', { quantity: 2 });

      expect(result.state).toBe('settled');
      expect(store.linesIn(LIST)[0].quantity).toBe(0);
      expect(store.linesIn(LIST)[0].boughtCount).toBe(1);
      expect(store.linesIn(LIST)[0].lastSettlementOutcome).toBe('BOUGHT');
    });

    it('does not move the row before the server answers', async () => {
      const { store } = await build([line('a', { quantity: 2 })]);
      await store.load(LIST);

      const settling = store.settle('a', 'BOUGHT', { quantity: 2 });

      expect(store.linesIn(LIST)[0].quantity).toBe(2);
      expect(store.writeNoteOf('a')?.outcome).toBe('pending');

      await settling;
    });

    it('leaves a note and moves nothing when it fails', async () => {
      const { store, lines } = await build([line('a', { quantity: 2 })]);
      await store.load(LIST);
      lines.failNext(new Error('offline'));

      const result = await store.settle('a', 'BOUGHT', { quantity: 2 });

      expect(result.state).toBe('failed');
      expect(store.linesIn(LIST)[0].quantity).toBe(2);
      expect(store.writeNoteOf('a')?.outcome).toBe('failed');
    });
  });

  describe('an event arriving during a write (plan 0004, 7.2 case 3)', () => {
    it('keeps the local value for the field being written and takes the rest', async () => {
      const { store, realtime } = await build([
        line('a', { content: 'Bread', quantity: 1 }),
      ]);
      await store.load(LIST);

      const writing = store.updateLine('a', { content: 'Sourdough' });

      realtime.emit(
        'line.updated',
        line('a', { content: 'Somebody else', quantity: 9, version: 2 })
      );

      // The field being edited keeps the local guess; every other field takes the
      // event. Without this, an echo overwrites a half finished change.
      expect(store.linesIn(LIST)[0].content).toBe('Sourdough');
      expect(store.linesIn(LIST)[0].quantity).toBe(9);

      await writing;
    });

    it('takes the whole record when no overlay claims anything', async () => {
      const { store, realtime } = await build([
        line('a', { content: 'Bread' }),
      ]);
      await store.load(LIST);

      realtime.emit(
        'line.updated',
        line('a', { content: 'Theirs', version: 2 })
      );

      expect(store.linesIn(LIST)[0].content).toBe('Theirs');
    });

    it('ignores an update for a line it does not hold', async () => {
      const { store, realtime } = await build([line('a')]);
      await store.load(LIST);

      realtime.emit('line.updated', line('elsewhere', { listId: 'other' }));

      expect(store.linesIn(LIST)).toHaveLength(1);
    });
  });

  describe('the other events', () => {
    it('takes a deleted row away without announcing it', async () => {
      const { store, realtime } = await build([line('a'), line('b')]);
      await store.load(LIST);

      realtime.emit('line.deleted', { id: 'a', listId: LIST });

      expect(store.linesIn(LIST).map((l) => l.id)).toEqual(['b']);
    });

    it('rewrites the whole order on a reorder', async () => {
      const { store, realtime } = await build([
        line('a', { position: 1 }),
        line('b', { position: 2 }),
      ]);
      await store.load(LIST);

      realtime.emit('line.reordered', {
        listId: LIST,
        orderedLineIds: ['b', 'a'],
      });

      const byId = new Map(store.linesIn(LIST).map((l) => [l.id, l.position]));
      expect(byId.get('b')).toBe(1);
      expect(byId.get('a')).toBe(2);
    });

    it('raises a comment count it already knows', async () => {
      const { store, realtime } = await build([line('a')]);
      await store.load(LIST);
      store.recordCommentCount('a', 2);

      realtime.emit('comment.added', {
        id: 'c1',
        lineId: 'a',
        authorUserId: 'user-toni',
        body: 'hi',
        createdAt: new Date().toISOString(),
      });

      expect(store.commentCountOf('a')).toBe(3);
    });

    it('does not invent a count it has never seen', async () => {
      // Nothing on the wire carries a comment count, so starting one at 1 from an
      // event would claim a line with nine comments has one.
      const { store, realtime } = await build([line('a')]);
      await store.load(LIST);

      realtime.emit('comment.added', {
        id: 'c1',
        lineId: 'a',
        authorUserId: 'user-toni',
        body: 'hi',
        createdAt: new Date().toISOString(),
      });

      expect(store.commentCountOf('a')).toBeUndefined();
    });

    /**
     * Plan 0018, gap 2. The comments themselves used to be sheet state, so a comment
     * from anybody but the reader moved the count and reached no conversation.
     */
    describe('the conversation itself', () => {
      const comment = (
        id: string,
        overrides: Record<string, unknown> = {}
      ) => ({
        id,
        lineId: 'a',
        authorUserId: 'user-toni',
        body: `body ${id}`,
        createdAt: new Date().toISOString(),
        ...overrides,
      });

      it('puts an arriving comment at the top of a loaded conversation', async () => {
        const { store, realtime } = await build([line('a')]);
        await store.load(LIST);
        store.recordComments('a', [
          {
            id: 'c1',
            lineId: 'a',
            authorUserId: 'me',
            body: 'first',
            createdAt: new Date().toISOString(),
          },
        ]);

        realtime.emit('comment.added', comment('c2'));

        // Newest first, which is the order the endpoint answers in and the sheet draws.
        expect(store.commentsOf('a')?.map((row) => row.id)).toEqual([
          'c2',
          'c1',
        ]);
        // The count follows from the list's length, so the two cannot disagree.
        expect(store.commentCountOf('a')).toBe(2);
      });

      it('shows a comment once when it arrives twice', async () => {
        const { store, realtime } = await build([line('a')]);
        await store.load(LIST);
        store.recordComments('a', []);

        // The reader's own comment: once as the response to the POST, once on the
        // socket. An append rather than an upsert would draw it twice.
        store.addComment(comment('c1'));
        realtime.emit('comment.added', comment('c1'));

        expect(store.commentsOf('a')?.map((row) => row.id)).toEqual(['c1']);
        expect(store.commentCountOf('a')).toBe(1);
      });

      it('leaves a line whose conversation was never opened alone', async () => {
        const { store, realtime } = await build([line('a')]);
        await store.load(LIST);
        store.recordCommentCount('a', 9);

        realtime.emit('comment.added', comment('c1'));

        // Starting a list from an event would show one comment for a line with nine.
        // The count still moves, which is the behaviour that was already right.
        expect(store.commentsOf('a')).toBeUndefined();
        expect(store.commentCountOf('a')).toBe(10);
      });
    });
  });

  describe('reordering', () => {
    it('renumbers optimistically and keeps the order on success', async () => {
      const { store } = await build([
        line('a', { position: 1 }),
        line('b', { position: 2 }),
      ]);
      await store.load(LIST);

      const outcome = await store.reorder(LIST, ['b', 'a']);

      expect(outcome).toBe('succeeded');
      expect(store.linesIn(LIST).map((l) => l.id)).toEqual(['b', 'a']);
    });

    it('puts the old order back and rereads when the server refuses', async () => {
      // A `validation_failed` means somebody deleted a line mid drag. The person who
      // dragged has done nothing wrong, so the list rereads and says nothing.
      const { store, lines } = await build([
        line('a', { position: 1 }),
        line('b', { position: 2 }),
      ]);
      await store.load(LIST);
      lines.failNext(new Error('gone'));

      const outcome = await store.reorder(LIST, ['b', 'a']);

      expect(outcome).toBe('failed');
      expect(lines.calls.filter((call) => call === 'list').length).toBe(2);
    });
  });

  describe('deleting', () => {
    it('takes the row away at once', async () => {
      const { store } = await build([line('a'), line('b')]);
      await store.load(LIST);

      const outcome = await store.deleteLine('a');

      expect(outcome.state).toBe('deleted');
      expect(store.linesIn(LIST).map((l) => l.id)).toEqual(['b']);
    });

    it('puts it back where it was when the delete fails', async () => {
      const { store, lines } = await build([
        line('a', { position: 1 }),
        line('b', { position: 2 }),
      ]);
      await store.load(LIST);
      lines.failNext(new Error('offline'));

      const outcome = await store.deleteLine('a');

      expect(outcome.state).toBe('failed');
      expect(store.linesIn(LIST).map((l) => l.id)).toEqual(['a', 'b']);
    });
  });

  /**
   * The third indicator (backend plan 0052).
   *
   * Two halves, and the second is the one plan 0051 did not answer: the event moves
   * it for a client that is watching, and the **read** carries it for one that was
   * asleep in a pocket while somebody generated a basket. An indicator that is right
   * only for whoever happened to be connected is worse than absent.
   */
  describe('who is out buying it (backend plan 0052)', () => {
    it('reads the claim off the line rather than waiting for an event', async () => {
      const { store } = await build([
        line('a', { claimed: true, claimedByUserId: 'user-ana' }),
      ]);

      await store.load(LIST);

      expect(store.claimOf('a')).toBe('user-ana');
    });

    it('marks every line one event names, because a run claims them together', async () => {
      // One event per zone rather than one per line (backend plan 0052, section
      // 3.1): a run takes every wanted line of every list it drew from.
      const { store, realtime } = await build([line('a'), line('b')]);
      await store.load(LIST);

      realtime.emit('line.claimChanged', {
        zoneId: 'zone-1',
        claimed: true,
        claimedByUserId: 'user-ana',
        lines: [
          { lineId: 'a', listId: LIST },
          { lineId: 'b', listId: LIST },
        ],
      });

      expect(store.claimOf('a')).toBe('user-ana');
      expect(store.claimOf('b')).toBe('user-ana');
    });

    it('lets go when the trip is over', async () => {
      const { store, realtime } = await build([
        line('a', { claimed: true, claimedByUserId: 'user-ana' }),
      ]);
      await store.load(LIST);

      realtime.emit('line.claimChanged', {
        zoneId: 'zone-1',
        claimed: false,
        claimedByUserId: null,
        lines: [{ lineId: 'a', listId: LIST }],
      });

      expect(store.claimOf('a')).toBeNull();
    });

    it('names nobody for a claim whose owner has left the zone', async () => {
      // Section 6: the line still reads as claimed and there is no name to put on
      // it, so the map that holds names has no entry.
      const { store } = await build([
        line('a', { claimed: true, claimedByUserId: null }),
      ]);

      await store.load(LIST);

      expect(store.claimOf('a')).toBeNull();
      expect(store.linesIn(LIST)[0].claimed).toBe(true);
    });

    it('ignores a line it has never loaded', async () => {
      // There is no row to mark, and the read that eventually brings the line in
      // carries the claim with it.
      const { store, realtime } = await build([line('a')]);
      await store.load(LIST);

      realtime.emit('line.claimChanged', {
        zoneId: 'zone-1',
        claimed: true,
        claimedByUserId: 'user-ana',
        lines: [{ lineId: 'never-seen', listId: LIST }],
      });

      expect(store.claims().size).toBe(0);
    });
  });
});
