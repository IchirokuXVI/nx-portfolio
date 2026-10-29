import {
  AllowanceLimit,
  AllowancePeriod,
  AllowancePurpose,
  AllowanceReserveOutcome,
  AllowanceScope,
  type AllowanceLimits,
  type ReserveAllowanceRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { CORE_ENTITIES } from '../entities';
import { AssistantAllowanceService } from './assistant-allowance.service';

/**
 * The assistant allowance against real Postgres (plan 0234, section 10.2).
 *
 * This is the spec that proves the locking: twenty reservations at once for
 * one person whose allowance fits five give exactly five, and twenty people at
 * once against a deployment ceiling that fits ten give exactly ten. A unit
 * spec can only agree with itself about that.
 *
 * **Each test has a day of its own.** The deployment's row is one per day and
 * shared by everybody, so every test runs at its own instant in a year nothing
 * else writes, and `afterAll` deletes the rows of those days. The people are
 * fresh uuids, deleted the same way.
 *
 *   LUNA_INTEGRATION=1 CORE_DB_URL=postgres://luna_core:luna_core@localhost:<port>/luna_core \
 *     npx nx run luna-shopper-backend-core:test-integration --testFile=assistant-allowance.integration.spec.ts
 */

const LIMITS: AllowanceLimits = {
  turnsPerDay: 60,
  turnsPerMonth: 600,
  assistantAudioSecondsPerDay: 900,
  assistantAudioSecondsPerMonth: 9000,
  commentAudioSecondsPerDay: 1800,
  commentAudioSecondsPerMonth: 18000,
  costPerDayMicroUsd: 100_000,
  costPerMonthMicroUsd: 1_000_000,
  deploymentCostPerDayMicroUsd: 3_000_000,
  deploymentCostPerMonthMicroUsd: 30_000_000,
};

describeIntegration('the assistant allowance (real Postgres)', () => {
  let dataSource: DataSource;
  let service: AssistantAllowanceService;
  const people: string[] = [];
  const days: string[] = [];

  function someone(): string {
    const id = randomUUID();
    people.push(id);
    return id;
  }

  /** A UTC noon in 1980 that no other test uses, and its day. */
  let nextDay = 0;
  function freshNoon(): Date {
    nextDay += 1;
    const noon = new Date(Date.UTC(1980, 0, 1 + nextDay, 12));
    days.push(noon.toISOString().slice(0, 10));
    return noon;
  }

  function request(
    userId: string,
    overrides: Partial<ReserveAllowanceRequest> = {}
  ): ReserveAllowanceRequest {
    return {
      userId,
      purpose: AllowancePurpose.TURN,
      audioSeconds: 0,
      microUsd: 20_000,
      limits: LIMITS,
      timezone: 'UTC',
      holdSeconds: 120,
      ...overrides,
    };
  }

  async function deploymentRow(day: string) {
    const [row] = await dataSource.query(
      `SELECT "costMicroUsd"::text AS "cost", "reservedMicroUsd"::text AS "reserved"
         FROM "assistant_usage_deployment_days" WHERE "day" = $1`,
      [day]
    );
    return row as { cost: string; reserved: string } | undefined;
  }

  async function personRow(userId: string, day: string) {
    const [row] = await dataSource.query(
      `SELECT "turns", "commentAudioSeconds", "costMicroUsd"::text AS "cost",
              "reservedTurns", "reservedCommentAudioSeconds",
              "reservedMicroUsd"::text AS "reserved",
              "promptTokens"::text AS "promptTokens"
         FROM "assistant_usage_days" WHERE "userId" = $1 AND "day" = $2`,
      [userId, day]
    );
    return row as Record<string, unknown> | undefined;
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: requiredEnv('CORE_DB_URL'),
      entities: CORE_ENTITIES,
      synchronize: false,
      // Twenty transactions at once need twenty connections, or the pool
      // queues them and the race this spec exists for never happens.
      extra: { max: 25 },
    });
    await dataSource.initialize();
    service = new AssistantAllowanceService(dataSource);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      if (people.length > 0) {
        await dataSource.query(
          `DELETE FROM "assistant_reservations" WHERE "userId" = ANY($1::uuid[])`,
          [people]
        );
        await dataSource.query(
          `DELETE FROM "assistant_usage_days" WHERE "userId" = ANY($1::uuid[])`,
          [people]
        );
      }
      await dataSource.query(
        `DELETE FROM "assistant_usage_deployment_days"
          WHERE "day" >= '1979-01-01' AND "day" < '1982-01-01'`
      );
      await dataSource.destroy();
    }
  });

  it('applies the migration: three tables and their keys', async () => {
    const tables = await dataSource.query(
      `SELECT c.relname FROM pg_class c
         JOIN pg_constraint k ON k.conrelid = c.oid AND k.contype = 'p'
        WHERE c.relname IN ('assistant_usage_days',
                            'assistant_usage_deployment_days',
                            'assistant_reservations')
        ORDER BY c.relname`
    );
    expect(tables.map((row: { relname: string }) => row.relname)).toEqual([
      'assistant_reservations',
      'assistant_usage_days',
      'assistant_usage_deployment_days',
    ]);
  });

  it('gives exactly five of twenty reservations at once to one person whose allowance fits five', async () => {
    const now = freshNoon();
    const userId = someone();
    // Comment audio, because a turn is one at a time by rule: each of these
    // holds 10 seconds against a day of 50.
    const limits = { ...LIMITS, commentAudioSecondsPerDay: 50 };

    const answers = await Promise.all(
      Array.from({ length: 20 }, () =>
        service.reserve(
          request(userId, {
            purpose: AllowancePurpose.TRANSCRIPTION,
            audioSeconds: 10,
            microUsd: 0,
            limits,
          }),
          now
        )
      )
    );

    const reserved = answers.filter(
      (a) => a.outcome === AllowanceReserveOutcome.RESERVED
    );
    expect(reserved).toHaveLength(5);
    expect(
      answers.filter((a) => a.outcome === AllowanceReserveOutcome.REFUSED)
    ).toHaveLength(15);
    expect(answers.find((a) => a.refused)?.refused).toEqual({
      scope: AllowanceScope.USER,
      period: AllowancePeriod.DAY,
      limit: AllowanceLimit.COMMENT_AUDIO,
      resetsAt: zonedMidnightAfter(now),
    });
    expect(
      await personRow(userId, now.toISOString().slice(0, 10))
    ).toMatchObject({ reservedCommentAudioSeconds: 50 });
  });

  it('gives exactly ten of twenty people at once a turn against a deployment ceiling that fits ten', async () => {
    const now = freshNoon();
    const limits = { ...LIMITS, deploymentCostPerDayMicroUsd: 200_000 };

    const answers = await Promise.all(
      Array.from({ length: 20 }, () =>
        service.reserve(request(someone(), { limits }), now)
      )
    );

    expect(
      answers.filter((a) => a.outcome === AllowanceReserveOutcome.RESERVED)
    ).toHaveLength(10);
    const refusals = answers.filter((a) => a.refused).map((a) => a.refused);
    expect(refusals).toHaveLength(10);
    for (const refusal of refusals) {
      expect(refusal).toMatchObject({
        scope: AllowanceScope.DEPLOYMENT,
        period: AllowancePeriod.DAY,
        limit: AllowanceLimit.COST,
      });
    }
    expect(await deploymentRow(now.toISOString().slice(0, 10))).toEqual({
      cost: '0',
      reserved: '200000',
    });
  });

  it('holds one turn in flight per person, and a transcription beside it', async () => {
    const now = freshNoon();
    const userId = someone();

    const first = await service.reserve(request(userId), now);
    const second = await service.reserve(
      request(userId, {
        purpose: AllowancePurpose.VOICE_TURN,
        audioSeconds: 5,
      }),
      now
    );
    const comment = await service.reserve(
      request(userId, {
        purpose: AllowancePurpose.TRANSCRIPTION,
        audioSeconds: 5,
        microUsd: 0,
      }),
      now
    );

    expect(first.outcome).toBe(AllowanceReserveOutcome.RESERVED);
    expect(second.outcome).toBe(AllowanceReserveOutcome.TURN_IN_FLIGHT);
    expect(comment.outcome).toBe(AllowanceReserveOutcome.RESERVED);
  });

  it('gives one of twenty turns at once to one person, also when they straddle midnight', async () => {
    // Two days of their own, and the midnight between them: half of the
    // reserves land on each day, so each half locks a different day row and
    // only the person's own lock keeps them apart.
    freshNoon();
    const after = freshNoon();
    const midnight = Date.UTC(
      after.getUTCFullYear(),
      after.getUTCMonth(),
      after.getUTCDate()
    );
    const userId = someone();

    const answers = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        service.reserve(
          request(userId),
          new Date(midnight + (i % 2 === 0 ? -500 : 500))
        )
      )
    );

    expect(
      answers.filter((a) => a.outcome === AllowanceReserveOutcome.RESERVED)
    ).toHaveLength(1);
    expect(
      answers.filter(
        (a) => a.outcome === AllowanceReserveOutcome.TURN_IN_FLIGHT
      )
    ).toHaveLength(19);
  });

  it('settles the real amounts on the reservation day, and releases the hold', async () => {
    const now = freshNoon();
    const day = now.toISOString().slice(0, 10);
    const userId = someone();
    const before = Number((await deploymentRow(day))?.cost ?? 0);

    const held = await service.reserve(request(userId), now);
    // Settled the next day: the amounts still land on the day of the hold.
    const tomorrow = new Date(now.getTime() + 24 * 3600 * 1000);
    const settled = await service.settle(
      {
        reservationId: held.reservationId as string,
        userId,
        purpose: AllowancePurpose.TURN,
        timezone: 'UTC',
        turns: 1,
        audioSeconds: 0,
        microUsd: 371,
        promptTokens: 2100,
        responseTokens: 120,
        cachedPromptTokens: 4300,
      },
      tomorrow
    );

    expect(settled).toEqual({ found: true });
    expect(await personRow(userId, day)).toMatchObject({
      turns: 1,
      cost: '371',
      reservedTurns: 0,
      reserved: '0',
      promptTokens: '2100',
    });
    expect(await deploymentRow(day)).toEqual({
      cost: String(before + 371),
      reserved: '0',
    });
    // The next turn is no longer in flight.
    expect((await service.reserve(request(userId), now)).outcome).toBe(
      AllowanceReserveOutcome.RESERVED
    );
  });

  it('charges a turn that ran over its reservation in full', async () => {
    const now = freshNoon();
    const userId = someone();
    const held = await service.reserve(request(userId), now);

    await service.settle(
      {
        reservationId: held.reservationId as string,
        userId,
        purpose: AllowancePurpose.TURN,
        timezone: 'UTC',
        turns: 1,
        audioSeconds: 0,
        microUsd: 35_000,
        promptTokens: 0,
        responseTokens: 0,
        cachedPromptTokens: 0,
      },
      now
    );

    expect(
      await personRow(userId, now.toISOString().slice(0, 10))
    ).toMatchObject({ cost: '35000', reserved: '0' });
  });

  it('releases an expired reservation without charging it', async () => {
    const now = freshNoon();
    const day = now.toISOString().slice(0, 10);
    const userId = someone();
    await service.reserve(request(userId, { holdSeconds: 60 }), now);
    const later = new Date(now.getTime() + 61_000);

    // The person's own next reservation releases it.
    const next = await service.reserve(request(userId), later);

    expect(next.outcome).toBe(AllowanceReserveOutcome.RESERVED);
    expect(await personRow(userId, day)).toMatchObject({
      turns: 0,
      cost: '0',
      reservedTurns: 1,
      reserved: '20000',
    });

    // And the sweep releases anybody's, the deployment's hold with it.
    const muchLater = new Date(later.getTime() + 3600_000);
    expect(await service.releaseExpired(muchLater)).toBeGreaterThanOrEqual(1);
    expect(await personRow(userId, day)).toMatchObject({
      turns: 0,
      cost: '0',
      reservedTurns: 0,
      reserved: '0',
    });
    expect((await deploymentRow(day))?.reserved).toBe('0');
  });

  it('still counts a settle for a reservation that expired, on today', async () => {
    const now = freshNoon();
    const day = now.toISOString().slice(0, 10);
    const userId = someone();
    const held = await service.reserve(
      request(userId, { holdSeconds: 60 }),
      now
    );
    await service.releaseExpired(new Date(now.getTime() + 61_000));

    const settled = await service.settle(
      {
        reservationId: held.reservationId as string,
        userId,
        purpose: AllowancePurpose.TURN,
        timezone: 'UTC',
        turns: 1,
        audioSeconds: 0,
        microUsd: 400,
        promptTokens: 1,
        responseTokens: 1,
        cachedPromptTokens: 0,
      },
      new Date(now.getTime() + 90_000)
    );

    expect(settled).toEqual({ found: false });
    expect(await personRow(userId, day)).toMatchObject({
      turns: 1,
      cost: '400',
      reservedTurns: 0,
      reserved: '0',
    });
  });

  it('sums the month across a month boundary in Europe/Madrid', async () => {
    const userId = someone();
    const timezone = 'Europe/Madrid';
    // 23:30 UTC on 31 October 1981 is 00:30 on 1 November in Madrid.
    const lastOfOctober = new Date('1981-10-31T12:00:00Z');
    const firstOfNovember = new Date('1981-10-31T23:30:00Z');
    days.push('1981-10-31', '1981-11-01');
    const limits = { ...LIMITS, turnsPerMonth: 2 };
    const settleTurn = async (now: Date) => {
      const held = await service.reserve(
        request(userId, { limits, timezone }),
        now
      );
      expect(held.outcome).toBe(AllowanceReserveOutcome.RESERVED);
      await service.settle(
        {
          reservationId: held.reservationId as string,
          userId,
          purpose: AllowancePurpose.TURN,
          timezone,
          turns: 1,
          audioSeconds: 0,
          microUsd: 300,
          promptTokens: 0,
          responseTokens: 0,
          cachedPromptTokens: 0,
        },
        now
      );
    };

    // Two turns in October fill its month.
    await settleTurn(lastOfOctober);
    await settleTurn(new Date('1981-10-31T20:00:00Z'));
    const october = await service.reserve(
      request(userId, { limits, timezone }),
      new Date('1981-10-31T22:30:00Z')
    );
    expect(october.refused).toEqual({
      scope: AllowanceScope.USER,
      period: AllowancePeriod.MONTH,
      limit: AllowanceLimit.TURNS,
      resetsAt: '1981-11-01T00:00:00+01:00',
    });

    // Half an hour later it is November in Madrid, though still October in
    // UTC, and the month is empty again.
    await settleTurn(firstOfNovember);
    expect(await personRow(userId, '1981-11-01')).toMatchObject({ turns: 1 });

    const read = await service.read(
      { userId, limits, timezone, turnReserveMicroUsd: 20_000 },
      firstOfNovember
    );
    expect(read.month.turns).toEqual({ used: 1, limit: 2 });
    expect(read.month.resetsAt).toBe('1981-12-01T00:00:00+01:00');
    expect(read.day.resetsAt).toBe('1981-11-02T00:00:00+01:00');
  });

  it('reads usage against the limits, with no money and the turn limit money allows', async () => {
    const now = freshNoon();
    const userId = someone();
    const held = await service.reserve(request(userId), now);
    await service.settle(
      {
        reservationId: held.reservationId as string,
        userId,
        purpose: AllowancePurpose.TURN,
        timezone: 'UTC',
        turns: 1,
        audioSeconds: 0,
        microUsd: 85_000,
        promptTokens: 0,
        responseTokens: 0,
        cachedPromptTokens: 0,
      },
      now
    );

    const read = await service.read(
      { userId, limits: LIMITS, timezone: 'UTC', turnReserveMicroUsd: 20_000 },
      now
    );

    // 85,000 of the day's 100,000 leaves no room for the next 20,000 reserve,
    // so the day stops at the one turn used; the month still has room.
    expect(read.day.turns).toEqual({ used: 1, limit: 1 });
    expect(read.month.turns).toEqual({ used: 1, limit: 600 });
    expect(read.day.commentAudioSeconds).toEqual({ used: 0, limit: 1800 });
    expect(read.deploymentAvailable).toBe(true);
    expect(JSON.stringify(read)).not.toMatch(/micro|cost/i);
  });
});

/** The next UTC midnight after `now`, as the calendar writes it for UTC. */
function zonedMidnightAfter(now: Date): string {
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  );
  return `${next.toISOString().slice(0, 19)}+00:00`;
}
