import type { ShopDetail } from '@portfolio/velista/models';
import { shopPageText } from '../shop-page/shop-page';

/**
 * The clock and calendar words the walks screens share (velista `0122`). Through
 * `Intl`, never `DatePipe`: the language is runtime state and there is no
 * `LOCALE_ID` to lean on. Each formatter falls back to English when `Intl` does
 * not know the locale, rather than throwing out of a template.
 */

function format(
  locale: string,
  options: Intl.DateTimeFormatOptions,
  at: Date
): string {
  try {
    return new Intl.DateTimeFormat(locale, options).format(at);
  } catch {
    return new Intl.DateTimeFormat('en', options).format(at);
  }
}

/** "13:24", or "12:52:15" with seconds. */
export function clockText(at: Date, locale: string, seconds = false): string {
  return format(
    locale,
    {
      hour: '2-digit',
      minute: '2-digit',
      ...(seconds ? { second: '2-digit' } : {}),
      hourCycle: 'h23',
    },
    at
  );
}

/** "14 September", with the year when it is not this year's. */
export function dateText(at: Date, locale: string, now = new Date()): string {
  return format(
    locale,
    {
      day: 'numeric',
      month: 'long',
      ...(at.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
    },
    at
  );
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Which day something happened, as the history's headings name it. */
export type DayName =
  | { readonly kind: 'today' }
  | { readonly kind: 'yesterday' }
  | { readonly kind: 'date'; readonly text: string };

export function dayName(at: Date, locale: string, now = new Date()): DayName {
  if (sameDay(at, now)) {
    return { kind: 'today' };
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  return sameDay(at, yesterday)
    ? { kind: 'yesterday' }
    : { kind: 'date', text: dateText(at, locale, now) };
}

/** The key of the day's day, for grouping: local calendar days. */
export function dayKey(at: Date): string {
  return `${at.getFullYear()}-${at.getMonth()}-${at.getDate()}`;
}

/** Whole minutes of walking, at least one when there was any. */
export function minutesOf(ms: number): number {
  return ms <= 0 ? 0 : Math.max(1, Math.round(ms / 60_000));
}

/** A span split into minutes and seconds, for "10 min 15 s after 12:42". */
export function spanOf(ms: number): {
  readonly minutes: number;
  readonly seconds: number;
} {
  const total = Math.max(0, Math.round(ms / 1000));
  return { minutes: Math.floor(total / 60), seconds: total % 60 };
}

/**
 * "<chain> · <street>" under a walk's title, as the map page puts it, or null
 * until the shop has been read.
 */
export function shopLine(shop: ShopDetail, locale: string): string {
  const text = shopPageText(shop, locale);
  const chain = text.chain ?? text.title;
  const street = text.street !== chain ? text.street : null;
  return [chain, street].filter((part) => part !== null).join(' · ');
}
