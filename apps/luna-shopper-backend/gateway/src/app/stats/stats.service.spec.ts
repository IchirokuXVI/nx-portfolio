import { STATS_PATTERNS } from '@portfolio/luna-shopper/contracts';
import type { NatsClient } from '../messaging/nats-client';
import { GatewayStatsService, STATS_CACHE_TTL_MS } from './stats.service';

/**
 * The public platform totals (plan 0017, section 8.2): the cache that keeps an
 * unauthenticated burst from becoming a NATS burst, and the partial response
 * that keeps one broken service from taking down a public page.
 */

const IDENTITY = { users: 10, registeredUsers: 7, temporaryUsers: 3 };
const CORE = { zones: 4, activeZones: 3 };

function build(
  answer: (subject: string) => Promise<unknown> = async (subject) =>
    subject === STATS_PATTERNS.identity ? IDENTITY : CORE
) {
  const send = jest.fn((subject: string) => answer(subject));
  const nats = { send } as unknown as NatsClient;
  return { svc: new GatewayStatsService(nats), send };
}

describe('GatewayStatsService.platform', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('composes both services in one response', async () => {
    const { svc, send } = build();

    const stats = await svc.platform();

    expect(stats.identity).toEqual(IDENTITY);
    expect(stats.core).toEqual(CORE);
    expect(stats.measuredAt).toEqual(expect.any(String));
    expect(send.mock.calls.map((c) => c[0]).sort()).toEqual([
      STATS_PATTERNS.core,
      STATS_PATTERNS.identity,
    ]);
  });

  it('serves a second call from the cache, with no second round trip', async () => {
    const { svc, send } = build();

    const first = await svc.platform();
    const second = await svc.platform();

    // A burst of a thousand visitors is one pair of NATS calls, not a thousand.
    expect(send).toHaveBeenCalledTimes(2);
    expect(second).toBe(first);
  });

  it('refetches once the TTL has passed', async () => {
    jest.useFakeTimers();
    const { svc, send } = build();

    await svc.platform();
    jest.setSystemTime(Date.now() + STATS_CACHE_TTL_MS + 1);
    await svc.platform();

    expect(send).toHaveBeenCalledTimes(4);
  });

  it('reports when the snapshot was taken, so staleness is visible', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-26T10:00:00.000Z'));
    const { svc } = build();

    const stats = await svc.platform();

    expect(stats.measuredAt).toBe('2026-08-26T10:00:00.000Z');
  });

  it('degrades to a null block when a service does not answer', async () => {
    const { svc } = build(async (subject) => {
      if (subject === STATS_PATTERNS.identity) {
        throw new Error('auth is down');
      }
      return CORE;
    });

    const stats = await svc.platform();

    // A broken auth service must not take the public page down with it.
    expect(stats.identity).toBeNull();
    expect(stats.core).toEqual(CORE);
  });

  it('still answers when both services are down', async () => {
    const { svc } = build(async () => {
      throw new Error('everything is down');
    });

    await expect(svc.platform()).resolves.toEqual({
      identity: null,
      core: null,
      measuredAt: expect.any(String),
    });
  });

  it('sends no argument, because the totals are not a caller’s', async () => {
    const { svc, send } = build();
    await svc.platform();
    for (const [, payload] of send.mock.calls) {
      expect(payload).toEqual({});
    }
  });
});
