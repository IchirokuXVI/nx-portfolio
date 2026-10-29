import type {
  AllowanceLimit,
  AllowancePeriod,
  AllowanceScope,
  AssistantAllowance,
} from '@portfolio/velista/models';
import { GatewayError } from '../errors';
import { str } from '../mapping/primitives';

const LIMITS: readonly AllowanceLimit[] = [
  'turns',
  'assistantAudio',
  'commentAudio',
  'cost',
];

/**
 * Whether a failure is the assistant's allowance saying no, and what it said
 * (backend `0234`, section 8.1, velista `0174`, target 5).
 *
 * Pure, and the one place that reads the code's `details`: the panel and the list's
 * voice strip both ask this before they pick a sentence. Rule D4, so every field is
 * mapped from `unknown` into velista's own unions, each with the fallback that
 * promises least:
 *
 * - an unknown `scope` reads as `user`, so the sentence talks about the person's own
 *   use and never claims the assistant is resting when nobody said so;
 * - an unknown `period` reads as `day`, the nearer way back;
 * - an unknown `limit` reads as `turns`, the sentence that says the assistant is done
 *   for the period, rather than one that invites typing;
 * - an unparseable `resetsAt` reads as null, and the sentence goes without its time.
 *
 * Anything else answers null and keeps the caller's own copy.
 */
export function allowanceRefusal(error: unknown): AssistantAllowance | null {
  if (
    !(error instanceof GatewayError) ||
    error.code !== 'assistant_allowance_reached'
  ) {
    return null;
  }

  const details = error.details ?? {};
  const scope: AllowanceScope =
    details['scope'] === 'deployment' ? 'deployment' : 'user';
  const period: AllowancePeriod =
    details['period'] === 'month' ? 'month' : 'day';
  const limit = LIMITS.find((known) => known === details['limit']) ?? 'turns';

  return { scope, period, limit, resetsAt: dateOf(details['resetsAt']) };
}

function dateOf(raw: unknown): Date | null {
  const text = str(raw);
  if (text === null || text.trim() === '') {
    return null;
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}
