import {
  RealtimeEvent,
  userRoom,
  zoneRoom,
} from '@portfolio/luna-shopper/contracts';
import { EventRelayService } from '../relay/event-relay.service';
import { RealtimeGateway } from './realtime.gateway';

/**
 * The user's own channel, from connection to delivery (plan 0030, section 2).
 *
 * The property under test is the one a PENDING member depends on: a socket that
 * has sent **no subscribe message at all** still receives the events addressed
 * to the person holding it. `checkZone` calls `requireApproved`, so a member
 * waiting for approval is refused the zone room and is not in the room where
 * their own approval is announced; the room they are in is the one they were put
 * in when they connected.
 */

/** A socket.io server double that actually models room membership. */
function fakeServer() {
  const sockets = new Map<
    string,
    { rooms: Set<string>; received: unknown[] }
  >();

  return {
    sockets,
    /**
     * What the gateway holds as `server`: a local-only emit that resolves its
     * rooms to the **union** of the sockets in them, which is what socket.io
     * does and what keeps a socket in two of the named rooms from being served
     * twice.
     */
    server: {
      local: {
        to: (rooms: string | string[]) => ({
          emit: (event: string, payload: unknown) => {
            const named = new Set(Array.isArray(rooms) ? rooms : [rooms]);
            for (const socket of sockets.values()) {
              if ([...socket.rooms].some((room) => named.has(room))) {
                socket.received.push({ event, payload });
              }
            }
          },
        }),
      },
    },
    /** A connected client, with the join the gateway performs recorded. */
    client(id: string) {
      const state = { rooms: new Set<string>(), received: [] as unknown[] };
      sockets.set(id, state);
      return {
        id,
        data: {} as { userId?: string },
        rooms: state.rooms,
        join: jest.fn(async (room: string) => {
          state.rooms.add(room);
        }),
        leave: jest.fn(async (room: string) => {
          state.rooms.delete(room);
        }),
        disconnect: jest.fn(),
        handshake: { auth: { token: 't' }, headers: {}, query: {} },
        state,
      };
    },
  };
}

/** A relay whose publish loops back into this pod's own subscription. */
async function loopbackRelay(): Promise<EventRelayService> {
  let deliverToPod: ((channel: string, raw: string) => void) | undefined;
  const redis = {
    duplicate: () => ({
      on: (event: string, handler: (channel: string, raw: string) => void) => {
        if (event === 'message') {
          deliverToPod = handler;
        }
      },
      subscribe: jest.fn().mockResolvedValue(1),
      unsubscribe: jest.fn().mockResolvedValue(1),
    }),
    client: {
      publish: jest.fn(async (channel: string, raw: string) => {
        deliverToPod?.(channel, raw);
        return 1;
      }),
    },
  } as never;

  const relay = new EventRelayService(redis, {
    warn: jest.fn(),
    error: jest.fn(),
  } as never);
  await relay.onModuleInit();
  return relay;
}

async function build(userId = 'u1', verifies = true) {
  const relay = await loopbackRelay();
  const io = fakeServer();
  const tokenVerifier = {
    verify: jest.fn(async () =>
      verifies ? { sub: userId } : Promise.reject(new Error('bad token'))
    ),
    // Plan 0051 section 9: the handshake now asks which of the two kinds of
    // identity the token carries. Every socket in this suite is an account one.
    verifyIdentity: jest.fn(async () =>
      verifies
        ? { kind: 'user', userId }
        : Promise.reject(new Error('bad token'))
    ),
  };
  const coreAccess = {
    // Plan 0032 turned the zone check into one answer carrying the readable list
    // ids. This suite joins no list presence rooms, so the set stays empty.
    checkZoneWithLists: jest.fn(async () => ({ allowed: false, listIds: [] })),
    checkZoneStaff: jest.fn(async () => false),
    checkList: jest.fn(async () => false),
  };
  const presence = {
    register: jest.fn(),
    disconnect: jest.fn(async () => undefined),
    joinZone: jest.fn(async () => undefined),
  };
  const gateway = new RealtimeGateway(
    tokenVerifier as never,
    coreAccess as never,
    presence as never,
    relay,
    // Plan 0031 gave the gateway the room sync service, which this suite never
    // exercises: nothing here loses access to anything.
    { bind: jest.fn() } as never,
    { debug: jest.fn() } as never
  );
  (gateway as unknown as { server: unknown }).server = io.server;
  gateway.onModuleInit();

  return { gateway, relay, io, tokenVerifier, coreAccess, presence };
}

describe('the user room a socket is put in', () => {
  it('is joined at connection, from the id the token carries', async () => {
    const { gateway, io } = await build('u1');
    const client = io.client('s1');

    await gateway.handleConnection(client as never);

    expect(client.join).toHaveBeenCalledWith(userRoom('u1'));
    expect(client.data.userId).toBe('u1');
  });

  it('is not asked of core: the verified token is the claim', async () => {
    const { gateway, io, coreAccess } = await build('u1');

    await gateway.handleConnection(io.client('s1') as never);

    // Every other room is checked because the socket is claiming a relationship
    // to a resource. Asking "may this user hear about this user" would be a
    // round trip to answer a tautology (section 2).
    expect(coreAccess.checkZoneWithLists).not.toHaveBeenCalled();
    expect(coreAccess.checkZoneStaff).not.toHaveBeenCalled();
  });

  it('is not joined by a socket whose token does not verify', async () => {
    const { gateway, io } = await build('u1', false);
    const client = io.client('s1');

    await gateway.handleConnection(client as never);

    expect(client.join).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('delivers an approval to a pending member who subscribed to nothing', async () => {
    const { gateway, io, relay } = await build('u1');
    const client = io.client('s1');
    await gateway.handleConnection(client as never);

    // Exactly what the consumer publishes for `member.approved` (section 4.1):
    // the zone room, which this socket is not in, and the member's own.
    relay.publish({
      rooms: [zoneRoom('z1'), userRoom('u1')],
      event: RealtimeEvent.MemberApproved,
      payload: { id: 'm1', userId: 'u1', status: 'APPROVED' },
    });

    expect(client.rooms.has(zoneRoom('z1'))).toBe(false);
    expect(client.state.received).toEqual([
      {
        event: RealtimeEvent.MemberApproved,
        payload: { id: 'm1', userId: 'u1', status: 'APPROVED' },
      },
    ]);
  });

  it('delivers one copy to a member who does hold the zone room as well', async () => {
    const { gateway, io, relay, coreAccess } = await build('u1');
    coreAccess.checkZoneWithLists.mockResolvedValue({
      allowed: true,
      listIds: [],
    });
    const client = io.client('s1');
    await gateway.handleConnection(client as never);
    await gateway.subscribeZone(client as never, { zoneId: 'z1' });

    relay.publish({
      rooms: [zoneRoom('z1'), userRoom('u1')],
      event: RealtimeEvent.MemberApproved,
      payload: { id: 'm1' },
    });

    // This socket is in both of the named rooms. One delivery is what a client
    // can render; two is a double toast and a double refetch, which is what an
    // emit per room would produce for exactly the person the event is about.
    expect(client.state.received).toHaveLength(1);
  });

  it('keeps one user’s events out of another user’s socket', async () => {
    const { gateway, io, relay } = await build('u1');
    await gateway.handleConnection(io.client('s1') as never);

    relay.publish({
      rooms: [userRoom('u2')],
      event: RealtimeEvent.UserUsernameChanged,
      payload: { userId: 'u2', username: 'Vela Rápida' },
    });

    expect(io.sockets.get('s1')?.received).toEqual([]);
  });
});
