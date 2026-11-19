import { entryKey } from '../harvest/matching';
import {
  ACTIVE_RUNS_SQL,
  CHAIN_ROWS_SQL,
  DECISIONS_SQL,
  DEFAULT_RECORD,
  DEZA_SOURCES_SQL,
  JOINED_SQL,
  LOCK_SQL,
  REKEY_SQL,
  STATUS_COUNTS_SQL,
  countLines,
  describe as describeError,
  parseDezaKeysArgs,
  pendingMoves,
  recordOf,
  rekeyable,
  runDezaKeys,
  selectMoves,
  type DezaKeysDb,
  type StoredRow,
} from './deza-keys';

/**
 * Release task 0008 of backend plan 0272: the selection, the collisions, the
 * guard's count and the command over an in memory database. The SQL itself
 * is proved against real Postgres in `deza-keys.integration.spec.ts`.
 */

const DEZA = '02720000-0000-4000-8000-000000000001';
const OTHER = '02720000-0000-4000-8000-000000000002';

let next = 0;

/** A row stored under the key of its stored text, as a walk wrote it. */
function row(
  name: string,
  sizeFormat: string | null,
  over: Partial<StoredRow> = {}
): StoredRow {
  next += 1;
  return {
    id: `e-${String(next).padStart(4, '0')}`,
    externalId: entryKey(name, sizeFormat),
    name,
    sizeFormat,
    status: 'ACTIVE',
    sourceKind: 'OFFICIAL_WEB',
    ...over,
  };
}

describe('deza keys: which rows move (section 1)', () => {
  it('moves a whole description the split now reads', () => {
    const socks = row('Calcetines 3 pares', null);
    const yogurt = row('Yogur 2X125 g', null);
    const hose = row('Manguera 15 m.', null);

    const { moves } = selectMoves([socks, yogurt, hose]);

    expect(moves).toEqual([
      expect.objectContaining({
        id: socks.id,
        oldKey: socks.externalId,
        newKey: entryKey('Calcetines', '3 pares'),
        name: 'Calcetines',
        sizeFormat: '3 pares',
        collision: false,
      }),
      expect.objectContaining({
        id: yogurt.id,
        name: 'Yogur',
        sizeFormat: '2X125 g',
      }),
      // Plan 0266: a size that ends in a full stop.
      expect.objectContaining({
        id: hose.id,
        name: 'Manguera',
        sizeFormat: '15 m.',
      }),
    ]);
  });

  it('leaves a row the split already built', () => {
    expect(selectMoves([row('Calcetines', '3 pares')]).moves).toEqual([]);
  });

  it('leaves a leaflet row with the same text', () => {
    const leaflet = row('Calcetines 3 pares', null, {
      sourceKind: 'OFFICIAL_LEAFLET',
    });
    const selection = selectMoves([leaflet]);
    expect(selection.moves).toEqual([]);
    expect(selection.rows).toBe(0);
  });

  it('counts a row whose key its text does not build as unkeyed, and never moves it', () => {
    const unkeyed = row('Calcetines 3 pares', null, {
      externalId: 'printed-on-a-leaflet',
    });
    const selection = selectMoves([unkeyed]);
    expect(selection).toEqual({ rows: 1, unkeyed: 1, moves: [] });
  });

  it('moves a row of every status', () => {
    const statuses = ['ACTIVE', 'UNRESOLVED', 'CANDIDATE', 'REJECTED'];
    const { moves } = selectMoves(
      statuses.map((status, i) =>
        row(`Calcetines ${i + 2} pares`, null, { status })
      )
    );
    expect(moves.map((move) => move.status)).toEqual(statuses);
    expect(countLines({ rows: 4, unkeyed: 0, moves }, 0)).toEqual([
      'rows 4',
      'unkeyed 0',
      'moves 4',
      'moves-active 1',
      'moves-unresolved 1',
      'moves-other 2',
      'collisions 0',
      'active-runs 0',
    ]);
  });

  it('reads only the chain it is asked about', async () => {
    const query = jest.fn(async () => []);
    await pendingMoves({ query }, DEZA);
    expect(query).toHaveBeenCalledWith(CHAIN_ROWS_SQL, [DEZA]);
    expect(CHAIN_ROWS_SQL).toContain('"supermarketId" = $1');
  });
});

describe('deza keys: collisions (section 4)', () => {
  it('skips a moved row whose new key another row holds, and names the holder', () => {
    const moving = row('Yogur 2X125 g', null);
    const holder = row('Yogur', '2x125 g');

    const selection = selectMoves([moving, holder]);

    expect(selection.moves).toEqual([
      expect.objectContaining({
        id: moving.id,
        collision: true,
        holder: holder.id,
      }),
    ]);
    expect(rekeyable(selection)).toEqual([]);
  });

  it('counts a leaflet row as a holder', () => {
    const moving = row('Calcetines 3 pares', null);
    const leaflet = row('Calcetines', '3 pares', {
      sourceKind: 'OFFICIAL_LEAFLET',
    });
    expect(selectMoves([moving, leaflet]).moves[0].collision).toBe(true);
  });

  it('skips both of two moved rows that give one new key', () => {
    const a = row('Calcetines 3 pares', null);
    const b = row('Calcetines 3', 'pares');

    const selection = selectMoves([a, b]);

    expect(selection.moves).toEqual([
      expect.objectContaining({ id: a.id, collision: true, holder: null }),
      expect.objectContaining({ id: b.id, collision: true, holder: null }),
    ]);
  });

  it('leaves both kinds out of the guard count', async () => {
    const rows = [
      row('Yogur 2X125 g', null),
      row('Yogur', '2x125 g'),
      row('Calcetines 3 pares', null),
      row('Calcetines 3', 'pares'),
      row('Toalla 2 u', null, { externalId: 'unkeyed' }),
    ];
    const db = { query: async () => rows };
    await expect(pendingMoves(db as never, DEZA)).resolves.toBe(0);
    rows.push(row('Bolsas 20 bolsitas', null));
    await expect(pendingMoves(db as never, DEZA)).resolves.toBe(1);
  });
});

describe('deza keys: the arguments', () => {
  it('reads --count, and --max with an optional record file', () => {
    expect(parseDezaKeysArgs(['--count'])).toEqual({ mode: 'count' });
    expect(parseDezaKeysArgs(['--max', '140'])).toEqual({
      mode: 'write',
      max: 140,
      record: DEFAULT_RECORD,
    });
    expect(parseDezaKeysArgs(['--record', '/tmp/r.tsv', '--max', '0'])).toEqual(
      { mode: 'write', max: 0, record: '/tmp/r.tsv' }
    );
  });

  it.each([
    [[]],
    [['--max']],
    [['--max', 'ten']],
    [['--record', '/tmp/r.tsv']],
    [['--count', '--max', '1']],
    [['--max', '1', '--max', '2']],
    [['--maxx', '1']],
  ])('refuses %j', (argv) => {
    expect(() => parseDezaKeysArgs(argv)).toThrow('usage');
  });
});

/**
 * An in memory harvester database that answers the command's SQL, and a
 * transaction that puts every row back when its work throws.
 */
function fakeDb(state: {
  chains: string[];
  rows: Map<
    string,
    (StoredRow & { supermarketId: string; itemId: string | null })[]
  >;
  activeRuns?: number;
  /** Throws on the update with this index, counted from 1. */
  failOnUpdate?: number;
  /** Answers every update as done and changes nothing. */
  ignoreUpdates?: boolean;
  /** Runs after each update, to change what the snapshot reads. */
  afterUpdate?: (
    row: StoredRow & { supermarketId: string; itemId: string | null }
  ) => void;
  /** The price, availability and presence counts. */
  joined?: () => { prices: number; availability: number; presence: number };
}) {
  const writes: string[] = [];
  let updates = 0;
  const all = (chains?: unknown) =>
    [...state.rows.entries()]
      .filter(([chain]) => !Array.isArray(chains) || chains.includes(chain))
      .flatMap(([, rows]) => rows);
  const query = async <T>(
    sql: string,
    params: unknown[] = []
  ): Promise<T[]> => {
    const answer = (value: unknown[]) => value as T[];
    switch (sql) {
      case DEZA_SOURCES_SQL:
        return answer(state.chains.map((supermarketId) => ({ supermarketId })));
      case CHAIN_ROWS_SQL:
        return answer(
          (state.rows.get(String(params[0])) ?? []).map((r) => ({ ...r }))
        );
      case ACTIVE_RUNS_SQL:
        return answer([{ n: state.activeRuns ?? 0 }]);
      case LOCK_SQL:
        writes.push('lock');
        return [];
      case STATUS_COUNTS_SQL: {
        const counts = new Map<string, number>();
        for (const r of all(params[0])) {
          const key = `${r.status} NONE`;
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        return answer(
          [...counts.entries()].map(([key, n]) => {
            const [status, matchedBy] = key.split(' ');
            return { status, matchedBy, n };
          })
        );
      }
      case DECISIONS_SQL:
        return answer([
          {
            rows: all(params[0]).length,
            bound: all(params[0]).filter((r) => r.itemId).length,
            decisions: all(params[0])
              .map((r) => `${r.id}:${r.itemId}:${r.status}`)
              .sort()
              .join(','),
          },
        ]);
      case JOINED_SQL:
        return answer([
          state.joined?.() ?? { prices: 3, availability: 2, presence: 1 },
        ]);
      case REKEY_SQL: {
        updates += 1;
        if (state.failOnUpdate === updates) {
          throw new Error('the connection dropped');
        }
        const [id, newKey, name, sizeFormat, oldKey] = params as string[];
        const target = all().find(
          (r) => r.id === id && r.externalId === oldKey
        );
        if (!target) {
          return [];
        }
        if (state.ignoreUpdates) {
          return answer([{ id }]);
        }
        // The unique index uq_source_catalog_entry, which refuses an update
        // onto a key another row of the chain still holds.
        if (
          all([target.supermarketId]).some(
            (r) => r.id !== id && r.externalId === newKey
          )
        ) {
          throw Object.assign(new Error('duplicate key'), { code: '23505' });
        }
        Object.assign(target, { externalId: newKey, name, sizeFormat });
        state.afterUpdate?.(target);
        writes.push(id);
        return answer([{ id }]);
      }
      default:
        throw new Error(`unexpected SQL: ${sql.slice(0, 60)}`);
    }
  };
  const db: DezaKeysDb = {
    query,
    transaction: async (work) => {
      const saved = new Map(
        [...state.rows.entries()].map(([k, v]) => [k, v.map((r) => ({ ...r }))])
      );
      try {
        return await work({ query });
      } catch (error) {
        state.rows = saved;
        throw error;
      }
    },
  };
  return { db, writes };
}

describe('deza keys: the command', () => {
  function chainRows() {
    return [
      {
        ...row('Calcetines 3 pares', null),
        supermarketId: DEZA,
        itemId: 'i-1',
      },
      {
        ...row('Yogur 2X125 g', null, { status: 'UNRESOLVED' }),
        supermarketId: DEZA,
        itemId: null,
      },
      { ...row('Leche', '1 L'), supermarketId: DEZA, itemId: 'i-2' },
    ];
  }

  function ports(db: DezaKeysDb) {
    const lines: string[] = [];
    const files = new Map<string, string>();
    return {
      lines,
      files,
      ports: {
        db,
        files: {
          write: async (path: string, text: string) => {
            files.set(path, text);
          },
        },
        log: (line: string) => lines.push(line),
      },
    };
  }

  it('prints rows 0 and every other line 0 with no DEZA source', async () => {
    const { db } = fakeDb({ chains: [], rows: new Map() });
    const out = ports(db);
    await runDezaKeys(out.ports, { mode: 'count' });
    expect(out.lines).toEqual([
      'rows 0',
      'unkeyed 0',
      'moves 0',
      'moves-active 0',
      'moves-unresolved 0',
      'moves-other 0',
      'collisions 0',
      'active-runs 0',
    ]);
  });

  it('counts without writing, and a write run then a count print moves 0', async () => {
    const state = {
      chains: [DEZA],
      rows: new Map([
        [DEZA, chainRows()],
        [
          OTHER,
          [
            {
              ...row('Calcetines 4 pares', null),
              supermarketId: OTHER,
              itemId: null,
            },
          ],
        ],
      ]),
    };
    const { db, writes } = fakeDb(state);

    const counted = ports(db);
    await runDezaKeys(counted.ports, { mode: 'count' });
    expect(counted.lines).toContain('moves 2');
    expect(writes).toEqual([]);

    const written = ports(db);
    await runDezaKeys(written.ports, {
      mode: 'write',
      max: 2,
      record: 'r.tsv',
    });
    expect(written.lines.at(-1)).toBe('rekeyed 2');
    expect(written.lines).toContain('before status ACTIVE NONE 2');
    expect(written.lines).toContain('after status ACTIVE NONE 2');
    // The other chain is not DEZA's and was never read.
    expect(state.rows.get(OTHER)?.[0].name).toBe('Calcetines 4 pares');

    const again = ports(db);
    await runDezaKeys(again.ports, { mode: 'count' });
    expect(again.lines).toContain('moves 0');

    // The record: ids and keys, no name.
    const record = written.files.get('r.tsv') ?? '';
    expect(record.split('\n')[0]).toBe(
      'entry_id\told_key\tnew_key\toutcome\tnew_key_holder'
    );
    expect(record.trim().split('\n')).toHaveLength(3);
    expect(record).not.toMatch(/Calcetines|Yogur/);
    // Nothing the command printed names a product either.
    expect(written.lines.join('\n')).not.toMatch(
      /Calcetines|Yogur|[0-9a-f]{40}/
    );
  });

  it('refuses above --max before any write', async () => {
    const { db, writes } = fakeDb({
      chains: [DEZA],
      rows: new Map([[DEZA, chainRows()]]),
    });
    await expect(
      runDezaKeys(ports(db).ports, { mode: 'write', max: 1, record: 'r.tsv' })
    ).rejects.toThrow('2 moves, above 1');
    expect(writes.filter((w) => w !== 'lock')).toEqual([]);
  });

  it('refuses while a run of the chain is in flight', async () => {
    const { db, writes } = fakeDb({
      chains: [DEZA],
      rows: new Map([[DEZA, chainRows()]]),
      activeRuns: 1,
    });
    await expect(
      runDezaKeys(ports(db).ports, { mode: 'write', max: 10, record: 'r.tsv' })
    ).rejects.toThrow('PENDING or RUNNING');
    expect(writes).toEqual([]);
  });

  it('leaves no row re-keyed when the last update fails', async () => {
    const state = {
      chains: [DEZA],
      rows: new Map([[DEZA, chainRows()]]),
      failOnUpdate: 2,
    };
    const { db } = fakeDb(state);
    const before = JSON.stringify(state.rows.get(DEZA));
    const out = ports(db);

    await expect(
      runDezaKeys(out.ports, { mode: 'write', max: 10, record: 'r.tsv' })
    ).rejects.toThrow('the connection dropped');

    expect(JSON.stringify(state.rows.get(DEZA))).toBe(before);
    expect(out.files.size).toBe(0);
  });

  it('records a collision and does not write it', async () => {
    const moving = {
      ...row('Yogur 2X125 g', null),
      supermarketId: DEZA,
      itemId: 'i-1',
    };
    const holder = {
      ...row('Yogur', '2x125 g'),
      supermarketId: DEZA,
      itemId: 'i-2',
    };
    const { db, writes } = fakeDb({
      chains: [DEZA],
      rows: new Map([[DEZA, [moving, holder]]]),
    });
    const out = ports(db);

    await runDezaKeys(out.ports, { mode: 'write', max: 10, record: 'r.tsv' });

    expect(writes).toEqual(['lock']);
    expect(out.lines.at(-1)).toBe('rekeyed 0');
    expect(out.lines).toContain('collisions 1');
    expect(out.files.get('r.tsv')).toContain(
      `${moving.id}\t${moving.externalId}\t${holder.externalId}\tcollision\t${holder.id}`
    );
  });
});

describe('deza keys: what a failure prints', () => {
  it('prints a database error by its code, never its text', () => {
    const error = Object.assign(new Error('Key ("externalId")=(abc) exists'), {
      name: 'QueryFailedError',
      code: '23505',
    });
    expect(describeError(error)).toBe(
      'the command failed: QueryFailedError 23505'
    );
  });

  it('prints its own refusal whole', () => {
    expect(describeError(new Error('usage: x'))).toBe('usage: x');
  });

  it('writes a record line per moved row, in id order', () => {
    const a = row('Calcetines 3 pares', null);
    const b = row('Yogur 2X125 g', null);
    const text = recordOf(selectMoves([b, a]).moves);
    expect(text.split('\n')[1].startsWith(a.id)).toBe(true);
  });

  it('prints a failed query that has no code by its name alone', () => {
    const error = Object.assign(new Error('the text of the driver'), {
      name: 'QueryFailedError',
      query: 'UPDATE source_catalog_entries',
      parameters: ['Zumo'],
    });
    expect(describeError(error)).toBe('the command failed: QueryFailedError');
  });
});

/**
 * Rows whose moves depend on each other (the review of PR #1016). The texts
 * differ only in a comma, which the key ignores and the split does not: each
 * one splits at another place, so the keys meet.
 *
 * - `chainEnd` stored (`Zumo`, `3 x 187 ml,`) moves to `Zumo 3 x 187 ml,`
 *   with no size, a key nobody holds.
 * - `chainMiddle` stored (`Zumo 3 x`, `187 ml`) moves to (`Zumo`,
 *   `3 x 187 ml`): the key `chainEnd` holds.
 * - `chainStart` stored (`Zumo 3`, `x, 187 ml`) moves to (`Zumo 3 x,`,
 *   `187 ml`): the key `chainMiddle` holds.
 * - `ringCloser` stored (`Zumo 3 x, 187 ml`) with no size moves to that same
 *   key, and holds the key `chainEnd` moves to: with it the three are a ring.
 */
const chainEnd = () => row('Zumo', '3 x 187 ml,');
const chainMiddle = () => row('Zumo 3 x', '187 ml');
const chainStart = () => row('Zumo 3', 'x, 187 ml');
const ringCloser = () => row('Zumo 3 x, 187 ml', null);

describe('deza keys: moves that depend on each other (section 4)', () => {
  it('resolves a chain of two in one selection, the free key first', () => {
    const end = chainEnd();
    const middle = chainMiddle();

    const selection = selectMoves([middle, end]);

    expect(selection.moves).toEqual([
      expect.objectContaining({
        id: middle.id,
        newKey: end.externalId,
        collision: false,
        holder: end.id,
        step: 1,
      }),
      expect.objectContaining({ id: end.id, collision: false, step: 0 }),
    ]);
    expect(rekeyable(selection).map((move) => move.id)).toEqual([
      end.id,
      middle.id,
    ]);
  });

  it('resolves a chain of three', () => {
    const end = chainEnd();
    const middle = chainMiddle();
    const start = chainStart();

    const selection = selectMoves([start, middle, end]);

    expect(selection.moves.every((move) => !move.collision)).toBe(true);
    expect(rekeyable(selection).map((move) => move.id)).toEqual([
      end.id,
      middle.id,
      start.id,
    ]);
    expect(countLines(selection, 0)).toContain('collisions 0');
  });

  it('skips both rows of a swap', () => {
    const whole = row('Calcetines 3 pares', null);
    const split = row('Calcetines', '3 pares,');

    const selection = selectMoves([whole, split]);

    expect(selection.moves).toEqual([
      expect.objectContaining({
        id: whole.id,
        newKey: split.externalId,
        collision: true,
        holder: split.id,
      }),
      expect.objectContaining({
        id: split.id,
        newKey: whole.externalId,
        collision: true,
        holder: whole.id,
      }),
    ]);
    expect(rekeyable(selection)).toEqual([]);
  });

  it('skips every row of a ring of three', () => {
    const selection = selectMoves([chainEnd(), chainMiddle(), ringCloser()]);
    expect(selection.moves).toHaveLength(3);
    expect(selection.moves.every((move) => move.collision)).toBe(true);
  });

  it('skips a whole chain whose last key a row that does not move holds', () => {
    const end = chainEnd();
    const middle = chainMiddle();
    // A leaflet row on the key the end of the chain wants.
    const leaflet = row('Zumo 3 x 187 ml', null, {
      sourceKind: 'OFFICIAL_LEAFLET',
    });

    const selection = selectMoves([middle, end, leaflet]);

    expect(selection.moves).toEqual([
      expect.objectContaining({
        id: middle.id,
        collision: true,
        holder: end.id,
      }),
      expect.objectContaining({
        id: end.id,
        collision: true,
        holder: leaflet.id,
      }),
    ]);
    expect(countLines(selection, 0)).toContain('collisions 2');
  });

  it('counts a chain as pending for the guard', async () => {
    const rows = [chainStart(), chainMiddle(), chainEnd()];
    await expect(
      pendingMoves({ query: async () => rows } as never, DEZA)
    ).resolves.toBe(3);
  });
});

describe('deza keys: the command over moves that depend on each other', () => {
  function portsOf(db: DezaKeysDb) {
    const lines: string[] = [];
    const files = new Map<string, string>();
    return {
      lines,
      files,
      ports: {
        db,
        files: {
          write: async (path: string, text: string) => {
            files.set(path, text);
          },
        },
        log: (line: string) => lines.push(line),
      },
    };
  }

  function chainState() {
    return {
      chains: [DEZA],
      rows: new Map([
        [
          DEZA,
          [chainStart(), chainMiddle(), chainEnd()].map((r, i) => ({
            ...r,
            supermarketId: DEZA,
            itemId: `i-${i}` as string | null,
          })),
        ],
      ]),
    };
  }

  it('re-keys a chain of three in one run, with the counts --count printed', async () => {
    const state = chainState();
    const ids = (state.rows.get(DEZA) ?? []).map((r) => r.id);
    const { db, writes } = fakeDb(state);

    const counted = portsOf(db);
    await runDezaKeys(counted.ports, { mode: 'count' });
    expect(counted.lines).toContain('moves 3');
    expect(counted.lines).toContain('collisions 0');

    const written = portsOf(db);
    await runDezaKeys(written.ports, { mode: 'write', max: 3, record: '-' });

    // The write reports first exactly what --count printed.
    expect(written.lines.slice(0, counted.lines.length)).toEqual(counted.lines);
    expect(written.lines.at(-1)).toBe('rekeyed 3');
    // The holder of each key moved before the row that wanted it, past the
    // unique index the fake enforces.
    expect(writes).toEqual(['lock', ids[2], ids[1], ids[0]]);
    for (const r of state.rows.get(DEZA) ?? []) {
      expect(r.externalId).toBe(entryKey(r.name, r.sizeFormat));
    }

    const again = portsOf(db);
    await runDezaKeys(again.ports, { mode: 'count' });
    expect(again.lines).toContain('moves 0');
    expect(again.lines).toContain('collisions 0');
  });

  it('streams the record after the commit, behind its prefix, and counts it', async () => {
    const { db } = fakeDb(chainState());
    const out = portsOf(db);

    await runDezaKeys(out.ports, { mode: 'write', max: 3, record: '-' });

    const record = out.lines.filter((line) => line.startsWith('record\t'));
    expect(record).toHaveLength(4);
    expect(record[0]).toBe(
      'record\tentry_id\told_key\tnew_key\toutcome\tnew_key_holder'
    );
    expect(out.lines).toContain('record-end 4');
    const committed = out.lines.indexOf('committed 3');
    expect(committed).toBeGreaterThan(-1);
    expect(out.lines.indexOf(record[0])).toBe(committed + 1);
    expect(out.files.size).toBe(0);
    // Every other line is a count: no key, no id, no name.
    expect(
      out.lines.filter((line) => !line.startsWith('record\t')).join('\n')
    ).not.toMatch(/Zumo|e-\d{4}|[0-9a-f]{40}/);
  });

  it('writes neither row of a swap', async () => {
    const swap = [
      row('Calcetines 3 pares', null),
      row('Calcetines', '3 pares,'),
    ].map((r) => ({ ...r, supermarketId: DEZA, itemId: null }));
    const state = { chains: [DEZA], rows: new Map([[DEZA, swap]]) };
    const before = JSON.stringify(swap);
    const { db, writes } = fakeDb(state);
    const out = portsOf(db);

    await runDezaKeys(out.ports, { mode: 'write', max: 2, record: 'r.tsv' });

    expect(out.lines).toContain('collisions 2');
    expect(out.lines.at(-1)).toBe('rekeyed 0');
    expect(writes).toEqual(['lock']);
    expect(JSON.stringify(state.rows.get(DEZA))).toBe(before);
  });

  it('refuses to commit when a decision changed under the updates', async () => {
    const state = {
      ...chainState(),
      afterUpdate: (r: { itemId: string | null }) => {
        r.itemId = null;
      },
    };
    const before = JSON.stringify(state.rows.get(DEZA));
    const { db } = fakeDb(state);
    const out = portsOf(db);

    await expect(
      runDezaKeys(out.ports, { mode: 'write', max: 3, record: '-' })
    ).rejects.toThrow('the decision of a row changed');
    expect(JSON.stringify(state.rows.get(DEZA))).toBe(before);
    expect(out.lines).not.toContain('committed 3');
  });

  it('refuses to commit when a count of section 7.1 changed', async () => {
    let prices = 3;
    const state = {
      ...chainState(),
      afterUpdate: () => {
        prices = 2;
      },
      joined: () => ({ prices, availability: 2, presence: 1 }),
    };
    const { db } = fakeDb(state);

    await expect(
      runDezaKeys(portsOf(db).ports, { mode: 'write', max: 3, record: '-' })
    ).rejects.toThrow('a count of section 7.1 changed');
  });

  it('refuses to commit when a row it re-keys is still to re-key after the run', async () => {
    const state = { ...chainState(), ignoreUpdates: true };
    const { db } = fakeDb(state);
    const out = portsOf(db);

    await expect(
      runDezaKeys(out.ports, { mode: 'write', max: 3, record: '-' })
    ).rejects.toThrow('3 rows the selection re-keys are still to re-key');
    expect(out.lines.some((line) => line.startsWith('committed'))).toBe(false);
  });
});
