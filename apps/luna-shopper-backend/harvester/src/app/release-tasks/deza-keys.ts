import { splitSize } from '@portfolio/luna-shopper/deza';
import { entryKey } from '../harvest/matching';

/**
 * The stored DEZA walk rows whose key the deployed size split no longer
 * builds, and the command that re-keys them (backend plan 0272).
 *
 * A DEZA row is keyed on `entryKey(name, sizeFormat)`, and `name` and
 * `sizeFormat` are one call of `splitSize` over the printed description. A
 * change of the split thus moves keys: the next walk does not find the stored
 * row, writes a new one beside it, and the row a person bound to a product is
 * no longer seen. This module answers which rows move, from the stored text
 * alone, with the same `splitSize` and `entryKey` the walk calls. It holds no
 * rule of its own, so it serves every later change of the split too (D6).
 *
 * **One selection, two callers.** The release task's command
 * (`deza-keys.js`) and the guard that refuses a DEZA walk while a move exists
 * (section 5) both read {@link selectMoves}. A guard with a second copy of the
 * selection could disagree with the task it waits for.
 *
 * **What it prints.** Numbers only. `check.sh` and `post.sh` print the
 * command's output into the deploy log, which is public. The record of
 * section 4.1 holds ids and keys and no name. It goes to a file, or with
 * `--record -` to standard output behind {@link RECORD_PREFIX}, which
 * `post.sh` takes out into a file and never prints.
 */

/** The adapter whose walk keys its rows on the split. */
export const DEZA_ADAPTER = 'deza-web';

/** The release task that runs the command, which a refusal names. */
export const DEZA_KEYS_TASK =
  'k8s/release-tasks/tasks/0008-deza-keys-follow-the-split';

/** The kind of row a walk owns (plan 0190). A leaflet row is never touched. */
const WALK_KIND = 'OFFICIAL_WEB';

/** One stored row of the chain, of any kind, as the selection reads it. */
export interface StoredRow {
  id: string;
  externalId: string;
  name: string;
  sizeFormat: string | null;
  status: string;
  sourceKind: string;
}

/** One walk row whose stored key the split no longer builds. */
export interface Move {
  id: string;
  status: string;
  oldKey: string;
  newKey: string;
  /** The name and the size text the split builds, written with the key. */
  name: string;
  sizeFormat: string | null;
  /**
   * Whether section 4 skips it: its new key is held by a row that keeps it,
   * another moved row gives the same new key, or it is on a cycle of moves.
   */
  collision: boolean;
  /**
   * The id of the row that holds the new key now, or null for a free key and
   * for two moved rows.
   */
  holder: string | null;
  /**
   * When the write applies it, or null for a collision: 0 for a free key,
   * one more than its holder's step when the holder moves out of the key.
   */
  step: number | null;
}

/** What {@link selectMoves} found in one chain, or in several added up. */
export interface Selection {
  /** The walk rows of the chain that the selection read. */
  rows: number;
  /** Walk rows whose stored key is not `entryKey` of their stored text. */
  unkeyed: number;
  /** Every moved row, collisions included. */
  moves: Move[];
}

/**
 * The description the parser read, rebuilt from the stored pair: the name,
 * one space and the size text, or the name alone (plan 0270, section 5.3).
 */
export function descriptionOf(name: string, sizeFormat: string | null): string {
  return sizeFormat === null || sizeFormat === ''
    ? name
    : `${name} ${sizeFormat}`;
}

/**
 * Section 1 and section 4 over the rows of one chain. Pure: the same rows
 * always answer the same selection.
 *
 * 1. Only walk rows (`OFFICIAL_WEB`).
 * 2. Only rows whose stored key the stored text proves (`isNameKeyed`). The
 *    rest are counted as `unkeyed` and never touched.
 * 3. Every status.
 * 4. The row moves when the key the split builds from its description is not
 *    its stored key.
 *
 * A moved row is a collision when its new key cannot be reached inside one
 * run. The moves are resolved to a fixed point: a key counts as held only by
 * a row that keeps it after every move that can be made.
 *
 * - **Free.** No row holds the new key: the row moves, at step 0.
 * - **A chain.** The holder of the new key moves itself, and its move is not
 *   a collision: the row moves one step after its holder, which has left the
 *   key by then. A chain of any length thus resolves in one run.
 * - **Held.** A row that does not move holds the new key: a leaflet row, an
 *   unkeyed row, a row the split already built, or a moved row that is itself
 *   a collision. The row is a collision, and so is every row whose chain ends
 *   on it.
 * - **Shared.** Two or more moved rows give one new key: each is a collision.
 * - **A cycle.** A swap, or a longer ring of rows each wanting the next one's
 *   key: no order of updates frees a key first, so each is a collision.
 *
 * The step is the order the write applies the moves in, so that the unique
 * index `uq_source_catalog_entry` never sees two rows on one key.
 */
export function selectMoves(rows: StoredRow[]): Selection {
  const holders = new Map<string, string>();
  for (const row of rows) {
    holders.set(row.externalId, row.id);
  }

  let walkRows = 0;
  let unkeyed = 0;
  const moves: Move[] = [];
  for (const row of rows) {
    if (row.sourceKind !== WALK_KIND) {
      continue;
    }
    walkRows += 1;
    if (row.externalId !== entryKey(row.name, row.sizeFormat)) {
      unkeyed += 1;
      continue;
    }
    const split = splitSize(descriptionOf(row.name, row.sizeFormat));
    const newKey = entryKey(split.name, split.sizeFormat);
    if (newKey === row.externalId) {
      continue;
    }
    moves.push({
      id: row.id,
      status: row.status,
      oldKey: row.externalId,
      newKey,
      name: split.name,
      sizeFormat: split.sizeFormat,
      collision: false,
      holder: holders.get(newKey) ?? null,
      step: null,
    });
  }

  const byNewKey = new Map<string, number>();
  for (const move of moves) {
    byNewKey.set(move.newKey, (byNewKey.get(move.newKey) ?? 0) + 1);
  }
  const shared = (move: Move) => (byNewKey.get(move.newKey) ?? 0) > 1;
  const moveOf = new Map(moves.map((move) => [move.id, move]));

  // The step of every move, or null for a collision. Each key has one holder
  // and, outside the shared keys, one row that wants it, so following the
  // holders from a move is a path: it ends on a free key, on a row that does
  // not move, or comes back to itself. Walked without recursion, because a
  // chain can be as long as the chain has rows.
  const settled = new Map<string, number | null>();
  for (const start of moves) {
    const path: Move[] = [];
    const onPath = new Set<string>();
    let current = start;
    let outcome: number | null;
    for (;;) {
      const known = settled.get(current.id);
      if (known !== undefined) {
        outcome = known;
        break;
      }
      if (onPath.has(current.id)) {
        // A cycle: every row on it, and every row whose chain reaches it.
        outcome = null;
        break;
      }
      if (shared(current)) {
        outcome = null;
        settled.set(current.id, null);
        break;
      }
      const holder = holders.get(current.newKey);
      if (holder === undefined) {
        outcome = 0;
        settled.set(current.id, 0);
        break;
      }
      const next = moveOf.get(holder);
      if (!next) {
        outcome = null;
        settled.set(current.id, null);
        break;
      }
      path.push(current);
      onPath.add(current.id);
      current = next;
    }
    for (let i = path.length - 1; i >= 0; i -= 1) {
      outcome = outcome === null ? null : outcome + 1;
      settled.set(path[i].id, outcome);
    }
  }

  for (const move of moves) {
    move.step = settled.get(move.id) ?? null;
    move.collision = move.step === null;
    if (shared(move)) {
      move.holder = null;
    }
  }
  return { rows: walkRows, unkeyed, moves };
}

/**
 * The moves section 4 does not skip: the rows the task re-keys, in the order
 * that frees each key before the row that wants it is written.
 */
export function rekeyable(selection: Selection): Move[] {
  return selection.moves
    .filter((move) => !move.collision)
    .sort((a, b) => (a.step ?? 0) - (b.step ?? 0));
}

/** Two selections added up, for a database with more than one DEZA source. */
function sum(a: Selection, b: Selection): Selection {
  return {
    rows: a.rows + b.rows,
    unkeyed: a.unkeyed + b.unkeyed,
    moves: [...a.moves, ...b.moves],
  };
}

/** Anything that answers SQL, a pool or a transaction. */
export interface Sql {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
}

export const DEZA_SOURCES_SQL = `
SELECT "supermarketId"::text AS "supermarketId"
  FROM supermarket_sources
 WHERE "adapterKey" = '${DEZA_ADAPTER}'
 ORDER BY 1`;

/** Every row of the chain, of any kind: a leaflet row can hold a key too. */
export const CHAIN_ROWS_SQL = `
SELECT e.id::text AS id, e."externalId", e.name, e."sizeFormat",
       e.status::text AS status, e."sourceKind"::text AS "sourceKind"
  FROM source_catalog_entries e
 WHERE e."supermarketId" = $1`;

export const ACTIVE_RUNS_SQL = `
SELECT count(*)::int AS n
  FROM harvest_runs
 WHERE "supermarketId" = ANY($1::uuid[])
   AND status IN ('PENDING', 'RUNNING')`;

/** The rows of one chain, read for {@link selectMoves}. */
export async function readChain(
  db: Sql,
  supermarketId: string
): Promise<StoredRow[]> {
  const raw = await db.query<Record<string, unknown>>(CHAIN_ROWS_SQL, [
    supermarketId,
  ]);
  return raw.map((row) => ({
    id: String(row['id']),
    externalId: String(row['externalId']),
    name: String(row['name']),
    sizeFormat: (row['sizeFormat'] as string | null) ?? null,
    status: String(row['status']),
    sourceKind: String(row['sourceKind']),
  }));
}

/** The chains whose source walks the DEZA site. Usually one, or none. */
export async function readDezaChains(db: Sql): Promise<string[]> {
  return (await db.query<{ supermarketId: string }>(DEZA_SOURCES_SQL)).map(
    (row) => String(row.supermarketId)
  );
}

/** The selection over every DEZA chain. No source row answers `rows 0`. */
export async function readSelection(
  db: Sql,
  chains: string[]
): Promise<Selection> {
  let selection: Selection = { rows: 0, unkeyed: 0, moves: [] };
  for (const chain of chains) {
    selection = sum(selection, selectMoves(await readChain(db, chain)));
  }
  return selection;
}

/** The runs of the chains that are PENDING or RUNNING. */
export async function readActiveRuns(
  db: Sql,
  chains: string[]
): Promise<number> {
  if (chains.length === 0) {
    return 0;
  }
  const [row] = await db.query<{ n: number }>(ACTIVE_RUNS_SQL, [chains]);
  return Number(row?.n ?? 0);
}

/**
 * The guard's question (section 5.1): how many rows of this chain the task
 * would re-key. Collisions and unkeyed rows do not count, because the task
 * never changes them, and counting them would refuse every walk for ever.
 */
export async function pendingMoves(
  db: Sql,
  supermarketId: string
): Promise<number> {
  return rekeyable(selectMoves(await readChain(db, supermarketId))).length;
}

/**
 * The sentence a DEZA walk is refused with while a move exists. It names the
 * task and the command, and no row.
 */
export function dezaKeysRefusal(pending: number): string {
  return (
    `${pending} stored DEZA rows hold a key that the deployed size split no ` +
    'longer builds, and a walk now would leave each of them behind. They wait ' +
    `for the release task that runs deza-keys.js (${DEZA_KEYS_TASK}), which ` +
    're-keys them after the rollout. Start the walk again after it has run.'
  );
}

/** The count lines of section 3, which both shell files read. */
export function countLines(selection: Selection, activeRuns: number): string[] {
  const moves = selection.moves;
  const of = (status: string) =>
    moves.filter((move) => move.status === status).length;
  const active = of('ACTIVE');
  const unresolved = of('UNRESOLVED');
  return [
    `rows ${selection.rows}`,
    `unkeyed ${selection.unkeyed}`,
    `moves ${moves.length}`,
    `moves-active ${active}`,
    `moves-unresolved ${unresolved}`,
    `moves-other ${moves.length - active - unresolved}`,
    `collisions ${moves.filter((move) => move.collision).length}`,
    `active-runs ${activeRuns}`,
  ];
}

/**
 * The state section 7.1 holds equal before and after a write run, over every
 * row of the chains: the number of rows, the counts by status and match, a
 * digest of every row's decision, and the rows that hang off them.
 */
export interface Snapshot {
  statusLines: string[];
  rows: number;
  bound: number;
  /** An md5 over every row's id, item, proposal, confidence and decision time. */
  decisions: string;
  prices: number;
  availability: number;
  presence: number;
}

export const STATUS_COUNTS_SQL = `
SELECT e.status::text AS status,
       coalesce(e."matchedBy"::text, 'NONE') AS "matchedBy",
       count(*)::int AS n
  FROM source_catalog_entries e
 WHERE e."supermarketId" = ANY($1::uuid[])
 GROUP BY 1, 2
 ORDER BY 1, 2`;

export const DECISIONS_SQL = `
SELECT count(*)::int AS rows,
       count(e."itemId")::int AS bound,
       md5(coalesce(string_agg(
         e.id::text || ':' || coalesce(e."itemId"::text, '') || ':' ||
         coalesce(e."candidateEntryId"::text, '') || ':' ||
         e.status::text || ':' || coalesce(e."matchedBy"::text, '') || ':' ||
         e.confidence::text || ':' || coalesce(e."decidedAt"::text, ''),
         ',' ORDER BY e.id), '')) AS decisions
  FROM source_catalog_entries e
 WHERE e."supermarketId" = ANY($1::uuid[])`;

export const JOINED_SQL = `
SELECT
  (SELECT count(*) FROM source_entry_prices p
     JOIN source_catalog_entries e ON e.id = p."entryId"
    WHERE e."supermarketId" = ANY($1::uuid[]))::int AS prices,
  (SELECT count(*) FROM source_entry_availability a
     JOIN source_catalog_entries e ON e.id = a."entryId"
    WHERE e."supermarketId" = ANY($1::uuid[]))::int AS availability,
  (SELECT count(*) FROM source_entry_scope_presence s
     JOIN source_catalog_entries e ON e.id = s."entryId"
    WHERE e."supermarketId" = ANY($1::uuid[]))::int AS presence`;

export async function readSnapshot(
  db: Sql,
  chains: string[]
): Promise<Snapshot> {
  const statuses = await db.query<{
    status: string;
    matchedBy: string;
    n: number;
  }>(STATUS_COUNTS_SQL, [chains]);
  const [decisions] = await db.query<{
    rows: number;
    bound: number;
    decisions: string;
  }>(DECISIONS_SQL, [chains]);
  const [joined] = await db.query<{
    prices: number;
    availability: number;
    presence: number;
  }>(JOINED_SQL, [chains]);
  return {
    statusLines: statuses.map(
      (row) => `status ${row.status} ${row.matchedBy} ${Number(row.n)}`
    ),
    rows: Number(decisions?.rows ?? 0),
    bound: Number(decisions?.bound ?? 0),
    decisions: String(decisions?.decisions ?? ''),
    prices: Number(joined?.prices ?? 0),
    availability: Number(joined?.availability ?? 0),
    presence: Number(joined?.presence ?? 0),
  };
}

/** The lines of a snapshot the command prints. Numbers only, no digest. */
export function snapshotLines(snapshot: Snapshot): string[] {
  return [
    ...snapshot.statusLines,
    `chain-rows ${snapshot.rows}`,
    `bound ${snapshot.bound}`,
    `prices ${snapshot.prices}`,
    `availability ${snapshot.availability}`,
    `presence ${snapshot.presence}`,
  ];
}

/** What differs between two snapshots, or null when nothing does. */
export function snapshotDifference(
  before: Snapshot,
  after: Snapshot
): string | null {
  const a = [...snapshotLines(before), before.decisions].join('\n');
  const b = [...snapshotLines(after), after.decisions].join('\n');
  if (a === b) {
    return null;
  }
  if (before.decisions !== after.decisions) {
    return 'the decision of a row changed';
  }
  return 'a count of section 7.1 changed';
}

/** The update of section 3, step 4: three columns of one row, under its old key. */
export const REKEY_SQL = `
WITH moved AS (
  UPDATE source_catalog_entries
     SET "externalId" = $2, "name" = $3, "sizeFormat" = $4
   WHERE "id" = $1 AND "externalId" = $5
  RETURNING id
)
SELECT id::text AS id FROM moved`;

export const LOCK_SQL =
  'LOCK TABLE source_catalog_entries IN SHARE ROW EXCLUSIVE MODE';

export interface DezaKeysDb extends Sql {
  /** Runs `work` in one transaction: it commits when `work` resolves. */
  transaction<T>(work: (tx: Sql) => Promise<T>): Promise<T>;
}

export interface DezaKeysPorts {
  db: DezaKeysDb;
  files: { write(path: string, text: string): Promise<void> };
  log(line: string): void;
}

export type DezaKeysOptions =
  | { mode: 'count' }
  | { mode: 'write'; max: number; record: string };

/** Where the record goes when `--record` names no file. */
export const DEFAULT_RECORD = '/tmp/deza-keys-record.tsv';

/**
 * `--record -`: the record goes to standard output, beside the count lines,
 * each of its lines behind {@link RECORD_PREFIX}. `post.sh` takes the write
 * and its record from one `kubectl exec`, so no second call can lose it.
 */
export const STREAM_RECORD = '-';

/** What starts each streamed record line. No count line starts with it. */
export const RECORD_PREFIX = 'record\t';

/**
 * Reads `--count`, or `--max <n>` with an optional `--record <file>` or
 * `--record -`. Anything else is refused, so a typo never becomes a run
 * without a ceiling.
 */
export function parseDezaKeysArgs(argv: string[]): DezaKeysOptions {
  const usage =
    'usage: node deza-keys.js --count | --max <n> [--record <file> | -]';
  if (argv.length === 1 && argv[0] === '--count') {
    return { mode: 'count' };
  }
  const values: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (
      !['--max', '--record'].includes(flag) ||
      flag in values ||
      value === undefined ||
      value.startsWith('--') ||
      (flag === '--max' && !/^\d+$/.test(value))
    ) {
      throw new Error(usage);
    }
    values[flag] = value;
  }
  if (values['--max'] === undefined) {
    throw new Error(usage);
  }
  return {
    mode: 'write',
    max: Number(values['--max']),
    record: values['--record'] ?? DEFAULT_RECORD,
  };
}

const RECORD_HEADER = [
  'entry_id',
  'old_key',
  'new_key',
  'outcome',
  'new_key_holder',
];

/**
 * The record of section 4.1: one line per re-keyed or skipped row, tab
 * separated, with a header. Ids and keys, never a name.
 */
export function recordOf(moves: Move[]): string {
  const lines = [...moves]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((move) => [
      move.id,
      move.oldKey,
      move.newKey,
      move.collision ? 'collision' : 'rekeyed',
      move.collision ? (move.holder ?? '') : '',
    ]);
  return [RECORD_HEADER, ...lines]
    .map((cells) => cells.join('\t'))
    .join('\n')
    .concat('\n');
}

/** A refusal of the write run. Nothing was changed when it is thrown. */
export class DezaKeysRefusal extends Error {}

/**
 * The command. `--count` writes nothing. The write run re-keys every move
 * section 4 does not skip, in one transaction under a table lock, and
 * refuses to commit when a count of section 7.1 differs.
 */
export async function runDezaKeys(
  ports: DezaKeysPorts,
  options: DezaKeysOptions
): Promise<void> {
  await runDezaKeysOn(ports, options, await readDezaChains(ports.db));
}

/**
 * {@link runDezaKeys} over the chains given rather than every `deza-web`
 * source, so that a spec on a shared database reads its own chain alone.
 */
export async function runDezaKeysOn(
  ports: DezaKeysPorts,
  options: DezaKeysOptions,
  chains: string[]
): Promise<void> {
  const selection = await readSelection(ports.db, chains);
  const activeRuns = await readActiveRuns(ports.db, chains);
  for (const line of countLines(selection, activeRuns)) {
    ports.log(line);
  }
  if (options.mode === 'count') {
    return;
  }
  if (activeRuns > 0) {
    throw new DezaKeysRefusal(
      `Refused, and nothing was changed: ${activeRuns} runs of the chain are ` +
        'PENDING or RUNNING, and a run in flight writes rows of the chain.'
    );
  }

  const written = await ports.db.transaction(async (tx) => {
    await tx.query(LOCK_SQL);
    // Read again under the lock: no ingest writes a row from here on.
    const running = await readActiveRuns(tx, chains);
    if (running > 0) {
      throw new DezaKeysRefusal(
        `Refused, and nothing was changed: ${running} runs of the chain ` +
          'started while the command read.'
      );
    }
    const locked = await readSelection(tx, chains);
    if (locked.moves.length > options.max) {
      throw new DezaKeysRefusal(
        `Refused, and nothing was changed: ${locked.moves.length} moves, ` +
          `above ${options.max}.`
      );
    }
    const before = await readSnapshot(tx, chains);
    const moves = rekeyable(locked);
    for (const move of moves) {
      const updated = await tx.query<{ id: string }>(REKEY_SQL, [
        move.id,
        move.newKey,
        move.name,
        move.sizeFormat,
        move.oldKey,
      ]);
      if (updated.length !== 1) {
        throw new DezaKeysRefusal(
          'Refused, and nothing was changed: a row to re-key no longer held ' +
            'the key the command read.'
        );
      }
    }
    const after = await readSnapshot(tx, chains);
    const difference = snapshotDifference(before, after);
    if (difference) {
      throw new DezaKeysRefusal(
        `Refused, and nothing was changed: ${difference}.`
      );
    }
    // Every move was resolved before the first update, chains included, so
    // nothing the selection would re-key can be left once they are applied.
    // A row that is, is a selection that disagrees with its own write.
    const left = rekeyable(await readSelection(tx, chains)).length;
    if (left > 0) {
      throw new DezaKeysRefusal(
        `Refused, and nothing was changed: ${left} rows the selection ` +
          're-keys are still to re-key after the run.'
      );
    }
    return { before, after, moves: locked.moves, rekeyed: moves.length };
  });

  // The first line after the commit, so a caller that sees it knows the
  // updates are in, whatever is lost after it.
  ports.log(`committed ${written.rekeyed}`);
  if (written.moves.length > 0) {
    const record = recordOf(written.moves);
    if (options.record === STREAM_RECORD) {
      const lines = record.trimEnd().split('\n');
      for (const line of lines) {
        ports.log(`${RECORD_PREFIX}${line}`);
      }
      // The number of lines streamed, header included, so a caller can tell
      // a whole record from one cut short.
      ports.log(`record-end ${lines.length}`);
    } else {
      await ports.files.write(options.record, record);
    }
  }
  for (const line of snapshotLines(written.before)) {
    ports.log(`before ${line}`);
  }
  for (const line of snapshotLines(written.after)) {
    ports.log(`after ${line}`);
  }
  const now = await readSelection(ports.db, chains);
  for (const line of countLines(now, await readActiveRuns(ports.db, chains))) {
    ports.log(line);
  }
  ports.log(`rekeyed ${written.rekeyed}`);
}

/** The message of a failure that stops the command. Names no row. */
export function describe(error: unknown): string {
  if (error instanceof DezaKeysRefusal) {
    return error.message;
  }
  if (error instanceof Error) {
    // A database error carries a SQLSTATE and can quote a key in its text,
    // and the deploy log is public: its code is printed, never its text.
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') {
      return `the command failed: ${error.name} ${code}`;
    }
    // A failed query with no SQLSTATE, a client side driver error, still
    // carries the driver's text, and its query and parameters beside it.
    if ('query' in error || 'driverError' in error) {
      return `the command failed: ${error.name}`;
    }
    return error.message;
  }
  return 'the command failed';
}
