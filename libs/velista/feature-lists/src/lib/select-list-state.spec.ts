import type {
  Line,
  ListPageState,
  ShoppingListSummary,
} from '@portfolio/velista/models';
import { selectListState, type ListStateInput } from './select-list-state';

/**
 * Plan 0012 section 8, the half that is a property of the data rather than of the DOM.
 *
 * Every one of these would otherwise need a component, a fixture and a query. They are
 * assertions about what the page **is**, so they are made against the function that
 * decides it, which is the entire reason that function is pure and exported.
 */

const ME = 'user-me';
const LIST_ID = 'list-1';

function line(overrides: Partial<Line> = {}): Line {
  return {
    id: 'ln-1',
    listId: LIST_ID,
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

function list(overrides: Partial<ShoppingListSummary> = {}): ShoppingListSummary {
  return {
    id: LIST_ID,
    zoneId: 'zone-1',
    name: 'Weekly shop',
    createdByUserId: ME,
    lineCount: 12,
    readyCount: 7,
    ...overrides,
  };
}

function select(overrides: Partial<ListStateInput> = {}): ListPageState {
  return selectListState({
    list: list(),
    zoneName: 'Flat 3B',
    lines: [line()],
    linesState: 'loaded',
    linesComplete: true,
    writes: new Map(),
    commentCounts: new Map(),
    caller: { userId: ME, isStaff: false, knownReader: false },
    nameOf: () => null,
    reordering: false,
    live: true,
    errorKey: null,
    correlationId: null,
    gone: null,
    ...overrides,
  });
}

/** Narrows to the loaded branch, failing loudly rather than silently skipping. */
function loaded(state: ListPageState) {
  if (state.kind !== 'loaded') {
    throw new Error(`expected a loaded page, got ${state.kind}`);
  }
  return state;
}

describe('selectListState', () => {
  describe('the header, and rule L2', () => {
    it('names the list from the cache while the lines are still loading', () => {
      // The common path: the caller arrived from the group page, so the list is
      // cached and the title is there on the first frame. Only the lines skeleton.
      const state = select({ linesState: 'loading' });

      expect(state.kind).toBe('loading');
      expect(state.kind === 'loading' && state.header.listName).toBe(
        'Weekly shop'
      );
    });

    it('skeletons the title on a cold arrival and still loads the lines', () => {
      const state = select({ list: undefined, linesState: 'loading' });

      expect(state.kind).toBe('loading');
      expect(state.kind === 'loading' && state.header.listName).toBeNull();
    });

    it('counts from the cached summary before the lines arrive', () => {
      const state = select({ linesState: 'loading' });

      expect(state.kind === 'loading' && state.header).toMatchObject({
        readyCount: 7,
        lineCount: 12,
      });
    });

    it('counts from the lines themselves once they are here', () => {
      // The lines are optimistic, so the counter has to move with the thumb rather
      // than lag a tap behind it.
      const state = select({
        lines: [
          line({ id: 'a', status: 'READY' }),
          line({ id: 'b', status: 'PENDING', position: 2 }),
        ],
      });

      expect(loaded(state).header).toMatchObject({
        readyCount: 1,
        lineCount: 2,
      });
    });
  });

  describe('the two state machines in one row (section 3.4)', () => {
    it('draws an approved pending line as the ordinary row', () => {
      const row = loaded(select()).lines[0];

      expect(row).toMatchObject({ struck: false, captionKey: null });
    });

    it('strikes a ready line through and gives it no caption', () => {
      const state = select({ lines: [line({ status: 'READY' })] });

      expect(loaded(state).lines[0]).toMatchObject({
        struck: true,
        captionKey: null,
      });
    });

    it('captions a line the shop did not have', () => {
      const state = select({ lines: [line({ status: 'NOT_AVAILABLE' })] });

      expect(loaded(state).lines[0]).toMatchObject({
        struck: true,
        captionKey: 'list.line.notAvailable',
      });
    });

    it('captions a line waiting for approval, whatever its item status', () => {
      const state = select({
        lines: [line({ approvalStatus: 'PENDING', status: 'READY' })],
      });

      // Approval wins the caption: a line nobody has agreed to is a more urgent thing
      // to say than a shop not having it, and a row only ever grows one second line.
      expect(loaded(state).lines[0].captionKey).toBe(
        'list.line.awaitingApproval'
      );
    });

    it('keeps a turned down line on the list, quiet and last', () => {
      const state = select({
        lines: [
          line({ id: 'rejected', approvalStatus: 'REJECTED', position: 1 }),
          line({ id: 'ordinary', position: 2 }),
        ],
      });

      const ids = loaded(state).lines.map((row) => row.id);
      expect(ids).toEqual(['ordinary', 'rejected']);
      expect(loaded(state).lines[1]).toMatchObject({
        struck: true,
        captionKey: 'list.line.rejected',
      });
    });

    it('orders everything else by position', () => {
      const state = select({
        lines: [
          line({ id: 'c', position: 9 }),
          line({ id: 'a', position: 1 }),
          line({ id: 'b', position: 5 }),
        ],
      });

      expect(loaded(state).lines.map((row) => row.id)).toEqual(['a', 'b', 'c']);
    });
  });

  describe('who may do what', () => {
    it('offers the composer to a caller not known to be a reader', () => {
      // Optimistic, and it has to be: `ListView` carries no role for the caller and
      // there is no `GET /v1/lists/:id/access`, so the only person the client can know
      // is a writer is the one who created the list.
      const state = select({
        caller: { userId: 'somebody-else', isStaff: false, knownReader: false },
      });

      expect(loaded(state).abilities.canWrite).toBe(true);
    });

    it('takes the composer away once a write has been refused', () => {
      const state = select({
        caller: { userId: 'reader', isStaff: false, knownReader: true },
      });

      expect(loaded(state).abilities).toMatchObject({
        canWrite: false,
        knownReader: true,
      });
    });

    it('leaves a reader nothing tappable and only the comment affordance', () => {
      const state = select({
        caller: { userId: 'reader', isStaff: false, knownReader: true },
      });

      expect(loaded(state).lines[0]).toMatchObject({
        interactive: false,
        actions: ['comments'],
      });
    });

    it('lets the creator manage the list', () => {
      expect(loaded(select()).abilities.canManage).toBe(true);
    });

    it('lets zone staff manage a list they did not create', () => {
      // `requireManage` is the creator, a zone admin, or the owner, which is a
      // different rule from the write access that gates lines.
      const state = select({
        list: list({ createdByUserId: 'somebody-else' }),
        caller: { userId: ME, isStaff: true, knownReader: false },
      });

      expect(loaded(state).abilities.canManage).toBe(true);
    });

    it('does not let a plain writer rename a list they did not create', () => {
      const state = select({
        list: list({ createdByUserId: 'somebody-else' }),
        caller: { userId: ME, isStaff: false, knownReader: false },
      });

      expect(loaded(state).abilities.canManage).toBe(false);
    });
  });

  describe('deciding a suggested line', () => {
    const awaiting = line({ approvalStatus: 'PENDING' });

    it('offers the two decisions to staff, on a waiting line', () => {
      const state = select({
        lines: [awaiting],
        caller: { userId: ME, isStaff: true, knownReader: false },
      });

      expect(loaded(state).lines[0].decidable).toBe(true);
    });

    it('offers them to nobody else', () => {
      const state = select({ lines: [awaiting] });

      expect(loaded(state).lines[0].decidable).toBe(false);
    });

    it('offers staff a way to put a turned down line back', () => {
      const state = select({
        lines: [line({ approvalStatus: 'REJECTED' })],
        caller: { userId: ME, isStaff: true, knownReader: false },
      });

      expect(loaded(state).lines[0]).toMatchObject({
        decidable: false,
        restorable: true,
      });
    });

    it('does not offer a decision on a line that is already settled', () => {
      const state = select({
        caller: { userId: ME, isStaff: true, knownReader: false },
      });

      expect(loaded(state).lines[0]).toMatchObject({
        decidable: false,
        restorable: false,
      });
    });
  });

  describe('a write in flight (section 3.3)', () => {
    it('marks the row pending and leaves it interactive', () => {
      // A second tap supersedes the first. Blocking it would make the app feel slow
      // on exactly the connection it was designed for.
      const state = select({
        writes: new Map([['ln-1', { outcome: 'pending', byUserId: null }]]),
      });

      expect(loaded(state).lines[0]).toMatchObject({
        write: 'pending',
        interactive: true,
      });
    });

    it('names whoever overwrote a row, when the name resolves', () => {
      const state = select({
        writes: new Map([
          ['ln-1', { outcome: 'overwritten', byUserId: 'user-toni' }],
        ]),
        nameOf: (userId) => (userId === 'user-toni' ? 'Toni' : null),
      });

      expect(loaded(state).lines[0]).toMatchObject({
        write: 'overwritten',
        overwrittenBy: 'Toni',
      });
    });

    it('leaves the name null rather than showing an id', () => {
      const state = select({
        writes: new Map([
          ['ln-1', { outcome: 'overwritten', byUserId: 'user-gone' }],
        ]),
      });

      expect(loaded(state).lines[0].overwrittenBy).toBeNull();
    });

    it('reports no write state at all for an untouched row', () => {
      expect(loaded(select()).lines[0].write).toBe('none');
    });
  });

  describe('reordering, and rule L4', () => {
    const two = [line({ id: 'a', position: 1 }), line({ id: 'b', position: 2 })];

    it('is available once every page has arrived', () => {
      expect(loaded(select({ lines: two })).canReorder).toBe(true);
    });

    it('is unavailable while a page is still outstanding', () => {
      // `line.reorder` renumbers exactly the lines it names, so reordering a half read
      // list leaves two lines on the same position.
      const state = select({ lines: two, linesComplete: false });

      expect(loaded(state).canReorder).toBe(false);
    });

    it('is unavailable to a reader', () => {
      const state = select({
        lines: two,
        caller: { userId: 'reader', isStaff: false, knownReader: true },
      });

      expect(loaded(state).canReorder).toBe(false);
    });

    it('is pointless on a single line and is not offered', () => {
      expect(loaded(select()).canReorder).toBe(false);
    });

    it('turns ticking off, and empties the overflow, while the mode is on', () => {
      const state = select({ lines: two, reordering: true });

      expect(loaded(state).lines[0]).toMatchObject({
        interactive: false,
        actions: [],
      });
    });
  });

  describe('the overflow', () => {
    it('offers marking a line as missing, and putting it back once it is', () => {
      expect(loaded(select()).lines[0].actions).toContain('markNotAvailable');

      const missing = select({ lines: [line({ status: 'NOT_AVAILABLE' })] });
      expect(loaded(missing).lines[0].actions).toContain('markPending');
      expect(loaded(missing).lines[0].actions).not.toContain(
        'markNotAvailable'
      );
    });
  });

  describe('the comment count', () => {
    it('is undefined when the client has never seen the comments', () => {
      // Nothing on the wire carries one: `LineView` has no such field. A confident
      // zero on a line with nine comments would be worse than nothing.
      expect(loaded(select()).lines[0].commentCount).toBeUndefined();
    });

    it('is the number the client actually counted', () => {
      const state = select({ commentCounts: new Map([['ln-1', 3]]) });

      expect(loaded(state).lines[0].commentCount).toBe(3);
    });
  });

  describe('the states that are not the list', () => {
    it('reports an empty list as loaded rather than as its own state', () => {
      const state = select({ lines: [] });

      expect(loaded(state).empty).toBe(true);
    });

    it('reports the page gone before anything else', () => {
      // Ahead of the error branch: a caller whose access was withdrawn should read
      // the sentence about that rather than a generic failure.
      const state = select({ gone: 'unshared', errorKey: 'list.error.failed' });

      expect(state).toEqual({ kind: 'gone', reason: 'unshared' });
    });

    it('carries the correlation id through an error', () => {
      const state = select({
        errorKey: 'list.error.notAvailable',
        correlationId: 'ref-1',
      });

      expect(state).toEqual({
        kind: 'error',
        messageKey: 'list.error.notAvailable',
        correlationId: 'ref-1',
      });
    });

    it('says the list is not live when the room was refused', () => {
      const state = select({ live: false });

      expect(loaded(state).header.live).toBe(false);
    });
  });
});
