import type { DueLine, LineRowVm } from '@portfolio/velista/models';
import { selectDueLines, type DueLinesInput } from './select-due-lines';

function lineRow(id: string, adjustable = true): LineRowVm {
  return { id, content: `Name ${id}`, adjustable } as unknown as LineRowVm;
}

function due(lineId: string, overrides: Partial<DueLine> = {}): DueLine {
  return {
    lineId,
    reason: 'PERIOD',
    periodDays: 7,
    daysSinceBought: 5,
    tripsWith: null,
    tripsSeen: null,
    quantity: 2,
    ...overrides,
  };
}

function select(
  rows: readonly LineRowVm[],
  dues: readonly DueLine[],
  overrides: Partial<DueLinesInput> = {}
) {
  const byId = new Map(dues.map((line) => [line.lineId, line]));
  return selectDueLines({
    rows,
    dueOf: (lineId) => byId.get(lineId),
    locale: 'en',
    expanded: false,
    ...overrides,
  });
}

describe('selectDueLines (velista 0089)', () => {
  it('draws a PERIOD row with the relative day through Intl (test 7)', () => {
    const vm = select([lineRow('eggs')], [due('eggs')]);

    expect(vm.rows).toEqual([
      {
        lineId: 'eggs',
        name: 'Name eggs',
        quantity: 2,
        reasonKey: 'list.due.period',
        reasonArgs: { days: 7, when: '5 days ago' },
      },
    ]);
  });

  it('uses periodOne for a period of one day, and the locale for the words (test 7)', () => {
    const vm = select(
      [lineRow('bread')],
      [due('bread', { periodDays: 1, daysSinceBought: 1 })],
      { locale: 'es' }
    );

    expect(vm.rows[0].reasonKey).toBe('list.due.periodOne');
    expect(vm.rows[0].reasonArgs).toEqual({ when: 'ayer' });
  });

  it('draws a STAPLE row with its counts (test 7)', () => {
    const vm = select(
      [lineRow('yogurt')],
      [
        due('yogurt', {
          reason: 'STAPLE',
          periodDays: null,
          tripsWith: 5,
          tripsSeen: 6,
        }),
      ]
    );

    expect(vm.rows[0].reasonKey).toBe('list.due.staple');
    expect(vm.rows[0].reasonArgs).toEqual({ with: 5, seen: 6 });
  });

  it('falls back on the runtime locale for a tag Intl refuses', () => {
    const vm = select(
      [lineRow('eggs')],
      [due('eggs', { daysSinceBought: 0 })],
      {
        locale: 'not a locale!!',
      }
    );

    expect(typeof vm.rows[0].reasonArgs['when']).toBe('string');
  });

  it('offers nothing a reader cannot adjust (test 2)', () => {
    const vm = select(
      [lineRow('eggs', false), lineRow('milk')],
      [due('eggs'), due('milk')]
    );

    expect(vm.rows.map((row) => row.lineId)).toEqual(['milk']);
  });

  it('draws three, and every row once expanded', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const rows = ids.map((id) => lineRow(id));
    const dues = ids.map((id) => due(id));

    const folded = select(rows, dues);
    expect(folded.rows.map((row) => row.lineId)).toEqual(['a', 'b', 'c']);
    expect(folded.hiddenCount).toBe(2);

    const open = select(rows, dues, { expanded: true });
    expect(open.rows.map((row) => row.lineId)).toEqual(ids);
    expect(open.hiddenCount).toBe(0);
  });

  it('has nothing hidden at three or fewer', () => {
    const vm = select(
      ['a', 'b', 'c'].map((id) => lineRow(id)),
      ['a', 'b', 'c'].map((id) => due(id))
    );

    expect(vm.hiddenCount).toBe(0);
  });

  it('skips a row the server did not name', () => {
    expect(select([lineRow('eggs')], []).rows).toEqual([]);
  });
});
