/**
 * The run directory: the only state this library keeps (plan 0001).
 *
 * A killed run resumes for free because everything a subcommand needs is on
 * disk between invocations. There are four files a walk reads, and a fifth
 * nothing reads back:
 *
 * - `state.json`: the run's identity, the two urls, the chain walk cursor, the
 *   ids already decided, the candidate set each row of the current batch was
 *   handed, and how many rows have had to be asked again because that set
 *   changed underneath them.
 * - `decisions.jsonl`: a header line, then one line per decided row.
 * - `brands.json`: the brand registry as `start` read it (plan 0004). Written
 *   once, never rewritten, and read by every later step, so one walk applies
 *   one registry from its first row to its last.
 * - `shared-eans.json`: which queued entries print an EAN another queued entry
 *   of their chain prints, as `start` read the queue (plan 0006). Written once,
 *   like `brands.json`.
 * - `brands-to-register.json`: what `propose-brands` suggests registering, as
 *   the body `POST /v1/admin/catalog/brands/register-many` takes. More than 200
 *   brands are split into `brands-to-register-2.json` and on, one body each.
 *   `brands-to-register.notes.json` beside them holds what a person reads while
 *   editing: each brand's key, spellings and entry count, and the chain ids a
 *   house label names. Nothing in a walk reads any of them.
 *
 * The decided ids live in `state.json` *and* are recoverable from the JSONL, on
 * purpose. `state.json` is rewritten whole and could be lost to a kill between
 * the append and the rewrite, so `load` reconciles the two and the JSONL wins.
 * An entry already in the file is never asked again.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const STATE_FILE = 'state.json';
const DECISIONS_FILE = 'decisions.jsonl';
const REPORT_FILE = 'report.json';
const BRANDS_FILE = 'brands.json';

export function statePath(dir) {
  return join(dir, STATE_FILE);
}

export function decisionsPath(dir) {
  return join(dir, DECISIONS_FILE);
}

export function reportPath(dir) {
  return join(dir, REPORT_FILE);
}

export function brandsPath(dir) {
  return join(dir, BRANDS_FILE);
}

/**
 * The brand registry as `start` read it, and the moment it read it (plan 0004).
 *
 * A third file beside the state and the decisions, written once and never
 * rewritten. It is separate from `state.json` because `state.json` is rewritten
 * whole on every step and the registry is the one thing in a run that must not
 * change under it: a resumed walk applies the brands it started with, the way
 * it already applies the `local` flag it started with.
 */
export function writeBrands(dir, snapshot) {
  const path = brandsPath(dir);
  writeFileSync(
    path,
    `${JSON.stringify(snapshot, null, 2)}
`,
    'utf8'
  );
  return path;
}

export function readBrands(dir) {
  const path = brandsPath(dir);
  if (!existsSync(path)) {
    throw new Error(
      `${path} does not exist. It is written by start, so this run directory was started before the brand registry existed. Start a new run.`
    );
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

const SHARED_EANS_FILE = 'shared-eans.json';
const BRANDS_TO_REGISTER_FILE = 'brands-to-register.json';
const BRANDS_TO_REGISTER_NOTES_FILE = 'brands-to-register.notes.json';
/** Every body file `writeBrandsToRegister` writes, and nothing else. */
const BRANDS_TO_REGISTER_PART = /^brands-to-register(-\d+)?\.json$/;

export function sharedEansPath(dir) {
  return join(dir, SHARED_EANS_FILE);
}

/** Body 1 is `brands-to-register.json`, body n is `brands-to-register-<n>.json`. */
export function brandsToRegisterPath(dir, part = 1) {
  return part === 1
    ? join(dir, BRANDS_TO_REGISTER_FILE)
    : join(dir, `brands-to-register-${part}.json`);
}

export function brandsToRegisterNotesPath(dir) {
  return join(dir, BRANDS_TO_REGISTER_NOTES_FILE);
}

/**
 * The queued entries whose EAN another queued entry of the same chain prints,
 * as `start` read the queue (plan 0006).
 *
 * `{ readAt, entries: { <entry id>: [<the other entry ids>] } }`. Written once,
 * beside `brands.json` and for the same reason: `state.json` is rewritten whole
 * on every step, and this is a snapshot every later step reads unchanged.
 */
export function writeSharedEans(dir, snapshot) {
  const path = sharedEansPath(dir);
  writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  return path;
}

/**
 * The snapshot, or an empty one for a run started before plan 0006.
 *
 * A missing file is not an error, unlike a missing `brands.json`: a run that
 * never indexed its EANs behaves exactly as it did when it was started.
 */
export function readSharedEans(dir) {
  const path = sharedEansPath(dir);
  if (!existsSync(path)) {
    return { readAt: null, entries: {} };
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * The brands `propose-brands` suggests registering, for a person to edit.
 *
 * `bodies` holds one request body per element, each `{ brands }`, and `notes`
 * is what the sibling notes file holds. The bodies of an earlier proposal are
 * removed first, so a directory never keeps a stale part a person might send.
 * Answers the body paths in order and the notes path.
 */
export function writeBrandsToRegister(dir, bodies, notes) {
  mkdirSync(dir, { recursive: true });
  for (const name of readdirSync(dir)) {
    if (BRANDS_TO_REGISTER_PART.test(name)) {
      rmSync(join(dir, name));
    }
  }
  const files = bodies.map((body, index) => {
    const path = brandsToRegisterPath(dir, index + 1);
    writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
    return path;
  });
  const notesFile = brandsToRegisterNotesPath(dir);
  writeFileSync(notesFile, `${JSON.stringify(notes, null, 2)}\n`, 'utf8');
  return { files, notesFile };
}

/** Every non empty line of a JSONL file, parsed. */
export function readJsonl(path) {
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line));
}

function appendJsonl(path, value) {
  appendFileSync(path, `${JSON.stringify(value)}\n`, 'utf8');
}

/**
 * Starts a run directory, or refuses to overwrite one.
 *
 * A second `start` against a directory that already holds a run is an error
 * rather than a reset: the decisions in it are the expensive part of a run, and
 * silently truncating them is the one mistake nothing else could undo.
 */
export function createRun(
  dir,
  {
    runId,
    mainUrl,
    rehearsalUrl,
    mainUser,
    model,
    local,
    chains,
    supermarkets,
    total,
  }
) {
  mkdirSync(dir, { recursive: true });
  if (existsSync(statePath(dir))) {
    throw new Error(
      `${statePath(dir)} already holds run ${readState(dir).runId}. Point --run-dir at a new directory, or continue this run with: npx nx run luna-shopper/curation-cli:curate -- --resume ${dir}`
    );
  }

  const header = {
    header: true,
    runId,
    mainUrl,
    rehearsalUrl,
    model: model ?? null,
    startedAt: new Date().toISOString(),
  };
  appendJsonl(decisionsPath(dir), header);

  const state = {
    runId,
    mainUrl,
    rehearsalUrl,
    // The username, never the password. A run directory is an ordinary
    // directory an operator may keep, copy or attach to a report.
    mainUser: mainUser ?? null,
    model: model ?? null,
    // Whether the model answering this run runs on the operator's own machine
    // (plan 0003). It is written once and read by every later `decide`, because
    // a resumed run has to apply the rule it was started under or the decisions
    // file means two things from top to bottom.
    local: local === true,
    startedAt: header.startedAt,
    total: total ?? 0,
    // The chains as catalog answers them, so `next` and `decide` need no
    // request to know which supermarket a row belongs to.
    supermarkets: supermarkets ?? [],
    // The walk: one entry per chain, each with its own cursor and the rows it
    // has already handed out but not yet had decided.
    chains: chains.map((chain) => ({
      supermarketId: chain.supermarketId,
      name: chain.name ?? null,
      cursor: null,
      exhausted: false,
    })),
    chainIndex: 0,
    decidedIds: [],
    createdRefs: {},
    // What `next` last handed out, per row, as candidate identities, and how
    // many rows `decide` has refused to record because that set had changed
    // (plan 0002). A row leaves `handouts` the moment it is decided.
    handouts: {},
    reasks: 0,
  };
  writeState(dir, state);
  return state;
}

export function writeState(dir, state) {
  writeFileSync(statePath(dir), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export function readState(dir) {
  const path = statePath(dir);
  if (!existsSync(path)) {
    throw new Error(`${path} does not exist. Start a run there first.`);
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * The state, reconciled with what the decisions file actually holds.
 *
 * The JSONL is the record of truth for what was decided, because it is
 * appended before the state is rewritten.
 */
export function loadRun(dir) {
  const state = readState(dir);
  const lines = readJsonl(decisionsPath(dir));
  const header = lines.find((line) => line.header) ?? null;
  const records = lines.filter((line) => !line.header);

  const decidedIds = new Set(state.decidedIds ?? []);
  const createdRefs = { ...(state.createdRefs ?? {}) };
  for (const record of records) {
    decidedIds.add(record.entryId);
    if (record.ref && record.rehearsalItemId) {
      createdRefs[record.ref] = record.rehearsalItemId;
    }
  }

  return {
    state: { ...state, decidedIds: [...decidedIds], createdRefs },
    header,
    records,
  };
}

/** Appends one decided row and rewrites the state in that order. */
export function appendDecision(dir, state, record) {
  appendJsonl(decisionsPath(dir), record);
  const decidedIds = new Set(state.decidedIds ?? []);
  decidedIds.add(record.entryId);
  const createdRefs = { ...(state.createdRefs ?? {}) };
  if (record.ref && record.rehearsalItemId) {
    createdRefs[record.ref] = record.rehearsalItemId;
  }
  const next = { ...state, decidedIds: [...decidedIds], createdRefs };
  writeState(dir, next);
  return next;
}

export function writeReport(dir, report) {
  const path = reportPath(dir);
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return path;
}
