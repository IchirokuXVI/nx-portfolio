import type {
  ShopMapDocument,
  ShopWalkEntryView,
} from '@portfolio/luna-shopper/contracts';
import {
  foldWalk,
  type WalkEntry,
} from '@portfolio/luna-shopper/shop-map/model';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  emptyShopMapDocument,
  foldOnto,
  foldReplaying,
  needsSnapshot,
  replacesState,
  type FoldStart,
} from './walk-fold';

/**
 * The fold of backend plan 0168, section 2, with the database replaced by
 * arrays: the walk's document, the log, and the snapshots it stores. The
 * integration spec proves the same over real Postgres.
 */
const FIXTURES = join(
  __dirname,
  '../../../../../../libs/luna-shopper/shop-map/model/src/lib/__fixtures__/el-jamon'
);
const read = <T>(file: string): T =>
  JSON.parse(readFileSync(join(FIXTURES, file), 'utf8')) as T;

const elJamon = read<{ entries: Omit<ShopWalkEntryView, 'seq'>[] }>(
  'walk-log.json'
).entries;
const expectedMap = read<ShopMapDocument>('expected-map.json');

/** A walk in memory, appended to the way `ShopWalkService.append` does. */
class MemoryWalk {
  document = emptyShopMapDocument();
  readonly log: ShopWalkEntryView[] = [];
  readonly snapshots: FoldStart[] = [];

  async append(entry: Omit<ShopWalkEntryView, 'seq'>): Promise<void> {
    const seq = this.log.length + 1;
    const next: ShopWalkEntryView = { ...entry, seq };
    this.document = replacesState(next.kind)
      ? await foldReplaying(
          this.snapshots,
          async (after) => this.log.filter((e) => e.seq > after),
          next
        )
      : foldOnto(this.document, next);
    this.log.push(next);
    if (needsSnapshot(seq, next.kind)) {
      this.snapshots.push({ seq, document: this.document });
    }
  }
}

function entry(
  id: string,
  kind: ShopWalkEntryView['kind'],
  logFrom: number,
  logTo: number,
  events: ShopWalkEntryView['events'],
  extra: Partial<ShopWalkEntryView> = {}
): Omit<ShopWalkEntryView, 'seq'> {
  return {
    id,
    kind,
    at: '2026-09-30T10:00:00.000Z',
    logFrom,
    logTo,
    events,
    ...extra,
  };
}

const note = (id: string, logMs: number, x: number) => ({
  type: 'mark-put' as const,
  mark: { id, kind: 'note' as const, x, y: 0, heading: 0, text: id, logMs },
});

describe('the walk fold (plan 0168, section 2)', () => {
  it('folds the El Jamón log entry by entry to the map the library folds it to', async () => {
    const walk = new MemoryWalk();
    for (const e of elJamon) {
      await walk.append(e);
    }

    const whole = foldWalk(walk.log as WalkEntry[]);
    expect(walk.document).toEqual(whole);
    expect(walk.document).toEqual(expectedMap);
    // Two rewinds in the fixture, and each stored its fold.
    expect(walk.snapshots.map((s) => s.seq)).toEqual(
      walk.log.filter((e) => e.kind === 'rewound').map((e) => e.seq)
    );
  });

  it('stores a snapshot every twentieth entry and on every rewind', () => {
    expect(needsSnapshot(19, 'continued')).toBe(false);
    expect(needsSnapshot(20, 'continued')).toBe(true);
    expect(needsSnapshot(40, 'edited')).toBe(true);
    expect(needsSnapshot(3, 'rewound')).toBe(true);
    expect(needsSnapshot(3, 'discarded')).toBe(false);
  });

  it('rewinds past a snapshot by folding from an older start', async () => {
    const walk = new MemoryWalk();
    await walk.append(
      entry('e1', 'started', 0, 1000, [
        {
          type: 'path',
          points: [
            [0, 0, 0],
            [1000, 1, 0],
          ],
        },
        note('a', 500, 0.5),
      ])
    );
    // Twenty saves of one note each, so seq 20 stores a snapshot.
    for (let i = 2; i <= 21; i++) {
      const t = i * 1000;
      await walk.append(
        entry(`e${i}`, 'continued', t - 1000, t, [
          { type: 'path', points: [[t, i, 0]] },
          note(`n${i}`, t, i),
        ])
      );
    }
    expect(walk.snapshots.map((s) => s.seq)).toEqual([20]);

    // Back to 1.5 s: before everything the snapshot at 20 holds.
    await walk.append(
      entry('r1', 'rewound', 21000, 21000, [], { rewoundTo: 1500 })
    );
    expect(walk.document.marks.map((m) => m.id)).toEqual(['a']);
    expect(walk.document).toEqual(foldWalk(walk.log as WalkEntry[]));

    // And past that rewind, to a point after it: the state it produced plus
    // what came after it.
    await walk.append(
      entry('e23', 'resumed', 21000, 22000, [
        { type: 'path', points: [[21000, 5, 5]] },
        note('b', 21500, 5),
      ])
    );
    await walk.append(
      entry('r2', 'rewound', 22000, 22000, [], { rewoundTo: 21200 })
    );
    expect(walk.document.marks.map((m) => m.id)).toEqual(['a']);
    await walk.append(
      entry('r3', 'rewound', 22000, 22000, [], { rewoundTo: 30000 })
    );
    expect(walk.document).toEqual(foldWalk(walk.log as WalkEntry[]));
  });

  it('discards a whole unconfirmed session of continued saves', async () => {
    const walk = new MemoryWalk();
    await walk.append(
      entry('s1', 'started', 0, 1000, [
        {
          type: 'path',
          points: [
            [0, 0, 0],
            [1000, 1, 0],
          ],
        },
      ])
    );
    await walk.append(
      entry('s2', 'stopped', 1000, 1000, [], { reason: 'tracking-lost' })
    );
    await walk.append(
      entry('s3', 'resumed', 1000, 2000, [
        {
          type: 'path',
          points: [
            [1000, 9, 9],
            [2000, 9, 10],
          ],
        },
        note('wrong', 1500, 9),
      ])
    );
    await walk.append(
      entry('s4', 'continued', 2000, 3000, [
        { type: 'path', points: [[3000, 9, 11]] },
      ])
    );
    await walk.append(entry('s5', 'discarded', 1000, 3000, []));

    expect(walk.document.marks).toEqual([]);
    expect(walk.document).toEqual(foldWalk(walk.log as WalkEntry[]));
  });
});
