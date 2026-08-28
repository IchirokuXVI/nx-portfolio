import {
  listRoom,
  RealtimeEvent,
  zoneRoom,
  zoneStaffRoom,
  type DomainEvent,
} from '@portfolio/luna-shopper/contracts';
import type { Server } from 'socket.io';
import { sweepsFor } from '../consumer/sweeps';
import type { PresenceService } from '../presence/presence.service';
import type { RelayDirective } from '../relay/event-relay.service';
import { RoomSyncService } from './room-sync.service';

/**
 * Rooms a socket should no longer be in (plan 0031).
 *
 * The whole plan in one sentence: a kicked member leaves the zone's rooms
 * **without their client sending `zone.unsubscribe`**. Every test below keeps
 * that constraint, because the cooperative release the service relies on today
 * is a well behaved client choosing to leave rather than an access control.
 */

const ZONE = 'z1';
const OTHER_ZONE = 'z2';
const THIRD_ZONE = 'z3';
const LIST = 'l1';
const OTHER_LIST = 'l2';

/** A socket double with real room membership, which is what the sweep moves. */
class FakeSocket {
  readonly rooms: Set<string>;

  constructor(
    readonly id: string,
    userId: string,
    rooms: string[]
  ) {
    this.data = { userId };
    // Socket.io puts every socket in a room named after its own id. It is here
    // on purpose: the sweep must pass over it rather than try to authorize it.
    this.rooms = new Set([id, ...rooms]);
  }

  readonly data: { userId: string };

  async leave(room: string): Promise<void> {
    this.rooms.delete(room);
  }
}

/** Just enough socket.io server for the sweep: the two indexes it reads. */
function fakeServer(sockets: FakeSocket[]): Server {
  const byId = new Map(sockets.map((socket) => [socket.id, socket]));
  const rooms = new Map<string, Set<string>>();
  for (const socket of sockets) {
    for (const room of socket.rooms) {
      const members = rooms.get(room) ?? new Set<string>();
      members.add(socket.id);
      rooms.set(room, members);
    }
  }
  return { sockets: { sockets: byId, adapter: { rooms } } } as unknown as Server;
}

interface Harness {
  service: RoomSyncService;
  run: (directive: RelayDirective) => Promise<void>;
  presence: { leaveZone: jest.Mock; unviewList: jest.Mock };
  recheckZone: jest.Mock;
  recheckZoneStaff: jest.Mock;
  recheckList: jest.Mock;
}

/**
 * A pod holding the given sockets, whose core answers `no` for exactly the rooms
 * named in `denied`. The relay is a plain subject the test pushes directives
 * into, standing in for the message that arrived from whichever pod consumed the
 * event.
 */
function pod(sockets: FakeSocket[], denied: string[] = []): Harness {
  let receive: ((directive: RelayDirective) => void) | undefined;
  const relay = {
    directives$: {
      subscribe: (handler: (directive: RelayDirective) => void) => {
        receive = handler;
      },
    },
  } as never;

  const presence = {
    socketsOf: (userId: string) =>
      sockets.filter((s) => s.data.userId === userId).map((s) => s.id),
    leaveZone: jest.fn().mockResolvedValue(undefined),
    unviewList: jest.fn().mockResolvedValue(undefined),
  };

  const answer = (room: string) => Promise.resolve(!denied.includes(room));
  const recheckZone = jest.fn((_u: string, zoneId: string) =>
    answer(zoneRoom(zoneId))
  );
  const recheckZoneStaff = jest.fn((_u: string, zoneId: string) =>
    answer(zoneStaffRoom(zoneId))
  );
  const recheckList = jest.fn((_u: string, listId: string) =>
    answer(listRoom(listId))
  );

  const service = new RoomSyncService(
    relay,
    presence as unknown as PresenceService,
    { recheckZone, recheckZoneStaff, recheckList } as never,
    { warn: jest.fn() } as never
  );
  service.onModuleInit();
  service.bind(fakeServer(sockets));

  return {
    service,
    run: async (directive: RelayDirective) => {
      receive?.(directive);
      // The subscription handler is fire and forget; let its promise settle.
      await new Promise((resolve) => setImmediate(resolve));
    },
    presence,
    recheckZone,
    recheckZoneStaff,
    recheckList,
  };
}

function kicked(userId: string): DomainEvent {
  return {
    event: RealtimeEvent.MemberKicked,
    eventId: 'e1',
    zoneId: ZONE,
    payload: { id: 'm1', zoneId: ZONE, userId },
  };
}

describe('evicting a kicked member', () => {
  it('takes the zone room away with no unsubscribe from the client', async () => {
    const socket = new FakeSocket('s1', 'u1', [zoneRoom(ZONE)]);
    const harness = pod([socket], [zoneRoom(ZONE)]);

    await harness.run(sweepsFor(kicked('u1'))[0]);

    expect(socket.rooms.has(zoneRoom(ZONE))).toBe(false);
  });

  it('takes the zone lists with it, and their presence', async () => {
    const socket = new FakeSocket('s1', 'u1', [
      zoneRoom(ZONE),
      listRoom(LIST),
      listRoom(OTHER_LIST),
    ]);
    // Losing the zone loses its lists, because core's read check requires an
    // approved membership before it looks at list access at all.
    const harness = pod(
      [socket],
      [zoneRoom(ZONE), listRoom(LIST), listRoom(OTHER_LIST)]
    );

    await harness.run(sweepsFor(kicked('u1'))[0]);

    expect([...socket.rooms]).toEqual(['s1']);
    expect(harness.presence.unviewList).toHaveBeenCalledWith('s1', LIST);
    expect(harness.presence.unviewList).toHaveBeenCalledWith('s1', OTHER_LIST);
  });

  it('removes them from the zone presence rather than letting them time out', async () => {
    const socket = new FakeSocket('s1', 'u1', [zoneRoom(ZONE)]);
    const harness = pod([socket], [zoneRoom(ZONE)]);

    await harness.run(sweepsFor(kicked('u1'))[0]);

    // `leaveZone` is what removes the member from `presence:zone:{id}` and
    // rebroadcasts, so the others see them go at once instead of on the ninety
    // second heartbeat timeout.
    expect(harness.presence.leaveZone).toHaveBeenCalledWith('s1', ZONE);
  });

  it('keeps every other zone, and never disconnects', async () => {
    const socket = new FakeSocket('s1', 'u1', [
      zoneRoom(ZONE),
      zoneRoom(OTHER_ZONE),
      zoneRoom(THIRD_ZONE),
    ]);
    const harness = pod([socket], [zoneRoom(ZONE)]);

    await harness.run(sweepsFor(kicked('u1'))[0]);

    expect(socket.rooms.has(zoneRoom(OTHER_ZONE))).toBe(true);
    expect(socket.rooms.has(zoneRoom(THIRD_ZONE))).toBe(true);
    expect(harness.presence.leaveZone).toHaveBeenCalledTimes(1);
  });

  it('leaves other members of the zone where they are', async () => {
    const kickedSocket = new FakeSocket('s1', 'u1', [zoneRoom(ZONE)]);
    const staying = new FakeSocket('s2', 'u2', [zoneRoom(ZONE)]);
    // The deny is per room in this double, so a sweep scoped to u1's sockets is
    // the only thing keeping u2 in place; that is the assertion.
    const harness = pod([kickedSocket, staying], [zoneRoom(ZONE)]);

    await harness.run(sweepsFor(kicked('u1'))[0]);

    expect(staying.rooms.has(zoneRoom(ZONE))).toBe(true);
  });
});

describe('a demoted admin', () => {
  it('leaves the staff room and stays in the zone', async () => {
    const socket = new FakeSocket('s1', 'u1', [
      zoneRoom(ZONE),
      zoneStaffRoom(ZONE),
    ]);
    const harness = pod([socket], [zoneStaffRoom(ZONE)]);

    const demoted: DomainEvent = {
      event: RealtimeEvent.MemberRoleChanged,
      eventId: 'e2',
      zoneId: ZONE,
      payload: { id: 'm1', zoneId: ZONE, userId: 'u1' },
    };
    await harness.run(sweepsFor(demoted)[0]);

    expect(socket.rooms.has(zoneStaffRoom(ZONE))).toBe(false);
    expect(socket.rooms.has(zoneRoom(ZONE))).toBe(true);
    // The staff room carries no presence of its own; only the counts are lost.
    expect(harness.presence.leaveZone).not.toHaveBeenCalled();
  });
});

describe('list.accessChanged', () => {
  const event: DomainEvent = {
    event: RealtimeEvent.ListAccessChanged,
    eventId: 'e3',
    zoneId: ZONE,
    listId: LIST,
    payload: { listId: LIST },
  };

  it('sweeps the room the payload names, which names nobody', async () => {
    expect(sweepsFor(event)).toEqual([
      { direction: 'evict', rooms: [listRoom(LIST)] },
    ]);
  });

  it('removes only the sockets whose re-check now fails', async () => {
    const revoked = new FakeSocket('s1', 'u1', [zoneRoom(ZONE), listRoom(LIST)]);
    const kept = new FakeSocket('s2', 'u2', [zoneRoom(ZONE), listRoom(LIST)]);
    const harness = pod([revoked, kept]);
    harness.recheckList.mockImplementation(async (userId: string) =>
      userId !== 'u1'
    );

    await harness.run(sweepsFor(event)[0]);

    expect(revoked.rooms.has(listRoom(LIST))).toBe(false);
    expect(kept.rooms.has(listRoom(LIST))).toBe(true);
    // The zone is not what changed, and neither socket loses it.
    expect(revoked.rooms.has(zoneRoom(ZONE))).toBe(true);
  });

  it('asks each question once however many sockets a user holds', async () => {
    const phone = new FakeSocket('s1', 'u1', [listRoom(LIST)]);
    const laptop = new FakeSocket('s2', 'u1', [listRoom(LIST)]);
    const harness = pod([phone, laptop]);

    await harness.run(sweepsFor(event)[0]);

    expect(harness.recheckList).toHaveBeenCalledTimes(1);
  });
});

describe('which events sweep at all', () => {
  it('member.rejected evicts nothing: a pending member was never in the room', () => {
    expect(
      sweepsFor({
        event: RealtimeEvent.MemberRejected,
        eventId: 'e4',
        zoneId: ZONE,
        payload: { id: 'm1', userId: 'u1' },
      })
    ).toEqual([]);
  });

  it('an ordinary line edit evicts nothing', () => {
    expect(
      sweepsFor({
        event: RealtimeEvent.LineAdded,
        eventId: 'e5',
        zoneId: ZONE,
        listId: LIST,
        payload: {},
      })
    ).toEqual([]);
  });

  it('a merge approval sweeps both accounts it names', () => {
    expect(
      sweepsFor({
        event: RealtimeEvent.MergeApproved,
        eventId: 'e6',
        zoneId: ZONE,
        payload: { id: 'r1', zoneId: ZONE, sourceUserId: 'u1', targetUserId: 'u2' },
      })
    ).toEqual([{ direction: 'evict', userIds: ['u1', 'u2'] }]);
  });

  it('a zone going away sweeps the whole room, which its payload does not name', () => {
    for (const event of [
      RealtimeEvent.ZoneDeleted,
      RealtimeEvent.ZoneMarkedForDeletion,
      RealtimeEvent.ZoneOwnershipChanged,
    ]) {
      expect(
        sweepsFor({ event, eventId: 'e7', zoneId: ZONE, payload: {} })
      ).toEqual([{ direction: 'evict', rooms: [zoneRoom(ZONE)] }]);
    }
  });
});

describe('crossing pods', () => {
  it('evicts a socket held by a pod that never saw the event', async () => {
    // This harness is pod B: it holds the socket and consumed nothing. The
    // directive is what crossed, exactly as it would over the relay channel.
    const socket = new FakeSocket('s1', 'u1', [zoneRoom(ZONE)]);
    const podB = pod([socket], [zoneRoom(ZONE)]);

    await podB.run(sweepsFor(kicked('u1'))[0]);

    expect(socket.rooms.has(zoneRoom(ZONE))).toBe(false);
  });

  it('does nothing for a user whose sockets are all on another pod', async () => {
    const stranger = new FakeSocket('s9', 'u9', [zoneRoom(ZONE)]);
    const podB = pod([stranger], [zoneRoom(ZONE)]);

    await podB.run(sweepsFor(kicked('u1'))[0]);

    expect(stranger.rooms.has(zoneRoom(ZONE))).toBe(true);
    expect(podB.recheckZone).not.toHaveBeenCalled();
  });
});

describe('a cooperative client', () => {
  it('makes the sweep a no-op, because there is nothing left to leave', async () => {
    // The client already released the zone on `member.kicked`, so the socket is
    // in nothing but its own id room by the time the directive arrives.
    const socket = new FakeSocket('s1', 'u1', []);
    const harness = pod([socket], [zoneRoom(ZONE)]);

    await harness.run(sweepsFor(kicked('u1'))[0]);

    expect([...socket.rooms]).toEqual(['s1']);
    expect(harness.recheckZone).not.toHaveBeenCalled();
    expect(harness.presence.leaveZone).not.toHaveBeenCalled();
  });
});
