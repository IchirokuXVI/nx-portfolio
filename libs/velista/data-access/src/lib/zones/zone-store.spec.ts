import { TestBed } from '@angular/core/testing';
import type { MyZone } from '@portfolio/velista/models';
import { provideFakeBrowserFacade } from '@portfolio/velista/platform';
import { SessionStore } from '../auth/session-store';
import { REALTIME_CLIENT } from '../realtime/realtime-client';
import { RealtimeMemory } from '../realtime/realtime-memory';
import { ZONE_SERVICE, type ZoneServiceI } from './zone-service';
import { ZoneStore } from './zone-store';

function zone(overrides: Partial<MyZone> = {}): MyZone {
  return {
    id: 'z1',
    name: 'Flat 3B',
    joinCode: 'FLAT3B',
    status: 'ACTIVE',
    ownerUserId: 'user-me',
    myRole: 'OWNER',
    myStatus: 'APPROVED',
    counts: {
      memberCount: 3,
      listCount: 2,
      pendingRequestCount: 0,
      firstPendingRequesterName: null,
    },
    lists: [],
    ...overrides,
  };
}

describe('ZoneStore', () => {
  let store: ZoneStore;
  let realtime: RealtimeMemory;
  let zones: MyZone[];
  let authenticated: boolean;

  beforeEach(() => {
    zones = [
      // Owner of the first, plain member of the second. The member's null pending
      // count is what the backend actually sends somebody who may not see
      // governance data, and it is what decides the staff room below.
      zone(),
      zone({
        id: 'z2',
        name: "Mum and Dad's",
        myRole: 'MEMBER',
        counts: {
          memberCount: 4,
          listCount: 1,
          pendingRequestCount: null,
          firstPendingRequesterName: null,
        },
      }),
    ];
    authenticated = true;

    const service: ZoneServiceI = {
      listMyZones: async () => ({ items: zones, nextCursor: null }),
      createZone: async () => ({ state: 'created', zone: zone() }),
      joinZone: async () => ({
        state: 'joined',
        membership: {
          id: 'm1',
          zoneId: 'z9',
          userId: 'user-me',
          username: 'You',
          role: 'MEMBER',
          status: 'PENDING',
        },
      }),
    };

    TestBed.configureTestingModule({
      providers: [
        // Listed explicitly: `ZoneStore` is no longer `providedIn: 'root'` (rule D5),
        // because it has to resolve `ZONE_SERVICE` in the injector where the app binds
        // it rather than in the root injector, where it would silently get the
        // in-memory default instead.
        ZoneStore,
        { provide: ZONE_SERVICE, useValue: service },
        { provide: REALTIME_CLIENT, useExisting: RealtimeMemory },
        provideFakeBrowserFacade(),
        {
          provide: SessionStore,
          useValue: {
            isAuthenticated: () => authenticated,
            userId: () => 'user-me',
          },
        },
      ],
    });

    realtime = TestBed.inject(RealtimeMemory);
    store = TestBed.inject(ZoneStore);
  });

  describe('loading', () => {
    it('loads the caller zones', async () => {
      await store.load();

      expect(store.state()).toBe('loaded');
      expect(store.myZones().map((z) => z.id)).toEqual(['z1', 'z2']);
    });

    it('reports an anonymous caller as loaded with nothing, without a request', async () => {
      // `0003`'s anonymous state is a designed screen, not a 401 handled gracefully.
      authenticated = false;

      await store.load();

      expect(store.state()).toBe('loaded');
      expect(store.myZones()).toEqual([]);
    });

    it('records a failure rather than throwing', async () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          ZoneStore,
          {
            provide: ZONE_SERVICE,
            useValue: {
              listMyZones: async () => {
                throw new Error('boom');
              },
            },
          },
          { provide: REALTIME_CLIENT, useExisting: RealtimeMemory },
          provideFakeBrowserFacade(),
          {
            provide: SessionStore,
            useValue: { isAuthenticated: () => true, userId: () => 'user-me' },
          },
        ],
      });

      const failing = TestBed.inject(ZoneStore);
      await failing.load();

      expect(failing.state()).toBe('failed');
      expect(failing.error()).toBeInstanceOf(Error);
    });
  });

  describe('rooms', () => {
    it('joins a zone room per zone, and no list rooms', async () => {
      // List and line events reach the zone room too, so subscribing per list on the
      // home screen would pay for the same bytes twice.
      await store.load();

      const rooms = [...realtime.rooms.keys()].sort();
      expect(rooms).toContain('zone:z1');
      expect(rooms).toContain('zone:z2');
      expect(rooms.filter((room) => room.startsWith('list:'))).toEqual([]);
    });

    it('joins the staff room only where the caller is staff', async () => {
      // The staff room is the only one carrying the governance fields on a counts
      // broadcast, so an owner needs it and a plain member must not ask for it.
      await store.load();

      expect([...realtime.rooms.keys()]).toContain('zone:z1:staff');
      expect([...realtime.rooms.keys()]).not.toContain('zone:z2:staff');
    });

    it('leaves both rooms when a zone goes away', async () => {
      await store.load();

      realtime.emit('zone.deleted', { id: 'z1' });

      const rooms = [...realtime.rooms.keys()];
      expect(rooms).not.toContain('zone:z1');
      expect(rooms).not.toContain('zone:z1:staff');
      expect(rooms).toContain('zone:z2');
    });
  });

  describe('applying realtime events', () => {
    beforeEach(async () => {
      await store.load();
    });

    it('renames a zone without a refresh', () => {
      realtime.emit('zone.updated', {
        id: 'z1',
        name: 'Flat 3C',
        joinCode: 'FLAT3B',
        status: 'ACTIVE',
        ownerUserId: 'user-me',
      });

      expect(store.myZones()[0].name).toBe('Flat 3C');
    });

    it('keeps the counts when a zone is renamed', () => {
      // The event carries a ZoneView, which has no counts. Replacing the record
      // wholesale would blank every number on the card.
      realtime.emit('zone.updated', {
        id: 'z1',
        name: 'Flat 3C',
        status: 'ACTIVE',
      });

      expect(store.myZones()[0].counts.memberCount).toBe(3);
    });

    it('applies a counts broadcast', () => {
      realtime.emit('zone.countsUpdated', {
        zoneId: 'z1',
        counts: {
          memberCount: 9,
          pendingRequestCount: 2,
          firstPendingRequesterName: 'Ines',
        },
      });

      expect(store.myZones()[0].counts).toMatchObject({
        memberCount: 9,
        pendingRequestCount: 2,
        firstPendingRequesterName: 'Ines',
      });
    });

    it('keeps known governance numbers when the plain room sends nulls', () => {
      // The staff room fills those fields and the plain zone room sends the same
      // event with both null. Taking the null would blank an owner's join request
      // row every time somebody joined.
      realtime.emit('zone.countsUpdated', {
        zoneId: 'z1',
        counts: {
          memberCount: 5,
          pendingRequestCount: 4,
          firstPendingRequesterName: 'Ines',
        },
      });
      realtime.emit('zone.countsUpdated', {
        zoneId: 'z1',
        counts: {
          memberCount: 6,
          pendingRequestCount: null,
          firstPendingRequesterName: null,
        },
      });

      expect(store.myZones()[0].counts).toMatchObject({
        memberCount: 6,
        pendingRequestCount: 4,
        firstPendingRequesterName: 'Ines',
      });
    });

    it('ignores a counts broadcast with no counts block', () => {
      realtime.emit('zone.countsUpdated', { zoneId: 'z1' });

      expect(store.myZones()[0].counts.memberCount).toBe(3);
    });

    it('marks a zone for deletion rather than removing it', () => {
      // `0003` open question 2: it stays visible as a plain non tappable card.
      realtime.emit('zone.markedForDeletion', {
        id: 'z1',
        status: 'MARKED_FOR_DELETION',
      });

      expect(store.myZones()[0].status).toBe('MARKED_FOR_DELETION');
    });

    it('removes the zone when the caller is kicked from it', () => {
      realtime.emit('member.kicked', {
        id: 'm9',
        zoneId: 'z2',
        userId: 'user-me',
        username: 'You',
        role: 'MEMBER',
        status: 'KICKED',
      });

      expect(store.myZones().map((z) => z.id)).toEqual(['z1']);
    });

    it('does not remove the zone when somebody else is kicked', () => {
      realtime.emit('member.kicked', {
        id: 'm9',
        zoneId: 'z2',
        userId: 'someone-else',
        username: 'Sam',
        role: 'MEMBER',
        status: 'KICKED',
      });

      expect(store.myZones().map((z) => z.id)).toEqual(['z1', 'z2']);
    });

    it('updates the caller own role in place', () => {
      realtime.emit('member.roleChanged', {
        id: 'm2',
        zoneId: 'z2',
        userId: 'user-me',
        username: 'You',
        role: 'ADMIN',
        status: 'APPROVED',
      });

      expect(store.myZones()[1].myRole).toBe('ADMIN');
    });

    it('counts a new list against the zone', () => {
      realtime.emit('list.created', {
        id: 'l9',
        zoneId: 'z1',
        name: 'Party',
        createdByUserId: 'user-me',
      });

      expect(store.myZones()[0].counts.listCount).toBe(3);
    });

    it('ignores an event for a zone it does not hold', () => {
      // Inventing a partial record from an event would render a card with no name.
      realtime.emit('zone.updated', { id: 'not-loaded', name: 'Ghost' });

      expect(store.myZones().map((z) => z.id)).toEqual(['z1', 'z2']);
    });

    it('drops a malformed payload instead of writing it into the store', () => {
      realtime.emit('zone.updated', { name: 'no id at all' });
      realtime.emit('member.kicked', 'not an object');

      expect(store.myZones().map((z) => z.id)).toEqual(['z1', 'z2']);
      expect(store.myZones()[0].name).toBe('Flat 3B');
    });

    it('ignores an event name this build does not know', () => {
      realtime.emit('zone.teleported', { id: 'z1' });

      expect(store.myZones()).toHaveLength(2);
    });
  });

  describe('refused rooms', () => {
    it('reports a zone whose room the server declined as not live', async () => {
      // Looking live while being stale is worse than looking broken.
      realtime.refuse.add('zone:z2');

      await store.load();

      expect(store.staleZoneIds().has('z2')).toBe(true);
      expect(store.staleZoneIds().has('z1')).toBe(false);
    });
  });
});
