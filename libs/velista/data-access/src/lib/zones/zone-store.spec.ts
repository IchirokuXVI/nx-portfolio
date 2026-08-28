import { TestBed } from '@angular/core/testing';
import type { MyZone, Zone } from '@portfolio/velista/models';
import { provideFakeBrowserFacade } from '@portfolio/velista/platform';
import { SessionStore } from '../auth/session-store';
import { REALTIME_CLIENT } from '../realtime/realtime-client';
import { RealtimeMemory } from '../realtime/realtime-memory';
import {
  ZONE_SERVICE,
  type ZoneCreationResult,
  type ZoneJoinResult,
  type ZoneServiceI,
} from './zone-service';
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

  /** How many times the list was fetched, which is how a reconcile is observed. */
  let listCalls: number;

  /** When set, the list request never comes back, freezing the reconcile mid flight. */
  let holdList: boolean;

  /** What the two mutations answer, and what they were called with. */
  let created: Zone;
  let createResult: ZoneCreationResult | 'throw' | null;
  let joinResult: ZoneJoinResult | 'throw' | null;
  let createArgs: (readonly [string, string | undefined])[];
  let joinArgs: (readonly [string, string | undefined])[];

  /** Plan 0010: which zones were fetched one at a time, and what was written. */
  let getCalls: string[];
  let getResult: 'throw' | null;
  let writeArgs: (readonly [string, string])[];

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
    listCalls = 0;
    holdList = false;
    created = {
      id: 'z-new',
      name: 'Flat 3B',
      joinCode: 'HK7M2QPD',
      status: 'ACTIVE',
      ownerUserId: 'user-me',
    };
    createResult = null;
    joinResult = null;
    createArgs = [];
    joinArgs = [];
    getCalls = [];
    getResult = null;
    writeArgs = [];

    const service: ZoneServiceI = {
      listMyZones: async () => {
        listCalls += 1;
        if (holdList) {
          // Never resolves, which is how "before the reload lands" is expressed as a
          // test: the reconcile has been started and has not come back.
          await new Promise(() => undefined);
        }
        return { items: zones, nextCursor: null };
      },
      createZone: async (name, username) => {
        createArgs = [...createArgs, [name, username] as const];
        if (createResult === 'throw') {
          throw new Error('boom');
        }
        return createResult ?? { state: 'created', zone: created };
      },
      joinZone: async (joinCode, username) => {
        joinArgs = [...joinArgs, [joinCode, username] as const];
        if (joinResult === 'throw') {
          throw new Error('boom');
        }
        return (
          joinResult ?? {
            state: 'joined',
            membership: {
              id: 'm1',
              zoneId: 'z9',
              userId: 'user-me',
              username: 'You',
              role: 'MEMBER',
              status: 'PENDING',
            },
          }
        );
      },

      // Plan 0010. The group page reads one zone and writes to it, and each write
      // answers whatever the server would have: the store patches its cache from the
      // **answer** rather than from what was asked for, so a double that echoed the
      // request would hide a bug rather than expose one.
      getZone: async (zoneId) => {
        getCalls = [...getCalls, zoneId];
        if (getResult === 'throw') {
          throw new Error('boom');
        }

        const found = zones.find((candidate) => candidate.id === zoneId);
        if (found === undefined) {
          throw new Error(`no such zone ${zoneId}`);
        }
        return found;
      },
      renameZone: async (zoneId, name) => {
        writeArgs = [...writeArgs, ['renameZone', zoneId] as const];
        return { ...stripMine(zoneId), name };
      },
      regenerateJoinCode: async (zoneId) => {
        writeArgs = [...writeArgs, ['regenerateJoinCode', zoneId] as const];
        return { ...stripMine(zoneId), joinCode: 'NEWCODE1' };
      },
      deleteZone: async (zoneId) => {
        writeArgs = [...writeArgs, ['deleteZone', zoneId] as const];
        return zoneId;
      },
      claimOwnership: async (zoneId) => {
        writeArgs = [...writeArgs, ['claimOwnership', zoneId] as const];
        return {
          ...stripMine(zoneId),
          status: 'ACTIVE' as const,
          ownerUserId: 'user-me',
        };
      },
    };

    /** The plain `Zone` half of a seeded zone, which is what a write answers. */
    function stripMine(zoneId: string): Zone {
      const found = zones.find((candidate) => candidate.id === zoneId);
      return {
        id: zoneId,
        name: found?.name ?? '',
        joinCode: found?.joinCode ?? '',
        status: found?.status ?? 'ACTIVE',
        ownerUserId: found?.ownerUserId ?? null,
      };
    }

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

    // Plan 0020, section 2. An ownership transfer changes two memberships and
    // publishes no membership event for either, so the caller's own role is derived
    // from `ownerUserId`. All three cases, because the middle one is the damaging
    // half: an old owner left holding `OWNER` is offered Delete group and Transfer
    // ownership, and every press of either is a forbidden.

    it('makes the caller the owner when the group is handed to them', () => {
      realtime.emit('zone.ownershipChanged', {
        id: 'z2',
        name: "Mum and Dad's",
        joinCode: 'FLAT3B',
        status: 'ACTIVE',
        ownerUserId: 'user-me',
      });

      expect(store.myZones()[1].myRole).toBe('OWNER');
    });

    it('demotes the outgoing owner to admin when the group goes to somebody else', () => {
      realtime.emit('zone.ownershipChanged', {
        id: 'z1',
        name: 'Flat 3B',
        joinCode: 'FLAT3B',
        status: 'ACTIVE',
        ownerUserId: 'someone-else',
      });

      // What `transferOwnership` writes in the same transaction, so this is the
      // server's own answer rather than a guess.
      expect(store.myZones()[0].myRole).toBe('ADMIN');
      expect(store.myZones()[0].ownerUserId).toBe('someone-else');
    });

    it('leaves the caller role alone when the transfer is between two other people', () => {
      realtime.emit('zone.ownershipChanged', {
        id: 'z2',
        name: "Mum and Dad's",
        joinCode: 'FLAT3B',
        status: 'ACTIVE',
        ownerUserId: 'someone-else',
      });

      expect(store.myZones()[1].myRole).toBe('MEMBER');
    });

    it('joins the staff room on becoming the owner', () => {
      // **Rule G3.** Without the re-sync a new owner would not receive the governance
      // counts until the next full load, so the group's join requests would be
      // invisible to the only person who can act on them.
      expect([...realtime.rooms.keys()]).not.toContain('zone:z2:staff');

      realtime.emit('zone.ownershipChanged', {
        id: 'z2',
        name: "Mum and Dad's",
        joinCode: 'FLAT3B',
        status: 'ACTIVE',
        ownerUserId: 'user-me',
      });

      expect([...realtime.rooms.keys()]).toContain('zone:z2:staff');
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

  describe('creating a group', () => {
    it('puts it on screen with what is certainly true of it, before any reload', async () => {
      // Plan 0008 section 5.5. `POST /v1/zones` answers a `Zone` and the dashboard
      // renders a `MyZone`; the four fields in between are derivable rather than
      // guessed for a group created one moment ago, which is what makes this safe.
      //
      // The reload is held open, so what is asserted is the state the person actually
      // sees: the group is on screen while the request that confirms it is still out.
      holdList = true;

      const outcome = await store.createZone('Flat 3B');

      expect(outcome).toEqual({ state: 'created', zoneId: 'z-new' });
      const fresh = store.myZones().find((z) => z.id === 'z-new');
      expect(fresh).toMatchObject({
        myRole: 'OWNER',
        myStatus: 'APPROVED',
        lists: [],
        counts: {
          memberCount: 1,
          listCount: 0,
          // The creator is staff, so zero rather than null: they can see the number
          // and there is nothing in it yet.
          pendingRequestCount: 0,
          firstPendingRequesterName: null,
        },
      });
    });

    it('records the way in, so the dashboard can say what just happened', async () => {
      await store.createZone('Flat 3B');

      expect(store.lastEntry()).toEqual({ kind: 'created', zoneId: 'z-new' });

      store.clearLastEntry();
      expect(store.lastEntry()).toBeNull();
    });

    it('reconciles without the page dropping back to a skeleton', async () => {
      // `load` would move the state to `loading`, which `selectHomeState` renders as a
      // skeleton, so the correct dashboard would be replaced by a spinner for the
      // length of a request the person has already waited through.
      await store.load();

      await store.createZone('Flat 3B');

      // Never `loading`, and the list was fetched again: the reconcile happened, it
      // just did not announce itself as a load.
      expect(store.state()).toBe('loaded');
      expect(listCalls).toBe(2);
    });

    it('reports a lost guest account rather than a failure', async () => {
      // Rule D3 refused to send. Not an error, and emphatically not a retry.
      createResult = { state: 'guest-account-lost' };

      expect(await store.createZone('Flat 3B')).toEqual({
        state: 'guest-account-lost',
      });
      expect(store.lastEntry()).toBeNull();
    });

    it('hands a failure back with its error, for the page to key copy on', async () => {
      createResult = 'throw';

      const outcome = await store.createZone('Flat 3B');

      expect(outcome).toEqual({
        state: 'failed',
        error: expect.any(Error),
      });
      expect(store.myZones().map((z) => z.id)).toEqual([]);
    });

    it('never sends a username the person did not type', async () => {
      // `CreateZoneDto.username` is optional and omitting it means "call me by my
      // global username", which is the common path (plan 0008, section 5.2).
      await store.createZone('Flat 3B');

      expect(createArgs).toEqual([['Flat 3B', undefined]]);
    });
  });

  describe('asking to join a group', () => {
    it('waits for the reload, because that is where the name comes from', async () => {
      // `MembershipView` carries a `zoneId` and no name, and no endpoint turns a code
      // into a zone (sections 5.6 and 5.7). `listMine` returns PENDING memberships
      // with the zone row joined, so the reload is what names the group.
      zones = [
        ...zones,
        zone({ id: 'z9', name: 'Casa Ferrer', myStatus: 'PENDING' }),
      ];

      const outcome = await store.joinZone('GTBN4KRW');

      expect(outcome).toEqual({ state: 'joined', zoneId: 'z9' });
      expect(store.myZones().find((z) => z.id === 'z9')?.name).toBe(
        'Casa Ferrer'
      );
      expect(store.lastEntry()).toEqual({ kind: 'joined', zoneId: 'z9' });
    });

    it('reports a lost guest account rather than a failure', async () => {
      joinResult = { state: 'guest-account-lost' };

      expect(await store.joinZone('GTBN4KRW')).toEqual({
        state: 'guest-account-lost',
      });
    });

    it('hands a failure back with its error', async () => {
      joinResult = 'throw';

      expect(await store.joinZone('NOSUCHXX')).toEqual({
        state: 'failed',
        error: expect.any(Error),
      });
    });

    it('never sends a username the person did not type', async () => {
      await store.joinZone('GTBN4KRW');

      expect(joinArgs).toEqual([['GTBN4KRW', undefined]]);
    });
  });

  describe('refused zones', () => {
    it('reports a zone whose room the server declined as not live', async () => {
      // Looking live while being stale is worse than looking broken. Keyed by zone id:
      // the client answers zone ids, and a room name would have to be stripped back to
      // one, which is what used to go wrong for the staff room (plan 0016, F3).
      realtime.refuse.add('z2');

      await store.load();

      expect(store.staleZoneIds().has('z2')).toBe(true);
      expect(store.staleZoneIds().has('z1')).toBe(false);
    });
  });

  // -------------------------------------------------------------- plan 0010

  describe('loading one zone', () => {
    it('fetches it and puts it in the cache', async () => {
      await store.loadZone('z1');

      expect(getCalls).toEqual(['z1']);
      expect(store.zoneById('z1')?.name).toBe('Flat 3B');
      expect(store.zoneState().get('z1')).toBe('loaded');
    });

    it('is loading, not loaded, when nothing is cached to draw', async () => {
      getResult = 'throw';

      await store.loadZone('z1');

      // No cached header to fall back on, so the failure is the whole screen.
      expect(store.zoneState().get('z1')).toBe('failed');
    });

    it('leaves a cached zone alone when the refetch fails', async () => {
      // A background reconcile that did not arrive must not replace a correct group
      // with an error panel: being briefly out of date is the better failure.
      await store.load();
      getResult = 'throw';

      await store.loadZone('z1');

      expect(store.zoneState().get('z1')).toBe('loaded');
      expect(store.zoneById('z1')?.name).toBe('Flat 3B');
    });
  });

  describe('rule G3, the staff room', () => {
    it('follows myRole rather than the counts', async () => {
      // The two disagree for exactly as long as it matters. A just demoted admin's
      // counts still say staff, and asking for a room the server now refuses would
      // put a permanent stale badge on the group (section 5.3).
      zones = [
        zone({
          myRole: 'MEMBER',
          counts: {
            memberCount: 3,
            listCount: 2,
            // Stale, and deliberately non-null: this is what the old rule read.
            pendingRequestCount: 2,
            firstPendingRequesterName: 'Ines',
          },
        }),
      ];

      await store.load();

      expect([...realtime.rooms.keys()]).toContain('zone:z1');
      expect([...realtime.rooms.keys()]).not.toContain('zone:z1:staff');
    });

    it('leaves the staff room when the caller is demoted', async () => {
      await store.load();
      expect([...realtime.rooms.keys()]).toContain('zone:z1:staff');

      realtime.emit('member.roleChanged', {
        id: 'm1',
        zoneId: 'z1',
        userId: 'user-me',
        username: 'Dani',
        role: 'MEMBER',
        status: 'APPROVED',
      });

      expect([...realtime.rooms.keys()]).not.toContain('zone:z1:staff');
      expect([...realtime.rooms.keys()]).toContain('zone:z1');
    });
  });

  describe('losing a group while a page is open on it', () => {
    it('records a removal, so the page can leave and say why', async () => {
      await store.load();

      realtime.emit('member.kicked', {
        id: 'm1',
        zoneId: 'z1',
        userId: 'user-me',
        username: 'Dani',
        role: 'MEMBER',
        status: 'KICKED',
      });

      expect(store.departure()).toEqual({ zoneId: 'z1', reason: 'kicked' });
      expect(store.zoneById('z1')).toBeUndefined();
    });

    it('keeps a ban apart from a removal', async () => {
      await store.load();

      realtime.emit('member.banned', {
        id: 'm1',
        zoneId: 'z1',
        userId: 'user-me',
        username: 'Dani',
        role: 'MEMBER',
        status: 'BANNED',
      });

      expect(store.departure()?.reason).toBe('banned');
    });

    it('records a deletion', async () => {
      await store.load();

      realtime.emit('zone.deleted', { id: 'z1', zoneId: 'z1' });

      expect(store.departure()).toEqual({ zoneId: 'z1', reason: 'deleted' });
    });

    it('says nothing about a zone the caller never held', async () => {
      await store.load();

      realtime.emit('zone.deleted', { id: 'z9', zoneId: 'z9' });

      expect(store.departure()).toBeNull();
    });

    it('records nothing for a role change, which must not navigate', async () => {
      await store.load();

      realtime.emit('member.roleChanged', {
        id: 'm1',
        zoneId: 'z1',
        userId: 'user-me',
        username: 'Dani',
        role: 'ADMIN',
        status: 'APPROVED',
      });

      expect(store.departure()).toBeNull();
      expect(store.zoneById('z1')?.myRole).toBe('ADMIN');
    });
  });

  describe('the governance writes', () => {
    it('patches the cache from the server answer, not from the request', async () => {
      await store.load();

      expect(await store.renameZone('z1', 'Flat 3C')).toEqual({
        state: 'succeeded',
      });
      expect(writeArgs).toEqual([['renameZone', 'z1']]);
      expect(store.zoneById('z1')?.name).toBe('Flat 3C');
    });

    it('updates the join code in place, with no refetch', async () => {
      // The acceptance criterion: the invite card on this page and on the dashboard
      // both pick it up from the store rather than from a reload.
      await store.load();

      await store.regenerateJoinCode('z1');

      expect(store.zoneById('z1')?.joinCode).toBe('NEWCODE1');
      expect(listCalls).toBe(1);
    });

    it('removes a deleted group from the cache without recording a departure', async () => {
      // They did this. Being told what you just chose is noise.
      await store.load();

      expect(await store.deleteZone('z1')).toEqual({ state: 'succeeded' });
      expect(store.zoneById('z1')).toBeUndefined();
      expect(store.departure()).toBeNull();
    });

    it('makes the claimer the owner, which the ZoneView cannot say', async () => {
      zones = [
        zone({
          status: 'MARKED_FOR_DELETION',
          ownerUserId: null,
          myRole: 'ADMIN',
        }),
      ];
      await store.load();

      await store.claimOwnership('z1');

      expect(store.zoneById('z1')).toMatchObject({
        myRole: 'OWNER',
        status: 'ACTIVE',
        ownerUserId: 'user-me',
      });
    });
  });

  describe('recordMembershipChange', () => {
    it('moves the member count and the waiting count on an approval', async () => {
      zones = [
        zone({
          counts: {
            memberCount: 3,
            listCount: 2,
            pendingRequestCount: 2,
            firstPendingRequesterName: 'Ines',
          },
        }),
      ];
      await store.load();

      store.recordMembershipChange('z1', 'approved');

      expect(store.zoneById('z1')?.counts).toMatchObject({
        memberCount: 4,
        pendingRequestCount: 1,
        // The named requester may be the one just answered and the store cannot tell,
        // so it is cleared rather than left stale.
        firstPendingRequesterName: null,
      });
    });

    it('moves only the waiting count on a rejection', async () => {
      zones = [
        zone({
          counts: {
            memberCount: 3,
            listCount: 2,
            pendingRequestCount: 2,
            firstPendingRequesterName: 'Ines',
          },
        }),
      ];
      await store.load();

      store.recordMembershipChange('z1', 'rejected');

      expect(store.zoneById('z1')?.counts).toMatchObject({
        memberCount: 3,
        pendingRequestCount: 1,
      });
    });

    it('leaves a null waiting count null, because it is a permission', async () => {
      // Turning it into a number because something happened would invent a
      // permission the caller does not have (section 4.3).
      await store.load();

      store.recordMembershipChange('z2', 'approved');

      expect(store.zoneById('z2')?.counts.pendingRequestCount).toBeNull();
    });

    it('drops the member count when somebody is removed', async () => {
      await store.load();

      store.recordMembershipChange('z1', 'removed');

      expect(store.zoneById('z1')?.counts.memberCount).toBe(2);
    });

    it('never takes a count below zero', async () => {
      zones = [
        zone({
          counts: {
            memberCount: 0,
            listCount: 0,
            pendingRequestCount: 0,
            firstPendingRequesterName: null,
          },
        }),
      ];
      await store.load();

      store.recordMembershipChange('z1', 'removed');
      store.recordMembershipChange('z1', 'rejected');

      expect(store.zoneById('z1')?.counts).toMatchObject({
        memberCount: 0,
        pendingRequestCount: 0,
      });
    });
  });
});
