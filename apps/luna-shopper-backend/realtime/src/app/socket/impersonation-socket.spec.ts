import { userRoom } from '@portfolio/luna-shopper/contracts';
import { Subject } from 'rxjs';
import { impersonationRoom } from '../impersonation/impersonation-sessions.service';
import { RealtimeGateway } from './realtime.gateway';

/**
 * A socket of a support session (plan 0194, target state 9).
 *
 * A socket is verified one time, as it connects, so nothing about its token
 * closes it later. These are the three things that do: auth says the session
 * is not live, the deadline arrives, and auth announces that the session
 * ended. An ordinary socket takes none of them.
 */

const NOW = Date.parse('2026-10-13T10:00:00.000Z');
const SESSION = 's1';

/** A socket.io server double that models rooms and `disconnectSockets`. */
function fakeServer() {
  const clients = new Map<string, ReturnType<typeof makeClient>>();

  function makeClient(id: string) {
    const rooms = new Set<string>();
    const client = {
      id,
      data: {} as Record<string, unknown>,
      rooms,
      join: jest.fn(async (room: string) => {
        rooms.add(room);
      }),
      disconnect: jest.fn(),
      handshake: { auth: { token: 't' }, headers: {}, query: {} },
    };
    clients.set(id, client);
    return client;
  }

  const server = {
    local: {
      to: () => ({ emit: jest.fn() }),
      in: (room: string) => ({
        disconnectSockets: (close: boolean) => {
          for (const client of clients.values()) {
            if (client.rooms.has(room)) {
              client.disconnect(close);
            }
          }
        },
      }),
    },
  };

  return { server, client: makeClient };
}

function build(options: { identity: unknown; live?: boolean }) {
  const io = fakeServer();
  const ended$ = new Subject<string>();
  const sessions = {
    ended$: ended$.asObservable(),
    isLive: jest.fn(async () => options.live ?? true),
  };
  const presence = {
    register: jest.fn(),
    disconnect: jest.fn(async () => undefined),
  };
  const gateway = new RealtimeGateway(
    { verifyIdentity: jest.fn(async () => options.identity) } as never,
    {} as never,
    presence as never,
    { stream$: { subscribe: jest.fn() } } as never,
    { bind: jest.fn() } as never,
    { debug: jest.fn() } as never,
    sessions as never
  );
  (gateway as unknown as { server: unknown }).server = io.server;
  gateway.onModuleInit();
  return { gateway, io, sessions, presence, ended$ };
}

const supported = (minutesLeft: number) => ({
  kind: 'user',
  userId: 'u1',
  impersonation: {
    sessionId: SESSION,
    until: (NOW + minutesLeft * 60_000) / 1000,
  },
});

describe('a socket of a support session', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('asks auth whether the session is live, and joins as the user', async () => {
    const { gateway, io, sessions } = build({ identity: supported(90) });
    const client = io.client('c1');

    await gateway.handleConnection(client as never);

    expect(sessions.isLive).toHaveBeenCalledWith(SESSION);
    expect(client.disconnect).not.toHaveBeenCalled();
    expect([...client.rooms].sort()).toEqual(
      [impersonationRoom(SESSION), userRoom('u1')].sort()
    );
  });

  it('is refused when auth says the session is not live', async () => {
    const { gateway, io, presence } = build({
      identity: supported(90),
      live: false,
    });
    const client = io.client('c1');

    await gateway.handleConnection(client as never);

    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(client.rooms.size).toBe(0);
    expect(presence.register).not.toHaveBeenCalled();
  });

  it('is refused past its deadline, with no question to auth', async () => {
    const { gateway, io, sessions } = build({ identity: supported(0) });
    const client = io.client('c1');

    await gateway.handleConnection(client as never);

    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(sessions.isLive).not.toHaveBeenCalled();
  });

  it('is disconnected at until, and not a moment before', async () => {
    const { gateway, io } = build({ identity: supported(90) });
    const client = io.client('c1');
    await gateway.handleConnection(client as never);

    jest.advanceTimersByTime(90 * 60_000 - 1);
    expect(client.disconnect).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(client.disconnect).toHaveBeenCalledTimes(1);
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('is disconnected on impersonation.ended for its session', async () => {
    const { gateway, io, ended$ } = build({ identity: supported(90) });
    const client = io.client('c1');
    await gateway.handleConnection(client as never);

    ended$.next('another-session');
    expect(client.disconnect).not.toHaveBeenCalled();

    ended$.next(SESSION);
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('drops its deadline timer when it disconnects first', async () => {
    const { gateway, io } = build({ identity: supported(90) });
    const client = io.client('c1');
    await gateway.handleConnection(client as never);

    await gateway.handleDisconnect(client as never);

    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(120 * 60_000);
    expect(client.disconnect).not.toHaveBeenCalled();
  });
});

describe('an ordinary socket, which does not change', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('asks auth nothing, joins no session room and carries no timer', async () => {
    const { gateway, io, sessions, ended$ } = build({
      identity: { kind: 'user', userId: 'u1' },
    });
    const client = io.client('c1');

    await gateway.handleConnection(client as never);

    expect(sessions.isLive).not.toHaveBeenCalled();
    expect([...client.rooms]).toEqual([userRoom('u1')]);
    expect(jest.getTimerCount()).toBe(0);

    ended$.next(SESSION);
    jest.advanceTimersByTime(24 * 60 * 60_000);
    expect(client.disconnect).not.toHaveBeenCalled();
  });
});
