import type {
  Line,
  ListPageState,
  ListPermission,
  ShoppingListSummary,
} from '@portfolio/velista/models';
import { selectListState, type ListStateInput } from './select-list-state';

/**
 * Plan 0012 section 8, the half that is a property of the data rather than of the DOM,
 * and plan 0030's whole permission matrix on top of it.
 *
 * Every one of these would otherwise need a component, a fixture and a query. They are
 * assertions about what the page **is**, so they are made against the function that
 * decides it, which is the entire reason that function is pure and exported. That is
 * doubly true of the matrix: acceptance items 1 to 3, 5 and 6 each describe a caller
 * holding one combination of four permissions, and four accounts and a share sheet is
 * exactly what section 10 says not to need for them.
 */

const ME = 'user-me';
const LIST_ID = 'list-1';

/** The four callers plan 0030 section 4 tabulates, named the way the plan names them. */
const READ_ONLY: readonly ListPermission[] = ['READ'];
const WRITER: readonly ListPermission[] = ['READ', 'WRITE'];
const DECIDER: readonly ListPermission[] = ['READ', 'DECIDE'];
const BOTH: readonly ListPermission[] = ['READ', 'WRITE', 'DECIDE'];
/** Group staff, and a list admin who was granted the rest beside it, look the same. */
const ADMIN: readonly ListPermission[] = ['READ', 'WRITE', 'DECIDE', 'MANAGE'];

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

function list(
  overrides: Partial<ShoppingListSummary> = {}
): ShoppingListSummary {
  return {
    id: LIST_ID,
    zoneId: 'zone-1',
    name: 'Weekly shop',
    createdByUserId: ME,
    autoApproveLines: false,
    lineCount: 12,
    readyCount: 7,
    myPermissions: ADMIN,
    ...overrides,
  };
}

/**
 * The default caller holds everything, which keeps every spec that is not about
 * permissions reading as it did before plan 0030. A spec that **is** about them says so
 * by naming one of the five sets above.
 */
function select(overrides: Partial<ListStateInput> = {}): ListPageState {
  return selectListState({
    list: list(),
    zoneName: 'Flat 3B',
    lines: [line()],
    linesState: 'loaded',
    linesComplete: true,
    writes: new Map(),
    commentCounts: new Map(),
    caller: { permissions: ADMIN },
    nameOf: () => null,
    reordering: false,
    viewers: [],
    editorOf: () => null,
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
  // Plan 0022, section 3.4. The two indicators this screen earns, and the rule that
  // neither of them is allowed to decide anything.
  describe('presence', () => {
    it('puts who else is shopping into the header', () => {
      const state = select({ viewers: ['Ana', 'Marc'] });

      expect(loaded(state).header.viewers).toEqual(['Ana', 'Marc']);
    });

    it('says nobody rather than zero when the caller is alone', () => {
      expect(loaded(select()).header.viewers).toEqual([]);
    });

    it('names whoever is editing a line, on that line', () => {
      const state = select({
        lines: [line({ id: 'line-1' }), line({ id: 'line-2', position: 2 })],
        editorOf: (lineId) => (lineId === 'line-1' ? 'Ana' : null),
      });

      expect(loaded(state).lines.map((row) => row.editor)).toEqual([
        'Ana',
        null,
      ]);
    });

    // Section 3: advisory and only advisory. Somebody else editing changes nothing
    // about what the row is or what a tap on it does, and a guard built on presence
    // would refuse an edit nobody is making.
    it('changes nothing else about a line somebody else is editing', () => {
      const withEditor = loaded(select({ editorOf: () => 'Ana' })).lines[0];
      const without = loaded(select()).lines[0];

      expect(withEditor).toEqual({ ...without, editor: 'Ana' });
    });

    // The sheet cannot be opened from a row in reorder mode, so an indicator there
    // would be about a screen the reader cannot get to.
    it('names nobody while the list is being put in order', () => {
      const state = select({ reordering: true, editorOf: () => 'Ana' });

      expect(loaded(state).lines[0]?.editor).toBeNull();
    });
  });

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

  // Plan 0030, section 3. Four membership tests on the set the server sent, and nothing
  // inferred from a zone role or from a refusal.
  describe('the abilities, from the permission set', () => {
    function abilities(permissions: readonly ListPermission[]) {
      return loaded(select({ caller: { permissions } })).abilities;
    }

    it('reads an empty set as read only, and says so once', () => {
      // The deliberate inversion of the old optimism (section 3.2). An absent or
      // unreadable `myPermissions` arrives here as the empty set for this reason.
      expect(abilities([])).toEqual({
        canWrite: false,
        canDecide: false,
        canComment: false,
        canManage: false,
        readOnly: true,
      });
    });

    it('reads READ alone the same way', () => {
      expect(abilities(READ_ONLY).readOnly).toBe(true);
    });

    it('gives a writer the composer and not the tick', () => {
      expect(abilities(WRITER)).toMatchObject({
        canWrite: true,
        canDecide: false,
        readOnly: false,
      });
    });

    it('gives a decider the tick and not the composer', () => {
      expect(abilities(DECIDER)).toMatchObject({
        canWrite: false,
        canDecide: true,
      });
    });

    it('lets both of them comment, and a reader not', () => {
      // The new restriction, and a visible removal for anybody holding READER today
      // (section 3.1). `comment.add` follows WRITE or DECIDE now.
      expect(abilities(WRITER).canComment).toBe(true);
      expect(abilities(DECIDER).canComment).toBe(true);
      expect(abilities(READ_ONLY).canComment).toBe(false);
    });

    it('does not read MANAGE as any of the other three', () => {
      // Backend plan 0036's call site table is what the server enforces: `line.add`
      // asks for WRITE and `comment.add` for WRITE or DECIDE. Widening these would draw
      // a composer the server refuses every use of, which is what rule G2 forbids.
      // What MANAGE really buys is per row, and the edit and delete specs below have it.
      expect(abilities(['READ', 'MANAGE'])).toMatchObject({
        canWrite: false,
        canDecide: false,
        canComment: false,
        canManage: true,
        readOnly: false,
      });
    });

    it('takes no notice of who created the list', () => {
      // The creator's power is an ordinary access row now (backend plan 0036, section
      // 2.5), so their id decides nothing here and a group admin can revoke it.
      const state = select({
        list: list({ createdByUserId: ME, myPermissions: READ_ONLY }),
        caller: { permissions: READ_ONLY },
      });

      expect(loaded(state).abilities.canManage).toBe(false);
    });

    it('drops an unrecognised permission rather than defaulting it', () => {
      // The mapper owns that (rule D4), and this is the half of it this function has to
      // agree with: a set it did not fully understand still answers for what it did.
      const state = select({
        caller: {
          permissions: ['READ', 'WRITE', 'TELEPORT'] as ListPermission[],
        },
      });

      expect(loaded(state).abilities).toMatchObject({
        canWrite: true,
        canDecide: false,
        canManage: false,
      });
    });
  });

  // Acceptance items 1, 2, 3, 5 and 6. One caller per description, and the whole row
  // asserted rather than one field of it, because the failure these guard against is a
  // control left on screen beside the ones that were correctly removed.
  describe('what a row offers, per permission (section 4)', () => {
    const pending = line({ approvalStatus: 'PENDING' });
    const rejected = line({ approvalStatus: 'REJECTED' });
    const missing = line({ status: 'NOT_AVAILABLE' });

    function row(
      permissions: readonly ListPermission[],
      lines: readonly Line[] = [line()]
    ) {
      return loaded(select({ caller: { permissions }, lines })).lines[0];
    }

    it('leaves a read-only caller the conversation and nothing else', () => {
      // Section 3.1 over acceptance item 1: the overflow is the only way into the
      // comments sheet, and a reader keeps reading it. What they lose is the composer
      // inside it, which is the sheet's business rather than the row's.
      expect(row(READ_ONLY)).toMatchObject({
        interactive: false,
        actions: ['comments'],
        editScope: null,
        decidable: false,
        restorable: false,
      });
    });

    it('gives a writer a pending line to edit and delete, and no tick', () => {
      expect(row(WRITER, [pending])).toMatchObject({
        interactive: false,
        actions: ['edit', 'comments', 'delete'],
        editScope: 'full',
        decidable: false,
      });
    });

    it('lets a writer edit and delete a turned down line too', () => {
      expect(row(WRITER, [rejected])).toMatchObject({
        actions: ['edit', 'comments', 'delete'],
        editScope: 'full',
      });
    });

    it('keeps a writer away from an approved line entirely', () => {
      // A writer whose line has been agreed to cannot quietly change what was agreed to
      // (backend plan 0036, section 4.1).
      expect(row(WRITER)).toMatchObject({
        actions: ['comments'],
        editScope: null,
      });
    });

    it('gives a decider the tick, the decisions, and no edit on a pending row', () => {
      expect(row(DECIDER, [pending])).toMatchObject({
        interactive: true,
        actions: ['markNotAvailable', 'comments'],
        editScope: null,
        decidable: true,
      });
    });

    it('gives a decider the quantity and nothing else on an approved row', () => {
      expect(row(DECIDER)).toMatchObject({
        actions: ['edit', 'markNotAvailable', 'comments'],
        editScope: 'quantity',
      });
    });

    it('never lets a decider delete an approved line', () => {
      expect(row(DECIDER).actions).not.toContain('delete');
      expect(row(BOTH).actions).not.toContain('delete');
    });

    it('gives a list admin every field of every line, and the delete', () => {
      expect(row(ADMIN)).toMatchObject({
        interactive: true,
        actions: ['edit', 'markNotAvailable', 'comments', 'delete'],
        editScope: 'full',
      });
      expect(row(ADMIN, [pending]).editScope).toBe('full');
    });

    it('offers putting a line back once it is marked as missing', () => {
      expect(row(BOTH, [missing]).actions).toContain('markPending');
      expect(row(BOTH, [missing]).actions).not.toContain('markNotAvailable');
    });

    it('offers marking it missing to nobody without DECIDE', () => {
      // Saying what the shop had is deciding rather than writing (section 4).
      expect(row(WRITER, [pending]).actions).not.toContain('markNotAvailable');
    });

    it('keeps editScope and the edit entry in step, on every combination', () => {
      // The invariant `LineRowVm.editScope` states, asserted rather than trusted,
      // because the two fields are read by two different components.
      for (const permissions of [READ_ONLY, WRITER, DECIDER, BOTH, ADMIN]) {
        for (const candidate of [line(), pending, rejected, missing]) {
          const one = row(permissions, [candidate]);
          expect(one.actions.includes('edit')).toBe(one.editScope !== null);
        }
      }
    });
  });

  describe('deciding a suggested line', () => {
    const awaiting = line({ approvalStatus: 'PENDING' });

    it('offers the two decisions on a waiting line, to DECIDE', () => {
      const state = select({
        lines: [awaiting],
        caller: { permissions: DECIDER },
      });

      expect(loaded(state).lines[0].decidable).toBe(true);
    });

    it('offers them to a writer, who is not the one deciding', () => {
      const state = select({
        lines: [awaiting],
        caller: { permissions: WRITER },
      });

      expect(loaded(state).lines[0].decidable).toBe(false);
    });

    it('offers a way to put a turned down line back', () => {
      const state = select({
        lines: [line({ approvalStatus: 'REJECTED' })],
        caller: { permissions: DECIDER },
      });

      expect(loaded(state).lines[0]).toMatchObject({
        decidable: false,
        restorable: true,
      });
    });

    it('does not offer a decision on a line that is already settled', () => {
      expect(loaded(select()).lines[0]).toMatchObject({
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
    const two = [
      line({ id: 'a', position: 1 }),
      line({ id: 'b', position: 2 }),
    ];

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
      const state = select({ lines: two, caller: { permissions: READ_ONLY } });

      expect(loaded(state).canReorder).toBe(false);
    });

    it('follows WRITE, not the tick', () => {
      // Reordering rewrites what the list asks for rather than what the shop had, so it
      // stayed with `canWrite` when ticking moved to `canDecide` (section 4).
      expect(
        loaded(select({ lines: two, caller: { permissions: DECIDER } }))
          .canReorder
      ).toBe(false);
      expect(
        loaded(select({ lines: two, caller: { permissions: WRITER } }))
          .canReorder
      ).toBe(true);
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

  // Acceptance item 7, and plan 0030 section 5. The page passes `autoApproveLines` to
  // `LineStore.addLine`, which builds the placeholder with the approval the server is
  // about to give it, so it has to reach the loaded state at all.
  describe('the list configuration the page has to hand down', () => {
    it('carries the list auto-approve setting through', () => {
      const state = select({ list: list({ autoApproveLines: true }) });

      expect(loaded(state).autoApproveLines).toBe(true);
    });

    it('answers false while the list itself has not landed', () => {
      // The safe direction: a placeholder drawn PENDING and corrected to APPROVED is a
      // row settling down, and the reverse is an approve button flashing.
      expect(loaded(select({ list: undefined })).autoApproveLines).toBe(false);
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
