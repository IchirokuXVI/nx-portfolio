import {
  dayOfMonth,
  groupHistoryByMonth,
  monthLabel,
  monthName,
  type LineHistoryRowVm,
} from './line-history-view';

function rowAt(id: string, at: Date): LineHistoryRowVm {
  return {
    id,
    outcome: 'BOUGHT',
    quantity: 1,
    who: null,
    mine: true,
    at,
    when: '',
    listName: null,
    reverted: false,
    price: null,
    unitPrice: null,
    day: String(at.getDate()),
    product: null,
  };
}

describe('groupHistoryByMonth', () => {
  const now = new Date(2026, 9, 11);

  it('puts rows under their month, newest month first, in the order given', () => {
    const months = groupHistoryByMonth(
      [
        rowAt('a', new Date(2026, 8, 28)),
        rowAt('b', new Date(2026, 8, 1)),
        rowAt('c', new Date(2026, 7, 23)),
      ],
      'en',
      now
    );

    expect(months.map((month) => month.key)).toEqual(['2026-09', '2026-08']);
    expect(months[0].rows.map((row) => row.id)).toEqual(['a', 'b']);
    expect(months[0].label).toBe('September');
  });

  it('names the year of a month that is not in this year', () => {
    const months = groupHistoryByMonth(
      [rowAt('a', new Date(2025, 11, 3))],
      'en',
      now
    );

    expect(months[0].label).toBe('December 2025');
  });

  it('answers no month for no rows', () => {
    expect(groupHistoryByMonth([], 'en', now)).toEqual([]);
  });
});

describe('monthLabel', () => {
  it('starts a Spanish month with a capital', () => {
    expect(monthLabel(new Date(2026, 8, 5), 'es', new Date(2026, 9, 1))).toBe(
      'Septiembre'
    );
  });

  it('falls back to the ISO month for a locale Intl refuses', () => {
    expect(
      monthLabel(new Date(2026, 8, 5), 'not a locale', new Date(2026, 9, 1))
    ).toBe('2026-09');
  });
});

describe('monthName', () => {
  it('leaves a Spanish month in lower case, for the middle of a sentence', () => {
    expect(monthName(new Date(2026, 8, 5), 'es', new Date(2026, 9, 1))).toBe(
      'septiembre'
    );
  });
});

describe('dayOfMonth', () => {
  it('writes the day as a number', () => {
    expect(dayOfMonth(new Date(2026, 8, 28), 'en')).toBe('28');
  });
});
