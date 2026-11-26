/**
 * The replay (plan 0006, sections 3 to 6): a change list, sorted by what the
 * target holds, and in a write run sent through the items batch under an
 * `expect`, so a product that moved on the target is never overwritten.
 *
 * Every write goes through `PATCH /v1/admin/catalog/items/batch` with an
 * `expect`, and a decisions file through the decisions route under the content
 * guard of backend plan 0277. Nothing else is written. A dry run, the default,
 * signs in once and reads: the lookups, and the source rows of the few products
 * the wash rule asks about.
 *
 * Zero npm dependencies, Node built ins only. Not browser reachable.
 */

import { renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import {
  LOCAL_GAP,
  NOT_CARRIED,
  carriedField,
  nameHalves,
  sameValue,
  wireValue,
} from './changes.mjs';

export const BATCH_PATH = '/v1/admin/catalog/items/batch';
export const LOOKUP_PATH = '/v1/admin/catalog/items/lookup';
export const entriesPath = (itemId) =>
  `/v1/admin/harvest/items/${encodeURIComponent(itemId)}/entries`;

/** The lookup and the batch both take at most this many products a request. */
export const MAX_BATCH = 1000;
export const DEFAULT_BATCH_SIZE = 100;

/** The page size of the source rows read, which is the gateway's maximum. */
const ENTRIES_PAGE = 100;

/** At most ten requests a second, under both rate buckets of the gateway. */
export const MIN_REQUEST_GAP_MS = 100;

/** A 429 is waited out and sent again at most this many times. */
export const MAX_RATE_RETRIES = 3;

/** A lost answer is read back and sent again at most this many times. */
const MAX_LOST_ROUNDS = 3;

/**
 * How long one request may take before it counts as a lost answer. Node's own
 * fetch waits five minutes for the headers. The gateway of a cluster gives up
 * after 15 seconds and answers 504 itself, so a request that has had no answer
 * after twice that is hung, and the read back decides what landed.
 */
export const REQUEST_TIMEOUT_MS = 30000;

/**
 * A decisions part refused in rounds that drop none of its rows is stopped
 * after this many such rounds, so a refusal that names no row of the part
 * cannot send it forever.
 */
export const MAX_IDLE_DECISION_ROUNDS = 2;

/** What the header says while the report is written during a run. */
export const IN_PROGRESS_NOTE =
  'The run had not finished when this file was written. In a write run, a line still of class apply and without written was in flight or not yet sent, and its outcome is not known. A line with sentInLostRequest was sent in a request whose answer was lost, so the target may hold it.';

/**
 * What a line with `checked: false` says, of any class: its request was sent
 * and the run ended before direct evidence settled it.
 */
export const UNKNOWN_OUTCOME_REASON =
  'its request was sent and its outcome is not known: the target may hold it. Run the dry run again to settle it';

/** The classes of section 4.1, in the order the table checks them. */
export const CLASS = Object.freeze({
  NOT_CARRIED,
  LOCAL_GAP,
  NO_TWIN: 'no twin',
  MERGED: 'merged on target',
  WASH: 'excluded: wash task',
  IDENTITY: 'identity changed',
  ALREADY: 'already there',
  CONFLICT: 'conflict',
  APPLY: 'apply',
  REFUSED: 'refused',
  /** Sent in the request the run stopped on, and not on the target after it. */
  NOT_WRITTEN: 'not written',
  /**
   * Sent in a request whose outcome nothing later proved: the target may hold
   * it. Only `markUnsettled` gives this class, always with `checked: false`,
   * and the line keeps the class it held before under `lastKnownClass`. A
   * report written before this class existed has such a line as `not written`
   * (or another class) with `checked: false`.
   */
  OUTCOME_UNKNOWN: 'outcome unknown',
  /** Never sent, because the run stopped before it. */
  NOT_SENT: 'not sent',
});

/**
 * The answers a split can narrow down to one product: a refusal that names a
 * problem with the content of the batch. Any other answer is about the run
 * (the rate, the operator, the size of the request, the server), and a split
 * would only send the same refusal again, so the run stops.
 */
const CONTENT_REFUSAL_STATUSES = new Set([400, 409, 422]);

/**
 * The run stopped on an answer it cannot sort per product.
 *
 * `answer` is what the report records: the status, the problem code and the
 * message. The message names no product, because stderr prints it.
 */
export class ReplayStopped extends Error {
  constructor(message, answer, cause) {
    super(message, { cause });
    this.name = 'ReplayStopped';
    this.answer = answer;
    this.status = answer?.status ?? null;
  }
}

/** What a dry run cannot predict, said in every report header. */
export const DRY_RUN_LIMITS =
  'A dry run predicts only the classes of the lookup. It cannot predict a refusal of the write itself (an unregistered brand, a barcode or base unit rule, a category that does not resolve), because the route has no dry run.';

// ---------------------------------------------------------------------------
// The wash rule (section 4.4)
// ---------------------------------------------------------------------------

/**
 * The two patterns of the wash rule (release task 0009 selects by them), as literals, because the CLI
 * cannot import TypeScript. `replay.test.mjs` reads `wash-sizes.ts` as text
 * and asserts each of these equals its source, so the rule keeps one meaning
 * (owner decision O2).
 */
export const SHORT_WASH_WORD = /^(\d+) ?(?:lav|lv)\.?$/i;
export const WASH_SUM = /^(\d+)\s*\+\s*(\d+)(?:\s*lavados?| ?(?:lav|lv))\.?$/i;

/** The wash count a printed size states by the task's rule, or null. */
export function washCount(text) {
  const trimmed = String(text ?? '').trim();
  const short = SHORT_WASH_WORD.exec(trimmed);
  if (short) {
    return Number(short[1]);
  }
  const sum = WASH_SUM.exec(trimmed);
  if (sum) {
    return Number(sum[1]) + Number(sum[2]);
  }
  return null;
}

/**
 * The count `C` when a change is a wash candidate on this target, else null:
 * it takes `unitSize` from a whole number above 0 to null, and the target
 * product holds `UNIT` and that same size.
 */
export function washCandidate(change, item) {
  const size = change.fields.find((field) => field.field === 'unitSize');
  if (!size || size.to !== null) {
    return null;
  }
  const count = Number(size.from);
  if (!Number.isInteger(count) || count <= 0) {
    return null;
  }
  if (item?.defaultUnit !== 'UNIT' || Number(item.unitSize) !== count) {
    return null;
  }
  return count;
}

/**
 * The `ACTIVE` source row that states that count by the task's rule, or null.
 * Its text is what the report shows, so an operator can check the product.
 */
export function washRow(count, rows) {
  return (
    (rows ?? []).find(
      (row) => row.status === 'ACTIVE' && washCount(row.sizeFormat) === count
    ) ?? null
  );
}

/** Whether an `ACTIVE` source row states that count by the task's rule. */
export function washExcluded(count, rows) {
  return washRow(count, rows) !== null;
}

/**
 * The fields the wash task owns (owner decision 157a): the size, and the
 * default unit when the change moves it too. Every other field of the same
 * product is still carried.
 */
export const WASH_FIELDS = new Set(['unitSize', 'defaultUnit']);

/** What a report line says about a size left to the wash task. */
export const WASH_NOTE =
  'the size was left to release task 0009; check this product after it has run on the target';

/**
 * What the note adds when the dropped size took a unit change with it: the
 * task only clears the size, so nobody carries the unit.
 */
export function washUnitNote(field) {
  return `the unit change (defaultUnit from ${field.from ?? 'none'} to ${field.to ?? 'none'}) was not carried, and release task 0009 will not carry it either, because it only clears the size: set the unit on the target by hand`;
}

/**
 * The note of a line whose size was left to the wash task: `WASH_NOTE`, and
 * the unit sentence when the dropped fields hold a unit change.
 */
export function washNote(dropped) {
  const unit = dropped.find((field) => field.field === 'defaultUnit');
  return unit ? `${WASH_NOTE}. ${washUnitNote(unit)}` : WASH_NOTE;
}

// ---------------------------------------------------------------------------
// The target, as a paced client
// ---------------------------------------------------------------------------

/** A wait that resolves after `ms`. */
const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A fetch that keeps the whole body of a failed answer.
 *
 * The session cuts a failed body at 500 characters for its message, and the
 * refusal of a batch of a hundred names every product it refused. So the full
 * text is kept here, beside the session, and read back by the client.
 *
 * Each request also gets a timeout, which covers reading the body too, so a
 * hung target becomes a lost answer and not a run that waits for ever.
 */
export function capturingFetch(
  base = globalThis.fetch,
  { timeoutMs = REQUEST_TIMEOUT_MS } = {}
) {
  let last = null;
  return {
    fetchImpl: async (url, init = {}) => {
      const response = await base(url, {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) {
        last = null;
        return response;
      }
      const text = await response.text();
      last = { status: response.status, text };
      return new Response(text, {
        status: response.status,
        headers: response.headers,
      });
    },
    take() {
      const taken = last;
      last = null;
      return taken;
    },
  };
}

/** A refusal's body, read as the house problem document, or null. */
export function problemOf(error, captured = null) {
  const text = captured?.text ?? error?.body ?? null;
  if (typeof text !== 'string' || text === '') {
    return null;
  }
  try {
    const body = JSON.parse(text);
    return typeof body === 'object' && body !== null ? body : null;
  } catch {
    return null;
  }
}

/**
 * The session, paced to ten requests a second, waiting out a 429 the number of
 * seconds the answer names, at most three times.
 */
export function makeTargetClient({
  session,
  capture = null,
  sleep = realSleep,
  now = () => Date.now(),
  stderr,
  gapMs = MIN_REQUEST_GAP_MS,
}) {
  let nextAt = 0;
  let requests = 0;
  const pace = async () => {
    const wait = nextAt - now();
    if (wait > 0) {
      await sleep(wait);
    }
    nextAt = now() + gapMs;
  };

  return {
    get requests() {
      return requests;
    },
    async request(path, init = {}) {
      for (let attempt = 0; ; attempt++) {
        await pace();
        requests += 1;
        try {
          const answer = await session.fetch(path, init);
          capture?.take();
          return answer;
        } catch (error) {
          const captured = capture?.take() ?? null;
          const problem = problemOf(error, captured);
          error.problem = problem;
          if (error.status === 429 && attempt < MAX_RATE_RETRIES) {
            const seconds = Number(problem?.details?.retryAfterSeconds);
            const waitMs =
              Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60000;
            stderr?.write(
              `the target answered 429; waiting ${Math.ceil(waitMs / 1000)} s, then sending the same request again\n`
            );
            await sleep(waitMs);
            continue;
          }
          throw error;
        }
      }
    },
  };
}

/** Every product of `ids` as the target holds it now, by the id asked. */
export async function lookupItems(client, ids) {
  const unique = [...new Set(ids)];
  const items = new Map();
  for (let start = 0; start < unique.length; start += MAX_BATCH) {
    const answer = await client.request(LOOKUP_PATH, {
      method: 'POST',
      body: { ids: unique.slice(start, start + MAX_BATCH) },
    });
    for (const item of answer?.items ?? []) {
      items.set(item.id, item);
    }
  }
  return items;
}

/** Every source row bound to or proposing one product, all pages. */
export async function readEntries(client, itemId) {
  const rows = [];
  let cursor = null;
  do {
    const page = await client.request(entriesPath(itemId), {
      query: { limit: ENTRIES_PAGE, cursor },
    });
    rows.push(...(page?.items ?? []));
    cursor = page?.nextCursor ?? null;
  } while (cursor);
  return rows;
}

// ---------------------------------------------------------------------------
// The classes (sections 4.1 and 4.2)
// ---------------------------------------------------------------------------

/** The target's name and brand, as the report records them. */
function targetIdentity(item) {
  return item
    ? { name: nameHalves(item.name), brand: item.brand ?? null }
    : null;
}

/** Whether the target still carries the identity the change was made on. */
function sameIdentity(identity, item, esOnly) {
  if (!sameValue('name', identity.name, item.name, { esOnly })) {
    return false;
  }
  if ('brand' in identity && !sameValue('brand', identity.brand, item.brand)) {
    return false;
  }
  return true;
}

/**
 * One change, judged against the target (section 4.1). Pure: the lookup's
 * view of the product, and the source rows when the wash rule asked for them.
 *
 * Answers the report line of the product.
 */
export function classify(
  change,
  item,
  { esOnly = false, washRows = null } = {}
) {
  const line = {
    itemId: change.itemId,
    class: change.class,
    fields: change.fields.map(({ field, from, to }) => ({ field, from, to })),
    identity: { local: change.identity ?? null, target: targetIdentity(item) },
  };
  if (change.reason) {
    line.reason = change.reason;
  }
  if (change.unguarded?.length) {
    line.unguarded = change.unguarded;
  }
  if (change.class) {
    return line;
  }
  if (!item) {
    return { ...line, class: CLASS.NO_TWIN };
  }
  for (const field of line.fields) {
    field.target = carriedField(field.field).read(item) ?? null;
  }
  if (item.mergedInto) {
    return { ...line, class: CLASS.MERGED, survivor: item.mergedInto };
  }
  const count = washCandidate(change, item);
  const excludedBy = count === null ? null : washRow(count, washRows);
  if (excludedBy) {
    const dropped = line.fields.filter((field) => WASH_FIELDS.has(field.field));
    const washTask = {
      count,
      text: excludedBy.sizeFormat,
      note: washNote(dropped),
    };
    const rest = line.fields.filter((field) => !WASH_FIELDS.has(field.field));
    if (rest.length === 0) {
      return { ...line, class: CLASS.WASH, washCount: count, washTask };
    }
    // Only the size is the task's: the other fields go on to be judged and
    // sent under their guard, and the line keeps what was left out.
    washTask.fields = dropped;
    line.fields = rest;
    line.washTask = washTask;
  }
  if (!sameIdentity(change.identity, item, esOnly)) {
    return { ...line, class: CLASS.IDENTITY };
  }
  let holdsFrom = 0;
  let neither = false;
  for (const field of line.fields) {
    const kind = carriedField(field.field).kind;
    if (sameValue(kind, field.target, field.to)) {
      field.holds = 'to';
    } else if (sameValue(kind, field.target, field.from)) {
      field.holds = 'from';
      holdsFrom += 1;
    } else {
      field.holds = 'neither';
      neither = true;
    }
  }
  if (holdsFrom === 0 && !neither) {
    return { ...line, class: CLASS.ALREADY };
  }
  if (neither) {
    return { ...line, class: CLASS.CONFLICT };
  }
  return { ...line, class: CLASS.APPLY };
}

// ---------------------------------------------------------------------------
// The write (section 4.3)
// ---------------------------------------------------------------------------

/**
 * One entry of the batch: the fields that still hold `from`, set to `to`, and
 * an `expect` of their `from` plus the identity, as name and brand.
 */
export function batchEntry(line, { esOnly = false } = {}) {
  const entry = { itemId: line.itemId };
  const expect = {};
  for (const field of line.fields) {
    if (field.holds !== 'from') {
      continue;
    }
    const spec = carriedField(field.field);
    entry[spec.send] = wireValue(spec, field.to);
    expect[spec.send] = wireValue(spec, field.from);
  }
  const identity = line.identity.local;
  if (!esOnly && expect.name === undefined && identity?.name) {
    expect.name = wireValue(carriedField('name'), identity.name);
  }
  if (identity && 'brand' in identity && expect.brand === undefined) {
    expect.brand = wireValue(carriedField('brand'), identity.brand);
  }
  entry.expect = expect;
  return entry;
}

/**
 * A failure the proxy or the socket gave, where the write may have landed: a
 * 502, 503 or 504, no answer at all (a timeout included), or a 2xx answer
 * whose body could not be read. The server took the request in that last
 * case, so only a read back can say what it holds.
 */
function lostAnswer(error) {
  const status = error?.status;
  return (
    status === undefined ||
    status === null ||
    (status >= 200 && status < 300) ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

/**
 * Whether a read back after this failure settles what did not land.
 *
 * Only a 2xx says the server had finished the request when it answered. After
 * no answer, a timeout, a 502, 503 or 504 the backend may still commit later:
 * the cluster's proxy gives up after 15 seconds while the backend carries on.
 * A plain 500 proves no more, because the gateway renders a failure on its own
 * side of the broker (a reply it stopped waiting for) as a 500 too, while the
 * catalog service may still be writing. So after any of those, a read back
 * that sees the new values is conclusive, and one that sees the old ones is
 * not.
 */
function readBackSettles(error) {
  const status = error?.status;
  return typeof status === 'number' && status >= 200 && status < 300;
}

/**
 * Marks a line as sent in a request whose outcome is not known yet. Set before
 * every read back, whatever the answer that led to it, so a read that fails or
 * a stop after it still knows the products were sent.
 */
function markSentInLostRequest(group) {
  for (const line of group) {
    line.sentInLostRequest = true;
  }
}

/**
 * Direct evidence said what the target holds for this line, and this is the
 * only way the flag is cleared. Three events count: a written answer for it, a
 * read back that saw its new values, and an `item_expectation_failed` refusal
 * that names it (the guard ran on it inside the transaction). A read back that
 * saw the old values is not one of them, nor is any other refusal: the server
 * runs some content checks before the guard and outside the transaction, so
 * such a refusal says nothing of an earlier request.
 */
function settle(line) {
  delete line.sentInLostRequest;
}

/**
 * The end of a run, in every path (the end of the write, a stop, a signal, a
 * failed report write): every line that still carries the flag, of any class,
 * becomes `outcome unknown` and is not checked, so the counts and stderr tell
 * the operator to run the dry run again. The class it held is kept as
 * `lastKnownClass`; a line still waiting to be sent held `not written`, never
 * `not sent`, since its first send may land. This is the one place that gives
 * the class and `checked: false`, so the two always agree.
 */
export function markUnsettled(lines) {
  for (const line of lines) {
    if (!line.sentInLostRequest || line.class === CLASS.OUTCOME_UNKNOWN) {
      continue;
    }
    line.lastKnownClass =
      line.class === CLASS.APPLY && !line.written
        ? CLASS.NOT_WRITTEN
        : line.class;
    line.class = CLASS.OUTCOME_UNKNOWN;
    line.checked = false;
    line.reason = UNKNOWN_OUTCOME_REASON;
  }
}

/** The fields of an expectation failure, as the report reads them. */
function failedFields(failure) {
  return (failure?.fields ?? []).map((field) => field.field);
}

/** The fields of a line the batch sends: those that still held `from`. */
function sentFields(line) {
  return line.fields.filter((field) => field.holds === 'from');
}

/**
 * Whether an expectation failure only says the edit is already there: every
 * field sent is named, and the target holds its `to`, and nothing else is
 * named. That is what a resend meets when the first send committed after its
 * answer was lost, or when someone made the same edit on the target.
 */
function refusedAsAlreadyThere(line, failure) {
  const sent = sentFields(line);
  const mismatches = failure?.fields ?? [];
  if (sent.length === 0 || mismatches.length !== sent.length) {
    return false;
  }
  return sent.every((field) => {
    const spec = carriedField(field.field);
    const mismatch = mismatches.find((entry) => entry.field === spec.send);
    return (
      mismatch !== undefined && sameValue(spec.kind, mismatch.actual, field.to)
    );
  });
}

/** Whether a refusal names a problem with the content, so a split can find it. */
function contentRefusal(error, problem) {
  return (
    CONTENT_REFUSAL_STATUSES.has(error?.status) &&
    typeof problem?.code === 'string' &&
    problem.code !== ''
  );
}

/** What the report records of the answer a run stopped on. */
function answerOf(error, problem = error?.problem ?? problemOf(error)) {
  const status = error?.status ?? null;
  return {
    status,
    code: problem?.code ?? (status === null ? 'no_answer' : `http_${status}`),
    message:
      problem?.detail ?? problem?.message ?? String(error?.message ?? error),
  };
}

/** Why the run stopped, in words that name no product, for stderr. */
function stopReason(error, { lostRounds = 0, batch = null } = {}) {
  const status = error?.status ?? null;
  if (error instanceof ReplayStopped) {
    return error.message;
  }
  if (lostRounds > MAX_LOST_ROUNDS) {
    return `the target gave no answer ${lostRounds} times for one batch`;
  }
  if (error?.name === 'TimeoutError') {
    return `the target gave no answer within ${REQUEST_TIMEOUT_MS / 1000} s`;
  }
  if (status === null || status === undefined) {
    return 'the target gave no answer';
  }
  if (status >= 200 && status < 300) {
    return `the target answered ${status} with a body that could not be read`;
  }
  if (status === 429) {
    return `the target still answered 429 after ${MAX_RATE_RETRIES} waits`;
  }
  if (status === 401 || status === 403) {
    return `the target refused the operator with ${status} after a new login`;
  }
  if (status === 413) {
    return `the target answered 413 for a batch of ${batch ?? 'some'} products`;
  }
  const code = (error?.problem ?? problemOf(error))?.code;
  return `the target answered ${status}${code ? ` (${code})` : ''}`;
}

/**
 * Reads a batch back after an answer that may hide a write: a product that
 * holds `to` for every field sent landed and is `already there`. Answers the
 * products that did not land.
 */
async function readBack(client, group) {
  const items = await lookupItems(
    client,
    group.map((line) => line.itemId)
  );
  const rest = [];
  for (const line of group) {
    const item = items.get(line.itemId);
    const landed =
      item &&
      sentFields(line).every((field) => {
        const spec = carriedField(field.field);
        return sameValue(spec.kind, spec.read(item), field.to);
      });
    if (landed) {
      line.class = CLASS.ALREADY;
      line.afterLostAnswer = true;
      settle(line);
    } else {
      rest.push(line);
    }
  }
  return rest;
}

/** Marks a group as written, with each field it sent. */
function markWritten(group) {
  for (const line of group) {
    line.written = true;
    // The expect held `from`, so no earlier lost request had landed.
    settle(line);
    for (const field of sentFields(line)) {
      field.sent = true;
    }
  }
}

/**
 * Sends the `apply` lines in batches, and sorts what the target refuses.
 *
 * Mutates the lines as each answer comes, so what the report holds is true
 * whenever the run stops: a line that was written gets `written: true` and
 * each sent field `sent: true`; a refused one changes class.
 *
 * Which answer does what:
 * - `item_expectation_failed` drops the products it names and sends the rest
 *   again. A product refused only because it already holds every `to` is
 *   `already there`.
 * - A 400, 409 or 422 with a problem code splits the batch until the refused
 *   product is alone, and it is `refused`.
 * - A 502, 503, 504, no answer, a timeout or a 2xx whose body cannot be read
 *   reads the batch back and sends again what did not land, at most three
 *   times.
 * - A 413 halves the group it refused, once, and no later batch is larger
 *   than that half.
 * - Anything else stops the run: a 429 after the client's waits, a 401 or 403
 *   after the session's new login, a second 413, any other 5xx, an answer
 *   lost a fourth time. The products of the request in flight are
 *   `not written` (or `already there` when a read back shows they landed),
 *   every product after them is `not sent`, and a `ReplayStopped` is thrown.
 *
 * A product sent in a request whose outcome is not known (any lost answer, a
 * 2xx whose body could not be read among them, or a 5xx) carries
 * `sentInLostRequest: true` until direct evidence settles it (see `settle`).
 * When the write ends, in any way, a product that still carries it is
 * `outcome unknown` with `checked: false`, whatever its class was (see
 * `markUnsettled`).
 *
 * `progress.current` holds the group in flight, so a signal handler can mark
 * it, and `onAnswer` is called after every answer is sorted.
 */
export async function writeApply(
  client,
  lines,
  {
    batchSize = DEFAULT_BATCH_SIZE,
    esOnly = false,
    stderr,
    progress = {},
    onAnswer = null,
  } = {}
) {
  const pending = lines.filter((line) => line.class === CLASS.APPLY);
  const stats = { requests: 0, written: 0 };
  let size = batchSize;
  let halved = false;
  let cursor = 0;
  let lostRounds = 0;
  const queue = [];
  progress.current = null;

  /** Sends one group and sorts its answer. Throws only to stop the run. */
  const send = async (group) => {
    let error;
    try {
      await client.request(BATCH_PATH, {
        method: 'PATCH',
        body: {
          items: group.map((line) => batchEntry(line, { esOnly })),
          requireRegisteredBrands: true,
        },
      });
    } catch (caught) {
      error = caught;
    }
    if (error === undefined) {
      markWritten(group);
      stats.written += group.length;
      return;
    }

    const problem = error.problem ?? problemOf(error);
    const failures =
      problem?.code === 'item_expectation_failed'
        ? (problem?.details?.failures ?? [])
        : [];
    const named = new Map(failures.map((failure) => [failure.itemId, failure]));
    const hit = group.filter((line) => named.has(line.itemId));
    if (hit.length > 0) {
      for (const line of hit) {
        const failure = named.get(line.itemId);
        const fields = failedFields(failure);
        // The failure names what the target holds now, which settles it.
        settle(line);
        if (refusedAsAlreadyThere(line, failure)) {
          line.class = CLASS.ALREADY;
          if (lostRounds > 0) {
            line.afterLostAnswer = true;
          }
        } else {
          // Suspected, not confirmed, and no test reproduces it: a request is
          // lost, then someone changes the brand or the name on the target,
          // and the resend is refused here naming that field. The settle above
          // has cleared the flag, so the line may end `identity changed`
          // without `checked: false`, although the lost request may have
          // landed (its fields would then hold `to`). The owner decided on
          // 2026-11-26 to leave this case unchecked (not investigated) for now.
          line.class =
            fields.includes('name') || fields.includes('brand')
              ? CLASS.IDENTITY
              : CLASS.CONFLICT;
        }
        line.refusedOn = fields;
        for (const mismatch of failure.fields ?? []) {
          const spec = line.fields.find(
            (field) => carriedField(field.field).send === mismatch.field
          );
          if (spec) {
            spec.target = mismatch.actual ?? null;
          }
          if (mismatch.field === 'name' || mismatch.field === 'brand') {
            line.identity.target = {
              ...(line.identity.target ?? {}),
              [mismatch.field]:
                mismatch.field === 'name'
                  ? nameHalves(mismatch.actual)
                  : (mismatch.actual ?? null),
            };
          }
        }
      }
      queue.unshift(group.filter((line) => !named.has(line.itemId)));
      return;
    }

    if (lostAnswer(error)) {
      lostRounds += 1;
      // Before the read back, also after a 2xx: the server committed, and a
      // read that fails must not leave the products looking unsent. What the
      // read back sees with the old values stays flagged and is sent again.
      markSentInLostRequest(group);
      const rest = await readBack(client, group);
      if (lostRounds > MAX_LOST_ROUNDS) {
        throw new ReplayStopped(
          `the write stopped: ${stopReason(error, { lostRounds })}`,
          { ...answerOf(error, problem), code: 'no_answer' },
          error
        );
      }
      stderr?.write(
        `a batch got no answer (${error.status ?? 'no status'}); ${group.length - rest.length} of its ${group.length} products landed, the rest are sent again\n`
      );
      queue.unshift(rest);
      return;
    }

    if (contentRefusal(error, problem)) {
      if (group.length === 1) {
        const [line] = group;
        line.class = CLASS.REFUSED;
        line.code = problem.code;
        line.message = problem.detail ?? problem.message ?? error.message;
        return;
      }
      const middle = Math.ceil(group.length / 2);
      queue.unshift(group.slice(0, middle), group.slice(middle));
      return;
    }

    // The group that was refused is halved, and no batch after it is larger
    // than one half. Halving the configured size instead resent a short group
    // whole, and its second 413 stopped the run.
    if (error.status === 413 && !halved && group.length > 1) {
      halved = true;
      const half = Math.ceil(group.length / 2);
      size = Math.min(size, half);
      stderr?.write(
        `the target answered 413 for a batch of ${group.length}; sending batches of ${size} from now on\n`
      );
      queue.unshift(group.slice(0, half), group.slice(half));
      return;
    }

    // A server error may still hide a write that committed, so the batch is
    // read back before its products are called not written. What the read
    // back does not see landed may still land: see readBackSettles.
    if (error.status >= 500) {
      markSentInLostRequest(group);
      try {
        await readBack(client, group);
      } catch {
        // The products stay marked, and the stop reports them not checked.
      }
    }
    throw new ReplayStopped(
      `the write stopped: ${stopReason(error, { batch: group.length })}`,
      answerOf(error, problem),
      error
    );
  };

  try {
    while (queue.length > 0 || cursor < pending.length) {
      if (queue.length === 0) {
        queue.push(pending.slice(cursor, cursor + size));
        cursor += size;
        lostRounds = 0;
      }
      const group = queue.shift();
      if (group.length === 0) {
        continue;
      }
      progress.current = group;
      stats.requests += 1;
      await send(group);
      progress.current = null;
      // The report on disk follows every answer, so a stop that leaves no
      // time for the last write still leaves a record of what landed.
      onAnswer?.();
    }
  } catch (error) {
    const stop =
      error instanceof ReplayStopped
        ? error
        : new ReplayStopped(
            `the write stopped: ${stopReason(error)}`,
            answerOf(error),
            error
          );
    for (const line of progress.current ?? []) {
      if (line.class === CLASS.APPLY && !line.written) {
        line.class = CLASS.NOT_WRITTEN;
        line.error = stop.answer;
      }
    }
    progress.current = null;
    for (const line of [...queue.flat(), ...pending.slice(cursor)]) {
      // A line waiting to be sent again after a lost answer is left to
      // markUnsettled below.
      if (
        line.class !== CLASS.APPLY ||
        line.written ||
        line.sentInLostRequest
      ) {
        continue;
      }
      line.class = CLASS.NOT_SENT;
      line.reason = 'the run stopped before this product was sent';
    }
    stop.stats = stats;
    throw stop;
  } finally {
    markUnsettled(pending);
  }
  return stats;
}

// ---------------------------------------------------------------------------
// The passes
// ---------------------------------------------------------------------------

/** The lines of changes the run stopped before it read on the target. */
function unreadLines(changes) {
  return changes.map((change) => {
    const line = classify(change, undefined);
    return change.class
      ? line
      : {
          ...line,
          class: CLASS.NOT_SENT,
          reason: 'the run stopped before this product was read',
        };
  });
}

/**
 * Sorts every change into its class against the target, and in a write run
 * sends the `apply` class. Answers the report lines and the request counts.
 *
 * `lines` is the caller's array and is filled as each product is judged and
 * each answer comes, so a caller that catches a throw still holds every
 * outcome known so far. A product the run did not reach is `not sent`. Any
 * failure is thrown as a `ReplayStopped`, whose message names no product.
 */
export async function replayChanges({
  changes,
  client,
  write = false,
  batchSize = DEFAULT_BATCH_SIZE,
  esOnly = false,
  washCheck = true,
  extraIds = [],
  stderr,
  lines = [],
  progress = {},
  onAnswer = null,
}) {
  progress.entryReads = 0;
  progress.items = new Map();
  let index = 0;
  try {
    const asked = changes
      .filter((change) => change.class === null)
      .map((change) => change.itemId);
    const items = await lookupItems(client, [...asked, ...extraIds]);
    progress.items = items;

    for (; index < changes.length; index++) {
      const change = changes[index];
      const item = change.class === null ? items.get(change.itemId) : undefined;
      let washRows = null;
      if (
        washCheck &&
        item &&
        !item.mergedInto &&
        washCandidate(change, item) !== null
      ) {
        washRows = await readEntries(client, change.itemId);
        progress.entryReads += 1;
      }
      lines.push(classify(change, item, { esOnly, washRows }));
    }
  } catch (error) {
    lines.push(...unreadLines(changes.slice(index)));
    throw new ReplayStopped(
      `the run stopped while it read the target: ${stopReason(error)}`,
      answerOf(error),
      error
    );
  }

  let written = { requests: 0, written: 0 };
  if (write) {
    progress.write ??= {};
    written = await writeApply(client, lines, {
      batchSize,
      esOnly,
      stderr,
      progress: progress.write,
      onAnswer,
    });
  }
  return {
    lines,
    items: progress.items,
    entryReads: progress.entryReads,
    written,
  };
}

/** Products per class, in the order of the table, and fields sent. */
export function countLines(lines) {
  const classes = {};
  for (const name of Object.values(CLASS)) {
    classes[name] = 0;
  }
  let fieldsSent = 0;
  let written = 0;
  let landedAfterLostAnswer = 0;
  let sizeLeftToWashTask = 0;
  for (const line of lines) {
    classes[line.class] = (classes[line.class] ?? 0) + 1;
    if (line.written) {
      written += 1;
    }
    // Landed through a request whose answer was lost, so the target holds an
    // audit row for it while `written` does not count it.
    if (line.afterLostAnswer) {
      landedAfterLostAnswer += 1;
    }
    if (line.class !== CLASS.WASH && line.washTask) {
      sizeLeftToWashTask += 1;
    }
    fieldsSent += line.fields.filter((field) => field.sent).length;
  }
  return {
    products: lines.length,
    classes,
    written,
    landedAfterLostAnswer,
    // The class itself, so the count and the class cannot disagree.
    outcomeUnknown: classes[CLASS.OUTCOME_UNKNOWN],
    fieldsSent,
    sizeLeftToWashTask,
  };
}

/** What stderr says of the lines whose outcome is not known, or nothing. */
function outcomeUnknownText(count, noun) {
  return count > 0
    ? `; ${count} ${noun} were sent and their outcome is not known, run the dry run again`
    : '';
}

/** What the change list holds that no replay carries (section 5). */
export function notCarriedOf(header, lines) {
  const fields = {};
  for (const line of lines) {
    for (const change of line.unguarded ?? []) {
      fields[change.field] = (fields[change.field] ?? 0) + 1;
    }
  }
  return {
    otherEntities: header?.otherEntities ?? {},
    unguardedFields: fields,
  };
}

/** `replay-localhost-43700-2026-11-26T10-00-00-000Z.json` beside the list. */
export function defaultReportPath(
  changeFile,
  targetUrl,
  now = new Date(),
  prefix = 'replay'
) {
  const host = new URL(targetUrl).host.replace(/[^A-Za-z0-9.-]/g, '-');
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return join(dirname(changeFile), `${prefix}-${host}-${stamp}.json`);
}

/** A url the operator typed, without the trailing slash. */
export function normalizeTargetUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(
      '--target-url is required and has no default: type the gateway of the target each time.'
    );
  }
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`--target-url ${value} is not a url.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`--target-url ${value} is not an http or https url.`);
  }
  return url.toString().replace(/\/+$/, '');
}

/**
 * The host name of a url or of a bare host, lower case, with no scheme, port
 * or path, or null when it is not one.
 */
export function hostNameOf(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  const text = value.trim();
  try {
    const url = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`
    );
    return url.hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * Refuses a write whose `--confirm-host` is missing or names another host
 * than `--target-url` (owner decision 158a). A dry run needs none.
 */
export function assertConfirmedHost(targetUrl, confirmHost) {
  const target = hostNameOf(targetUrl);
  const given = typeof confirmHost === 'string' ? confirmHost.trim() : '';
  if (given === '') {
    throw new Error(
      `--write needs --confirm-host ${target}: type the host name of the target a second time. The target is ${target}, and no --confirm-host was given. Nothing was sent.`
    );
  }
  const confirmed = hostNameOf(given);
  if (confirmed !== target) {
    throw new Error(
      `--confirm-host names ${confirmed ?? given}, and --target-url names ${target}. They must be the same host. Nothing was sent.`
    );
  }
}

/** A batch size between 1 and the route's cap. */
export function parseBatchSize(value) {
  if (value === undefined) {
    return DEFAULT_BATCH_SIZE;
  }
  const size = Number(value);
  if (!Number.isInteger(size) || size < 1 || size > MAX_BATCH) {
    throw new Error(
      `--batch-size is ${value}, and it is a whole number from 1 to ${MAX_BATCH}.`
    );
  }
  return size;
}

/** The one line stderr gets: the counts per class and the report's path. */
export function countsLine(counts) {
  const parts = Object.entries(counts.classes)
    .filter(([, count]) => count > 0)
    .map(([name, count]) => `${name} ${count}`);
  const wash = counts.sizeLeftToWashTask
    ? `; the size of ${counts.sizeLeftToWashTask} more left to the wash task`
    : '';
  const landed = counts.landedAfterLostAnswer
    ? `, ${counts.landedAfterLostAnswer} more landed after a lost answer`
    : '';
  return `${counts.products} products: ${parts.join(', ') || 'none'}${wash}; ${counts.written} written${landed}, ${counts.fieldsSent} fields sent${outcomeUnknownText(counts.outcomeUnknown ?? 0, 'products')}`;
}

/**
 * The codes of a rename that Windows refuses while another program (an
 * editor, an antivirus scan) holds the file. They pass after a moment.
 */
const RENAME_BUSY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

/** A rename refused with one of those codes is tried this many times. */
export const RENAME_TRIES = 5;

/** The wait before the next try grows by this much each time. */
export const RENAME_WAIT_MS = 50;

/**
 * Blocks the thread for `ms`. The report is written synchronously in the
 * signal path, where no timer would run, so the wait cannot be a promise.
 */
function waitSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Writes a file whole or not at all: a temp file beside it, then a rename
 * over it. A stop between the two leaves the previous version in place.
 *
 * A rename refused with EPERM, EBUSY or EACCES is tried again, up to
 * {@link RENAME_TRIES} times with a short synchronous wait. When it still
 * fails, the temp file holds the newest text and is kept: the error names its
 * full path, so the operator can open it. The temp file has one name a run,
 * so the next write that succeeds renames it away and leaves no stale copy.
 */
export function writeFileAtomic(
  path,
  text,
  {
    rename = renameSync,
    tries = RENAME_TRIES,
    waitMs = RENAME_WAIT_MS,
    wait = waitSync,
  } = {}
) {
  const temp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  writeFileSync(temp, text, 'utf8');
  for (let attempt = 1; ; attempt++) {
    try {
      rename(temp, path);
      return;
    } catch (error) {
      if (RENAME_BUSY_CODES.has(error?.code) && attempt < tries) {
        wait(waitMs * attempt);
        continue;
      }
      const kept = resolve(temp);
      const failure = new Error(
        `${error?.code ?? 'the rename failed'}: ${path} could not be replaced after ${attempt} ${attempt === 1 ? 'try' : 'tries'}, and the newest report is kept at ${kept}`,
        { cause: error }
      );
      failure.code = error?.code;
      failure.tempPath = kept;
      throw failure;
    }
  }
}

/** Writes the report, never to stdout. */
export function writeReport(path, report, writeFile = writeFileAtomic) {
  writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
  return path;
}

/**
 * Keeps the report file in step with a run (plan 0006, section 5).
 *
 * `snapshot` writes it after every answer, marked in progress. `close` writes
 * it once the run ends, and when that write fails it prints the counts and
 * the error the run stopped on before it throws the write failure, so neither
 * hides the other. `interrupt` is the signal path: it marks what was in
 * flight, writes the report synchronously and ends the keeper, so a write the
 * run makes later changes nothing on disk.
 *
 * `complete({ running })` fills the counts and the header; `print(withPath)`
 * writes the counts lines to stderr.
 */
export function reportKeeper({
  report,
  reportPath,
  writeFile,
  complete,
  print,
  stderr,
}) {
  let closed = false;
  const write = () => writeReport(reportPath, report, writeFile);
  return {
    get closed() {
      return closed;
    },
    snapshot() {
      if (closed) {
        return;
      }
      complete({ running: true });
      try {
        write();
      } catch (error) {
        throw new ReplayStopped(
          `the run stopped: the report could not be written to ${reportPath} (${error?.message ?? error}), so nothing more is sent`,
          {
            status: null,
            code: 'report_not_written',
            message: String(error?.message ?? error),
          },
          error
        );
      }
    },
    close(failure) {
      if (closed) {
        if (failure) {
          throw failure;
        }
        return report;
      }
      closed = true;
      markUnsettled(report.lines);
      complete({ running: false });
      let writeError = null;
      try {
        write();
      } catch (error) {
        writeError = error;
      }
      print(writeError === null);
      if (writeError !== null) {
        if (failure) {
          stderr.write(`${failure?.message ?? failure}\n`);
        }
        throw new Error(
          `the report could not be written to ${reportPath}: ${writeError?.message ?? writeError}`,
          { cause: failure ?? writeError }
        );
      }
      if (failure) {
        throw failure;
      }
      return report;
    },
    interrupt(signal, mark) {
      if (closed) {
        return false;
      }
      closed = true;
      const answer = {
        status: null,
        code: 'interrupted',
        message: `the run was stopped with ${signal} while this request was in flight, so whether it landed is not known`,
      };
      mark(answer);
      markUnsettled(report.lines);
      report.header.stoppedBy = `the run was stopped with ${signal}`;
      report.header.error = answer;
      complete({ running: false });
      try {
        write();
      } catch (error) {
        print(false);
        stderr.write(
          `the report could not be written to ${reportPath}: ${error?.message ?? error}\n`
        );
        return false;
      }
      print(true);
      return true;
    },
  };
}

/**
 * Marks the products of a stopped write: those in flight carry the flag, as a
 * request whose answer will never be read, and the rest not yet sent are
 * `not sent`. The keeper's `markUnsettled` then marks every flagged line.
 */
function markProductsInterrupted({ lines, inFlight, write, answer }) {
  for (const line of inFlight ?? []) {
    if (line.class === CLASS.APPLY && !line.written) {
      line.class = CLASS.NOT_WRITTEN;
      line.error = answer;
      line.sentInLostRequest = true;
    }
  }
  if (!write) {
    return;
  }
  for (const line of lines) {
    if (line.class !== CLASS.APPLY || line.written || line.sentInLostRequest) {
      continue;
    }
    line.class = CLASS.NOT_SENT;
    line.reason = 'the run stopped before this product was sent';
  }
}

// ---------------------------------------------------------------------------
// Queue decisions (section 6, after backend plan 0277)
// ---------------------------------------------------------------------------

/**
 * The fields `expect.observed` holds, every one of them (plan 0277, section 1;
 * `packaging` since decision 154a). A file written before that decision lacks
 * it and the server refuses it with a 400, so it is refused here before
 * anything is sent.
 */
export const OBSERVED_FIELDS = [
  'name',
  'brand',
  'ean',
  'sizeFormat',
  'unitSize',
  'sizeUnit',
  'packCount',
  'soldByWeight',
  'approxWeight',
  'packaging',
];

/** The classes of a replayed decision. */
export const DECISION_CLASS = Object.freeze({
  APPLY: 'apply',
  APPLIED: 'applied',
  NO_TWIN: 'no twin',
  CONFLICT: 'conflict',
  DECIDED_ON_TARGET: 'decided on target',
  DROPPED_WITH_UNIT: 'dropped with its unit',
  REFUSED: 'refused',
  /** In the part whose answer was lost, and not decided on the target after it. */
  NOT_WRITTEN: 'not written',
  NOT_SENT: 'not sent',
});

/** What a refusal code of the decisions route means for the replay. */
function decisionClassOf(code) {
  switch (code) {
    case 'EXPECT_MISMATCH':
      return DECISION_CLASS.CONFLICT;
    case 'NOT_PENDING':
      return DECISION_CLASS.DECIDED_ON_TARGET;
    case 'NOT_FOUND':
      return DECISION_CLASS.NO_TWIN;
    default:
      return DECISION_CLASS.REFUSED;
  }
}

function carriesObserved(expect) {
  return (
    typeof expect?.status === 'string' &&
    expect.observed !== null &&
    typeof expect.observed === 'object' &&
    OBSERVED_FIELDS.every((field) => field in expect.observed)
  );
}

/**
 * A decisions file made ready for another cluster (section 6.1).
 *
 * Refused whole unless every decided row's `expect` carries the content guard
 * of plan 0277. Each row then expects its status and its content, and no
 * `lastSeenAt`, which a walk on the target moves whether the row changed or not.
 */
export function prepareDecisions({ file, header, records, implementation }) {
  if (!header) {
    throw new Error(`${file} has no header line. It is not a decisions file.`);
  }
  if (implementation !== 'suggestions') {
    throw new Error(
      `${file} is not a suggestions decisions file. Only those are replayed: the groups decider writes to another route.`
    );
  }
  const decided = records.filter(
    (record) => record.decision === 'CREATE' || record.decision === 'LINK'
  );
  const bare = decided.filter((record) => !carriesObserved(record.expect));
  if (bare.length > 0) {
    throw new Error(
      `${bare.length} of the ${decided.length} decided rows of ${file} carry no complete expect.observed (backend plan 0277), so the file cannot be replayed to another cluster. Nothing was sent.`
    );
  }
  return {
    header,
    records: decided.map((record) => ({
      ...record,
      expect: {
        status: record.expect.status,
        observed: record.expect.observed,
      },
    })),
  };
}

/** The products the decisions name by id, which the lookup also reads. */
export function decisionItemIds(prepared) {
  return (prepared?.records ?? [])
    .filter((record) => record.decision === 'LINK' && record.itemId)
    .map((record) => record.itemId);
}

/** A report line of one decided row. */
function decisionLine(record, klass, extra = {}) {
  return {
    entryId: record.entryId,
    op: record.decision === 'CREATE' ? 'createItem' : 'accept',
    ...(record.itemId ? { itemId: record.itemId } : {}),
    ...(record.ref ? { ref: record.ref } : {}),
    ...(record.itemRef ? { itemRef: record.itemRef } : {}),
    class: klass,
    ...extra,
  };
}

/**
 * Drops the named rows with the rows that need them (section 6.3).
 *
 * A dropped `createItem` takes every row that names its `ref` with it, because
 * the server resolves a ref inside one request only. A dropped `accept` takes
 * nothing else.
 */
export function dropUnits(records, dropped) {
  const refs = new Set(
    records
      .filter((record) => dropped.has(record.entryId) && record.ref)
      .map((record) => record.ref)
  );
  const kept = [];
  const removed = [];
  for (const record of records) {
    const reason = dropped.get(record.entryId);
    if (reason) {
      removed.push(decisionLine(record, reason.class, reason.extra ?? {}));
    } else if (record.itemRef && refs.has(record.itemRef)) {
      removed.push(
        decisionLine(record, DECISION_CLASS.DROPPED_WITH_UNIT, {
          detail: `it names ${record.itemRef}, whose createItem was dropped`,
        })
      );
    } else {
      kept.push(record);
    }
  }
  return { kept, removed };
}

/**
 * The rows of a part whose answer was lost, read back on the target and
 * classed by the state each row is in there.
 *
 * Only an `accept` that names a product can be read: its row is listed by
 * that product's source rows. A row that is no longer pending is
 * `decided on target`. A row still pending is `not written`, and with
 * `checked: false` unless `settles` (the answer was a 2xx, so the server had
 * finished): after a timeout, no answer or a 5xx the part may still land after
 * the read. Every other row (a `createItem`, an `accept` onto a product the
 * part made, a row the product does not list, a read that failed) is
 * `not written` with `checked: false`: its outcome is not known. After one
 * failed read the rest are not read, so a target that hangs is not asked once
 * a row.
 */
export async function readBackDecisions(
  client,
  records,
  answer,
  { settles = false } = {}
) {
  const lines = [];
  const rowsOf = new Map();
  let reachable = Boolean(client);
  const unknown = (record, why) =>
    decisionLine(record, DECISION_CLASS.NOT_WRITTEN, {
      code: answer.code,
      detail: `the answer to this part was lost (${answer.message}), and ${why}`,
      checked: false,
    });
  for (const record of records) {
    if (record.decision !== 'LINK' || !record.itemId) {
      lines.push(
        unknown(record, 'a row with no product of its own cannot be read back')
      );
      continue;
    }
    if (!reachable) {
      lines.push(unknown(record, 'the read back failed'));
      continue;
    }
    let rows = rowsOf.get(record.itemId);
    if (rows === undefined) {
      try {
        rows = await readEntries(client, record.itemId);
      } catch {
        reachable = false;
        lines.push(unknown(record, 'the read back failed'));
        continue;
      }
      rowsOf.set(record.itemId, rows);
    }
    const row = rows.find((entry) => entry.id === record.entryId);
    if (!row) {
      lines.push(
        unknown(record, 'the product it names does not list this row')
      );
    } else if (row.status !== record.expect.status) {
      lines.push(
        decisionLine(record, DECISION_CLASS.DECIDED_ON_TARGET, {
          targetStatus: row.status,
          afterLostAnswer: true,
        })
      );
    } else if (settles) {
      lines.push(
        decisionLine(record, DECISION_CLASS.NOT_WRITTEN, {
          code: answer.code,
          detail: `the answer to this part was lost (${answer.message}), and the row is still ${row.status} on the target`,
        })
      );
    } else {
      lines.push(
        unknown(
          record,
          `the row was still ${row.status} on the target when it was read, and the part may still land after that read`
        )
      );
    }
  }
  return lines;
}

/**
 * Replays the decisions (section 6): a no twin `accept` is dropped first, then
 * in a write run the rest go in parts of at most the route's cap, and a part
 * refused at `VALIDATE` loses the refused rows and is sent again. A part
 * refused at any other step, or at `VALIDATE` naming no row, stops the run
 * with a `ReplayStopped`, as a stop of the product write does.
 *
 * `applyFile(path)` is the suggestions decider's `apply` with the target url,
 * `splitParts(records)` its split by the cap, and `writeFile` writes each part
 * beside the report. `client` reads rows back after a lost answer.
 * `progress.inFlight` holds the rows of the part in flight and
 * `progress.orphanedItemIds` the products the route could not delete;
 * `onAnswer` is called after every answer is sorted.
 */
export async function replayDecisions({
  prepared,
  items,
  write = false,
  partBase,
  applyFile,
  splitParts,
  writeFile = (path, text) => writeFileSync(path, text, 'utf8'),
  lines = [],
  client = null,
  progress = {},
  onAnswer = null,
}) {
  progress.inFlight = null;
  progress.orphanedItemIds ??= [];
  const noTwin = new Map();
  for (const record of prepared.records) {
    if (
      record.decision === 'LINK' &&
      record.itemId &&
      !items.has(record.itemId)
    ) {
      noTwin.set(record.entryId, { class: DECISION_CLASS.NO_TWIN });
    }
  }
  const first = dropUnits(prepared.records, noTwin);
  lines.push(...first.removed);
  if (!write) {
    lines.push(
      ...first.kept.map((record) => decisionLine(record, DECISION_CLASS.APPLY))
    );
    return { lines, requests: 0 };
  }

  const parts = first.kept.length === 0 ? [] : splitParts(first.kept);
  let requests = 0;
  const notSentAfter = (index) => {
    for (const rest of parts.slice(index + 1)) {
      lines.push(
        ...rest.map((record) => decisionLine(record, DECISION_CLASS.NOT_SENT))
      );
    }
  };
  for (let index = 0; index < parts.length; index++) {
    let pending = parts[index];
    let round = 0;
    let idleRounds = 0;
    while (pending.length > 0) {
      round += 1;
      const path = `${partBase}.part-${index + 1}-of-${parts.length}.round-${round}.jsonl`;
      writeFile(
        path,
        [prepared.header, ...pending]
          .map((line) => `${JSON.stringify(line)}\n`)
          .join('')
      );
      requests += 1;
      progress.inFlight = pending;
      let answer;
      try {
        answer = await applyFile(path);
      } catch (error) {
        const stop = new ReplayStopped(
          `the decisions stopped: ${stopReason(error)}`,
          answerOf(error),
          error
        );
        if (lostAnswer(error) || error?.status >= 500) {
          // The part may have landed: what the target holds decides.
          lines.push(
            ...(await readBackDecisions(client, pending, stop.answer, {
              settles: readBackSettles(error),
            }))
          );
        } else {
          // Refused before anything was written: nothing of the part landed.
          lines.push(
            ...pending.map((record) =>
              decisionLine(record, DECISION_CLASS.REFUSED, {
                code: stop.answer.code,
                detail: stop.answer.message,
              })
            )
          );
        }
        progress.inFlight = null;
        // The caller reports every later part as not sent.
        throw stop;
      }
      progress.inFlight = null;
      progress.orphanedItemIds.push(...(answer.orphanedItemIds ?? []));
      if (answer.applied) {
        lines.push(
          ...pending.map((record) =>
            decisionLine(record, DECISION_CLASS.APPLIED)
          )
        );
        onAnswer?.();
        break;
      }
      const refused = new Map();
      for (const result of answer.results ?? []) {
        if (result.error) {
          refused.set(result.entryId, {
            class: decisionClassOf(result.error.code),
            extra: { code: result.error.code, detail: result.error.detail },
          });
        }
      }
      if (answer.failedStep !== 'VALIDATE' || refused.size === 0) {
        // Refused for a reason no single row carries: nothing more is sent,
        // and the run is a stopped run like any other.
        const step = answer.failedStep ?? 'refused';
        lines.push(
          ...pending.map((record) =>
            decisionLine(record, DECISION_CLASS.REFUSED, {
              code: step,
              detail: answer.error ?? null,
            })
          )
        );
        notSentAfter(index);
        // The message names only the step, because stderr prints it and the
        // server's error text may name a row. The report keeps that text.
        throw new ReplayStopped(
          `the decisions stopped: the target refused a part at ${answer.failedStep ?? 'a step it did not name'}, for a reason no row carries`,
          {
            status: null,
            code: step,
            message:
              typeof answer.error === 'string'
                ? answer.error
                : answer.error
                  ? JSON.stringify(answer.error)
                  : 'the part was refused for a reason no row carries',
          }
        );
      }
      const next = dropUnits(pending, refused);
      lines.push(...next.removed);
      pending = next.kept;
      idleRounds = next.removed.length === 0 ? idleRounds + 1 : 0;
      if (idleRounds >= MAX_IDLE_DECISION_ROUNDS) {
        // The refusal names no row of the part, so sending it again would
        // meet the same refusal for ever.
        lines.push(
          ...pending.map((record) =>
            decisionLine(record, DECISION_CLASS.REFUSED, {
              code: 'no_progress',
              detail: `refused at VALIDATE ${idleRounds} times in a row, naming no row of this part`,
            })
          )
        );
        notSentAfter(index);
        throw new ReplayStopped(
          `the decisions stopped: the target refused one part ${idleRounds} times in a row and named none of its rows`,
          {
            status: null,
            code: 'no_progress',
            message: 'a refusal at VALIDATE named no row of the part',
          }
        );
      }
      onAnswer?.();
    }
  }
  return { lines, requests };
}

// ---------------------------------------------------------------------------
// The two commands
// ---------------------------------------------------------------------------

/** The header fields that say whether the run was still going when written. */
function stampHeader(header, client, now, running) {
  header.endedAt = running ? null : now().toISOString();
  header.requests = client.requests;
  if (running) {
    header.inProgress = IN_PROGRESS_NOTE;
  } else {
    delete header.inProgress;
  }
}

/**
 * `--replay` (sections 3 to 6): the change list, and the decisions file when
 * one is named, against one target. Writes the report after every answer and
 * whatever happened, and answers it.
 *
 * `decisions` is `{ file, prepared, applyFile, splitParts }` or null.
 * `controls.interrupt(signal)` is set for the signal handler of the CLI: it
 * writes the report over what is known, synchronously, and the run writes
 * nothing after it.
 */
export async function runReplay({
  changeFile,
  changeList,
  folded,
  targetUrl,
  write,
  batchSize,
  reportPath,
  client,
  decisions = null,
  stderr,
  commit = null,
  now = () => new Date(),
  writeFile,
  controls = {},
}) {
  const startedAt = now().toISOString();
  const header = {
    targetUrl,
    dryRun: !write,
    changeList: changeList.header,
    changeFile,
    identityGuard: folded.esOnlyIdentity
      ? 'weak: this list is not from the audit trail, so only the Spanish half of a name is compared and the expect carries no name'
      : 'name and brand as the local side read them',
    startedAt,
    endedAt: null,
    commit,
    dryRunLimits: DRY_RUN_LIMITS,
  };
  const report = {
    header,
    counts: null,
    lines: [],
    notCarried: null,
    droppedUnchanged: folded.dropped,
  };
  const progress = { write: {}, decisions: {} };
  const decisionLines = [];

  const complete = ({ running }) => {
    stampHeader(header, client, now, running);
    report.entryReads = progress.entryReads ?? 0;
    if (decisions) {
      // Every decided row has a line, also when the run stopped before or
      // inside the decisions.
      const seen = new Set(decisionLines.map((line) => line.entryId));
      const unseen = decisions.prepared.records
        .filter((record) => !seen.has(record.entryId))
        .map((record) => decisionLine(record, DECISION_CLASS.NOT_SENT));
      const all = [...decisionLines, ...unseen];
      report.decisions = {
        file: decisions.file,
        counts: countDecisions(all),
        orphanedItemIds: [...(progress.decisions.orphanedItemIds ?? [])],
        lines: all,
      };
    }
    report.counts = countLines(report.lines);
    report.notCarried = notCarriedOf(changeList.header, report.lines);
  };
  const print = (withPath) => {
    stderr.write(`${countsLine(report.counts)}\n`);
    if (report.decisions) {
      const parts = Object.entries(report.decisions.counts.classes)
        .filter(([, count]) => count > 0)
        .map(([name, count]) => `${name} ${count}`);
      const orphaned = report.decisions.orphanedItemIds.length;
      stderr.write(
        `${report.decisions.counts.rows} decided rows: ${parts.join(', ') || 'none'}${orphaned ? `; ${orphaned} products left orphaned on the target` : ''}${outcomeUnknownText(report.decisions.counts.outcomeUnknown, 'rows')}\n`
      );
    }
    if (withPath) {
      stderr.write(`report: ${reportPath}\n`);
    }
  };
  const keeper = reportKeeper({
    report,
    reportPath,
    writeFile,
    complete,
    print,
    stderr,
  });
  controls.interrupt = (signal) =>
    keeper.interrupt(signal, (answer) => {
      markProductsInterrupted({
        lines: report.lines,
        inFlight: progress.write.current,
        write,
        answer,
      });
      report.lines.push(
        ...unreadLines(folded.changes.slice(report.lines.length))
      );
      const seen = new Set(decisionLines.map((line) => line.entryId));
      for (const record of progress.decisions.inFlight ?? []) {
        if (!seen.has(record.entryId)) {
          decisionLines.push(
            decisionLine(record, DECISION_CLASS.NOT_WRITTEN, {
              code: answer.code,
              detail: answer.message,
              checked: false,
            })
          );
        }
      }
    });

  let failure = null;
  try {
    const result = await replayChanges({
      changes: folded.changes,
      client,
      write,
      batchSize,
      esOnly: folded.esOnlyIdentity,
      extraIds: decisions ? decisionItemIds(decisions.prepared) : [],
      stderr,
      lines: report.lines,
      progress,
      onAnswer: keeper.snapshot,
    });
    if (decisions) {
      await replayDecisions({
        prepared: decisions.prepared,
        items: result.items,
        write,
        partBase: reportPath.replace(/\.json$/, '.decisions'),
        applyFile: decisions.applyFile,
        splitParts: decisions.splitParts,
        writeFile,
        lines: decisionLines,
        client,
        progress: progress.decisions,
        onAnswer: keeper.snapshot,
      });
    }
  } catch (error) {
    failure = error;
    if (!keeper.closed) {
      header.stoppedBy = String(error?.message ?? error);
      header.error = error?.answer ?? answerOf(error);
    }
  }
  return keeper.close(failure);
}

/**
 * The changes an `identity changed` report line holds, made again with the
 * target's name and brand as the identity (section 4.5).
 */
export function identityChanges(report, { only = null } = {}) {
  const wanted = only ? new Set(only) : null;
  return (report.lines ?? [])
    .filter((line) => line.class === CLASS.IDENTITY)
    .filter((line) => !wanted || wanted.has(line.itemId))
    .map((line) => ({
      itemId: line.itemId,
      class: null,
      reason: null,
      identity: line.identity?.target ?? null,
      fields: (line.fields ?? []).map(({ field, from, to }) => ({
        field,
        from,
        to,
      })),
      unguarded: [],
    }))
    .filter((change) => change.identity !== null);
}

/** Refuses a report written for another target than this run's. */
export function assertReportTarget(reportFile, previous, targetUrl) {
  const recorded = previous?.header?.targetUrl;
  let same = false;
  try {
    same = Boolean(recorded) && normalizeTargetUrl(recorded) === targetUrl;
  } catch {
    same = false;
  }
  if (!same) {
    throw new Error(
      `${reportFile} was written for ${recorded ?? 'no target'}, and this run targets ${targetUrl}. Refusing.`
    );
  }
}

/**
 * `--replay-identity` (section 4.5): the `identity changed` lines of a report,
 * guarded by the target's name and brand as that report recorded them.
 */
export async function runReplayIdentity({
  reportFile,
  previous,
  targetUrl,
  only,
  write,
  batchSize,
  reportPath,
  client,
  stderr,
  commit = null,
  now = () => new Date(),
  writeFile,
  controls = {},
}) {
  assertReportTarget(reportFile, previous, targetUrl);
  const changes = identityChanges(previous, { only });
  const startedAt = now().toISOString();
  const report = {
    header: {
      targetUrl,
      dryRun: !write,
      pass: 'identity',
      fromReport: reportFile,
      only: only ? only.length : null,
      identityGuard: "the target's name and brand as the report recorded them",
      startedAt,
      endedAt: null,
      commit,
      dryRunLimits: DRY_RUN_LIMITS,
    },
    counts: null,
    lines: [],
  };
  const progress = { write: {} };
  const keeper = reportKeeper({
    report,
    reportPath,
    writeFile,
    complete: ({ running }) => {
      stampHeader(report.header, client, now, running);
      report.counts = countLines(report.lines);
    },
    print: (withPath) => {
      stderr.write(`${countsLine(report.counts)}\n`);
      if (withPath) {
        stderr.write(`report: ${reportPath}\n`);
      }
    },
    stderr,
  });
  controls.interrupt = (signal) =>
    keeper.interrupt(signal, (answer) => {
      markProductsInterrupted({
        lines: report.lines,
        inFlight: progress.write.current,
        write,
        answer,
      });
      report.lines.push(...unreadLines(changes.slice(report.lines.length)));
    });
  let failure = null;
  try {
    await replayChanges({
      changes,
      client,
      write,
      batchSize,
      washCheck: false,
      stderr,
      lines: report.lines,
      progress,
      onAnswer: keeper.snapshot,
    });
  } catch (error) {
    failure = error;
    if (!keeper.closed) {
      report.header.stoppedBy = String(error?.message ?? error);
      report.header.error = error?.answer ?? answerOf(error);
    }
  }
  return keeper.close(failure);
}

/** Decided rows per class. */
export function countDecisions(lines) {
  const classes = {};
  for (const name of Object.values(DECISION_CLASS)) {
    classes[name] = 0;
  }
  let outcomeUnknown = 0;
  for (const line of lines) {
    classes[line.class] = (classes[line.class] ?? 0) + 1;
    if (line.checked === false) {
      outcomeUnknown += 1;
    }
  }
  return { rows: lines.length, classes, outcomeUnknown };
}
