import { toDueLine, toDueLines } from './due-line-mappers';

const PERIOD = {
  lineId: 'l-1',
  reason: 'PERIOD',
  periodDays: 7,
  daysSinceBought: 5,
  tripsWith: null,
  tripsSeen: null,
  quantity: 2,
};

const STAPLE = {
  lineId: 'l-2',
  reason: 'STAPLE',
  periodDays: null,
  daysSinceBought: 3,
  tripsWith: 5,
  tripsSeen: 6,
  quantity: 4,
};

describe('due line mappers (velista 0089, test 1)', () => {
  it('maps a PERIOD row and a STAPLE row', () => {
    expect(toDueLine(PERIOD)).toEqual({
      lineId: 'l-1',
      reason: 'PERIOD',
      periodDays: 7,
      daysSinceBought: 5,
      tripsWith: null,
      tripsSeen: null,
      quantity: 2,
    });
    expect(toDueLine(STAPLE)).toEqual({
      lineId: 'l-2',
      reason: 'STAPLE',
      periodDays: null,
      daysSinceBought: 3,
      tripsWith: 5,
      tripsSeen: 6,
      quantity: 4,
    });
  });

  it('refuses a malformed row', () => {
    expect(toDueLine(null)).toBeNull();
    expect(toDueLine('l-1')).toBeNull();
    expect(toDueLine({ ...PERIOD, lineId: undefined })).toBeNull();
    expect(toDueLine({ ...PERIOD, lineId: '' })).toBeNull();
    // A reason whose own numbers are missing cannot say why the line is due.
    expect(toDueLine({ ...PERIOD, periodDays: null })).toBeNull();
    expect(toDueLine({ ...STAPLE, tripsSeen: null })).toBeNull();
    expect(toDueLine({ ...STAPLE, tripsWith: 7, tripsSeen: 6 })).toBeNull();
  });

  it('falls back on the numbers the row carries when the reason is unknown', () => {
    expect(toDueLine({ ...PERIOD, reason: 'SEASONAL' })?.reason).toBe('PERIOD');
    expect(toDueLine({ ...STAPLE, reason: undefined })?.reason).toBe('STAPLE');
    expect(
      toDueLine({ ...PERIOD, reason: 'SEASONAL', periodDays: null })
    ).toBeNull();
  });

  it('keeps only the numbers of its reason, and never adds less than one', () => {
    const mapped = toDueLine({
      ...PERIOD,
      tripsWith: 5,
      tripsSeen: 6,
      quantity: 0,
      daysSinceBought: 'soon',
    });

    expect(mapped?.tripsWith).toBeNull();
    expect(mapped?.tripsSeen).toBeNull();
    expect(mapped?.quantity).toBe(1);
    expect(mapped?.daysSinceBought).toBe(0);
  });

  it('drops a malformed row and keeps the answer', () => {
    expect(
      toDueLines({ items: [PERIOD, { reason: 'PERIOD' }, STAPLE] }).map(
        (line) => line.lineId
      )
    ).toEqual(['l-1', 'l-2']);
    expect(toDueLines(null)).toEqual([]);
    expect(toDueLines({ items: 'none' })).toEqual([]);
  });
});
