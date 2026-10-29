import {
  AllowanceLimit,
  AllowancePeriod,
  AllowancePurpose,
  AllowanceScope,
  type AllowanceLimits,
  type AllowanceRefusal,
} from '@portfolio/luna-shopper/contracts';
import type { AllowanceCalendar } from './allowance-calendar';

/**
 * The rules of the assistant allowance that are not the database's (plan 0234,
 * section 5.1): what a reservation holds, and the order its counters are
 * checked in. Pure, so the order has a unit spec; the locking that makes the
 * check true under concurrency is the integration spec's.
 */

/** What one person's rows add up to, for one day or one month. */
export interface PersonTotals {
  turns: number;
  reservedTurns: number;
  assistantAudioSeconds: number;
  reservedAssistantAudioSeconds: number;
  commentAudioSeconds: number;
  reservedCommentAudioSeconds: number;
  costMicroUsd: number;
  reservedMicroUsd: number;
}

/** What the deployment's rows add up to, for one day or one month. */
export interface DeploymentTotals {
  costMicroUsd: number;
  reservedMicroUsd: number;
}

export const NO_PERSON_USAGE: PersonTotals = {
  turns: 0,
  reservedTurns: 0,
  assistantAudioSeconds: 0,
  reservedAssistantAudioSeconds: 0,
  commentAudioSeconds: 0,
  reservedCommentAudioSeconds: 0,
  costMicroUsd: 0,
  reservedMicroUsd: 0,
};

export const NO_DEPLOYMENT_USAGE: DeploymentTotals = {
  costMicroUsd: 0,
  reservedMicroUsd: 0,
};

/** What a reservation adds to each counter. */
export interface ReserveAmounts {
  turns: number;
  assistantAudioSeconds: number;
  commentAudioSeconds: number;
  microUsd: number;
}

/**
 * Section 5.2: a typed or spoken turn holds one turn, and the audio seconds go
 * to assistant audio for a spoken turn and to comment audio for a voice
 * comment's transcription.
 */
export function amountsFor(
  purpose: AllowancePurpose,
  audioSeconds: number,
  microUsd: number
): ReserveAmounts {
  return {
    turns: purpose === AllowancePurpose.TRANSCRIPTION ? 0 : 1,
    assistantAudioSeconds:
      purpose === AllowancePurpose.VOICE_TURN ? audioSeconds : 0,
    commentAudioSeconds:
      purpose === AllowancePurpose.TRANSCRIPTION ? audioSeconds : 0,
    microUsd,
  };
}

interface Check {
  scope: AllowanceScope;
  period: AllowancePeriod;
  limit: AllowanceLimit;
  held: number;
  amount: number;
  max: number;
}

/**
 * The first limit that does not fit, in the order of section 5.1 step 4, or
 * null when all fit: person turns per day, per month; person audio per day,
 * per month (assistant or comment audio by purpose); person cost per day, per
 * month; deployment cost per day, per month.
 *
 * A counter fits when `used + reserved + this <= limit`. **A counter this
 * reservation adds nothing to is not checked**, so a person over their cost
 * limit (the settle never caps a real cost) is not refused a voice comment's
 * transcription, which costs no money.
 */
export function firstRefusal(input: {
  amounts: ReserveAmounts;
  limits: AllowanceLimits;
  personDay: PersonTotals;
  personMonth: PersonTotals;
  deploymentDay: DeploymentTotals;
  deploymentMonth: DeploymentTotals;
  calendar: AllowanceCalendar;
}): AllowanceRefusal | null {
  const { amounts, limits, personDay, personMonth } = input;
  const { deploymentDay, deploymentMonth, calendar } = input;
  const user = AllowanceScope.USER;
  const day = AllowancePeriod.DAY;
  const month = AllowancePeriod.MONTH;

  const checks: Check[] = [
    {
      scope: user,
      period: day,
      limit: AllowanceLimit.TURNS,
      held: personDay.turns + personDay.reservedTurns,
      amount: amounts.turns,
      max: limits.turnsPerDay,
    },
    {
      scope: user,
      period: month,
      limit: AllowanceLimit.TURNS,
      held: personMonth.turns + personMonth.reservedTurns,
      amount: amounts.turns,
      max: limits.turnsPerMonth,
    },
    {
      scope: user,
      period: day,
      limit: AllowanceLimit.ASSISTANT_AUDIO,
      held:
        personDay.assistantAudioSeconds +
        personDay.reservedAssistantAudioSeconds,
      amount: amounts.assistantAudioSeconds,
      max: limits.assistantAudioSecondsPerDay,
    },
    {
      scope: user,
      period: month,
      limit: AllowanceLimit.ASSISTANT_AUDIO,
      held:
        personMonth.assistantAudioSeconds +
        personMonth.reservedAssistantAudioSeconds,
      amount: amounts.assistantAudioSeconds,
      max: limits.assistantAudioSecondsPerMonth,
    },
    {
      scope: user,
      period: day,
      limit: AllowanceLimit.COMMENT_AUDIO,
      held:
        personDay.commentAudioSeconds + personDay.reservedCommentAudioSeconds,
      amount: amounts.commentAudioSeconds,
      max: limits.commentAudioSecondsPerDay,
    },
    {
      scope: user,
      period: month,
      limit: AllowanceLimit.COMMENT_AUDIO,
      held:
        personMonth.commentAudioSeconds +
        personMonth.reservedCommentAudioSeconds,
      amount: amounts.commentAudioSeconds,
      max: limits.commentAudioSecondsPerMonth,
    },
    {
      scope: user,
      period: day,
      limit: AllowanceLimit.COST,
      held: personDay.costMicroUsd + personDay.reservedMicroUsd,
      amount: amounts.microUsd,
      max: limits.costPerDayMicroUsd,
    },
    {
      scope: user,
      period: month,
      limit: AllowanceLimit.COST,
      held: personMonth.costMicroUsd + personMonth.reservedMicroUsd,
      amount: amounts.microUsd,
      max: limits.costPerMonthMicroUsd,
    },
    {
      scope: AllowanceScope.DEPLOYMENT,
      period: day,
      limit: AllowanceLimit.COST,
      held: deploymentDay.costMicroUsd + deploymentDay.reservedMicroUsd,
      amount: amounts.microUsd,
      max: limits.deploymentCostPerDayMicroUsd,
    },
    {
      scope: AllowanceScope.DEPLOYMENT,
      period: month,
      limit: AllowanceLimit.COST,
      held: deploymentMonth.costMicroUsd + deploymentMonth.reservedMicroUsd,
      amount: amounts.microUsd,
      max: limits.deploymentCostPerMonthMicroUsd,
    },
  ];

  for (const check of checks) {
    if (check.amount > 0 && check.held + check.amount > check.max) {
      return {
        scope: check.scope,
        period: check.period,
        limit: check.limit,
        resetsAt:
          check.period === day ? calendar.dayResetsAt : calendar.monthResetsAt,
      };
    }
  }
  return null;
}

/**
 * The turn limit a person can actually reach in one period (section 8.2): the
 * configured limit, or the turns already used once money no longer fits the
 * next turn's reserve. The read shows this number, so the number shown is the
 * one that stops them.
 *
 * Not "what money allows at the reserve amount" counted forward, which the
 * plan's sentence also reads as: a turn reserves about fifty times what it
 * costs, so that count would show five turns to a person with sixty.
 */
export function reachableTurns(
  turnsHeld: number,
  turnLimit: number,
  costHeld: number,
  costLimit: number,
  turnReserveMicroUsd: number
): number {
  return costHeld + turnReserveMicroUsd > costLimit
    ? Math.min(turnLimit, turnsHeld)
    : turnLimit;
}
