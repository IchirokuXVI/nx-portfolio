import type { MessageEvent } from '@nestjs/common';
import { RealtimeEvent, userRoom } from '@portfolio/luna-shopper/contracts';
import { ERROR_CODES } from '@portfolio/luna-shopper/platform';
import { Subject } from 'rxjs';
import type { RelayMessage } from '../relay/event-relay.service';
import { SseController } from './sse.controller';

/**
 * An SSE stream of a support session (plan 0194, target state 9).
 *
 * The token of a stream is verified one time, as the stream opens. So a stream
 * of a session opens only while auth says the session is live, and it closes
 * at the deadline or as the session ends. A stream of an ordinary token does
 * none of that.
 */

const NOW = Date.parse('2026-10-13T10:00:00.000Z');
const SESSION = 's1';
const ZONE = 'z1';

function build(options: { act?: unknown; live?: boolean }) {
  const stream$ = new Subject<RelayMessage>();
  const ended$ = new Subject<string>();
  const sessions = {
    ended$: ended$.asObservable(),
    isLive: jest.fn(async () => options.live ?? true),
  };
  const controller = new SseController(
    {
      verifyAuthHeader: jest.fn(async () => ({
        sub: 'u1',
        ...(options.act ? { act: options.act } : {}),
      })),
    } as never,
    {
      checkZone: jest.fn(async () => true),
      checkZoneStaff: jest.fn(async () => false),
    } as never,
    { stream$: stream$.asObservable() } as never,
    sessions as never
  );
  return { controller, stream$, ended$, sessions };
}

const request = { headers: { authorization: 'Bearer t' } } as never;

const act = (minutesLeft: number) => ({
  sub: 'a1',
  sid: SESSION,
  until: (NOW + minutesLeft * 60_000) / 1000,
});

const toUser = (): RelayMessage =>
  ({
    rooms: [userRoom('u1')],
    event: RealtimeEvent.ZoneUpdated,
    payload: { ok: true },
  }) as RelayMessage;

/** Opens the stream and lets its authorization settle. */
async function open(controller: SseController) {
  const events: MessageEvent[] = [];
  const state = { closed: false, error: undefined as unknown };
  controller.zoneStream(ZONE, request).subscribe({
    next: (event) => events.push(event),
    error: (error) => {
      state.error = error;
    },
    complete: () => {
      state.closed = true;
    },
  });
  // The authorization is a chain of promises inside `defer`.
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
  return { events, state };
}

describe('an SSE stream of a support session', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('opens while auth says the session is live', async () => {
    const { controller, stream$, sessions } = build({ act: act(90) });

    const { events, state } = await open(controller);
    stream$.next(toUser());

    expect(sessions.isLive).toHaveBeenCalledWith(SESSION);
    expect(events).toHaveLength(1);
    expect(state.closed).toBe(false);
  });

  it('is refused with impersonation_ended when the session is not live', async () => {
    const { controller, stream$ } = build({ act: act(90), live: false });

    const { events, state } = await open(controller);
    stream$.next(toUser());

    expect(state.error).toMatchObject({
      code: ERROR_CODES.IMPERSONATION_ENDED,
    });
    expect(events).toEqual([]);
  });

  it('closes at until', async () => {
    const { controller, stream$ } = build({ act: act(90) });
    const { events, state } = await open(controller);

    jest.advanceTimersByTime(90 * 60_000 - 1);
    expect(state.closed).toBe(false);

    jest.advanceTimersByTime(1);
    expect(state.closed).toBe(true);

    stream$.next(toUser());
    expect(events).toEqual([]);
  });

  it('closes as its session ends, and not as another one does', async () => {
    const { controller, ended$ } = build({ act: act(90) });
    const { state } = await open(controller);

    ended$.next('another-session');
    expect(state.closed).toBe(false);

    ended$.next(SESSION);
    expect(state.closed).toBe(true);
  });

  it('refuses a malformed act claim, and does not read it as an ordinary token', async () => {
    const { controller } = build({ act: { sub: 'a1' } });

    const { state } = await open(controller);

    expect(state.error).toMatchObject({ code: ERROR_CODES.UNAUTHORIZED });
  });
});

describe('an SSE stream of an ordinary token, which does not change', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('asks auth nothing and never closes on a deadline or an end', async () => {
    const { controller, stream$, ended$, sessions } = build({});
    const { events, state } = await open(controller);

    ended$.next(SESSION);
    jest.advanceTimersByTime(24 * 60 * 60_000);
    stream$.next(toUser());

    expect(sessions.isLive).not.toHaveBeenCalled();
    expect(state.closed).toBe(false);
    expect(events).toHaveLength(1);
  });
});
