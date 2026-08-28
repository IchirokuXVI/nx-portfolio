import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { APP_API_CONFIG, type MyZone } from '@portfolio/velista/models';
import {
  ConnectionState,
  provideFakeBrowserFacade,
} from '@portfolio/velista/platform';
import { ApiUrl } from '../api-url';
import { SessionStore } from '../auth/session-store';
import { TokenStore } from '../auth/token-store';
import { MEMBERSHIP_SERVICE } from '../memberships/membership-service';
import { MembershipStore } from '../memberships/membership-store';
import { ZONE_SERVICE, type ZoneServiceI } from '../zones/zone-service';
import { ZoneStore } from '../zones/zone-store';
import { REALTIME_CLIENT } from './realtime-client';
import { RealtimeSocket } from './realtime-socket';
import { SOCKET_FACTORY, type SocketLike } from './socket-factory';

/**
 * The wire contract, against payloads **captured from a running backend**.
 *
 * Every other spec in this library drives `RealtimeMemory` with a payload someone
 * wrote by hand, so all of them agree with each other and none of them agrees with
 * anything in particular. The gap that leaves is the one that costs the most: a
 * payload whose shape the mapper does not expect is dropped and counted, silently,
 * and the app stops being live for that kind of change while every test stays green.
 *
 * The payloads below are copied verbatim from `LUNA_EVENTS` on 2026-08-28, read
 * straight out of JetStream. They are the real thing, ids and timestamps included.
 *
 * This runs the **real** transport, `RealtimeSocket`, over a hand driven socket and
 * into the **real** `ZoneStore`, so it covers the whole client path: `onAny`, the
 * name filter, the mapper, the subject, and the store's own switch. What it cannot
 * cover is the server actually sending them, which is what the realtime service's
 * consume loop is for, and which is where the outage this spec was written after
 * actually lived.
 */

// ---------------------------------------------------------------- real payloads

const ZONE_ID = '51766dbb-79eb-4fc6-bf06-12fe27f6b0a6';

const ZONE_UPDATED = {
  id: ZONE_ID,
  name: 'Renamed By Probe',
  joinCode: 'XV9DMWJP',
  status: 'ACTIVE',
  ownerUserId: 'd54a5df1-31f3-4514-b75f-85ec9879bb62',
  config: {},
  createdAt: '2026-08-28T01:35:03.823Z',
  updatedAt: '2026-08-28T01:35:04.229Z',
};

const LIST_CREATED = {
  id: '675dacad-b798-4d0a-b793-1f60208c5516',
  zoneId: ZONE_ID,
  name: 'Probe List',
  createdByUserId: 'd54a5df1-31f3-4514-b75f-85ec9879bb62',
  counts: { lineCount: 0, readyCount: 0 },
  createdAt: '2026-08-28T01:35:05.050Z',
  updatedAt: '2026-08-28T01:35:05.050Z',
};

const ZONE_COUNTS_UPDATED = {
  zoneId: ZONE_ID,
  counts: {
    memberCount: 2,
    pendingRequestCount: 1,
    firstPendingRequesterName: 'Silver Harbor',
  },
};

const MEMBER_JOINED = {
  id: '4b078f9f-c1bc-41ce-8241-852e0eb3a6ea',
  zoneId: ZONE_ID,
  userId: 'dffd3e39-8ffb-4b73-ae32-059164ada7a4',
  username: 'Silver Harbor',
  role: 'MEMBER',
  status: 'PENDING',
  createdAt: '2026-08-28T01:18:22.310Z',
  updatedAt: '2026-08-28T01:18:22.310Z',
};

const PRESENCE_ZONE_UPDATED = {
  zoneId: ZONE_ID,
  online: [{ userId: 'd54a5df1-31f3-4514-b75f-85ec9879bb62' }],
};

// ---------------------------------------------------------------- the harness

class FakeSocket implements SocketLike {
  connected = false;
  private _any: ((event: string, ...args: readonly unknown[]) => void) | null =
    null;
  private readonly _handlers = new Map<string, (() => void)[]>();

  connect(): void {
    this.connected = true;
    for (const handler of this._handlers.get('connect') ?? []) {
      handler();
    }
  }
  disconnect(): void {
    this.connected = false;
  }
  on(event: string, handler: () => void): void {
    this._handlers.set(event, [...(this._handlers.get(event) ?? []), handler]);
  }
  onAny(handler: (event: string, ...args: readonly unknown[]) => void): void {
    this._any = handler;
  }
  timeout() {
    return { emitWithAck: async () => ({ ok: true }) };
  }

  /** Push a frame exactly as socket.io hands one to `onAny`. */
  send(name: string, payload: unknown): void {
    this._any?.(name, payload);
  }
}

function myZone(): MyZone {
  return {
    id: ZONE_ID,
    name: 'Realtime Probe',
    joinCode: 'XV9DMWJP',
    status: 'ACTIVE',
    ownerUserId: 'd54a5df1-31f3-4514-b75f-85ec9879bb62',
    myRole: 'OWNER',
    myStatus: 'APPROVED',
    counts: {
      memberCount: 1,
      listCount: 0,
      pendingRequestCount: 0,
      firstPendingRequesterName: null,
    },
    lists: [],
  };
}

async function setup() {
  const socket = new FakeSocket();

  const zones: ZoneServiceI = {
    listMyZones: async () => ({ items: [myZone()], nextCursor: null }),
  } as never;

  TestBed.configureTestingModule({
    providers: [
      provideFakeBrowserFacade(),
      ConnectionState,
      ApiUrl,
      ZoneStore,
      MembershipStore,
      { provide: ZONE_SERVICE, useValue: zones },
      {
        provide: MEMBERSHIP_SERVICE,
        useValue: {
          listMembers: async () => ({ items: [], nextCursor: null }),
        },
      },
      { provide: REALTIME_CLIENT, useClass: RealtimeSocket },
      {
        provide: APP_API_CONFIG,
        useValue: {
          gatewayBaseUrl: 'http://localhost:3000',
          realtimeBaseUrl: 'http://localhost:3001',
        },
      },
      {
        provide: TokenStore,
        useValue: {
          ensureFreshToken: async () => 'a-token',
          // R1's authentication check reads the pair directly rather than the
          // session, to keep the socket below `SessionStore` in the DI graph.
          hasSession: () => true,
        },
      },
      {
        provide: SessionStore,
        useValue: {
          isAuthenticated: signal(true).asReadonly(),
          userId: signal('d54a5df1-31f3-4514-b75f-85ec9879bb62').asReadonly(),
        },
      },
      { provide: SOCKET_FACTORY, useValue: () => socket },
    ],
  });

  const store = TestBed.inject(ZoneStore);
  const realtime = TestBed.inject(REALTIME_CLIENT) as RealtimeSocket;
  TestBed.tick();

  await store.load();
  // Drain the connect and the room reconcile the load kicks off.
  for (let turn = 0; turn < 40; turn += 1) {
    await Promise.resolve();
  }

  return { store, realtime, socket };
}

describe('the realtime wire contract, against captured payloads', () => {
  it('opens the connection and asks for the zone', async () => {
    const { realtime } = await setup();

    expect(realtime.connected()).toBe(true);
  });

  it('renames a zone from a real zone.updated frame', async () => {
    const { store, socket } = await setup();

    socket.send('zone.updated', ZONE_UPDATED);

    expect(store.zoneById(ZONE_ID)?.name).toBe('Renamed By Probe');
  });

  it('takes the counts from a real zone.countsUpdated frame', async () => {
    const { store, socket } = await setup();

    socket.send('zone.countsUpdated', ZONE_COUNTS_UPDATED);

    const counts = store.zoneById(ZONE_ID)?.counts;
    expect(counts?.memberCount).toBe(2);
    // The staff room's copy fills these; the plain room's nulls them.
    expect(counts?.pendingRequestCount).toBe(1);
    expect(counts?.firstPendingRequesterName).toBe('Silver Harbor');
  });

  it('counts a new list from a real list.created frame', async () => {
    const { store, socket } = await setup();

    socket.send('list.created', LIST_CREATED);

    expect(store.zoneById(ZONE_ID)?.counts.listCount).toBe(1);
  });

  it('drops nothing it was given', async () => {
    const { realtime, socket } = await setup();

    socket.send('zone.updated', ZONE_UPDATED);
    socket.send('zone.countsUpdated', ZONE_COUNTS_UPDATED);
    socket.send('list.created', LIST_CREATED);
    socket.send('member.joined', MEMBER_JOINED);
    socket.send('presence.zoneUpdated', PRESENCE_ZONE_UPDATED);

    // The counter that would have caught a wire shape this app no longer
    // understands. Empty is the assertion: every payload above mapped.
    expect([...realtime.droppedEvents().entries()]).toEqual([]);
  });
});
