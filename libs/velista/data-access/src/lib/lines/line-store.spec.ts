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

function line(id: string, overrides: Partial<Line> = {}): Line {
  return {
    id,
    listId: LIST,
    content: 'Sourdough loaf',
    quantity: 1,
    itemId: null,
    position: 1,
    approvalStatus: 'APPROVED',
    status: 'PENDING',
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
  const calls: string[] = [];

  const answer = async (fallback: Line): Promise<Line> => {
    calls.push('write');
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
        line('server-id', { listId, content, quantity: quantity ?? 1, version: 1 })
      ),
    updateLine: async (lineId, changes) =>
      answer(line(lineId, { ...changes, version: 2 })),
    setStatus: async (lineId, status) => answer(line(lineId, { status, version: 2 })),
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
      expect(lines.calls.filter((call) => call === 'list').length).toBeGreaterThan(
        1
      );
    });
  });

  describe('an optimistic add, and its identity problem', () => {
    it('shows the row before the server answers', async () => {
      const { store } = await build();
      await store.load(LIST);

      const adding = store.addLine(LIST, 'Milk', 2, ME);

      // Already on screen, under a client key, because there is no server id yet.
      expect(store.linesIn(LIST)).toHaveLength(1);
      expect(store.linesIn(LIST)[0].content).toBe('Milk');

      await adding;
    });

    it('replaces the local row with the server one rather than adding a second', async () => {
      const { store } = await build();
      await store.load(LIST);

      const outcome = await store.addLine(LIST, 'Milk', 2, ME);

      expect(outcome.state).toBe('added');
      expect(store.linesIn(LIST)).toHaveLength(1);
      expect(store.linesIn(LIST)[0].id).toBe('server-id');
    });

    it('does not draw a second row when its own event echoes back', async () => {
      // The identity problem section 5.2 is about: the event cannot be matched by id
      // against a row that had none, so the store remembers the ids it minted.
      const { store, realtime } = await build();
      await store.load(LIST);
      await store.addLine(LIST, 'Milk', 2, ME);

      realtime.emit(
        'line.added',
        line('server-id', { content: 'Milk', quantity: 2 })
      );

      expect(store.linesIn(LIST)).toHaveLength(1);
    });

    it('inserts somebody else’s line', async () => {
      const { store, realtime } = await build([line('a')]);
      await store.load(LIST);

      realtime.emit('line.added', line('theirs', { position: 2 }));

      expect(store.linesIn(LIST).map((l) => l.id)).toEqual(['a', 'theirs']);
    });

    it('takes the row away again when the add fails', async () => {
      // Unlike an edit there is nothing to snap back to: the line never existed, and
      // leaving it would be an item somebody believes is on a shared list.
      const { store, lines } = await build();
      await store.load(LIST);
      lines.failNext(new Error('offline'));

      const outcome = await store.addLine(LIST, 'Milk', 1, ME);

      expect(outcome.state).toBe('failed');
      expect(store.linesIn(LIST)).toHaveLength(0);
    });
  });

  describe('ticking a line off (section 3.3)', () => {
    it('changes the row before the request resolves', async () => {
      const { store } = await build([line('a')]);
      await store.load(LIST);

      const writing = store.setStatus('a', 'READY');

      expect(store.linesIn(LIST)[0].status).toBe('READY');
      expect(store.writeNoteOf('a')?.outcome).toBe('pending');

      await writing;
    });

    it('reports nothing at all on success, because the change was the feedback', async () => {
      const { store } = await build([line('a')]);
      await store.load(LIST);

      const outcome = await store.setStatus('a', 'READY');

      expect(outcome).toBe('succeeded');
      expect(store.writeNoteOf('a')).toBeNull();
    });

    it('snaps the row back and leaves an inline note when it fails', async () => {
      const { store, lines } = await build([line('a', { status: 'PENDING' })]);
      await store.load(LIST);
      lines.failNext(new Error('offline'));

      const outcome = await store.setStatus('a', 'READY');

      expect(outcome).toBe('failed');
      expect(store.linesIn(LIST)[0].status).toBe('PENDING');
      expect(store.writeNoteOf('a')?.outcome).toBe('failed');
    });

    it('reports overwritten when the server moved further than this write alone', async () => {
      const { store, lines } = await build([line('a', { version: 1 })]);
      await store.load(LIST);
      // Version 3 off a base of 1: somebody else's change landed in between.
      lines.answerNext(line('a', { status: 'READY', version: 3 }));

      const outcome = await store.setStatus('a', 'READY');

      expect(outcome).toBe('overwritten');
      expect(store.writeNoteOf('a')?.outcome).toBe('overwritten');
    });

    it('shows the server’s value once the write has landed', async () => {
      const { store, lines } = await build([line('a')]);
      await store.load(LIST);
      lines.answerNext(line('a', { content: 'Theirs', version: 3 }));

      await store.setStatus('a', 'READY');

      expect(store.linesIn(LIST)[0].content).toBe('Theirs');
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
      const { store, realtime } = await build([line('a', { content: 'Bread' })]);
      await store.load(LIST);

      realtime.emit('line.updated', line('a', { content: 'Theirs', version: 2 }));

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
});
