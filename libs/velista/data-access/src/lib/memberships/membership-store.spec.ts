import { TestBed } from '@angular/core/testing';
import type { Membership } from '@portfolio/velista/models';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { REALTIME_CLIENT } from '../realtime/realtime-client';
import { RealtimeMemory } from '../realtime/realtime-memory';
import {
  fakeMembershipService,
  provideFakeMembershipService,
  provideFakeSessionStore,
} from '../testing/store-doubles';
import { MembershipStore } from './membership-store';

const ZONE = 'zone-1';

function member(id: string, overrides: Partial<Membership> = {}): Membership {
  return {
    id,
    zoneId: ZONE,
    userId: `u-${id}`,
    username: id.toUpperCase(),
    role: 'MEMBER',
    status: 'APPROVED',
    ...overrides,
  };
}

function setup(
  seed: readonly Membership[] = [member('a'), member('b')],
  rejectWith?: { listMembers?: unknown }
) {
  const service = fakeMembershipService({
    members: seed,
    rejectWith: rejectWith as Parameters<
      typeof fakeMembershipService
    >[0]['rejectWith'],
  });

  TestBed.configureTestingModule({
    providers: [
      provideVelistaTesting(),
      provideFakeMembershipService(service),
      provideFakeSessionStore('REGISTERED'),
      RealtimeMemory,
      MembershipStore,
    ],
  });

  return {
    store: TestBed.inject(MembershipStore),
    realtime: TestBed.inject(REALTIME_CLIENT) as RealtimeMemory,
    service,
  };
}

const ids = (rows: readonly Membership[]) => rows.map((row) => row.id);

describe('MembershipStore', () => {
  describe('loading', () => {
    it('holds a zone rows in the order the server gave them', async () => {
      const { store } = setup();

      await store.load(ZONE, ['APPROVED']);

      expect(ids(store.membersIn(ZONE))).toEqual(['a', 'b']);
      expect(store.stateOf(ZONE)).toBe('loaded');
    });

    it('reports a failure and rethrows, so a screen can say its own sentence', async () => {
      const boom = new Error('nope');
      const { store } = setup([], { listMembers: boom });

      await expect(store.load(ZONE)).rejects.toThrow(boom);
      expect(store.stateOf(ZONE)).toBe('failed');
      expect(store.errorOf(ZONE)).toBe(boom);
    });

    it('answers with nobody for a zone nothing has asked for', () => {
      const { store } = setup();

      expect(store.membersIn('never-loaded')).toEqual([]);
      expect(store.stateOf('never-loaded')).toBe('idle');
    });
  });

  /**
   * Plan 0018, gap 1. The six events that carry a membership, and the one that carries
   * only an id, against the filter the zone was loaded under.
   */
  describe('applying events', () => {
    it('replaces a row that changed', async () => {
      const { store, realtime } = setup();
      await store.load(ZONE, ['APPROVED']);

      realtime.emit('member.roleChanged', member('a', { role: 'ADMIN' }));

      expect(store.membersIn(ZONE)[0].role).toBe('ADMIN');
    });

    it('takes away a member whose new status the screen did not ask for', async () => {
      const { store, realtime } = setup();
      await store.load(ZONE, ['APPROVED']);

      // A kick arrives as the membership in its KICKED state rather than as a
      // deletion, so the filter is what turns it into a departure.
      realtime.emit('member.kicked', member('a', { status: 'KICKED' }));

      expect(ids(store.membersIn(ZONE))).toEqual(['b']);
    });

    it('adds an arrival whose status is in the filter', async () => {
      const { store, realtime } = setup();
      await store.load(ZONE, ['APPROVED', 'PENDING']);

      realtime.emit('member.joined', member('c', { status: 'PENDING' }));

      expect(ids(store.membersIn(ZONE))).toEqual(['a', 'b', 'c']);
    });

    it('refuses an arrival whose status the caller may not see', async () => {
      const { store, realtime } = setup();
      // Rule G2: PENDING is staff only, so an ordinary member's screen asked for
      // APPROVED alone. Inserting the row anyway would be a permission decision made
      // by accident in a client.
      await store.load(ZONE, ['APPROVED']);

      realtime.emit('member.joined', member('c', { status: 'PENDING' }));

      expect(ids(store.membersIn(ZONE))).toEqual(['a', 'b']);
    });

    it('removes a rejected membership by its id alone', async () => {
      const { store, realtime } = setup([
        member('a'),
        member('b', { status: 'PENDING' }),
      ]);
      await store.load(ZONE, ['APPROVED', 'PENDING']);

      // No zone on this payload, which is why the zone summary cannot use it. An id
      // is unique and is all a removal needs.
      realtime.emit('member.rejected', { id: 'b', userId: 'u-b' });

      expect(ids(store.membersIn(ZONE))).toEqual(['a']);
    });

    it('ignores an event for a zone that was never loaded', () => {
      const { store, realtime } = setup();

      realtime.emit('member.joined', member('c'));

      // Building a one row zone out of an event would render a group of nine as a
      // group of one, which is worse than rendering nothing until it is asked for.
      expect(store.membersIn(ZONE)).toEqual([]);
    });

    it('does not duplicate a row it already holds', async () => {
      const { store, realtime } = setup();
      await store.load(ZONE, ['APPROVED']);

      realtime.emit('member.usernameChanged', member('a', { username: 'Ana' }));
      realtime.emit('member.usernameChanged', member('a', { username: 'Ana' }));

      expect(ids(store.membersIn(ZONE))).toEqual(['a', 'b']);
      expect(store.membersIn(ZONE)[0].username).toBe('Ana');
    });
  });

  describe('a write the caller made themselves', () => {
    it('lands the same way an event does', async () => {
      const { store } = setup();
      await store.load(ZONE, ['APPROVED']);

      store.record(member('a', { role: 'ADMIN' }));

      // The same path, deliberately: two ways into one row is how the two end up
      // differing in the case nobody tests.
      expect(store.membersIn(ZONE)[0].role).toBe('ADMIN');
    });
  });
});
