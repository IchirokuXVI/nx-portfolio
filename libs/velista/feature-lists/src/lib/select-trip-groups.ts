import {
  TRIP_ROWS_PAGE_SIZE,
  type Line,
  type LineRowVm,
  type TripGroup,
  type TripGroupVm,
  type TripRowMark,
  type TripRowVm,
} from '@portfolio/velista/models';

/** Everything `selectTripGroups` needs beside the composed groups. */
export interface TripGroupsInput {
  readonly groups: readonly TripGroup<LineRowVm>[];
  /** The line behind a row, for its live quantity and its claim. */
  readonly lineOf: (lineId: string) => Line | null;
  /** A user id's name in this zone, or null. */
  readonly nameOf: (userId: string) => string | null;
  readonly locale: string;
  /** Now, for whether a trip's date needs its year. */
  readonly now: Date;
}

/**
 * The trip groups as `lib-trip-group` draws them (velista `0088`, sections 4 and 5).
 *
 * Pure, so every rule about a label, a count and a row is tested without a page.
 */
export function selectTripGroups(
  input: TripGroupsInput
): readonly TripGroupVm[] {
  const format = dateFormatter(input.locale);

  return input.groups.map(({ key, trip, open, rows }) => {
    const live = trip.live;
    const countArgs: Readonly<Record<string, number>> =
      trip.kind === 'BASKET'
        ? { bought: trip.boughtLineCount, total: trip.lineCount }
        : { count: trip.lineCount };

    return {
      key,
      kind: trip.kind,
      live,
      name: trip.kind === 'BASKET' ? trip.name : null,
      date: format(trip.startedAt, input.now),
      countKey:
        trip.kind === 'BASKET' ? 'list.trips.bought' : 'list.trips.lines',
      countArgs,
      liveBy: live ? liveOwner(rows, input) : null,
      open,
      rows:
        rows === null
          ? null
          : rows.map(({ row, line }) => {
              const held = input.lineOf(line.id);
              const claimed = live && (held?.claimed ?? false);
              const mark: TripRowMark =
                row.outcome === 'NOT_BOUGHT' && claimed
                  ? 'claimed'
                  : MARKS[row.outcome];

              return {
                lineId: line.id,
                content: line.content,
                left: row.left,
                bought: row.bought,
                asked: row.asked,
                mark,
                claimedBy: mark === 'claimed' ? line.claimedBy : null,
                buyer:
                  trip.kind === 'LOOSE' && row.settledByUserId !== null
                    ? input.nameOf(row.settledByUserId)
                    : null,
                // The basket holds a copy taken when it was composed. On a live trip
                // this one sentence is all the page says about a difference.
                nowAsks:
                  live &&
                  held !== null &&
                  row.left !== null &&
                  held.quantity !== row.left
                    ? held.quantity
                    : null,
                quiet: !live,
              } satisfies TripRowVm;
            }),
      skeletonCount: Math.max(1, Math.min(trip.lineCount, TRIP_ROWS_PAGE_SIZE)),
    } satisfies TripGroupVm;
  });
}

const MARKS = {
  BOUGHT: 'bought',
  PARTLY: 'partly',
  NOT_AVAILABLE: 'notAvailable',
  NOT_BOUGHT: 'notBought',
} as const satisfies Record<string, TripRowMark>;

/**
 * Who is buying on a live trip: the owner its claimed lines already name.
 *
 * Null until the rows arrive, and null when the owner left the zone, which the head
 * draws as the nameless form.
 */
function liveOwner(
  rows: TripGroup<LineRowVm>['rows'],
  input: TripGroupsInput
): string | null {
  for (const { line } of rows ?? []) {
    const userId = input.lineOf(line.id)?.claimedByUserId ?? null;
    if (userId !== null) {
      return input.nameOf(userId);
    }
  }
  return null;
}

/**
 * "Sat 12 Sep", with the year only when it is not this year's.
 *
 * `Intl` and never `DatePipe`: the language is runtime state here. An unrecognised
 * locale tag throws `RangeError`, and the runtime's own locale stands in.
 */
function dateFormatter(locale: string): (date: Date, now: Date) => string {
  const build = (options: Intl.DateTimeFormatOptions) => {
    try {
      return new Intl.DateTimeFormat(locale, options);
    } catch {
      return new Intl.DateTimeFormat(undefined, options);
    }
  };
  const short = build({ weekday: 'short', day: 'numeric', month: 'short' });
  const long = build({ day: 'numeric', month: 'short', year: 'numeric' });

  return (date, now) =>
    date.getFullYear() === now.getFullYear()
      ? short.format(date)
      : long.format(date);
}
