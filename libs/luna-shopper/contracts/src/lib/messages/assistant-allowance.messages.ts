import type {
  AllowanceLimit,
  AllowancePeriod,
  AllowancePurpose,
  AllowanceReserveOutcome,
  AllowanceScope,
} from '../enums/assistant.enums';

/**
 * Each person's assistant allowance, kept in core (plan 0234).
 *
 * The assistant is the only caller. It reserves the worst case of a turn, a
 * spoken turn or a transcription before it calls a provider, and settles what
 * really happened afterwards, so concurrent turns cannot spend past a limit
 * together (section 5).
 *
 * **Core holds counts and no settings.** The limits and the timezone arrive in
 * each request, from the assistant's own configuration (section 7), so a limit
 * has one owner. Core does not learn what a turn said: it sees a user id,
 * numbers and a day.
 */
export const ASSISTANT_ALLOWANCE_PATTERNS = {
  /** Hold the worst case of what is about to happen, or name the limit that refuses it. */
  reserve: 'assistantAllowance.reserve',
  /** Release a reservation and count what really happened. */
  settle: 'assistantAllowance.settle',
  /** A person's usage against their limits, for `GET /v1/assistant/allowance`. */
  read: 'assistantAllowance.read',
} as const;

/**
 * The limits that apply to one person, chosen by the assistant from the
 * person's kind (section 7). Money is integer micro dollars, everywhere.
 */
export interface AllowanceLimits {
  turnsPerDay: number;
  turnsPerMonth: number;
  assistantAudioSecondsPerDay: number;
  assistantAudioSecondsPerMonth: number;
  commentAudioSecondsPerDay: number;
  commentAudioSecondsPerMonth: number;
  costPerDayMicroUsd: number;
  costPerMonthMicroUsd: number;
  deploymentCostPerDayMicroUsd: number;
  deploymentCostPerMonthMicroUsd: number;
}

/**
 * Hold a reservation (section 5.1). A `TURN` or a `VOICE_TURN` holds one turn,
 * a `TRANSCRIPTION` none, and the audio seconds go to assistant audio or to
 * comment audio by the same purpose.
 */
export interface ReserveAllowanceRequest {
  userId: string;
  purpose: AllowancePurpose;
  /** The estimate of section 2.1, whole seconds. Zero for a typed turn. */
  audioSeconds: number;
  /** Integer micro dollars: the worst case of the call sequence. */
  microUsd: number;
  limits: AllowanceLimits;
  /** An IANA name. The day and the month turn over at midnight there. */
  timezone: string;
  /** How long the reservation holds before it expires and releases (section 5.4). */
  holdSeconds: number;
}

/** The limit that refused, as the problem body's `details` carry it (section 8.1). */
export interface AllowanceRefusal {
  scope: AllowanceScope;
  period: AllowancePeriod;
  limit: AllowanceLimit;
  /** ISO 8601 with the offset of the allowance timezone. */
  resetsAt: string;
}

export interface ReserveAllowanceResponse {
  outcome: AllowanceReserveOutcome;
  /** Set when `outcome` is `RESERVED`. */
  reservationId: string | null;
  /** Set when `outcome` is `REFUSED`. */
  refused: AllowanceRefusal | null;
}

/**
 * Settle a reservation (section 5.3): release what it held and count what
 * really happened, on the reservation's own day. A reservation core no longer
 * holds still counts the amounts, on today's day: the money was spent.
 */
export interface SettleAllowanceRequest {
  reservationId: string;
  userId: string;
  purpose: AllowancePurpose;
  timezone: string;
  turns: number;
  audioSeconds: number;
  microUsd: number;
  promptTokens: number;
  responseTokens: number;
  cachedPromptTokens: number;
}

export interface SettleAllowanceResponse {
  /** False when the reservation had expired or was never held here. */
  found: boolean;
}

/** One person's usage against their limits (section 8.2). */
export interface ReadAllowanceRequest {
  userId: string;
  limits: AllowanceLimits;
  timezone: string;
  /** What a turn reserves, so the turn limit can be lowered to what money allows. */
  turnReserveMicroUsd: number;
}

/** One counter of the read: how much is used of how much. */
export interface AllowanceCounter {
  used: number;
  limit: number;
}

export interface AllowancePeriodView {
  turns: AllowanceCounter;
  assistantAudioSeconds: AllowanceCounter;
  commentAudioSeconds: AllowanceCounter;
  /** ISO 8601 with the offset of the allowance timezone. */
  resetsAt: string;
}

/**
 * What `GET /v1/assistant/allowance` answers (section 8.2).
 *
 * **No money.** A person has no use for micro dollars, and the operator's
 * prices are not theirs to see. When money binds before the turn count, the
 * turn limit is lowered to what money allows at the turn reserve, so the number
 * shown is the number that stops them.
 */
export interface AssistantAllowanceView {
  day: AllowancePeriodView;
  month: AllowancePeriodView;
  /** False when the deployment's own ceiling would refuse a turn now. */
  deploymentAvailable: boolean;
}
