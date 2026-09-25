import type {
  Line,
  LineRowVm,
  Trip,
  TripGroup,
  TripRow,
} from '@portfolio/velista/models';
import { selectTripGroups, type TripGroupsInput } from './select-trip-groups';

const NOW = new Date('2026-09-17T12:00:00.000Z');

function trip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'b-1',
    kind: 'BASKET',
    name: 'Weekend shop',
    live: false,
    startedAt: new Date('2026-09-12T10:00:00.000Z'),
    lineCount: 5,
    boughtLineCount: 3,
    ...overrides,
  };
}

function lineRow(id: string, claimedBy: string | null = null): LineRowVm {
  return { id, content: id, claimedBy } as unknown as LineRowVm;
}

function line(id: string, overrides: Partial<Line> = {}): Line {
  return {
    id,
    quantity: 0,
    claimed: false,
    claimedByUserId: null,
    ...overrides,
  } as unknown as Line;
}

function tripRow(lineId: string, overrides: Partial<TripRow> = {}): TripRow {
  return {
    lineId,
    asked: 2,
    bought: 2,
    left: 0,
    outcome: 'BOUGHT',
    settledByUserId: null,
    ...overrides,
  };
}

function select(
  groups: readonly TripGroup<LineRowVm>[],
  options: Partial<TripGroupsInput> & { lines?: readonly Line[] } = {}
) {
  const lines = new Map((options.lines ?? []).map((held) => [held.id, held]));
  return selectTripGroups({
    groups,
    lineOf: (lineId) => lines.get(lineId) ?? null,
    nameOf: (userId) =>
      ({ 'u-marta': 'Marta', 'u-dani': 'Dani' })[userId] ?? null,
    locale: options.locale ?? 'en-GB',
    now: options.now ?? NOW,
  });
}

function group(
  overrides: Partial<Trip> = {},
  rows: TripGroup<LineRowVm>['rows'] = null
): TripGroup<LineRowVm> {
  const head = trip(overrides);
  return { key: `${head.kind}:${head.id}`, trip: head, open: true, rows };
}

describe('selectTripGroups (velista 0088)', () => {
  describe('labels and dates (test 4)', () => {
    it('labels a named basket with its name and a date through Intl in the locale', () => {
      const [vm] = select([group()]);

      expect(vm.name).toBe('Weekend shop');
      expect(vm.date).toBe(
        new Intl.DateTimeFormat('en-GB', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
        }).format(new Date('2026-09-12T10:00:00.000Z'))
      );
      expect(vm.countKey).toBe('list.trips.bought');
      expect(vm.countArgs).toEqual({ bought: 3, total: 5 });
    });

    it('adds the time of day to a session only when another group shares its day (velista 0095, test 6)', () => {
      const dayOnly = new Intl.DateTimeFormat('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      });
      const withTime = new Intl.DateTimeFormat('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
      const morning = new Date('2026-09-12T08:00:00.000Z');
      const evening = new Date('2026-09-12T18:40:00.000Z');
      const monday = new Date('2026-09-14T09:00:00.000Z');

      const [alone] = select([
        group({ kind: 'SESSION', id: 's-1', name: null, startedAt: morning }),
        group({ kind: 'SESSION', id: 's-2', name: null, startedAt: monday }),
      ]);
      expect(alone.date).toBe(dayOnly.format(morning));

      const [late, early, basket] = select([
        group({ kind: 'SESSION', id: 's-2', name: null, startedAt: evening }),
        group({ kind: 'SESSION', id: 's-1', name: null, startedAt: morning }),
        group({ id: 'b-1', startedAt: morning }),
      ]);
      expect(late.date).toBe(withTime.format(evening));
      expect(early.date).toBe(withTime.format(morning));
      expect(basket.date).toBe(dayOnly.format(morning));
    });

    it('formats the same date in Spanish for a Spanish reader', () => {
      const [english] = select([group()], { locale: 'en' });
      const [spanish] = select([group()], { locale: 'es' });

      expect(spanish.date).not.toBe(english.date);
    });

    it('labels an unnamed basket by its date, and a session with no name and a line count', () => {
      const [unnamed, loose] = select([
        group({ name: null }),
        group({ id: 's-1', kind: 'SESSION', name: 'ignored', lineCount: 2 }),
      ]);

      expect(unnamed.name).toBeNull();
      expect(loose.name).toBeNull();
      expect(loose.countKey).toBe('list.trips.lines');
      expect(loose.countArgs).toEqual({ count: 2 });
    });

    it('adds the year to a trip from another year', () => {
      const [vm] = select([
        group({ startedAt: new Date('2025-12-20T10:00:00Z') }),
      ]);

      expect(vm.date).toContain('2025');
    });
  });

  describe('rows (tests 5 and 6)', () => {
    it('maps every outcome to its mark, quiet on a past trip', () => {
      const [vm] = select([
        group({}, [
          { row: tripRow('a', { outcome: 'BOUGHT' }), line: lineRow('a') },
          { row: tripRow('b', { outcome: 'PARTLY' }), line: lineRow('b') },
          {
            row: tripRow('c', { outcome: 'NOT_AVAILABLE' }),
            line: lineRow('c'),
          },
          { row: tripRow('d', { outcome: 'NOT_BOUGHT' }), line: lineRow('d') },
        ]),
      ]);

      expect(vm.rows?.map((row) => row.mark)).toEqual([
        'bought',
        'partly',
        'notAvailable',
        'notBought',
      ]);
      expect(vm.rows?.every((row) => row.quiet)).toBe(true);
    });

    it('draws the claimed dot for a claimed line in a live trip, and names the owner on the head', () => {
      const [vm] = select(
        [
          group({ live: true }, [
            {
              row: tripRow('rice', {
                outcome: 'NOT_BOUGHT',
                left: 1,
                bought: 0,
              }),
              line: lineRow('rice', 'Marta'),
            },
          ]),
        ],
        {
          lines: [
            line('rice', {
              quantity: 1,
              claimed: true,
              claimedByUserId: 'u-marta',
            }),
          ],
        }
      );

      expect(vm.rows?.[0].mark).toBe('claimed');
      expect(vm.rows?.[0].claimedBy).toBe('Marta');
      expect(vm.rows?.[0].quiet).toBe(false);
      expect(vm.liveBy).toBe('Marta');
    });

    it('keeps not bought on a past trip even when the line is claimed now', () => {
      const [vm] = select(
        [
          group({}, [
            {
              row: tripRow('rice', { outcome: 'NOT_BOUGHT' }),
              line: lineRow('rice'),
            },
          ]),
        ],
        { lines: [line('rice', { claimed: true })] }
      );

      expect(vm.rows?.[0].mark).toBe('notBought');
    });

    it('draws no comparison with the list on any row (velista 0095, test 7)', () => {
      const [vm] = select(
        [
          group({ live: true }, [
            { row: tripRow('onions', { left: 2 }), line: lineRow('onions') },
          ]),
        ],
        { lines: [line('onions', { quantity: 3 })] }
      );

      expect(vm.rows?.[0]).not.toHaveProperty('nowAsks');
    });

    it('names the buyer of a session purchase, and leaves it off when unknown', () => {
      const [vm] = select([
        group({ kind: 'SESSION', id: 's-1' }, [
          {
            row: tripRow('bread', {
              asked: null,
              left: null,
              settledByUserId: 'u-dani',
            }),
            line: lineRow('bread'),
          },
          {
            row: tripRow('milk', {
              asked: null,
              left: null,
              settledByUserId: null,
            }),
            line: lineRow('milk'),
          },
        ]),
      ]);

      expect(vm.rows?.map((row) => row.buyer)).toEqual(['Dani', null]);
    });

    it('holds one skeleton row per line until the rows arrive', () => {
      const [vm] = select([group({ lineCount: 4 })]);

      expect(vm.rows).toBeNull();
      expect(vm.skeletonCount).toBe(4);
    });
  });
});
