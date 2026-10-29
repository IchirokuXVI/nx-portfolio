/**
 * The assistant said no because an allowance is used up (backend `0234`, section 8.1,
 * velista `0174`).
 *
 * velista's own unions, read off the problem body's `details` by `allowanceRefusal` in
 * `data-access` (rule D4). An unknown value maps to the reading that promises least,
 * never to a crash and never to a string a template cannot place.
 */

/** Whose allowance refused: the person's own, or the whole deployment's. */
export type AllowanceScope = 'user' | 'deployment';

/** Which period ran out, and so how far away the way back is. */
export type AllowancePeriod = 'day' | 'month';

/**
 * Which counter refused. `assistantAudio` is the one the panel words differently,
 * because typing still works after it; the others all mean the assistant is done for
 * the period. `cost` is never named on screen: money is the operator's fact.
 */
export type AllowanceLimit =
  | 'turns'
  | 'assistantAudio'
  | 'commentAudio'
  | 'cost';

export interface AssistantAllowance {
  readonly scope: AllowanceScope;
  readonly period: AllowancePeriod;
  readonly limit: AllowanceLimit;
  /** When the period turns over, or null when the server's value could not be read. */
  readonly resetsAt: Date | null;
}

/** When the assistant is back, ready to put in a sentence. */
export interface AllowanceReturn {
  /** A time of day for a `day` period ("21:00"), a date for a `month` ("1 November"). */
  readonly when: string;
  /**
   * The hour of {@link when} on a 24 hour clock, for a language whose sentence changes
   * with it: Spanish says "a la 1:00" and "a las 2:00". Passed as the plural count.
   */
  readonly hour: number;
}

/**
 * The way back, in the reader's language and time zone.
 *
 * `Intl` and never `DatePipe`, because the language is runtime state here. An unknown
 * locale tag falls back to the runtime's own, and a date `Intl` cannot format answers
 * null, so the sentence goes out without its second half rather than not at all.
 *
 * No countdown, on purpose: rule A5 keeps a clock for `retryAfterSeconds`, which this
 * refusal never carries, and a twelve hour countdown is not an answer anybody can use.
 */
export function allowanceReturn(
  allowance: Pick<AssistantAllowance, 'period' | 'resetsAt'>,
  locale: string
): AllowanceReturn | null {
  const { resetsAt, period } = allowance;
  if (resetsAt === null || Number.isNaN(resetsAt.getTime())) {
    return null;
  }

  const options: Intl.DateTimeFormatOptions =
    period === 'month'
      ? { day: 'numeric', month: 'long' }
      : { hour: 'numeric', minute: '2-digit' };

  try {
    const hourPart = build(locale, { hour: 'numeric', hourCycle: 'h23' })
      .formatToParts(resetsAt)
      .find((part) => part.type === 'hour');

    return {
      when: build(locale, options).format(resetsAt),
      hour: hourPart === undefined ? 0 : Number(hourPart.value) % 24,
    };
  } catch {
    return null;
  }
}

function build(
  locale: string,
  options: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat(locale, options);
  } catch {
    return new Intl.DateTimeFormat(undefined, options);
  }
}
