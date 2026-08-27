import type { MyZone, ShoppingListSummary } from '@portfolio/velista/models';
import { selectGroupState } from './select-group-state';

/**
 * Plan 0010 section 3, exhaustively.
 *
 * A pure function is the cheapest thing in the world to test, which is the whole reason
 * the page's state selection is one. The states that matter most here are the two
 * empties, because they render zero rows and mean opposite things.
 */
function zone(overrides: Partial<MyZone> = {}): MyZone {
  return {
    id: 'zone-1',
    name: 'Flat 3B',
    joinCode: 'HK7M2QPD',
    status: 'ACTIVE',
    ownerUserId: 'user-me',
    myRole: 'OWNER',
    myStatus: 'APPROVED',
    counts: {
      memberCount: 1,
      listCount: 0,
      pendingRequestCount: 0,
      firstPendingRequesterName: null,
    },
    lists: [],
    ...overrides,
  };
}

function list(id: string): ShoppingListSummary {
  return {
    id,
    zoneId: 'zone-1',
    name: 'Weekly shop',
    createdByUserId: 'user-me',
    lineCount: 12,
    readyCount: 7,
  };
}

function select(input: {
  zone?: MyZone;
  zoneState?: 'idle' | 'loading' | 'loaded' | 'failed';
  lists?: readonly ShoppingListSummary[];
  listsState?: 'idle' | 'loading' | 'loaded' | 'failed';
  stale?: boolean;
}) {
  return selectGroupState({
    zone: input.zone,
    zoneState: input.zoneState ?? 'loaded',
    lists: input.lists ?? [],
    listsState: input.listsState ?? 'loaded',
    correlationId: 'ref-1',
    stale: input.stale ?? false,
  });
}

describe('selectGroupState', () => {
  describe('before anything has arrived', () => {
    it('is loading with no header on a cold deep link', () => {
      expect(select({ zone: undefined, zoneState: 'loading' })).toEqual({
        kind: 'loading',
        header: null,
      });
    });

    it('is an error only when there is no cached header to fall back on', () => {
      expect(select({ zone: undefined, zoneState: 'failed' })).toEqual({
        kind: 'error',
        correlationId: 'ref-1',
      });
    });

    it('shows the cached header immediately and skeletons only the rows', () => {
      // The acceptance criterion for arriving from the dashboard: a named group at
      // once, and a skeleton for the lists alone.
      const state = select({ zone: zone(), listsState: 'loading' });

      expect(state.kind).toBe('loading');
      expect(state.kind === 'loading' && state.header?.name).toBe('Flat 3B');
    });
  });

  describe('a membership that is still pending', () => {
    it('is its own state, decided before any request', () => {
      const state = select({
        zone: zone({ myStatus: 'PENDING', myRole: 'MEMBER' }),
        // Deliberately `idle`: nothing was asked for, which is the point.
        listsState: 'idle',
      });

      expect(state.kind).toBe('pending');
    });

    it('wins over an ownerless zone, since neither may be read', () => {
      const state = select({
        zone: zone({ myStatus: 'PENDING', status: 'MARKED_FOR_DELETION' }),
      });

      expect(state.kind).toBe('pending');
    });
  });

  describe('a group whose owner has gone', () => {
    it('offers the claim to an admin', () => {
      const state = select({
        zone: zone({
          status: 'MARKED_FOR_DELETION',
          ownerUserId: null,
          myRole: 'ADMIN',
        }),
      });

      expect(state).toMatchObject({ kind: 'ownerless', canClaim: true });
    });

    it('offers nothing to anybody else, including the person who was the owner', () => {
      for (const role of ['OWNER', 'MEMBER'] as const) {
        const state = select({
          zone: zone({
            status: 'MARKED_FOR_DELETION',
            ownerUserId: null,
            myRole: role,
          }),
        });

        expect(state).toMatchObject({ kind: 'ownerless', canClaim: false });
      }
    });
  });

  describe('the two empties, which mean opposite things', () => {
    it('says the group is empty when it has one member and no lists', () => {
      const state = select({
        zone: zone({ counts: { ...zone().counts, memberCount: 1 } }),
      });

      expect(state).toMatchObject({ kind: 'empty', reason: 'no-lists' });
    });

    it('says nothing is shared yet when several members and no readable lists', () => {
      // Section 3.2. `listCount` is filtered per caller and is zero either way, so
      // `memberCount` is the only thing that can tell these apart without a new
      // endpoint. Telling this person "No lists yet" would be false.
      const state = select({
        zone: zone({
          myRole: 'MEMBER',
          counts: { ...zone().counts, memberCount: 4 },
        }),
      });

      expect(state).toMatchObject({ kind: 'empty', reason: 'no-access' });
    });

    it('errs towards asking rather than towards claiming a populated group is empty', () => {
      // The heuristic is wrong for four people who genuinely have no lists, and this
      // records that it is wrong in the harmless direction on purpose.
      const state = select({
        zone: zone({ counts: { ...zone().counts, memberCount: 4 } }),
      });

      expect(state).toMatchObject({ reason: 'no-access' });
    });
  });

  describe('loaded', () => {
    it('maps the lists to rows with both counts', () => {
      const state = select({ zone: zone(), lists: [list('list-1')] });

      expect(state).toMatchObject({
        kind: 'loaded',
        lists: [{ id: 'list-1', lineCount: 12, readyCount: 7 }],
      });
    });
  });

  describe('the header, and rule G2', () => {
    it('reads staff from myRole and never from the counts', () => {
      // The count says "you may not see who is waiting", and the role says the caller
      // is an admin. The role wins for controls; the count only decides the number.
      const state = select({
        zone: zone({
          myRole: 'ADMIN',
          counts: { ...zone().counts, pendingRequestCount: null },
        }),
        lists: [list('list-1')],
      });

      expect(state.kind === 'loaded' && state.header).toMatchObject({
        isStaff: true,
        isOwner: false,
        pendingRequestCount: null,
      });
    });

    it('is not staff for a plain member holding a stale non-null count', () => {
      const state = select({
        zone: zone({
          myRole: 'MEMBER',
          counts: { ...zone().counts, pendingRequestCount: 3 },
        }),
        lists: [list('list-1')],
      });

      expect(state.kind === 'loaded' && state.header).toMatchObject({
        isStaff: false,
        pendingRequestCount: 3,
      });
    });

    it('carries the stale flag through, so the page can say it is not live', () => {
      const state = select({
        zone: zone(),
        lists: [list('list-1')],
        stale: true,
      });

      expect(state.kind === 'loaded' && state.header.stale).toBe(true);
    });

    it('takes the initial as a code point, so an emoji does not split', () => {
      const state = select({
        zone: zone({ name: '🏠 Home' }),
        lists: [list('list-1')],
      });

      expect(state.kind === 'loaded' && state.header.initial).toBe('🏠');
    });
  });
});
