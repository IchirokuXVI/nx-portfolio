import { toTrip, toTripPage, toTripRow } from './trip-mappers';

const TRIP = {
  id: 'b-1',
  kind: 'BASKET',
  name: 'Thursday shop',
  live: true,
  startedAt: '2026-09-17T10:00:00.000Z',
  lineCount: 5,
  fullyBoughtLineCount: 1,
};

const ROW = {
  lineId: 'l-1',
  asked: 6,
  bought: 3,
  left: 3,
  outcome: 'PARTLY',
  settledByUserId: null,
};

describe('trip mappers (velista 0088, test 1)', () => {
  it('maps a trip head', () => {
    expect(toTrip(TRIP)).toEqual({
      id: 'b-1',
      kind: 'BASKET',
      name: 'Thursday shop',
      live: true,
      startedAt: new Date('2026-09-17T10:00:00.000Z'),
      lineCount: 5,
      boughtLineCount: 1,
    });
  });

  // Backend 0159 renamed the count. The old name rides beside the new one for
  // one release, and this client reads only the new one.
  it('reads the bought count from fullyBoughtLineCount and never the old name', () => {
    expect(toTrip({ ...TRIP, boughtLineCount: 4 })?.boughtLineCount).toBe(1);
    expect(
      toTrip({ ...TRIP, fullyBoughtLineCount: undefined, boughtLineCount: 4 })
        ?.boughtLineCount
    ).toBe(0);
  });

  it('refuses a trip with no id or no readable date', () => {
    expect(toTrip({ ...TRIP, id: undefined })).toBeNull();
    expect(toTrip({ ...TRIP, id: '' })).toBeNull();
    expect(toTrip({ ...TRIP, startedAt: 'yesterday' })).toBeNull();
    expect(toTrip('b-1')).toBeNull();
    expect(toTrip(null)).toBeNull();
  });

  it('reads an unknown kind as a session, and absent counts as zero', () => {
    const trip = toTrip({
      ...TRIP,
      kind: 'SUBSCRIPTION',
      lineCount: undefined,
      fullyBoughtLineCount: 'many',
      live: 'yes',
    });

    expect(trip?.kind).toBe('SESSION');
    expect(trip?.lineCount).toBe(0);
    expect(trip?.boughtLineCount).toBe(0);
    expect(trip?.live).toBe(false);
  });

  it('maps the wire session and the older LOOSE to SESSION (velista 0095, test 6)', () => {
    expect(toTrip({ ...TRIP, kind: 'SESSION' })?.kind).toBe('SESSION');
    expect(toTrip({ ...TRIP, kind: 'LOOSE' })?.kind).toBe('SESSION');
  });

  it('drops a malformed trip from a page and keeps the rest', () => {
    const page = toTripPage({
      live: [TRIP, { kind: 'BASKET' }],
      items: [{ ...TRIP, id: 'b-2', live: false }],
      nextCursor: 'c-1',
    });

    expect(page.live.map((trip) => trip.id)).toEqual(['b-1']);
    expect(page.items.map((trip) => trip.id)).toEqual(['b-2']);
    expect(page.nextCursor).toBe('c-1');
    expect(toTripPage('nope')).toEqual({
      live: [],
      items: [],
      nextCursor: null,
    });
  });

  it("maps a row, keeping a session row's nulls as nulls", () => {
    expect(toTripRow(ROW)).toEqual(ROW);
    expect(
      toTripRow({
        lineId: 'l-2',
        asked: null,
        bought: 2,
        left: null,
        outcome: 'BOUGHT',
        settledByUserId: 'u-1',
      })
    ).toEqual({
      lineId: 'l-2',
      asked: null,
      bought: 2,
      left: null,
      outcome: 'BOUGHT',
      settledByUserId: 'u-1',
    });
  });

  it('refuses a row with no line id', () => {
    expect(toTripRow({ ...ROW, lineId: undefined })).toBeNull();
    expect(toTripRow({ ...ROW, lineId: '' })).toBeNull();
    expect(toTripRow([ROW])).toBeNull();
  });

  it('reads an unknown outcome as not bought, the quiet one', () => {
    expect(toTripRow({ ...ROW, outcome: 'STOLEN' })?.outcome).toBe(
      'NOT_BOUGHT'
    );
    expect(toTripRow({ ...ROW, outcome: undefined })?.outcome).toBe(
      'NOT_BOUGHT'
    );
  });
});
