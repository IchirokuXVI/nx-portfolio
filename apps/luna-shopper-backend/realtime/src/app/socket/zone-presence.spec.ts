import { zoneRoom } from '@portfolio/luna-shopper/contracts';
import type { CoreAccessClient } from '../messaging/core-access.client';
import type { PresenceService } from '../presence/presence.service';
import { RealtimeGateway } from './realtime.gateway';

/**
 * Zone presence is an intent, not a side effect of subscribing (plan 0033).
 *
 * The bug this file exists for: `zone.subscribe` used to call `joinZone`, and a
 * client subscribes to every group its user belongs to from the moment the app
 * loads so the counts on the dashboard stay live. So one person was reported as
 * being in all of their groups at once, and left none of them until the socket
 * dropped. Presence that never changes while the user moves is worse than none,
 * because it looks like it works.
 */

const ZONE = 'z1';

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

function harness() {
  const presence = {
    register: jest.fn(),
    joinZone: jest.fn().mockResolvedValue(undefined),
    leaveZone: jest.fn().mockResolvedValue(undefined),
  };
  const core = {
    checkZoneWithLists: jest
      .fn()
      .mockResolvedValue({ allowed: true, listIds: [] }),
    checkZoneStaff: jest.fn().mockResolvedValue(false),
    checkList: jest.fn().mockResolvedValue(true),
  };

  const gateway = new RealtimeGateway(
    { verify: jest.fn().mockResolvedValue({ sub: 'u1' }) } as never,
    core as unknown as CoreAccessClient,
    presence as unknown as PresenceService,
    { stream$: { subscribe: jest.fn() } } as never,
    { bind: jest.fn() } as never,
    { debug: jest.fn() } as never
  );

  return { gateway, presence, core };
}

describe('zone presence', () => {
  it('is not announced by subscribing to the zone', async () => {
    const { gateway, presence } = harness();
    const socket = new FakeSocket('s1', 'u1');

    await gateway.subscribeZone(socket as never, { zoneId: ZONE });

    expect(socket.rooms.has(zoneRoom(ZONE))).toBe(true);
    expect(presence.joinZone).not.toHaveBeenCalled();
  });

  it('is announced by the intent, for a socket in the room', async () => {
    const { gateway, presence } = harness();
    const socket = new FakeSocket('s1', 'u1');

    await gateway.subscribeZone(socket as never, { zoneId: ZONE });
    const ack = await gateway.enterZone(socket as never, { zoneId: ZONE });

    expect(ack).toEqual({ ok: true });
    expect(presence.joinZone).toHaveBeenCalledWith('s1', ZONE);
  });

  it('refuses the intent from a socket that is not in the room', async () => {
    // The list intents' rule, and it is the whole access check: a socket cannot
    // be in `zone:{id}` without core having said yes at subscribe time, so the
    // membership is the claim and re-asking core would answer a tautology.
    const { gateway, presence } = harness();
    const socket = new FakeSocket('s1', 'u1');

    const ack = await gateway.enterZone(socket as never, { zoneId: ZONE });

    expect(ack).toEqual({ ok: false });
    expect(presence.joinZone).not.toHaveBeenCalled();
  });

  it('leaves on the intent, keeping the subscription behind it', async () => {
    // Navigating off a group's screen, exactly: the room stays, because the
    // dashboard behind it still wants that group's counts live.
    const { gateway, presence } = harness();
    const socket = new FakeSocket('s1', 'u1');

    await gateway.subscribeZone(socket as never, { zoneId: ZONE });
    await gateway.enterZone(socket as never, { zoneId: ZONE });
    const ack = await gateway.leaveZone(socket as never, { zoneId: ZONE });

    expect(ack).toEqual({ ok: true });
    expect(presence.leaveZone).toHaveBeenCalledWith('s1', ZONE);
    expect(socket.rooms.has(zoneRoom(ZONE))).toBe(true);
  });

  it('acknowledges a leave from a socket that never announced', async () => {
    // Every stop intent is acknowledged whatever state the socket was in. A
    // client walking away must never be left announcing because the room went
    // first.
    const { gateway } = harness();
    const socket = new FakeSocket('s1', 'u1');

    await expect(
      gateway.leaveZone(socket as never, { zoneId: ZONE })
    ).resolves.toEqual({ ok: true });
  });

  it('drops presence when the subscription itself goes', async () => {
    const { gateway, presence } = harness();
    const socket = new FakeSocket('s1', 'u1');

    await gateway.subscribeZone(socket as never, { zoneId: ZONE });
    await gateway.enterZone(socket as never, { zoneId: ZONE });
    await gateway.unsubscribeZone(socket as never, { zoneId: ZONE });

    expect(presence.leaveZone).toHaveBeenCalledWith('s1', ZONE);
    expect(socket.rooms.has(zoneRoom(ZONE))).toBe(false);
  });
});
