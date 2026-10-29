import { Injectable, Logger } from '@nestjs/common';
import {
  AllowancePurpose,
  AllowanceReserveOutcome,
  type AllowanceLimits,
  type AllowancePeriodView,
  type AssistantAllowanceView,
  type ReadAllowanceRequest,
  type ReserveAllowanceRequest,
  type ReserveAllowanceResponse,
  type SettleAllowanceRequest,
  type SettleAllowanceResponse,
} from '@portfolio/luna-shopper/contracts';
import { ValidationException } from '@portfolio/luna-shopper/platform';
import { randomUUID } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import {
  addDays,
  calendarAt,
  isTimeZone,
  monthStart,
  type AllowanceCalendar,
} from './allowance-calendar';
import {
  amountsFor,
  firstRefusal,
  NO_DEPLOYMENT_USAGE,
  NO_PERSON_USAGE,
  reachableTurns,
  type DeploymentTotals,
  type PersonTotals,
} from './allowance-rules';
import {
  COUNT_DEPLOYMENT_SQL,
  COUNT_PERSON_SQL,
  DELETE_OLD_DEPLOYMENT_DAYS_SQL,
  DELETE_OLD_PERSON_DAYS_SQL,
  DEPLOYMENT_MONTH_SQL,
  ENSURE_DEPLOYMENT_DAY_SQL,
  ENSURE_PERSON_DAY_SQL,
  HOLD_DEPLOYMENT_SQL,
  HOLD_PERSON_SQL,
  INSERT_RESERVATION_SQL,
  LOCK_DEPLOYMENT_DAYS_SQL,
  LOCK_EXPIRED_OF_PERSON_SQL,
  LOCK_ONE_EXPIRED_SQL,
  LOCK_PERSON_DAYS_SQL,
  LOCK_PERSON_SQL,
  PERSON_MONTH_SQL,
  RELEASE_DEPLOYMENT_SQL,
  RELEASE_PERSON_SQL,
  releaseReservation,
  reservedAudio,
  rowsOf,
  TAKE_RESERVATION_SQL,
  TURN_IN_FLIGHT_SQL,
  type ReservationRow,
} from './assistant-allowance.sql';

/** How many months a deployment day row is kept (plan 0234, section 4). */
export const DEPLOYMENT_RETENTION_MONTHS = 13;

interface PersonRow {
  day: string;
  turns: number;
  assistantAudioSeconds: number;
  commentAudioSeconds: number;
  costMicroUsd: string;
  reservedTurns: number;
  reservedAssistantAudioSeconds: number;
  reservedCommentAudioSeconds: number;
  reservedMicroUsd: string;
}

interface DeploymentRow {
  day: string;
  costMicroUsd: string;
  reservedMicroUsd: string;
}

/**
 * Each person's assistant allowance, kept in core's database (plan 0234).
 *
 * Core sees a user id, numbers and a day, and never what a turn said. It holds
 * counts and no settings: the limits and the timezone arrive in each request
 * from the assistant, which owns them (section 7).
 *
 * Every write is one transaction in the lock order `assistant-allowance.sql.ts`
 * states, which is what makes a reservation atomic under concurrency: the
 * integration spec proves it, and a unit spec cannot.
 */
@Injectable()
export class AssistantAllowanceService {
  private readonly logger = new Logger(AssistantAllowanceService.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Hold the worst case of what is about to happen, or name the limit that
   * refuses it (section 5.1). A refusal changes nothing but the release of
   * this person's expired reservations, which is right whatever comes next.
   */
  async reserve(
    req: ReserveAllowanceRequest,
    now: Date = new Date()
  ): Promise<ReserveAllowanceResponse> {
    checkTimeZone(req.timezone);
    checkPurpose(req.purpose);
    checkLimits(req.limits, this.logger);
    checkCount('audioSeconds', req.audioSeconds);
    checkCount('microUsd', req.microUsd);
    checkCount('holdSeconds', req.holdSeconds);

    const calendar = calendarAt(now, req.timezone);
    const amounts = amountsFor(req.purpose, req.audioSeconds, req.microUsd);

    return this.dataSource.transaction(async (manager) => {
      // The person's own lock, before any row: every reserve of one person
      // waits for the last, whatever its day (section 15, item 19).
      await manager.query(LOCK_PERSON_SQL, [req.userId]);

      // Step 1, the rows. Created first, so the locks below have rows to take.
      await manager.query(ENSURE_PERSON_DAY_SQL, [req.userId, calendar.day]);
      await manager.query(ENSURE_DEPLOYMENT_DAY_SQL, [calendar.day]);

      // Step 2, this person's expired reservations, in the lock order:
      // reservations, then the person's days, then the deployment's days.
      const expired = rowsOf<ReservationRow>(
        await manager.query(LOCK_EXPIRED_OF_PERSON_SQL, [req.userId, now])
      );
      const days = [
        ...new Set([calendar.day, ...expired.map((row) => row.day)]),
      ].sort();
      await manager.query(LOCK_PERSON_DAYS_SQL, [req.userId, days]);
      await manager.query(LOCK_DEPLOYMENT_DAYS_SQL, [days]);
      for (const row of expired) {
        await releaseReservation(manager, row);
        this.logExpired(row);
      }

      // One turn in flight per person (section 5.1).
      if (amounts.turns > 0) {
        const open = (await manager.query(TURN_IN_FLIGHT_SQL, [
          req.userId,
          now,
        ])) as unknown[];
        if (open.length > 0) {
          return {
            outcome: AllowanceReserveOutcome.TURN_IN_FLIGHT,
            reservationId: null,
            refused: null,
          };
        }
      }

      // Steps 3 and 4, the sums and the checks, in section 5.1's order.
      const { personDay, personMonth, deploymentDay, deploymentMonth } =
        await this.totals(manager, req.userId, calendar);
      const refused = firstRefusal({
        amounts,
        limits: req.limits,
        personDay,
        personMonth,
        deploymentDay,
        deploymentMonth,
        calendar,
      });
      if (refused) {
        return {
          outcome: AllowanceReserveOutcome.REFUSED,
          reservationId: null,
          refused,
        };
      }

      // Step 5, the hold.
      const reservationId = randomUUID();
      await manager.query(HOLD_PERSON_SQL, [
        req.userId,
        calendar.day,
        amounts.turns,
        amounts.assistantAudioSeconds,
        amounts.commentAudioSeconds,
        amounts.microUsd,
      ]);
      await manager.query(HOLD_DEPLOYMENT_SQL, [
        calendar.day,
        amounts.microUsd,
      ]);
      await manager.query(INSERT_RESERVATION_SQL, [
        reservationId,
        req.userId,
        calendar.day,
        req.purpose,
        amounts.turns,
        req.audioSeconds,
        amounts.microUsd,
        new Date(now.getTime() + req.holdSeconds * 1000),
      ]);
      return {
        outcome: AllowanceReserveOutcome.RESERVED,
        reservationId,
        refused: null,
      };
    });
  }

  /**
   * Release a reservation and count what really happened (section 5.3), on the
   * reservation's own day. A reservation that expired or was never held here
   * still counts, on today's day, and says so in a warning: the money was
   * spent. The settle never caps a real cost at the reservation.
   */
  async settle(
    req: SettleAllowanceRequest,
    now: Date = new Date()
  ): Promise<SettleAllowanceResponse> {
    checkTimeZone(req.timezone);
    checkPurpose(req.purpose);
    for (const key of [
      'turns',
      'audioSeconds',
      'microUsd',
      'promptTokens',
      'responseTokens',
      'cachedPromptTokens',
    ] as const) {
      checkCount(key, req[key]);
    }

    return this.dataSource.transaction(async (manager) => {
      // The person's own lock first, as a reserve takes it, so the order
      // person then deployment holds for both.
      await manager.query(LOCK_PERSON_SQL, [req.userId]);
      const [held] = rowsOf<ReservationRow>(
        await manager.query(TAKE_RESERVATION_SQL, [
          req.reservationId,
          req.userId,
        ])
      );
      const day = held?.day ?? calendarAt(now, req.timezone).day;

      await manager.query(ENSURE_PERSON_DAY_SQL, [req.userId, day]);
      await manager.query(ENSURE_DEPLOYMENT_DAY_SQL, [day]);
      if (held) {
        const audio = reservedAudio(held);
        await manager.query(RELEASE_PERSON_SQL, [
          req.userId,
          day,
          held.turns,
          audio.assistant,
          audio.comment,
          held.microUsd,
        ]);
      } else {
        this.logger.warn(
          JSON.stringify({
            event: 'assistant.allowance.settleWithoutReservation',
            userId: req.userId,
            purpose: req.purpose,
            microUsd: req.microUsd,
          })
        );
      }

      const used = reservedAudio({
        purpose: req.purpose,
        audioSeconds: req.audioSeconds,
      });
      await manager.query(COUNT_PERSON_SQL, [
        req.userId,
        day,
        req.turns,
        used.assistant,
        used.comment,
        req.microUsd,
        req.promptTokens,
        req.responseTokens,
        req.cachedPromptTokens,
      ]);
      if (held) {
        await manager.query(RELEASE_DEPLOYMENT_SQL, [day, held.microUsd]);
      }
      await manager.query(COUNT_DEPLOYMENT_SQL, [day, req.microUsd]);
      return { found: held !== undefined };
    });
  }

  /**
   * The person's usage against their limits (section 8.2). Money is not in
   * the answer; it lowers the turn limit instead, to what the cost limit allows
   * at the turn reserve. A turn in flight counts as used.
   */
  async read(
    req: ReadAllowanceRequest,
    now: Date = new Date()
  ): Promise<AssistantAllowanceView> {
    checkTimeZone(req.timezone);
    checkLimits(req.limits, this.logger);
    const calendar = calendarAt(now, req.timezone);
    const { personDay, personMonth, deploymentDay, deploymentMonth } =
      await this.totals(this.dataSource.manager, req.userId, calendar);
    const limits = req.limits;
    const reserve = req.turnReserveMicroUsd;

    const period = (
      totals: PersonTotals,
      turnLimit: number,
      costLimit: number,
      assistantAudioLimit: number,
      commentAudioLimit: number,
      resetsAt: string
    ): AllowancePeriodView => {
      const turns = totals.turns + totals.reservedTurns;
      return {
        turns: {
          used: turns,
          limit: reachableTurns(
            turns,
            turnLimit,
            totals.costMicroUsd + totals.reservedMicroUsd,
            costLimit,
            reserve
          ),
        },
        assistantAudioSeconds: {
          used:
            totals.assistantAudioSeconds + totals.reservedAssistantAudioSeconds,
          limit: assistantAudioLimit,
        },
        commentAudioSeconds: {
          used: totals.commentAudioSeconds + totals.reservedCommentAudioSeconds,
          limit: commentAudioLimit,
        },
        resetsAt,
      };
    };

    const fits = (totals: DeploymentTotals, max: number) =>
      totals.costMicroUsd + totals.reservedMicroUsd + reserve <= max;

    return {
      day: period(
        personDay,
        limits.turnsPerDay,
        limits.costPerDayMicroUsd,
        limits.assistantAudioSecondsPerDay,
        limits.commentAudioSecondsPerDay,
        calendar.dayResetsAt
      ),
      month: period(
        personMonth,
        limits.turnsPerMonth,
        limits.costPerMonthMicroUsd,
        limits.assistantAudioSecondsPerMonth,
        limits.commentAudioSecondsPerMonth,
        calendar.monthResetsAt
      ),
      deploymentAvailable:
        fits(deploymentDay, limits.deploymentCostPerDayMicroUsd) &&
        fits(deploymentMonth, limits.deploymentCostPerMonthMicroUsd),
    };
  }

  /**
   * Releases expired reservations of anybody, one transaction each, at most
   * `max` of them (section 5.4). Expiry charges nothing: a pod that died mid
   * turn may have spent money nobody recorded, and each release is logged so
   * that gap can be counted.
   */
  async releaseExpired(now: Date = new Date(), max = 100): Promise<number> {
    let released = 0;
    while (released < max) {
      const row = await this.dataSource.transaction(async (manager) => {
        const [expired] = rowsOf<ReservationRow>(
          await manager.query(LOCK_ONE_EXPIRED_SQL, [now])
        );
        if (!expired) {
          return undefined;
        }
        await manager.query(LOCK_PERSON_DAYS_SQL, [
          expired.userId,
          [expired.day],
        ]);
        await manager.query(LOCK_DEPLOYMENT_DAYS_SQL, [[expired.day]]);
        await releaseReservation(manager, expired);
        return expired;
      });
      if (!row) {
        break;
      }
      released += 1;
      this.logExpired(row);
    }
    return released;
  }

  /**
   * One line per released reservation, with what it held and nobody was
   * charged: a pod that died mid turn, or a settle that failed twice, may have
   * spent it. The sum of these lines is the size of that gap (section 5.4).
   */
  private logExpired(row: ReservationRow): void {
    this.logger.warn(
      JSON.stringify({
        event: 'assistant.allowance.reservationExpired',
        userId: row.userId,
        purpose: row.purpose,
        microUsd: Number(row.microUsd),
        audioSeconds: Number(row.audioSeconds),
      })
    );
  }

  /**
   * Section 4's retention: a person's rows from before the start of the
   * previous month, and deployment rows older than thirteen months.
   *
   * Core holds no timezone, so the cutoffs are taken from the UTC date with a
   * day of margin: no zone is a whole day from UTC, so a row of the previous
   * month in any zone is never older than the cutoff.
   */
  async deleteOldRows(
    now: Date = new Date()
  ): Promise<{ personDays: number; deploymentDays: number }> {
    const today = calendarAt(now, 'UTC').day;
    const personCutoff = addDays(monthStart(today, -1), -1);
    const deploymentCutoff = addDays(
      monthStart(today, -DEPLOYMENT_RETENTION_MONTHS),
      -1
    );
    const personDays = deletedCount(
      await this.dataSource.query(DELETE_OLD_PERSON_DAYS_SQL, [personCutoff])
    );
    const deploymentDays = deletedCount(
      await this.dataSource.query(DELETE_OLD_DEPLOYMENT_DAYS_SQL, [
        deploymentCutoff,
      ])
    );
    return { personDays, deploymentDays };
  }

  /** The person's and the deployment's day and month, read through `manager`. */
  private async totals(
    manager: EntityManager,
    userId: string,
    calendar: AllowanceCalendar
  ): Promise<{
    personDay: PersonTotals;
    personMonth: PersonTotals;
    deploymentDay: DeploymentTotals;
    deploymentMonth: DeploymentTotals;
  }> {
    const personRows = (await manager.query(PERSON_MONTH_SQL, [
      userId,
      calendar.monthStart,
      calendar.nextMonthStart,
    ])) as PersonRow[];
    const deploymentRows = (await manager.query(DEPLOYMENT_MONTH_SQL, [
      calendar.monthStart,
      calendar.nextMonthStart,
    ])) as DeploymentRow[];

    const personMonth = personRows.reduce(addPerson, { ...NO_PERSON_USAGE });
    const personDay = personRows
      .filter((row) => row.day === calendar.day)
      .reduce(addPerson, { ...NO_PERSON_USAGE });
    const deploymentMonth = deploymentRows.reduce(addDeployment, {
      ...NO_DEPLOYMENT_USAGE,
    });
    const deploymentDay = deploymentRows
      .filter((row) => row.day === calendar.day)
      .reduce(addDeployment, { ...NO_DEPLOYMENT_USAGE });
    return { personDay, personMonth, deploymentDay, deploymentMonth };
  }
}

function addPerson(total: PersonTotals, row: PersonRow): PersonTotals {
  return {
    turns: total.turns + Number(row.turns),
    reservedTurns: total.reservedTurns + Number(row.reservedTurns),
    assistantAudioSeconds:
      total.assistantAudioSeconds + Number(row.assistantAudioSeconds),
    reservedAssistantAudioSeconds:
      total.reservedAssistantAudioSeconds +
      Number(row.reservedAssistantAudioSeconds),
    commentAudioSeconds:
      total.commentAudioSeconds + Number(row.commentAudioSeconds),
    reservedCommentAudioSeconds:
      total.reservedCommentAudioSeconds +
      Number(row.reservedCommentAudioSeconds),
    costMicroUsd: total.costMicroUsd + Number(row.costMicroUsd),
    reservedMicroUsd: total.reservedMicroUsd + Number(row.reservedMicroUsd),
  };
}

function addDeployment(
  total: DeploymentTotals,
  row: DeploymentRow
): DeploymentTotals {
  return {
    costMicroUsd: total.costMicroUsd + Number(row.costMicroUsd),
    reservedMicroUsd: total.reservedMicroUsd + Number(row.reservedMicroUsd),
  };
}

/** The rows a `DELETE` removed; the driver answers it as `[rows, rowCount]`. */
function deletedCount(answered: unknown): number {
  return Array.isArray(answered) && typeof answered[1] === 'number'
    ? answered[1]
    : 0;
}

function checkTimeZone(timezone: string): void {
  if (typeof timezone !== 'string' || !isTimeZone(timezone)) {
    throw new ValidationException(
      'timezone is not an IANA time zone this server knows'
    );
  }
}

function checkCount(name: string, value: unknown): void {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new ValidationException(
      `${name} must be a whole number of zero or more`
    );
  }
}

/**
 * Every field of {@link AllowanceLimits}, by name. A record rather than a list,
 * so a field added to the contract fails the build here until it is named.
 */
const LIMIT_FIELDS: Record<keyof AllowanceLimits, true> = {
  turnsPerDay: true,
  turnsPerMonth: true,
  assistantAudioSecondsPerDay: true,
  assistantAudioSecondsPerMonth: true,
  commentAudioSecondsPerDay: true,
  commentAudioSecondsPerMonth: true,
  costPerDayMicroUsd: true,
  costPerMonthMicroUsd: true,
  deploymentCostPerDayMicroUsd: true,
  deploymentCostPerMonthMicroUsd: true,
};

const LIMIT_NAMES = Object.keys(LIMIT_FIELDS) as (keyof AllowanceLimits)[];

/**
 * The limits fail closed: each field is checked by name, so one that is
 * missing refuses the request rather than leaving its counter unchecked
 * (`used + this > undefined` is false). Logged as an error, because only an
 * assistant that sends a broken request reaches it.
 */
function checkLimits(
  limits: AllowanceLimits | undefined,
  logger: Logger
): void {
  const broken =
    !limits || typeof limits !== 'object'
      ? 'limits'
      : LIMIT_NAMES.find((name) => {
          const value: unknown = limits[name];
          return !Number.isSafeInteger(value) || (value as number) < 1;
        });
  if (broken === undefined) {
    return;
  }
  logger.error(
    JSON.stringify({
      event: 'assistant.allowance.limitsRefused',
      field: broken,
    })
  );
  throw new ValidationException(
    broken === 'limits'
      ? 'limits are required'
      : `${broken} must be a whole number above zero`
  );
}

const PURPOSES: readonly string[] = Object.values(AllowancePurpose);

function checkPurpose(purpose: unknown): void {
  if (typeof purpose !== 'string' || !PURPOSES.includes(purpose)) {
    throw new ValidationException(
      `purpose must be one of ${PURPOSES.join(', ')}`
    );
  }
}
