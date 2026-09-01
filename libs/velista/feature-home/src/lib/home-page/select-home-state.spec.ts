import type { Identity, MyZone } from '@portfolio/velista/models';
import { selectHomeState } from './select-home-state';

/**
 * Plan 0003's acceptance criterion: unit tests cover the state selection logic.
 *
 * It is a pure function precisely so this can be exhaustive without a fixture, a
 * TestBed, or a fake backend (plan 0004, section 2.3).
 */

const registered: Identity = {
  kind: 'REGISTERED',
  userId: 'u1',
  username: 'dani',
};
const guest: Identity = { kind: 'TEMPORARY', userId: 'u1', username: 'guest' };

function zone(overrides: Partial<MyZone> = {}): MyZone {
  return {
    id: 'z1',
    name: 'Flat 3B',
    joinCode: 'FLAT3B',
    status: 'ACTIVE',
    ownerUserId: 'u1',
    myRole: 'OWNER',
    myStatus: 'APPROVED',
    counts: {
      memberCount: 3,
      listCount: 2,
      pendingRequestCount: 0,
      firstPendingRequesterName: null,
    },
    lists: [{ id: 'l1', name: 'Weekly shop', lineCount: 12, wantedCount: 7 }],
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
    resumeShoppers: [],
    zoneOnline: () => [],
    listViewers: () => [],
    guestBannerDismissed: false,
    ...overrides,
  });
}

// Plan 0022, sections 3.1 and 3.3. Zone presence needs no intent: the server computes
// it from who holds the zone room, and the dashboard has held one per zone since 0017.
describe('presence on the cards', () => {
  it('puts who is in the group on its card', () => {
    const state = select({ zoneOnline: () => ['Ana', 'Marc'] });

    expect(firstZone(state).online).toEqual(['Ana', 'Marc']);
  });

  it('shows nobody rather than a zero when the caller is alone', () => {
    expect(firstZone(select()).online).toEqual([]);
  });

  // Somebody standing outside the group is not shown who is inside it, for the reason
  // their lists are empty too.
  it('shows nobody at all on a card the caller has not been let into', () => {
    const state = select({
      zones: [zone({ myStatus: 'PENDING' })],
      zoneOnline: () => ['Ana'],
    });

    expect(firstZone(state).online).toEqual([]);
  });

  it('puts who is shopping a list onto that row', () => {
    const state = select({
      listViewers: (listId) => (listId === 'l1' ? ['Ana'] : []),
    });

    expect(firstZone(state).lists).toMatchObject([{ viewers: ['Ana'] }]);
  });
});

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
  // There are no anonymous cases here any more, and they did not move to the landing
  // page's spec: there is no longer a function to test, because the landing page has
  // no states. Who may see this page at all is `authenticatedGuard`'s job now, and
  // `auth-guards.spec.ts` is where that is asserted (plan 0007, section 4.3).
  describe('which state wins', () => {
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

    it('passes the counts through', () => {
      // Always present since backend plan 0017, so there is no absent case to cover
      // here any more. What a *malformed* counts block does is the mapper's job, and
      // mappers.spec covers it.
      expect(select()).toMatchObject({
        zones: [{ memberCount: 3, listCount: 2 }],
      });
    });

    it('shows a list preview that is empty because the caller can read none', () => {
      // An empty preview never means "this group has no lists": it means the caller
      // has been given access to none of them.
      const state = select({
        zones: [
          zone({
            lists: [],
            counts: {
              memberCount: 4,
              listCount: 0,
              pendingRequestCount: null,
              firstPendingRequesterName: null,
            },
          }),
        ],
      });

      expect(state).toMatchObject({ zones: [{ lists: [], listCount: 0 }] });
    });
  });

  describe('the join request row', () => {
    /**
     * @param count pending requests, or `null` for a caller who may not see them.
     *   The backend sends `null` to anybody who is not OWNER or ADMIN, so the null
     *   **is** the permission and the role beside it is only there for realism.
     */
    function withRequests(
      count: number | null,
      role: MyZone['myRole'] = 'OWNER'
    ) {
      return select({
        zones: [
          zone({
            myRole: role,
            counts: {
              memberCount: 3,
              listCount: 1,
              pendingRequestCount: count,
              firstPendingRequesterName: count === null ? null : 'Ines',
            },
            lists: [],
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

    it('is absent for a caller the backend will not tell', () => {
      // A null count is how the backend says "you may not see who is waiting". The
      // frontend does not second-guess it with its own role check, so the two can
      // never disagree.
      expect(
        firstZone(withRequests(null, 'MEMBER')).joinRequests
      ).toBeUndefined();
    });

    it('is shown to an admin as well as an owner', () => {
      expect(withRequests(2, 'ADMIN')).toMatchObject({
        zones: [{ joinRequests: { othersCount: 1 } }],
      });
    });
  });

  describe('the resume card', () => {
    it('resolves the remembered list against the loaded zones', () => {
      const state = select({ resumeListId: 'z1/l1' });

      expect(state).toMatchObject({
        resume: {
          listId: 'l1',
          zoneId: 'z1',
          listName: 'Weekly shop',
          zoneName: 'Flat 3B',
          lineCount: 12,
          wantedCount: 7,
        },
      });
    });

    it('is absent when nothing was remembered', () => {
      expect(select()).toMatchObject({ resume: null });
    });

    it('is absent when the remembered list is no longer reachable', () => {
      // After being removed from a group. Offering a card that leads to a 403 is
      // worse than offering none.
      expect(select({ resumeListId: 'z1/gone' })).toMatchObject({
        resume: null,
      });
    });

    // Plan 0012 changed the stored value's shape from `listId` to `zoneId/listId`,
    // because the list route needs both and there is no `GET /v1/lists/:id` to resolve
    // an id on its own. A device that still holds the old form must not break: it is
    // read as a list id with no zone and the card simply does not render, which is a
    // missing card once rather than a navigation to nowhere (section 4.1).
    it('declines a value stored before the zone was part of it', () => {
      expect(select({ resumeListId: 'l1' })).toMatchObject({ resume: null });
    });

    it('is absent when the zone remembered is not the one holding the list', () => {
      expect(select({ resumeListId: 'z-other/l1' })).toMatchObject({
        resume: null,
      });
    });

    // Plan 0017, section 7. The container resolves the names, because presence
    // carries user ids and a name is a fact about a zone rather than about a person.
    it('carries whoever the container says is shopping the list', () => {
      expect(
        select({ resumeListId: 'z1/l1', resumeShoppers: ['Ana', 'Marc'] })
      ).toMatchObject({ resume: { shoppers: ['Ana', 'Marc'] } });
    });

    it('carries an empty list of shoppers rather than omitting the field', () => {
      expect(select({ resumeListId: 'z1/l1' })).toMatchObject({
        resume: { shoppers: [] },
      });
    });
  });
});
