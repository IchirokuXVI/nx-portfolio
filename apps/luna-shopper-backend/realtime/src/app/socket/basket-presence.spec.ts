import {
  BasketKind,
  basketPresenceRoom,
  basketRoom,
} from '@portfolio/luna-shopper/contracts';
import { RealtimeGateway } from './realtime.gateway';

/**
 * What a participant socket joins, and what it does not (plan 0139, section 6).
 *
 * Every participant socket joins the basket's room, which carries the basket's
 * own traffic. Presence is the half that is meaningless on a `LIVE` basket: it
 * is the one everybody holds all the time, so "somebody is here" on it says
 * nothing about anything, and a presence room per person is a Redis key that
 * never expires.
 */

const BASKET = 'gl-1';
const PARTICIPANT = 'p-1';

const ENTRY = {
  participantId: PARTICIPANT,
  kind: 'REGISTERED',
  displayName: 'Ana',
  guestNumber: null,
  userId: 'u-ana',
};

function build(admission: unknown) {
  const client = {
    id: 's1',
    data: {} as { participantId?: string; basketKind?: BasketKind },
    join: jest.fn(async () => undefined),
    disconnect: jest.fn(),
    handshake: { auth: { token: 't' }, headers: {}, query: {} },
  };

  const coreAccess = {
    checkParticipant: jest.fn(async () => admission),
  };
  const presence = {
    register: jest.fn(),
    registerParticipant: jest.fn(),
    joinGeneratedList: jest.fn(async () => undefined),
    disconnect: jest.fn(async () => undefined),
  };
  const tokenVerifier = {
    verifyIdentity: jest.fn(async () => ({
      kind: 'participant',
      participantId: PARTICIPANT,
      generatedListId: BASKET,
    })),
  };

  const gateway = new RealtimeGateway(
    tokenVerifier as never,
    coreAccess as never,
    presence as never,
    { stream$: { subscribe: jest.fn() } } as never,
    { bind: jest.fn() } as never,
    { debug: jest.fn() } as never
  );
  (gateway as unknown as { server: unknown }).server = {
    local: { to: () => ({ emit: jest.fn() }) },
  };

  return { gateway, client, presence, coreAccess };
}

/** The rooms `join` was called with, in order. */
const joined = (client: { join: jest.Mock }): string[] =>
  client.join.mock.calls.map(([room]) => room as string);

describe('a participant socket on a GENERATED basket', () => {
  it('joins both rooms and enters presence', async () => {
    const w = build({ entry: ENTRY, basketKind: BasketKind.GENERATED });

    await w.gateway.handleConnection(w.client as never);

    expect(joined(w.client)).toEqual([
      basketRoom(BASKET),
      basketPresenceRoom(BASKET),
    ]);
    expect(w.presence.registerParticipant).toHaveBeenCalledWith('s1', ENTRY);
    expect(w.presence.joinGeneratedList).toHaveBeenCalledWith('s1', BASKET);
  });
});

describe('a participant socket on a LIVE basket', () => {
  it('joins the basket room and no presence room', async () => {
    const w = build({ entry: ENTRY, basketKind: BasketKind.LIVE });

    await w.gateway.handleConnection(w.client as never);

    // The room carries the basket's own traffic and every socket gets it. What
    // it does not get is a presence entry nobody would read.
    expect(joined(w.client)).toEqual([basketRoom(BASKET)]);
    expect(w.presence.registerParticipant).not.toHaveBeenCalled();
    expect(w.presence.joinGeneratedList).not.toHaveBeenCalled();
  });

  it('keeps the kind on the socket, so the disconnect path knows', async () => {
    const w = build({ entry: ENTRY, basketKind: BasketKind.LIVE });

    await w.gateway.handleConnection(w.client as never);

    expect(w.client.data.basketKind).toBe(BasketKind.LIVE);
  });
});

describe('a participant core refuses', () => {
  it('is disconnected and joins nothing', async () => {
    const w = build(undefined);

    await w.gateway.handleConnection(w.client as never);

    expect(w.client.disconnect).toHaveBeenCalledWith(true);
    expect(joined(w.client)).toEqual([]);
  });
});
