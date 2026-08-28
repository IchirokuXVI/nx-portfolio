import type { MessageEvent } from '@nestjs/common';
import {
  RealtimeEvent,
  userRoom,
  zoneRoom,
} from '@portfolio/luna-shopper/contracts';
import { Subject } from 'rxjs';
import type { RelayMessage } from '../relay/event-relay.service';
import { SseController } from './sse.controller';

/**
 * The user's own channel over the read-only transport (plan 0030, section 2).
 *
 * Plan 0009's guarantee is that a socket client and an SSE client receive
 * identical payloads off one relay. A room only the socket half could be in
 * would break that quietly, in the transport nobody develops against, so the
 * SSE controller adds the caller's own room to whichever stream is open.
 */

function build(allowed = true) {
  const stream$ = new Subject<RelayMessage>();
  const controller = new SseController(
    { verify: jest.fn(async () => ({ sub: 'u1' })) } as never,
    {
      checkZone: jest.fn(async () => allowed),
      checkZoneStaff: jest.fn(async () => false),
      checkList: jest.fn(async () => allowed),
    } as never,
    { stream$: stream$.asObservable() } as never
  );
  return { controller, stream$ };
}

const request = { headers: {} } as never;

/**
 * The stream authorizes per connection inside `defer`, so nothing is filtered
 * until that promise chain settles. Everything below publishes after it.
 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the user room on the SSE transport', () => {
  it('carries an event addressed to the caller on the zone stream', async () => {
    const { controller, stream$ } = build();
    const received: MessageEvent[] = [];

    controller
      .zoneStream('z1', request, 't')
      .subscribe((message) => received.push(message));
    await settle();

    stream$.next({
      rooms: [userRoom('u1')],
      event: RealtimeEvent.UserUsernameChanged,
      payload: { userId: 'u1', username: 'Vela Rápida' },
    });

    expect(received).toEqual([
      {
        type: RealtimeEvent.UserUsernameChanged,
        data: { userId: 'u1', username: 'Vela Rápida' },
        id: undefined,
      },
    ]);
  });

  it('carries it on the list stream too', async () => {
    const { controller, stream$ } = build();
    const received: MessageEvent[] = [];

    controller
      .listStream('l1', request, 't')
      .subscribe((message) => received.push(message));
    await settle();

    stream$.next({
      rooms: [userRoom('u1')],
      event: RealtimeEvent.ZoneCreated,
      payload: { id: 'z2', name: 'Flat 3B' },
    });

    expect(received).toHaveLength(1);
  });

  it('still carries the zone room it was opened for', async () => {
    const { controller, stream$ } = build();
    const received: MessageEvent[] = [];

    controller
      .zoneStream('z1', request, 't')
      .subscribe((message) => received.push(message));
    await settle();

    stream$.next({
      rooms: [zoneRoom('z1')],
      event: RealtimeEvent.ZoneUpdated,
      payload: { id: 'z1' },
    });

    expect(received).toHaveLength(1);
  });

  it('does not carry another user’s own events', async () => {
    const { controller, stream$ } = build();
    const received: MessageEvent[] = [];

    controller
      .zoneStream('z1', request, 't')
      .subscribe((message) => received.push(message));
    await settle();

    stream$.next({
      rooms: [userRoom('u2')],
      event: RealtimeEvent.UserUsernameChanged,
      payload: { userId: 'u2', username: 'Vela Rápida' },
    });

    expect(received).toEqual([]);
  });

  it('opens no stream at all for a caller refused the zone', async () => {
    const { controller } = build(false);
    const errored = jest.fn();

    controller
      .zoneStream('z1', request, 't')
      .subscribe({ next: jest.fn(), error: errored });
    await settle();

    // The user room does not become a way in: authorization runs first and a
    // denial closes the connection before any event flows.
    expect(errored).toHaveBeenCalled();
  });
});
