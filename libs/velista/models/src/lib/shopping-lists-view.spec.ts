import type { GeneratedListSummary } from './generated-list-view';
import {
  displayNames,
  formatGeneratedDate,
  isSameDay,
  outcomeBreakdown,
} from './shopping-lists-view';

/**
 * Naming an unnamed basket, which is the one piece of real logic in this file and the
 * one both screens share.
 *
 * Pure functions, so this is exhaustive without a fixture or a TestBed. `displayNames`
 * takes its formatter as an argument precisely so a spec can supply a stable one and
 * assert on the numbering rather than on how a runtime happens to spell August.
 */

function summary(overrides: Partial<GeneratedListSummary> = {}) {
  return {
    id: 'gl1',
    name: null,
    status: 'ACTIVE',
    generatedAt: new Date('2026-08-21T10:00:00.000Z'),
    lineCount: 4,
    settledLineCount: 0,
    ...overrides,
  } as GeneratedListSummary;
}

/** Stable and boring, so the assertions are about the numbering and nothing else. */
const asDay = (date: Date) => date.toISOString().slice(0, 10);

describe('displayNames', () => {
  it('uses a typed name as it is', () => {
    const names = displayNames([summary({ name: 'Saturday big shop' })], asDay);

    expect(names.get('gl1')).toBe('Saturday big shop');
  });

  it('falls back to the generation date for an unnamed one', () => {
    expect(displayNames([summary()], asDay).get('gl1')).toBe('2026-08-21');
  });

  // Null is not the only way to be unnamed: a name of spaces is a name nobody typed,
  // and rendering it would give a row a blank title.
  it('treats a whitespace name as unnamed', () => {
    expect(displayNames([summary({ name: '   ' })], asDay).get('gl1')).toBe(
      '2026-08-21'
    );
  });

  /**
   * The rule from backend `0050` section 1, and the reason this cannot be a pipe: the
   * number on one row is decided by the other rows.
   *
   * The input arrives newest first, so the **oldest** unnamed trip of a day is the bare
   * date and the newer ones count up. That is what keeps a label still as older pages
   * are appended: numbering from the newest would renumber every row whenever one
   * arrived.
   */
  it('numbers a second unnamed trip from the same day, counting upwards in time', () => {
    const names = displayNames(
      [
        summary({
          id: 'newest',
          generatedAt: new Date('2026-08-21T18:00:00Z'),
        }),
        summary({
          id: 'middle',
          generatedAt: new Date('2026-08-21T13:00:00Z'),
        }),
        summary({
          id: 'oldest',
          generatedAt: new Date('2026-08-21T09:00:00Z'),
        }),
      ],
      asDay
    );

    expect(names.get('oldest')).toBe('2026-08-21');
    expect(names.get('middle')).toBe('2026-08-21 2');
    expect(names.get('newest')).toBe('2026-08-21 3');
  });

  it('keeps the labels stable when an older page is appended', () => {
    const newer = [
      summary({ id: 'b', generatedAt: new Date('2026-08-21T18:00:00Z') }),
      summary({ id: 'a', generatedAt: new Date('2026-08-21T09:00:00Z') }),
    ];
    const withOlder = [
      ...newer,
      summary({ id: 'old', generatedAt: new Date('2026-08-14T09:00:00Z') }),
    ];

    expect(displayNames(newer, asDay).get('a')).toBe('2026-08-21');
    expect(displayNames(withOlder, asDay).get('a')).toBe('2026-08-21');
    expect(displayNames(withOlder, asDay).get('b')).toBe('2026-08-21 2');
  });

  it('numbers each day separately', () => {
    const names = displayNames(
      [
        summary({ id: 'b', generatedAt: new Date('2026-08-22T09:00:00Z') }),
        summary({ id: 'a', generatedAt: new Date('2026-08-21T09:00:00Z') }),
      ],
      asDay
    );

    expect(names.get('a')).toBe('2026-08-21');
    expect(names.get('b')).toBe('2026-08-22');
  });

  // A named trip is not something a bare one has to be told apart from, so it takes no
  // part in the count.
  it('leaves a named trip out of the numbering', () => {
    const names = displayNames(
      [summary({ id: 'bare' }), summary({ id: 'named', name: 'Corner shop' })],
      asDay
    );

    expect(names.get('bare')).toBe('2026-08-21');
    expect(names.get('named')).toBe('Corner shop');
  });

  it('answers an empty map for an empty listing', () => {
    expect(displayNames([], asDay).size).toBe(0);
  });
});

describe('formatGeneratedDate', () => {
  const august = new Date('2026-08-21T10:00:00.000Z');

  it('gives the day and the month in the reader s language', () => {
    expect(formatGeneratedDate(august, 'en', august)).toContain('21');
    expect(formatGeneratedDate(august, 'en', august)).toMatch(/August/i);
    expect(formatGeneratedDate(august, 'es', august)).toMatch(/agosto/i);
  });

  it('leaves the year out for the current year', () => {
    expect(formatGeneratedDate(august, 'en', august)).not.toContain('2026');
  });

  /**
   * A history is kept forever, so eventually it holds two trips a year apart on the
   * same day of the same month. Without the year they would be given one name and then
   * numbered against each other, as though they were two trips on one afternoon.
   */
  /**
   * `Intl` throws a `RangeError` for a tag it does not recognise, and this function
   * feeds `displayNames`, so an uncaught one would take out the whole dashboard card
   * and every row of the history at once rather than spoiling a single date.
   */
  it('falls back to an ISO date rather than throwing on a bad locale tag', () => {
    expect(formatGeneratedDate(august, 'not a locale', august)).toBe(
      '2026-08-21'
    );
  });

  it('adds the year once the trip is not from this year', () => {
    const nextYear = new Date('2027-02-02T10:00:00.000Z');

    expect(formatGeneratedDate(august, 'en', nextYear)).toContain('2026');
  });
});

/**
 * Whether the two outcome counts may be drawn (plan 0049, section 2).
 *
 * The test is arithmetic rather than a version flag, because arithmetic is the
 * condition the sentence actually needs: the breakdown may be drawn exactly when it
 * accounts for every finished line. Three different things fail it and all three should
 * fall back to "finished", which is the honest word for a number that merges outcomes.
 */
describe('outcomeBreakdown', () => {
  it('answers the two halves when they account for every finished line', () => {
    expect(
      outcomeBreakdown({
        settledLineCount: 4,
        boughtLineCount: 3,
        notAvailableLineCount: 1,
      })
    ).toEqual({ bought: 3, notAvailable: 1 });
  });

  // A basket nobody has settled anything on. Zero of zero still accounts for itself, so
  // the row says "0 of 12 got", which is true and better than "0 of 12 finished".
  it('answers zeroes on a trip nothing has happened to', () => {
    expect(
      outcomeBreakdown({
        settledLineCount: 0,
        boughtLineCount: 0,
        notAvailableLineCount: 0,
      })
    ).toEqual({ bought: 0, notAvailable: 0 });
  });

  // A server older than backend `0053` sends neither field, so both map to zero while
  // lines really are finished. Claiming "0 got" over three purchases would be worse
  // than being vague.
  it('declines where the counts are missing and lines are finished', () => {
    expect(
      outcomeBreakdown({
        settledLineCount: 3,
        boughtLineCount: 0,
        notAvailableLineCount: 0,
      })
    ).toBeNull();
  });

  /**
   * An outcome this build has never heard of, or a finished line with no settlement
   * behind it: either way a line is finished and in neither bucket, and the same
   * arithmetic catches it with no release of this app required.
   */
  it('declines where an outcome it does not know is in play', () => {
    expect(
      outcomeBreakdown({
        settledLineCount: 5,
        boughtLineCount: 3,
        notAvailableLineCount: 1,
      })
    ).toBeNull();
  });
});

describe('isSameDay', () => {
  it('compares by calendar day, not by hours elapsed', () => {
    const lateLastNight = new Date(2026, 7, 20, 23, 30);
    const earlyToday = new Date(2026, 7, 21, 1, 0);
    const now = new Date(2026, 7, 21, 9, 0);

    // Two and a half hours apart, and only one of them is today, which is how a person
    // reads it.
    expect(isSameDay(lateLastNight, now)).toBe(false);
    expect(isSameDay(earlyToday, now)).toBe(true);
  });
});
