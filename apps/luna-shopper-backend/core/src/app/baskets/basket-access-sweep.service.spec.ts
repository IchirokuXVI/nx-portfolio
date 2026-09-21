import type { ConfigService } from '@nestjs/config';
import {
  ParticipantEndedReason,
  ParticipantKind,
  RealtimeEvent,
} from '@portfolio/luna-shopper/contracts';
import type { Logger } from 'nestjs-pino';
import type { DataSource } from 'typeorm';
import type { BasketParticipant } from '../entities';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import { BasketAccessSweepService } from './basket-access-sweep.service';
import { BasketMembersService } from './basket-members.service';

/**
 * The sweep that evicts a socket when somebody's twelve hours run out (plan
 * 0140, section 7).
 *
 * `sweep()` is called directly, with no timers, which is why the service keeps
 * the interval and the work in two methods. What the fakes can prove is the
 * shape of the two statements and the announcements that follow them; that
 * `SKIP LOCKED` keeps two replicas from announcing one row twice is the
 * database's, and it is asserted in the integration spec.
 */

const BASKET = 'gl-1';

interface Harness {
  service: BasketAccessSweepService;
  statements: { sql: string; params: unknown[] }[];
  events: { event: RealtimeEvent; basketId?: string; userIds?: string[] }[];
}

function build(expired: Partial<BasketParticipant>[] = []): Harness {
  const statements: Harness['statements'] = [];
  const events: Harness['events'] = [];

  const dataSource = {
    query: async (sql: string, params: unknown[] = []) => {
      statements.push({ sql, params });
      return sql.includes('basket_participants') ? expired : [];
    },
  } as unknown as DataSource;

  const publisher = {
    // One basket, named on the list the envelope carries since plan 0139.
    emitToBaskets: (event: RealtimeEvent, basketIds: readonly string[]) =>
      events.push({ event, basketId: basketIds[0] }),
    emitToUsers: (event: RealtimeEvent, userIds: readonly string[]) =>
      events.push({ event, userIds: [...userIds] }),
  } as unknown as CoreEventsPublisher;

  const configService = {
    getOrThrow: () => ({
      basket: {
        accessSweep: { enabled: true, intervalMs: 60_000, batchSize: 200 },
      },
    }),
  } as unknown as ConfigService;

  const logger = { log: () => undefined, error: () => undefined } as unknown as Logger;

  const service = new BasketAccessSweepService(
    dataSource,
    new BasketMembersService(dataSource, publisher),
    logger,
    configService
  );
  return { service, statements, events };
}

function visitor(
  id: string,
  over: Partial<BasketParticipant> = {}
): Partial<BasketParticipant> {
  return {
    id,
    basketId: BASKET,
    kind: ParticipantKind.GUEST,
    userId: null,
    displayName: null,
    username: null,
    guestNumber: 1,
    shareLinkId: 'link-1',
    expiresAt: new Date('2026-06-01T00:00:00.000Z'),
    ...over,
  };
}

describe('the sweep ends expired access (section 7)', () => {
  it('writes EXPIRED as the reason, oldest expiry first, a batch at a time', async () => {
    const harness = build([visitor('p-1')]);
    await harness.service.sweep();

    const [update] = harness.statements;
    expect(update.sql).toContain('SET "revokedAt" = now()');
    expect(update.sql).toContain('ORDER BY "expiresAt"');
    expect(update.sql).toContain('FOR UPDATE SKIP LOCKED');
    // The cap is per tick, and the reason is the contract's own value rather
    // than a string written twice.
    expect(update.params).toEqual([200, ParticipantEndedReason.EXPIRED]);
  });

  it('touches only rows whose expiry has actually passed', async () => {
    const harness = build();
    await harness.service.sweep();

    const [update] = harness.statements;
    expect(update.sql).toContain('"revokedAt" IS NULL');
    expect(update.sql).toContain('"expiresAt" IS NOT NULL');
    expect(update.sql).toContain('"expiresAt" <= now()');
  });

  it('announces one participantLeft per row, which is the whole eviction', async () => {
    // The room hears it, realtime sweeps both rooms of the basket, and every
    // socket re-asks `checkParticipant`. Realtime needs no change.
    const harness = build([visitor('p-1'), visitor('p-2', { guestNumber: 2 })]);
    const ended = await harness.service.sweep();

    expect(ended).toBe(2);
    expect(
      harness.events.filter(
        (e) => e.event === RealtimeEvent.BasketParticipantLeft
      )
    ).toHaveLength(2);
  });

  it('tells a registered visitor’s own sessions the basket is no longer theirs', async () => {
    const harness = build([
      visitor('p-1', {
        kind: ParticipantKind.REGISTERED,
        userId: 'u-1',
        guestNumber: null,
      }),
    ]);
    await harness.service.sweep();

    expect(harness.events).toContainEqual({
      event: RealtimeEvent.BasketUnshared,
      userIds: ['u-1'],
    });
  });

  it('revokes expired links in the same tick, and announces nothing for them', async () => {
    // The table catching up with what every read already believes. A dead link
    // evicts none of the people it let in: they carry their own expiry.
    const harness = build();
    await harness.service.sweep();

    const links = harness.statements.find((s) =>
      s.sql.includes('basket_share_links')
    );
    expect(links?.sql).toContain('"revokedAt" IS NULL AND "expiresAt" <= now()');
    expect(harness.events).toEqual([]);
  });

  it('announces nothing when nobody expired', async () => {
    const harness = build();
    expect(await harness.service.sweep()).toBe(0);
    expect(harness.events).toEqual([]);
  });
});
