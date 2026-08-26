import { TestBed } from '@angular/core/testing';
import type { MyZone } from '@portfolio/velista/models';
import { BrowserFacade } from '@portfolio/velista/platform';
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
    summary: {
      memberCount: 3,
      listCount: 2,
      pendingRequestCount: 0,
      firstPendingRequesterName: null,
      lists: [],
    },
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
      zone(),
      zone({ id: 'z2', name: "Mum and Dad's", myRole: 'MEMBER' }),
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
        { provide: ZONE_SERVICE, useValue: service },
        { provide: REALTIME_CLIENT, useExisting: RealtimeMemory },
        {
          provide: BrowserFacade,
          useValue: { onLine: () => true, isBrowser: true },
        },
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
          {
            provide: ZONE_SERVICE,
            useValue: {
              listMyZones: async () => {
                throw new Error('boom');
              },
            },
          },
          { provide: REALTIME_CLIENT, useExisting: RealtimeMemory },
          {
            provide: BrowserFacade,
            useValue: { onLine: () => true, isBrowser: true },
          },
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
    it('joins one room per visible zone, and only zone rooms', async () => {
      // List and line events reach the zone room too, so subscribing per list on the
      // home screen would pay for the same bytes twice.
      await store.load();

      expect([...realtime.rooms.keys()].sort()).toEqual(['zone:z1', 'zone:z2']);
    });

    it('leaves the room when a zone goes away', async () => {
      await store.load();

      realtime.emit('zone.deleted', { id: 'z2' });

      expect([...realtime.rooms.keys()]).toEqual(['zone:z1']);
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

    it('keeps the summary when a zone is renamed', () => {
      // The event carries a ZoneView, which has no summary. Replacing the record
      // wholesale would blank every count on the card.
      realtime.emit('zone.updated', {
        id: 'z1',
        name: 'Flat 3C',
        status: 'ACTIVE',
      });

      expect(store.myZones()[0].summary?.memberCount).toBe(3);
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

      expect(store.myZones()[0].summary?.listCount).toBe(3);
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
