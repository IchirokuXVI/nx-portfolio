/**
 * The run directory, as far as the orchestrator reads and writes it (plan 0005).
 *
 * The decider owns its run directory, and everything in it is written by the
 * decider during a walk. There are three moments the orchestrator has to touch
 * it anyway, and each is here and nowhere else:
 *
 * - **A row that failed.** The decider threw on it, so the decider cannot be
 *   the one to record it. It is appended to `decisions.jsonl` as an ordinary
 *   REVIEW record, the same shape the decider writes, with the one issue
 *   `ROW_FAILED`. Both deciders read that file as the record of truth for what
 *   was decided, so the row is never handed out again.
 * - **A resume.** The run's CREATE decisions are written again into the new
 *   rehearsal slot, and the ids that slot answers replace the old ones in the
 *   state and in the decisions file. A ref then resolves to a product the new
 *   slot holds. `--apply` never reads a rehearsal id, so what it sends is
 *   unchanged by this.
 * - **`curation-run.json`**, the orchestrator's own file: which decider ran,
 *   the engine and the model, and what `start` answered. A resumed run cannot
 *   call `start` again, so this is where its prompt comes from.
 *
 * What differs between the two deciders is only which field names the row and
 * which one holds the rehearsal id, so the layout of each is one entry of
 * `LAYOUTS`.
 *
 * Zero npm dependencies, Node built ins only. Not browser reachable.
 */

import {
  appendFileSync,
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { createAdminSession } from '../../auth/src/session.mjs';
import { toCreateGroupBody } from '../../groups/src/gateway.mjs';
import { toCreateItemBody } from '../../suggestions/src/gateway.mjs';

/** The orchestrator's own file in a run directory. */
export const RUN_FILE = 'curation-run.json';

const DECISIONS_FILE = 'decisions.jsonl';
const STATE_FILE = 'state.json';

/** The issue a row that failed is recorded with. */
export const ROW_FAILED = 'ROW_FAILED';

/** How much of an error is kept in the record. */
const DETAIL_LIMIT = 2000;

/**
 * What each decider's records look like, as far as this file needs to know.
 *
 * `create` is the rehearsal write a resume repeats: the decision that made it,
 * the route, and the body the decider itself sent. The bodies are the
 * deciders' own functions, so a resume writes exactly what the walk wrote.
 */
export const LAYOUTS = {
  suggestions: {
    idKey: 'entryId',
    subject: (row) => row?.entry ?? null,
    failedRecord: ({ id, name, row, detail, at }) => ({
      entryId: id,
      entryName: name,
      supermarketId: null,
      expect: null,
      decision: 'REVIEW',
      proposedDecision: null,
      itemId: null,
      itemRef: null,
      item: null,
      ref: null,
      rehearsalItemId: null,
      confidence: 0,
      issues: [{ code: ROW_FAILED, detail }],
      reasoning: '',
      candidateCount: row?.candidates?.length ?? null,
      decidedAt: at,
    }),
    create: {
      decision: 'CREATE',
      rehearsalIdKey: 'rehearsalItemId',
      path: '/v1/admin/catalog/items',
      body: (record) => toCreateItemBody(record.item),
    },
  },
  groups: {
    idKey: 'itemId',
    subject: (row) => row?.item ?? null,
    failedRecord: ({ id, name, row, detail, at }) => ({
      itemId: id,
      itemName: name,
      expect: null,
      decision: 'REVIEW',
      proposedDecision: null,
      groupId: null,
      groupRef: null,
      group: null,
      ref: null,
      rehearsalGroupId: null,
      confidence: 0,
      issues: [{ code: ROW_FAILED, detail }],
      reasoning: '',
      candidateCount: row?.candidates?.length ?? null,
      decidedAt: at,
    }),
    create: {
      decision: 'CREATE_GROUP',
      rehearsalIdKey: 'rehearsalGroupId',
      path: '/v1/admin/catalog/product-groups',
      body: (record) => toCreateGroupBody(record.group),
    },
  },
};

function layoutOf(implementation) {
  const layout = LAYOUTS[implementation];
  if (!layout) {
    throw new Error(`No run directory layout for ${implementation}.`);
  }
  return layout;
}

/** Every line of a JSONL file, parsed, or nothing when there is no file. */
export function readJsonlFile(path) {
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line));
}

/** The header and the records of a decisions file. */
export function readDecisions(path) {
  const lines = readJsonlFile(path);
  return {
    header: lines.find((line) => line.header) ?? null,
    records: lines.filter((line) => !line.header),
  };
}

/**
 * Which decider wrote a decisions file, read off its records.
 *
 * Only a fallback, for a file whose run directory holds no `curation-run.json`.
 * A suggestions record names its row `entryId` and a groups record never does.
 * A file with no records answers null, and it has nothing to apply either.
 */
export function sniffImplementation(records) {
  const first = records?.[0];
  if (!first) {
    return null;
  }
  return 'entryId' in first ? 'suggestions' : 'groups';
}

/** The row's name, whichever decider handed it out. */
function subjectName(subject) {
  return (
    (typeof subject?.name === 'string' ? subject.name : null) ??
    subject?.name?.es ??
    subject?.nameEs ??
    subject?.nameEn ??
    subject?.id ??
    null
  );
}

/**
 * Records one row the decider could not decide, as a REVIEW (plan 0005).
 *
 * Called only between two decider calls, never during one, so nothing else is
 * writing the file at that moment. A row that is already in the file is left
 * as it is: the decider got as far as recording it before it threw.
 */
export function recordRowFailure({
  implementation,
  runDir,
  row,
  error,
  now = () => new Date(),
}) {
  const layout = layoutOf(implementation);
  const subject = layout.subject(row);
  const id = subject?.id ?? null;
  if (!id) {
    throw new Error(
      'the row that failed carries no id, so it cannot be recorded'
    );
  }
  const path = join(runDir, DECISIONS_FILE);
  const { records } = readDecisions(path);
  const already = records.find((record) => record[layout.idKey] === id);
  if (already) {
    return already;
  }
  const record = layout.failedRecord({
    id,
    name: subjectName(subject),
    row,
    detail: String(error?.message ?? error).slice(0, DETAIL_LIMIT),
    at: now().toISOString(),
  });
  appendFileSync(path, `${JSON.stringify(record)}\n`, 'utf8');
  return record;
}

/** Writes a file whole, through a rename, so a kill never leaves half of it. */
function replaceFile(path, text) {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, text, 'utf8');
  renameSync(temporary, path);
}

/**
 * Brings a stopped run onto a new rehearsal slot (plan 0005).
 *
 * The slot the run walked is gone: teardown removed its volumes. Every CREATE
 * the run recorded is written again into the new slot, in the order it was
 * decided, so the next row's search sees the same products the walk had made.
 * The new ids replace the old ones in `decisions.jsonl` and `state.json`, and
 * the state's rehearsal url becomes the new slot's.
 *
 * Nothing here talks to the main gateway. A resumed run writes to the main
 * catalog exactly as a new one does, which is never before `--apply`.
 *
 * A CREATE that the new slot refuses stops the resume. Every ref after it
 * would name a product that is not there, and a walk on top of that is the
 * duplicate bug the rehearsal slot exists to prevent.
 */
export async function replayCreations({
  implementation,
  runDir,
  rehearsalUrl,
  makeSession = createAdminSession,
}) {
  const layout = layoutOf(implementation);
  const decisionsPath = join(runDir, DECISIONS_FILE);
  const statePath = join(runDir, STATE_FILE);
  if (!existsSync(statePath)) {
    throw new Error(
      `${statePath} does not exist, so there is no run to resume.`
    );
  }

  const lines = readJsonlFile(decisionsPath);
  const records = lines.filter((line) => !line.header);
  const session = makeSession({ baseUrl: rehearsalUrl, label: 'rehearsal' });

  const createdRefs = {};
  let created = 0;
  const rewritten = [];
  for (const line of lines) {
    if (line.header || line.decision !== layout.create.decision || !line.ref) {
      rewritten.push(line);
      continue;
    }
    let answer;
    try {
      answer = await session.fetch(layout.create.path, {
        method: 'POST',
        body: layout.create.body(line),
      });
    } catch (error) {
      throw new Error(
        `the new rehearsal slot refused ${line.ref}, so the refs after it would name nothing: ${error?.message ?? error}`
      );
    }
    if (!answer?.id) {
      throw new Error(
        `the new rehearsal slot answered no id for ${line.ref}, so the refs after it would name nothing`
      );
    }
    createdRefs[line.ref] = answer.id;
    created += 1;
    rewritten.push({ ...line, [layout.create.rehearsalIdKey]: answer.id });
  }

  if (created > 0) {
    replaceFile(
      decisionsPath,
      rewritten.map((line) => `${JSON.stringify(line)}\n`).join('')
    );
  }

  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  replaceFile(
    statePath,
    `${JSON.stringify({ ...state, rehearsalUrl, createdRefs }, null, 2)}\n`
  );

  return { created, decided: records.length };
}

/** Where a run directory keeps the orchestrator's own file. */
export function runFilePath(runDir) {
  return join(runDir, RUN_FILE);
}

/** Writes `curation-run.json`. The password is never one of its fields. */
export function writeRunFile(runDir, content) {
  writeFileSync(
    runFilePath(runDir),
    `${JSON.stringify(content, null, 2)}\n`,
    'utf8'
  );
}

/** Reads `curation-run.json`, or null when the directory holds none. */
export function readRunFile(runDir) {
  const path = runFilePath(runDir);
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** The run file beside a decisions file, or null. */
export function runFileBeside(decisionsFile) {
  return readRunFile(dirname(decisionsFile));
}
