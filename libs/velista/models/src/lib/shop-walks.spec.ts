import {
  foldWalk,
  stateAt,
  type WalkEntry,
} from '@portfolio/luna-shopper/shop-map/model';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  rewindPreviewDocument,
  shopWalkHistory,
  sortShopWalks,
  walkLogEnd,
  walkWallClock,
  type ShopWalkSummary,
} from './shop-walks';

/** The El Jamón walk of model plan 0002, the log the browser walk seeds. */
const JAMON: WalkEntry[] = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      '../../../../luna-shopper/shop-map/model/src/lib/__fixtures__/el-jamon/walk-log.json'
    ),
    'utf8'
  )
).entries;

const bySeq = (seq: number): WalkEntry =>
  JAMON.find((entry) => entry.seq === seq) ?? JAMON[0];
const ms = (iso: string) => Date.parse(iso);

function entry(
  seq: number,
  kind: WalkEntry['kind'],
  logFrom: number,
  logTo: number,
  extra: Partial<WalkEntry> = {}
): WalkEntry {
  return {
    id: `e${seq}`,
    seq,
    kind,
    at: new Date(Date.UTC(2026, 8, 29, 10, 0, 0) + logTo).toISOString(),
    logFrom,
    logTo,
    events: [],
    ...extra,
  };
}

describe('walkWallClock', () => {
  it('reads a moment inside a save off the save time less the log still to come', () => {
    const started = bySeq(1);
    expect(walkWallClock(JAMON, 0)?.getTime()).toBe(
      ms(started.at) - started.logTo
    );
    expect(walkWallClock(JAMON, 600_000)?.getTime()).toBe(
      ms(started.at) - (started.logTo - 600_000)
    );
  });

  it('reads the moment of an edit or a rewind as that entry’s own time', () => {
    // The end of the log: the last rewind and the edit after it share it.
    expect(walkWallClock(JAMON, walkLogEnd(JAMON))?.getTime()).toBe(
      ms(bySeq(9).at)
    );
  });

  it('answers nothing for a walk with no entry', () => {
    expect(walkWallClock([], 0)).toBeNull();
    expect(walkLogEnd([])).toBe(0);
  });
});

describe('shopWalkHistory', () => {
  it('draws the El Jamón walk as seven rows, newest first', () => {
    const rows = shopWalkHistory(JAMON);

    expect(rows.map((row) => row.kind)).toEqual([
      'edited',
      'rewound',
      'resumed',
      'rewound',
      'resumed',
      'problem',
      'started',
    ]);
  });

  it('folds the automatic resume that was thrown away into the tracking stop', () => {
    const [problem] = shopWalkHistory(JAMON).filter(
      (row) => row.kind === 'problem'
    );

    expect(problem.seqs).toEqual([2, 3, 4]);
    expect(problem.discarded).toBe(true);
    expect(problem.reason).toBe('tracking-lost');
  });

  it('draws a session as one row, however many 20 s saves it made', () => {
    const log = [
      entry(1, 'started', 0, 20_000),
      entry(2, 'continued', 20_000, 40_000),
      entry(3, 'continued', 40_000, 60_000),
      entry(4, 'stopped', 60_000, 60_000, { reason: 'button' }),
      entry(5, 'edited', 60_000, 60_000),
    ];

    const rows = shopWalkHistory(log);

    expect(rows.map((row) => row.kind)).toEqual(['edited', 'started']);
    expect(rows[1].seqs).toEqual([1, 2, 3, 4]);
    expect(rows[1].walkedMs).toBe(60_000);
    expect(rows[1].logMs).toBe(0);
    // The session began when its first save's log began.
    expect(rows[1].at.getTime()).toBe(ms(log[0].at) - 20_000);
  });

  it('counts a session’s marks and an edit’s changes once the log is read', () => {
    const mark = {
      type: 'mark-put' as const,
      mark: {
        id: 'm1',
        kind: 'section' as const,
        x: 1,
        y: 1,
        heading: 0,
        text: 'Huevos',
        logMs: 10,
      },
    };
    const log = [
      entry(1, 'started', 0, 20_000, { events: [mark] }),
      entry(2, 'continued', 20_000, 40_000, {
        events: [{ ...mark, mark: { ...mark.mark, id: 'm2' } }],
      }),
      entry(3, 'edited', 40_000, 40_000, {
        events: [
          { type: 'area-removed', id: 'a1' },
          { type: 'mark-removed', id: 'm1' },
        ],
      }),
    ];

    const blind = shopWalkHistory(log);
    const read = shopWalkHistory(log, new Map(log.map((one) => [one.id, one])));

    expect(blind[1].marks).toBeNull();
    expect(blind[0].changes).toBeNull();
    expect(read[1].marks).toBe(2);
    expect(read[0].changes).toEqual({ areas: 1, marks: 1 });
  });

  it('says a rewind went back past an earlier one, and which', () => {
    const past = entry(10, 'rewound', 1_129_893, 1_129_893, {
      rewoundTo: 900_000,
    });

    const [row] = shopWalkHistory([...JAMON, past]);

    expect(row.kind).toBe('rewound');
    expect(row.undoes?.getTime()).toBe(ms(bySeq(8).at));
    expect(row.rewoundTo?.getTime()).toBe(
      ms(bySeq(1).at) - (bySeq(1).logTo - 900_000)
    );
  });

  it('says a rewind went back to before a tracking problem', () => {
    const log = [
      entry(1, 'started', 0, 100_000),
      entry(2, 'stopped', 100_000, 100_000, { reason: 'tracking-lost' }),
      entry(3, 'rewound', 100_000, 100_000, { rewoundTo: 50_000 }),
    ];

    const [row] = shopWalkHistory(log);

    expect(row.beforeProblem).toBe(true);
    expect(row.undoes).toBeNull();
  });

  it('marks a session whose automatic resume was kept as checked', () => {
    const log = [
      entry(1, 'resumed', 0, 30_000),
      entry(2, 'confirmed', 0, 30_000),
    ];

    const [row] = shopWalkHistory(log);

    expect(row).toMatchObject({ kind: 'resumed', checked: true, seqs: [1, 2] });
  });
});

describe('rewindPreviewDocument', () => {
  it('draws the moment as it was, and lays the present beside it to fade', () => {
    // Before the first rewind's target: the walk had the whole first session,
    // which the second rewind no longer holds.
    const moment = 1_050_000;
    const then = stateAt(JAMON, moment);
    const now = foldWalk(JAMON);

    const preview = rewindPreviewDocument(JAMON, moment);
    const ids = new Set(preview.areas.map((area) => area.id));

    for (const area of [...then.areas, ...now.areas]) {
      expect(ids.has(area.id)).toBe(true);
    }
    for (const area of then.areas) {
      expect(preview.areas.find((one) => one.id === area.id)).toEqual(area);
    }
  });
});

describe('sortShopWalks', () => {
  it('puts the shown walk first, then the newest change', () => {
    const walk = (
      id: string,
      shown: boolean,
      day: number
    ): ShopWalkSummary => ({
      id,
      locationId: 'l',
      name: id,
      shown,
      lastSeq: 0,
      entryCount: 0,
      markCount: 0,
      createdAt: new Date(2026, 0, 1),
      lastChangedAt: new Date(2026, 0, day),
    });

    expect(
      sortShopWalks([
        walk('a', false, 1),
        walk('b', true, 2),
        walk('c', false, 3),
      ]).map((one) => one.id)
    ).toEqual(['b', 'c', 'a']);
  });
});
