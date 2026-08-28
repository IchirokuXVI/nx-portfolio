import {
  listPresenceRoom,
  listRoom,
  RealtimeEvent,
  zoneRoom,
  type DomainEvent,
} from '@portfolio/luna-shopper/contracts';
import type { Server } from 'socket.io';
import { sweepsFor } from '../consumer/sweeps';
import type { CoreAccessClient } from '../messaging/core-access.client';
import type { PresenceService } from '../presence/presence.service';
import type { RelayDirective } from '../relay/event-relay.service';
import { RealtimeGateway } from './realtime.gateway';
import { RoomSyncService } from './room-sync.service';

/**
 * Zone level list presence (plan 0032).
 *
 * The group page shows eight lists and should say which of them somebody is
 * shopping from right now, live, without opening eight subscriptions. The room
 * is the access control: a socket joins `list:{id}:presence` for each list of
 * the zone it may read, so the broadcast needs no per recipient filtering and
 * nobody who may not read a list is in the room to hear that it exists.
 */

const ZONE = 'z1';
const READABLE = ['l1', 'l2'];
const HIDDEN = 'l9';

class FakeSocket {
  readonly rooms = new Set<string>();
  readonly data: { userId: string };
  readonly handshake = { auth: { token: 't' }, headers: {}, query: {} };

  constructor(
    readonly id: string,
    userId: string,
    rooms: string[] = []
  ) {
    this.data = { userId };
    this.rooms.add(id);
    for (const room of rooms) {
      this.rooms.add(room);
    }
  }

  async join(room: string): Promise<void> {
    this.rooms.add(room);
  }

  async leave(room: string): Promise<void> {
    this.rooms.delete(room);
  }
}

/** A core access double whose zone answer carries the readable list ids. */
function access(listIds: string[] = READABLE) {
  const checkZoneWithLists = jest
    .fn()
    .mockResolvedValue({ allowed: true, listIds });
  return {
    checkZoneWithLists,
    checkZoneStaff: jest.fn().mockResolvedValue(false),
    checkList: jest.fn().mockResolvedValue(true),
  };
}

function gatewayWith(core: ReturnType<typeof access>): RealtimeGateway {
  const presence = {
    register: jest.fn(),
    joinZone: jest.fn().mockResolvedValue(undefined),
    leaveZone: jest.fn().mockResolvedValue(undefined),
  } as unknown as PresenceService;

  return new RealtimeGateway(
    { verify: jest.fn().mockResolvedValue({ sub: 'u1' }) } as never,
    core as unknown as CoreAccessClient,
    presence,
    { stream$: { subscribe: jest.fn() } } as never,
    { bind: jest.fn() } as never,
    { debug: jest.fn() } as never
  );
}

describe('subscribing to a zone', () => {
  it('joins the presence room of every list the caller may read', async () => {
    const socket = new FakeSocket('s1', 'u1');
    const gateway = gatewayWith(access());

    await gateway.subscribeZone(socket as never, { zoneId: ZONE });

    expect(socket.rooms.has(listPresenceRoom('l1'))).toBe(true);
    expect(socket.rooms.has(listPresenceRoom('l2'))).toBe(true);
  });

  it('joins no room for a list the caller may not read', async () => {
    const socket = new FakeSocket('s1', 'u1');
    const gateway = gatewayWith(access());

    await gateway.subscribeZone(socket as never, { zoneId: ZONE });

    expect(socket.rooms.has(listPresenceRoom(HIDDEN))).toBe(false);
  });

  it('joins the presence rooms and not the list rooms themselves', async () => {
    // The distinction plan 0032 section 3 turns on: `list:{id}` carries every
    // line and comment event, so joining it eagerly would push every edit of
    // every readable list to every device, permanently.
    const socket = new FakeSocket('s1', 'u1');
    const gateway = gatewayWith(access());

    await gateway.subscribeZone(socket as never, { zoneId: ZONE });

    expect(socket.rooms.has(listRoom('l1'))).toBe(false);
  });

  it('answers both halves in one call to core', async () => {
    const core = access();
    const socket = new FakeSocket('s1', 'u1');

    await gatewayWith(core).subscribeZone(socket as never, { zoneId: ZONE });

    // Subscribing was already a round trip; the ids are a field on its answer.
    expect(core.checkZoneWithLists).toHaveBeenCalledTimes(1);
  });

  it('joins nothing at all when the zone itself is denied', async () => {
    const core = access();
    core.checkZoneWithLists.mockResolvedValue({ allowed: false, listIds: [] });
    const socket = new FakeSocket('s1', 'u1');

    const ack = await gatewayWith(core).subscribeZone(socket as never, {
      zoneId: ZONE,
    });

    expect(ack).toEqual({ ok: false });
    expect([...socket.rooms]).toEqual(['s1']);
  });
});

describe('connecting', () => {
  it('still asks core nothing', async () => {
    // The tempting placement for the presence rooms is `handleConnection`, and
    // it is rejected on where the cost lands: enumerating every readable list
    // across every zone would put the most expensive query this service makes on
    // the critical path of every connect, and a deploy reconnects every client at
    // once.
    const core = access();
    const gateway = gatewayWith(core);
    const socket = new FakeSocket('s1', 'u1');

    await gateway.handleConnection(socket as never);

    expect(core.checkZoneWithLists).not.toHaveBeenCalled();
  });
});

describe('unsubscribing from a zone', () => {
  it('leaves every one of the zone presence rooms it acquired', async () => {
    const core = access();
    const socket = new FakeSocket('s1', 'u1');
    const gateway = gatewayWith(core);

    await gateway.subscribeZone(socket as never, { zoneId: ZONE });
    await gateway.unsubscribeZone(socket as never, { zoneId: ZONE });

    // Nothing but the socket's own id room is left: they were acquired by that
    // subscription and are not rooms of their own on the client.
    expect([...socket.rooms]).toEqual(['s1']);
  });

  it('keeps a presence room the caller holds through another zone', async () => {
    const core = access();
    const socket = new FakeSocket('s1', 'u1', [listPresenceRoom('other')]);
    const gateway = gatewayWith(core);

    await gateway.subscribeZone(socket as never, { zoneId: ZONE });
    await gateway.unsubscribeZone(socket as never, { zoneId: ZONE });

    expect(socket.rooms.has(listPresenceRoom('other'))).toBe(true);
  });
});

/** The pod half: a directive arrives and this pod acts on its own sockets. */
function pod(sockets: FakeSocket[], listIds: string[] = READABLE) {
  let receive: ((directive: RelayDirective) => void) | undefined;
  const relay = {
    directives$: {
      subscribe: (handler: (directive: RelayDirective) => void) => {
        receive = handler;
      },
    },
  } as never;

  const recheckZoneLists = jest.fn().mockResolvedValue(listIds);
  const recheckList = jest.fn().mockResolvedValue(true);

  const byId = new Map(sockets.map((socket) => [socket.id, socket]));
  const rooms = new Map<string, Set<string>>();
  for (const socket of sockets) {
    for (const room of socket.rooms) {
      const members = rooms.get(room) ?? new Set<string>();
      members.add(socket.id);
      rooms.set(room, members);
    }
  }

  const service = new RoomSyncService(
    relay,
    {
      socketsOf: (userId: string) =>
        sockets.filter((s) => s.data.userId === userId).map((s) => s.id),
      leaveZone: jest.fn().mockResolvedValue(undefined),
      unviewList: jest.fn().mockResolvedValue(undefined),
    } as unknown as PresenceService,
    {
      recheckZoneLists,
      recheckList,
      recheckZone: jest.fn().mockResolvedValue(true),
      recheckZoneStaff: jest.fn().mockResolvedValue(true),
    } as never,
    { warn: jest.fn() } as never
  );
  service.onModuleInit();
  service.bind({
    sockets: { sockets: byId, adapter: { rooms } },
  } as unknown as Server);

  return {
    recheckZoneLists,
    recheckList,
    run: async (directive: RelayDirective) => {
      receive?.(directive);
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

const CREATED: DomainEvent = {
  event: RealtimeEvent.ListCreated,
  eventId: 'e1',
  zoneId: ZONE,
  listId: 'l2',
  payload: { id: 'l2', zoneId: ZONE },
};

describe('a list created while somebody is subscribed', () => {
  it('sweeps the zone room the other way', () => {
    expect(sweepsFor(CREATED)).toEqual([
      { direction: 'admit', rooms: [zoneRoom(ZONE)], zoneId: ZONE },
    ]);
  });

  it('joins the already subscribed sockets, on a pod that consumed nothing', async () => {
    // Invalidating the cached set joins nobody to anything; without this sweep
    // the socket would sit outside the new list's presence room until it next
    // re-subscribed, which on a mobile connection can be hours.
    const socket = new FakeSocket('s1', 'u1', [
      zoneRoom(ZONE),
      listPresenceRoom('l1'),
    ]);
    const podB = pod([socket]);

    await podB.run(sweepsFor(CREATED)[0]);

    expect(socket.rooms.has(listPresenceRoom('l2'))).toBe(true);
  });

  it('leaves the rooms it already holds alone', async () => {
    const socket = new FakeSocket('s1', 'u1', [
      zoneRoom(ZONE),
      listPresenceRoom('l1'),
    ]);
    const podB = pod([socket]);

    await podB.run(sweepsFor(CREATED)[0]);

    expect(socket.rooms.has(listPresenceRoom('l1'))).toBe(true);
    expect(socket.rooms.has(zoneRoom(ZONE))).toBe(true);
  });

  it('asks once for a user holding several sockets', async () => {
    const phone = new FakeSocket('s1', 'u1', [zoneRoom(ZONE)]);
    const laptop = new FakeSocket('s2', 'u1', [zoneRoom(ZONE)]);
    const podB = pod([phone, laptop]);

    await podB.run(sweepsFor(CREATED)[0]);

    expect(podB.recheckZoneLists).toHaveBeenCalledTimes(1);
  });

  it('does not touch a socket that is not subscribed to the zone', async () => {
    const elsewhere = new FakeSocket('s9', 'u9', [zoneRoom('other')]);
    const podB = pod([elsewhere]);

    await podB.run(sweepsFor(CREATED)[0]);

    expect(elsewhere.rooms.has(listPresenceRoom('l2'))).toBe(false);
    expect(podB.recheckZoneLists).not.toHaveBeenCalled();
  });
});

describe('losing read access to one list', () => {
  const accessChanged: DomainEvent = {
    event: RealtimeEvent.ListAccessChanged,
    eventId: 'e2',
    zoneId: ZONE,
    listId: 'l1',
    payload: { listId: 'l1' },
  };

  it('takes the presence room away and keeps the zone others', async () => {
    const socket = new FakeSocket('s1', 'u1', [
      zoneRoom(ZONE),
      listPresenceRoom('l1'),
      listPresenceRoom('l2'),
    ]);
    const podA = pod([socket]);
    podA.recheckList.mockImplementation(async (_u: string, listId: string) =>
      listId !== 'l1'
    );

    await podA.run(sweepsFor(accessChanged)[0]);

    expect(socket.rooms.has(listPresenceRoom('l1'))).toBe(false);
    expect(socket.rooms.has(listPresenceRoom('l2'))).toBe(true);
    expect(socket.rooms.has(zoneRoom(ZONE))).toBe(true);
  });

  it('asks core once for a list held in both of its rooms', async () => {
    // `list:{id}` and `list:{id}:presence` are two rooms behind one answer.
    const socket = new FakeSocket('s1', 'u1', [
      listRoom('l1'),
      listPresenceRoom('l1'),
    ]);
    const podA = pod([socket]);

    await podA.run(sweepsFor(accessChanged)[0]);

    expect(podA.recheckList).toHaveBeenCalledTimes(1);
  });
});
