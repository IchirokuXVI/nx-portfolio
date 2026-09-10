/**
 * The run directory: the only state this library keeps (plan 0001).
 *
 * A killed run resumes for free because everything a subcommand needs is on
 * disk between invocations. There are two files and nothing else:
 *
 * - `state.json`: the run's identity, the two urls, the chain walk cursor, the
 *   ids already decided, the candidate set each row of the current batch was
 *   handed, and how many rows have had to be asked again because that set
 *   changed underneath them.
 * - `decisions.jsonl`: a header line, then one line per decided row.
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
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const STATE_FILE = 'state.json';
const DECISIONS_FILE = 'decisions.jsonl';
const REPORT_FILE = 'report.json';

export function statePath(dir) {
  return join(dir, STATE_FILE);
}

export function decisionsPath(dir) {
  return join(dir, DECISIONS_FILE);
}

export function reportPath(dir) {
  return join(dir, REPORT_FILE);
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
  { runId, mainUrl, rehearsalUrl, mainUser, model, chains, supermarkets, total }
) {
  mkdirSync(dir, { recursive: true });
  if (existsSync(statePath(dir))) {
    throw new Error(
      `${statePath(dir)} already holds run ${readState(dir).runId}. Point --run-dir at a new directory, or continue this one with next.`
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
