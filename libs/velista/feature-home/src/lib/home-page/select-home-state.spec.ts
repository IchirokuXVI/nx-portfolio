import type { Identity, MyZone } from '@portfolio/velista/models';
import { selectHomeState } from './select-home-state';

/**
 * Plan 0003's acceptance criterion: unit tests cover the state selection logic.
 *
 * It is a pure function precisely so this can be exhaustive without a fixture, a
 * TestBed, or a fake backend (plan 0004, section 2.3).
 */

const anonymous: Identity = { kind: 'anonymous' };
const registered: Identity = { kind: 'REGISTERED', userId: 'u1' };
const guest: Identity = { kind: 'TEMPORARY', userId: 'u1' };

function zone(overrides: Partial<MyZone> = {}): MyZone {
  return {
    id: 'z1',
    name: 'Flat 3B',
    joinCode: 'FLAT3B',
    status: 'ACTIVE',
    ownerUserId: 'u1',
    myRole: 'OWNER',
    myStatus: 'APPROVED',
    summary: {
      memberCount: 3,
      listCount: 2,
      pendingRequestCount: 0,
      firstPendingRequesterName: null,
      lists: [{ id: 'l1', name: 'Weekly shop', lineCount: 12, readyCount: 7 }],
    },
    ...overrides,
  };
}

function select(
  overrides: Partial<Parameters<typeof selectHomeState>[0]> = {}
) {
  return selectHomeState({
    identity: registered,
    zones: [zone()],
    loadState: 'loaded',
    correlationId: null,
    resumeListId: null,
    guestBannerDismissed: false,
    ...overrides,
  });
}

/**
 * Narrows to the populated variant so a test can read a zone card directly.
 *
 * `toMatchObject` is ambiguous about a key expected to be `undefined` versus one that
 * is absent, and "the row is not there" is exactly that distinction, so those
 * assertions go through here instead.
 */
function firstZone(state: ReturnType<typeof selectHomeState>) {
  if (state.kind !== 'populated') {
    throw new Error(`expected a populated state, got ${state.kind}`);
  }
  return state.zones[0];
}

describe('selectHomeState', () => {
  describe('which state wins', () => {
    it('shows the anonymous screen with no token', () => {
      expect(select({ identity: anonymous }).kind).toBe('anonymous');
    });

    it('prefers anonymous over a stale load state from a previous session', () => {
      // Otherwise somebody who signed out sees a signed-in shape for a frame.
      expect(select({ identity: anonymous, loadState: 'failed' }).kind).toBe(
        'anonymous'
      );
    });

    it('shows the error state when the load failed', () => {
      const state = select({ loadState: 'failed', correlationId: 'ref-1' });

      expect(state).toEqual({ kind: 'error', correlationId: 'ref-1' });
    });

    it('treats idle as loading', () => {
      // Idle is the instant before the container's constructor starts the load.
      // Rendering "no groups yet" there flashes an empty state at every returning
      // user.
      expect(select({ loadState: 'idle', zones: [] }).kind).toBe('loading');
      expect(select({ loadState: 'loading', zones: [] }).kind).toBe('loading');
    });

    it('shows the empty state for an authenticated user with no groups', () => {
      expect(select({ zones: [] })).toEqual({ kind: 'empty', guest: false });
    });

    it('shows the populated state when there are groups', () => {
      expect(select().kind).toBe('populated');
    });
  });

  describe('the guest banner', () => {
    it('appears for a temporary user only', () => {
      expect(select({ identity: guest })).toMatchObject({ guest: true });
      expect(select({ identity: registered })).toMatchObject({ guest: false });
    });

    it('appears on the empty state too, where the risk is identical', () => {
      expect(select({ identity: guest, zones: [] })).toMatchObject({
        guest: true,
      });
    });

    it('stays hidden once dismissed in this session', () => {
      expect(
        select({ identity: guest, guestBannerDismissed: true })
      ).toMatchObject({ guest: false });
    });
  });

  describe('zone cards', () => {
    it('derives the initial, upper cased', () => {
      const state = select({ zones: [zone({ name: 'flat 3B' })] });

      expect(state).toMatchObject({ zones: [{ initial: 'F' }] });
    });

    it('takes a whole code point for the initial, not half a surrogate pair', () => {
      const state = select({ zones: [zone({ name: '🏠 Home' })] });

      expect(state).toMatchObject({ zones: [{ initial: '🏠' }] });
    });

    it('is tappable when active and approved', () => {
      expect(select()).toMatchObject({ zones: [{ tappable: true }] });
    });

    it('is not tappable while the membership is pending', () => {
      const state = select({ zones: [zone({ myStatus: 'PENDING' })] });

      expect(state).toMatchObject({
        zones: [{ tappable: false, waitingOn: expect.any(String) }],
      });
    });

    it('hides list content from a pending member', () => {
      // They have not been let in, so the preview would leak the group's contents.
      const state = select({ zones: [zone({ myStatus: 'PENDING' })] });

      expect(state).toMatchObject({ zones: [{ lists: [] }] });
    });

    it('is not tappable when the zone is being torn down', () => {
      const state = select({
        zones: [zone({ status: 'MARKED_FOR_DELETION' })],
      });

      expect(state).toMatchObject({ zones: [{ tappable: false }] });
    });

    it('is not tappable for a status this build does not recognise', () => {
      // Plan 0003 open question 2: the page must not break on it. A card that
      // cannot be opened is how that is honoured.
      const state = select({ zones: [zone({ status: 'UNKNOWN' })] });

      expect(state).toMatchObject({ zones: [{ tappable: false }] });
    });

    it('passes the counts through, and leaves them undefined when absent', () => {
      const withSummary = select();
      expect(withSummary).toMatchObject({
        zones: [{ memberCount: 3, listCount: 2 }],
      });

      const without = select({ zones: [zone({ summary: undefined })] });
      expect(without).toMatchObject({
        zones: [{ memberCount: undefined, listCount: undefined, lists: [] }],
      });
    });
  });

  describe('the join request row', () => {
    function withRequests(count: number, role: MyZone['myRole'] = 'OWNER') {
      return select({
        zones: [
          zone({
            myRole: role,
            summary: {
              memberCount: 3,
              listCount: 1,
              pendingRequestCount: count,
              firstPendingRequesterName: 'Ines',
              lists: [],
            },
          }),
        ],
      });
    }

    it('names the requester and counts the others, excluding them', () => {
      // Three waiting reads "Ines and 2 more", never "and 3 more".
      expect(withRequests(3)).toMatchObject({
        zones: [{ joinRequests: { firstName: 'Ines', othersCount: 2 } }],
      });
    });

    it('reports zero others for a single request, which selects the singular key', () => {
      expect(withRequests(1)).toMatchObject({
        zones: [{ joinRequests: { firstName: 'Ines', othersCount: 0 } }],
      });
    });

    it('is absent when nobody is waiting', () => {
      expect(firstZone(withRequests(0)).joinRequests).toBeUndefined();
    });

    it('is absent for a member who could not act on it anyway', () => {
      // Its presence in the view model implies the permission, so the template
      // never has to re-check a role.
      expect(firstZone(withRequests(3, 'MEMBER')).joinRequests).toBeUndefined();
    });

    it('is shown to an admin as well as an owner', () => {
      expect(withRequests(2, 'ADMIN')).toMatchObject({
        zones: [{ joinRequests: { othersCount: 1 } }],
      });
    });
  });

  describe('the resume card', () => {
    it('resolves the remembered list against the loaded zones', () => {
      const state = select({ resumeListId: 'l1' });

      expect(state).toMatchObject({
        resume: {
          listId: 'l1',
          listName: 'Weekly shop',
          zoneName: 'Flat 3B',
          lineCount: 12,
          readyCount: 7,
        },
      });
    });

    it('is absent when nothing was remembered', () => {
      expect(select()).toMatchObject({ resume: null });
    });

    it('is absent when the remembered list is no longer reachable', () => {
      // After being removed from a group. Offering a card that leads to a 403 is
      // worse than offering none.
      expect(select({ resumeListId: 'gone' })).toMatchObject({ resume: null });
    });
  });
});
