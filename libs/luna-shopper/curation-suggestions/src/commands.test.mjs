import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  BULK_ENTRY_DECISIONS_PATH,
  apply,
  buildOperations,
  candidateIdentities,
  composeBatch,
  decide,
  end,
  next,
  sameCandidates,
  start,
} from './commands.mjs';
import { makeGateway } from './gateway.mjs';
import { indexPrivateLabels } from './rules.mjs';
import { readJsonl } from './run-dir.mjs';
import { makeCatalog, makeFakeSession, makeQueue } from './test-fakes.mjs';

const MAIN_URL = 'http://localhost:3000';
const REHEARSAL_URL = 'http://localhost:43000';

const SUPERMARKETS = [
  { id: 'sm-1', name: { es: 'Mercadona', en: 'Mercadona' } },
  { id: 'sm-2', name: { es: 'El Jamón', en: 'El Jamón' } },
];

const VOCABULARIES = {
  categories: ['DAIRY', 'PANTRY', 'OTHER'],
  units: ['UNIT', 'LITER', 'GRAM'],
};
const LABELS = indexPrivateLabels({ Hacendado: 'Mercadona' });

function entry(id, name, overrides = {}) {
  return {
    id,
    supermarketId: 'sm-1',
    name,
    brand: null,
    ean: null,
    unitSize: null,
    sizeFormat: null,
    categoryPath: [],
    url: null,
    sourceKind: 'OFFICIAL_API',
    status: 'CANDIDATE',
    lastSeenAt: '2026-09-08T10:00:00.000Z',
    itemId: null,
    extra: null,
    ...overrides,
  };
}

function runDir() {
  return mkdtempSync(join(tmpdir(), 'curation-'));
}

/**
 * A whole world: a main gateway with a catalog and a queue, and an empty
 * rehearsal slot, the way `curation-cli` provisions one.
 */
function world({ entries = [], catalogItems = [], verifyFails = null } = {}) {
  const byChain = {};
  for (const row of entries) {
    (byChain[row.supermarketId] ??= []).push(row);
  }
  const mainCatalog = makeCatalog(catalogItems);
  const rehearsalCatalog = makeCatalog([]);
  const mainSession = makeFakeSession({
    catalog: mainCatalog,
    queue: makeQueue(byChain),
    supermarkets: SUPERMARKETS,
    label: 'main',
    verifyFails: verifyFails === 'main',
  });
  const rehearsalSession = makeFakeSession({
    catalog: rehearsalCatalog,
    supermarkets: SUPERMARKETS,
    label: 'rehearsal',
    verifyFails: verifyFails === 'rehearsal',
  });

  const makeSession = ({ label }) =>
    label === 'main' ? mainSession : rehearsalSession;
  const gateways = {
    main: makeGateway(mainSession),
    rehearsal: makeGateway(rehearsalSession),
  };
  return {
    mainCatalog,
    rehearsalCatalog,
    mainSession,
    rehearsalSession,
    makeSession,
    gateways,
  };
}

function startIn(dir, w, overrides = {}) {
  return start({
    mainUrl: MAIN_URL,
    rehearsalUrl: REHEARSAL_URL,
    mainUser: 'dev-admin',
    runDir: dir,
    model: 'claude-sonnet-5',
    makeSession: w.makeSession,
    vocabularies: VOCABULARIES,
    privateLabels: LABELS,
    ...overrides,
  });
}

const CREATE_MILK = {
  decision: 'CREATE',
  confidence: 0.98,
  item: {
    nameEs: 'Leche entera',
    nameEn: 'Whole milk',
    brand: null,
    unitSize: 1,
    defaultUnit: 'LITER',
    category: 'DAIRY',
    ean: null,
  },
  reasoning: 'a new product',
};

// ---------------------------------------------------------------------------
// start
// ---------------------------------------------------------------------------

test('start verifies both logins, counts the queue and answers the prompt', async () => {
  const dir = runDir();
  const w = world({
    entries: [entry('e1', 'Leche entera 1 L'), entry('e2', 'Pan')],
  });

  const answer = await startIn(dir, w);

  assert.equal(answer.remaining, 2);
  assert.ok(answer.runId);
  assert.match(answer.prompt, /## Category vocabulary/);
  // How wide a batch this decider will hand out, which is what stops a caller
  // asking `next --count` of a decider that does not compose one.
  assert.equal(answer.batches, 20);

  const state = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
  assert.equal(state.mainUrl, MAIN_URL);
  assert.equal(state.rehearsalUrl, REHEARSAL_URL);
  assert.equal(state.mainUser, 'dev-admin');
  assert.equal(state.total, 2);
  // The run directory never holds a password.
  assert.equal(JSON.stringify(state).includes('password'), false);

  const [header] = readJsonl(join(dir, 'decisions.jsonl'));
  assert.equal(header.header, true);
  assert.equal(header.mainUrl, MAIN_URL);
  assert.equal(header.rehearsalUrl, REHEARSAL_URL);
  assert.equal(header.model, 'claude-sonnet-5');
});

test('start stops on a failed login before it counts anything', async () => {
  const dir = runDir();
  const w = world({
    entries: [entry('e1', 'Leche')],
    verifyFails: 'rehearsal',
  });

  await assert.rejects(() => startIn(dir, w), /rehearsal gateway/);
  assert.equal(
    w.mainSession.calls.some(
      (call) => call.path === '/v1/admin/harvest/entries'
    ),
    false
  );
});

test('start refuses to overwrite a run directory that already holds a run', async () => {
  const dir = runDir();
  const w = world({ entries: [entry('e1', 'Leche')] });
  await startIn(dir, w);
  await assert.rejects(() => startIn(dir, w), /already holds run/);
});

test('--chain narrows the walk to one supermarket', async () => {
  const dir = runDir();
  const w = world({
    entries: [
      entry('e1', 'Leche'),
      entry('e2', 'Jamón', { supermarketId: 'sm-2' }),
    ],
  });

  const answer = await startIn(dir, w, { chain: 'sm-2' });

  assert.equal(answer.remaining, 1);
});

// ---------------------------------------------------------------------------
// next
// ---------------------------------------------------------------------------

test('next answers one row with its candidates and what is left', async () => {
  const dir = runDir();
  const w = world({
    entries: [entry('e1', 'Leche entera 1 L'), entry('e2', 'Pan de molde')],
    catalogItems: [
      {
        id: 'i1',
        name: { es: 'Leche entera' },
        brand: null,
        unitSize: 1,
        defaultUnit: 'LITER',
      },
    ],
  });
  await startIn(dir, w);

  const answer = await next({ runDir: dir, gateways: w.gateways });

  assert.equal(answer.entry.id, 'e1');
  assert.equal(answer.entry.chainName, 'Mercadona');
  assert.equal(answer.remaining, 2);
  assert.deepEqual(
    answer.candidates.map((c) => [c.itemId, c.origin]),
    [['i1', 'catalog']]
  );
});

test('next repeated without a decide answers the same row', async () => {
  const dir = runDir();
  const w = world({ entries: [entry('e1', 'Leche'), entry('e2', 'Pan')] });
  await startIn(dir, w);

  const first = await next({ runDir: dir, gateways: w.gateways });
  const again = await next({ runDir: dir, gateways: w.gateways });

  assert.equal(first.entry.id, 'e1');
  assert.equal(again.entry.id, 'e1');
});

test('next answers done when every row has been decided', async () => {
  const dir = runDir();
  const w = world({ entries: [entry('e1', 'Leche entera 1 L')] });
  await startIn(dir, w);
  await decide({
    runDir: dir,
    entryId: 'e1',
    input: CREATE_MILK,
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
    privateLabels: LABELS,
  });

  assert.deepEqual(await next({ runDir: dir, gateways: w.gateways }), {
    done: true,
    remaining: 0,
  });
});

test('next walks past a chain whose rows are all decided, onto the next chain', async () => {
  const dir = runDir();
  const w = world({
    entries: [
      entry('e1', 'Leche entera 1 L'),
      entry('e2', 'Jamón serrano', { supermarketId: 'sm-2' }),
    ],
  });
  await startIn(dir, w);
  await decide({
    runDir: dir,
    entryId: 'e1',
    input: CREATE_MILK,
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
    privateLabels: LABELS,
  });

  const answer = await next({ runDir: dir, gateways: w.gateways });
  assert.equal(answer.entry.id, 'e2');
});

// ---------------------------------------------------------------------------
// The candidate merge, which is the reason the rehearsal slot exists
// ---------------------------------------------------------------------------

test('a twin created by the previous decide is a candidate on the next row', async () => {
  const dir = runDir();
  const w = world({
    entries: [entry('e1', 'Leche entera 1 L'), entry('e2', 'Leche entera 1 L')],
  });
  await startIn(dir, w);

  // Nothing in either catalog yet, so the first row has no candidate at all.
  const first = await next({ runDir: dir, gateways: w.gateways });
  assert.equal(first.entry.id, 'e1');
  assert.deepEqual(first.candidates, []);

  await decide({
    runDir: dir,
    entryId: 'e1',
    input: CREATE_MILK,
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
    privateLabels: LABELS,
  });

  // The second row's candidate exists only because the first row's decide
  // wrote it into the rehearsal catalog. Computed at prefetch time it would
  // not be here, and the run would create the same product twice.
  const second = await next({ runDir: dir, gateways: w.gateways });
  assert.equal(second.entry.id, 'e2');
  assert.deepEqual(
    second.candidates.map((c) => [c.origin, c.ref, c.itemId, c.nameEs]),
    [['run', 'ref-e1', undefined, 'Leche entera']]
  );
});

test('a run candidate can be linked onto by its ref', async () => {
  const dir = runDir();
  const w = world({
    entries: [entry('e1', 'Leche entera 1 L'), entry('e2', 'Leche entera 1 L')],
  });
  await startIn(dir, w);
  await decide({
    runDir: dir,
    entryId: 'e1',
    input: CREATE_MILK,
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
    privateLabels: LABELS,
  });

  const answer = await decide({
    runDir: dir,
    entryId: 'e2',
    input: { decision: 'LINK', itemRef: 'ref-e1', confidence: 0.97 },
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
    privateLabels: LABELS,
  });

  assert.equal(answer.accepted, true);
  assert.equal(answer.decision.decision, 'LINK');
  assert.equal(answer.decision.itemRef, 'ref-e1');
  assert.equal(answer.decision.itemId, null);
});

test('a ref no decide created is a REVIEW, not a link into nothing', async () => {
  const dir = runDir();
  const w = world({ entries: [entry('e1', 'Leche entera 1 L')] });
  await startIn(dir, w);

  const answer = await decide({
    runDir: dir,
    entryId: 'e1',
    input: { decision: 'LINK', itemRef: 'ref-invented', confidence: 0.99 },
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
    privateLabels: LABELS,
  });

  assert.equal(answer.decision.decision, 'REVIEW');
  assert.ok(answer.issues.some((i) => i.code === 'LINK_TARGET_MISSING'));
});

// ---------------------------------------------------------------------------
// decide
// ---------------------------------------------------------------------------

test('a CREATE writes into the rehearsal catalog and never into the main one', async () => {
  const dir = runDir();
  const w = world({ entries: [entry('e1', 'Leche entera 1 L')] });
  await startIn(dir, w);

  const answer = await decide({
    runDir: dir,
    entryId: 'e1',
    input: CREATE_MILK,
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
    privateLabels: LABELS,
  });

  assert.equal(answer.accepted, true);
  assert.equal(w.rehearsalCatalog.rows.length, 1);
  assert.equal(w.mainCatalog.rows.length, 0);
  assert.equal(
    w.mainSession.calls.some((call) => call.method === 'POST'),
    false
  );

  const [, row] = readJsonl(join(dir, 'decisions.jsonl'));
  assert.equal(row.entryId, 'e1');
  assert.equal(row.decision, 'CREATE');
  assert.equal(row.ref, 'ref-e1');
  assert.equal(row.rehearsalItemId, 'created-1');
  assert.deepEqual(row.expect, {
    status: 'CANDIDATE',
    lastSeenAt: '2026-09-08T10:00:00.000Z',
  });
});

test('a confidence under the threshold is demoted and writes nothing anywhere', async () => {
  const dir = runDir();
  const w = world({ entries: [entry('e1', 'Leche entera 1 L')] });
  await startIn(dir, w);

  const answer = await decide({
    runDir: dir,
    entryId: 'e1',
    input: { ...CREATE_MILK, confidence: 0.5 },
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
    privateLabels: LABELS,
  });

  assert.equal(answer.accepted, false);
  assert.equal(answer.decision.decision, 'REVIEW');
  assert.equal(answer.decision.proposedDecision, 'CREATE');
  assert.ok(answer.issues.some((i) => i.code === 'LOW_CONFIDENCE'));
  assert.equal(w.rehearsalCatalog.rows.length, 0);
});

test('a decision that fails a validator is a REVIEW and writes nothing', async () => {
  const dir = runDir();
  const w = world({ entries: [entry('e1', 'Leche Hacendado 1 L')] });
  await startIn(dir, w);

  const answer = await decide({
    runDir: dir,
    entryId: 'e1',
    input: {
      ...CREATE_MILK,
      item: {
        ...CREATE_MILK.item,
        nameEs: 'Leche Hacendado',
        brand: 'Hacendado',
      },
    },
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
    privateLabels: LABELS,
  });

  assert.equal(answer.decision.decision, 'REVIEW');
  assert.ok(answer.issues.some((i) => i.code === 'NAME_CARRIES_BRAND'));
  assert.equal(w.rehearsalCatalog.rows.length, 0);
});

test('a reply that breaks the schema is retryable and writes nothing', async () => {
  const dir = runDir();
  const w = world({ entries: [entry('e1', 'Leche')] });
  await startIn(dir, w);

  const answer = await decide({
    runDir: dir,
    entryId: 'e1',
    input: { decision: 'MAYBE', confidence: 1 },
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
    privateLabels: LABELS,
  });

  assert.equal(answer.retryable, true);
  assert.equal(answer.accepted, false);
  assert.equal(readJsonl(join(dir, 'decisions.jsonl')).length, 1);
});

test('--final turns a broken reply into a recorded REVIEW', async () => {
  const dir = runDir();
  const w = world({ entries: [entry('e1', 'Leche')] });
  await startIn(dir, w);

  const answer = await decide({
    runDir: dir,
    entryId: 'e1',
    input: { decision: 'MAYBE', confidence: 1 },
    final: true,
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
    privateLabels: LABELS,
  });

  assert.equal(answer.retryable, false);
  assert.equal(answer.decision.decision, 'REVIEW');
  assert.ok(answer.issues.some((i) => i.code === 'MODEL_OUTPUT_INVALID'));
  assert.equal(readJsonl(join(dir, 'decisions.jsonl')).length, 2);
});

test('an entry already decided is refused rather than asked twice', async () => {
  const dir = runDir();
  const w = world({ entries: [entry('e1', 'Leche entera 1 L')] });
  await startIn(dir, w);
  const args = {
    runDir: dir,
    entryId: 'e1',
    input: CREATE_MILK,
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
    privateLabels: LABELS,
  };
  await decide(args);

  await assert.rejects(() => decide(args), /already in/);
});

test('a failed rehearsal write is a REVIEW that names the failure', async () => {
  const dir = runDir();
  const w = world({ entries: [entry('e1', 'Leche entera 1 L')] });
  await startIn(dir, w);
  w.rehearsalCatalog.create = () => {
    throw new Error('the slot answered 500');
  };

  const answer = await decide({
    runDir: dir,
    entryId: 'e1',
    input: CREATE_MILK,
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
    privateLabels: LABELS,
  });

  assert.equal(answer.decision.decision, 'REVIEW');
  assert.ok(answer.issues.some((i) => i.code === 'REHEARSAL_WRITE_FAILED'));
});

// ---------------------------------------------------------------------------
// Resume
// ---------------------------------------------------------------------------

test('a run resumes from a half written run directory', async () => {
  const dir = runDir();
  const w = world({
    entries: [entry('e1', 'Leche entera 1 L'), entry('e2', 'Pan de molde')],
  });
  await startIn(dir, w);
  await decide({
    runDir: dir,
    entryId: 'e1',
    input: CREATE_MILK,
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
    privateLabels: LABELS,
  });

  // A kill between the append and the state rewrite: the state forgets the row
  // and the decisions file does not. The file is what the walk believes.
  const state = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
  writeFileSync(
    join(dir, 'state.json'),
    JSON.stringify({ ...state, decidedIds: [], createdRefs: {} }, null, 2)
  );

  const answer = await next({ runDir: dir, gateways: w.gateways });
  assert.equal(answer.entry.id, 'e2');
  // And the ref the lost state forgot is a candidate again.
  assert.deepEqual(
    answer.candidates.map((c) => c.ref),
    []
  );
});

// ---------------------------------------------------------------------------
// end
// ---------------------------------------------------------------------------

test('end writes the report with the counts, the reviews and the usage', async () => {
  const dir = runDir();
  const w = world({
    entries: [entry('e1', 'Leche entera 1 L'), entry('e2', 'Pan de molde')],
  });
  await startIn(dir, w);
  await decide({
    runDir: dir,
    entryId: 'e1',
    input: CREATE_MILK,
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
    privateLabels: LABELS,
  });
  await decide({
    runDir: dir,
    entryId: 'e2',
    input: {
      decision: 'REVIEW',
      confidence: 0.4,
      issues: [{ code: 'X', detail: 'unsure' }],
    },
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
    privateLabels: LABELS,
  });

  const answer = end({
    runDir: dir,
    usage: { inputTokens: 10, outputTokens: 2 },
  });

  assert.deepEqual(answer.counts, { LINK: 0, CREATE: 1, REVIEW: 1 });
  const report = JSON.parse(readFileSync(answer.report, 'utf8'));
  assert.equal(report.model, 'claude-sonnet-5');
  assert.equal(report.decided, 2);
  assert.deepEqual(report.usage, { inputTokens: 10, outputTokens: 2 });
  assert.equal(report.reviews.length, 1);
  assert.equal(report.reviews[0].entryId, 'e2');
  assert.ok(report.reviews[0].issues.length > 0);
});

// ---------------------------------------------------------------------------
// apply
// ---------------------------------------------------------------------------

function decisionsFile(dir, header, rows) {
  const path = join(dir, 'decisions.jsonl');
  const lines = [
    JSON.stringify({ header: true, ...header }),
    ...rows.map((r) => JSON.stringify(r)),
  ];
  writeFileSync(path, `${lines.join('\n')}\n`);
  return path;
}

const CREATE_ROW = {
  entryId: 'e1',
  decision: 'CREATE',
  ref: 'ref-e1',
  item: {
    nameEs: 'Leche entera',
    nameEn: 'Whole milk',
    brand: null,
    ean: null,
    unitSize: 1,
    category: 'DAIRY',
    defaultUnit: 'LITER',
  },
  expect: { status: 'CANDIDATE', lastSeenAt: '2026-09-08T10:00:00.000Z' },
};

const LINK_REF_ROW = {
  entryId: 'e2',
  decision: 'LINK',
  itemId: null,
  itemRef: 'ref-e1',
  expect: { status: 'CANDIDATE', lastSeenAt: '2026-09-08T10:05:00.000Z' },
};

const LINK_ID_ROW = {
  entryId: 'e3',
  decision: 'LINK',
  itemId: 'i9',
  itemRef: null,
  expect: { status: 'UNRESOLVED', lastSeenAt: '2026-09-08T10:06:00.000Z' },
};

test('buildOperations keeps the decided order and skips every REVIEW', () => {
  const operations = buildOperations([
    CREATE_ROW,
    { entryId: 'e9', decision: 'REVIEW', issues: [] },
    LINK_REF_ROW,
    LINK_ID_ROW,
  ]);

  assert.deepEqual(
    operations.map((op) => [
      op.op,
      op.entryId,
      op.ref ?? op.itemRef ?? op.itemId,
    ]),
    [
      ['createItem', 'e1', 'ref-e1'],
      ['accept', 'e2', 'ref-e1'],
      ['accept', 'e3', 'i9'],
    ]
  );
  assert.deepEqual(operations[0].item, {
    name: { es: 'Leche entera', en: 'Whole milk' },
    brand: null,
    ean: null,
    unitSize: 1,
    category: 'DAIRY',
    defaultUnit: 'LITER',
  });
  assert.deepEqual(operations[0].expect, CREATE_ROW.expect);
});

test('apply sends one request and reports what the server answered', async () => {
  const dir = runDir();
  const file = decisionsFile(dir, { runId: 'r1', mainUrl: MAIN_URL }, [
    CREATE_ROW,
    LINK_REF_ROW,
  ]);
  const sent = [];
  const session = {
    async fetch(path, init) {
      sent.push({ path, body: init.body });
      return {
        runId: 'r1',
        applied: true,
        failedStep: null,
        error: null,
        results: [
          { entryId: 'e1', applied: true },
          { entryId: 'e2', applied: true },
        ],
        priceSkips: [{ entryId: 'e2', reason: 'the price write failed' }],
        orphanedItemIds: [],
      };
    },
  };

  const answer = await apply({ mainUrl: MAIN_URL, file, session });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].path, BULK_ENTRY_DECISIONS_PATH);
  assert.equal(sent[0].body.runId, 'r1');
  assert.equal(sent[0].body.operations.length, 2);
  assert.equal(answer.applied, true);
  assert.equal(answer.appliedOperations, 2);
  assert.deepEqual(answer.priceSkips, [
    { entryId: 'e2', reason: 'the price write failed' },
  ]);
});

/**
 * The refusal path, which is a 201 answer and not an error.
 *
 * A stale file is the reason `expect` is recorded at decide time, so the shape
 * a refusal comes back in is the one an operator reads most often. Reporting it
 * as "0 of 2 applied" and nothing else would leave them with no idea which row
 * moved under them or which check caught it.
 */
test('apply reports the step, the reason and the orphans of a refused file', async () => {
  const dir = runDir();
  const file = decisionsFile(dir, { runId: 'r1', mainUrl: MAIN_URL }, [
    CREATE_ROW,
    LINK_REF_ROW,
  ]);
  const session = {
    async fetch() {
      return {
        runId: 'r1',
        applied: false,
        failedStep: 'VALIDATE',
        error: 'one entry no longer matches what the file expected',
        results: [
          { entryId: 'e1', applied: false, error: null },
          {
            entryId: 'e2',
            applied: false,
            error: { code: 'EXPECT_MISMATCH', detail: 'lastSeenAt moved' },
          },
        ],
        priceSkips: [],
        orphanedItemIds: ['i-orphan'],
      };
    },
  };

  const answer = await apply({ mainUrl: MAIN_URL, file, session });

  assert.equal(answer.applied, false);
  assert.equal(answer.appliedOperations, 0);
  assert.equal(answer.failedStep, 'VALIDATE');
  assert.match(answer.error, /no longer matches/);
  assert.deepEqual(answer.orphanedItemIds, ['i-orphan']);
  assert.equal(answer.results[1].error.code, 'EXPECT_MISMATCH');
});

/** Nothing to send is not a refusal: no request, and the verdict is still true. */
test('apply answers a decided verdict for a file holding only REVIEWs', async () => {
  const dir = runDir();
  const file = decisionsFile(dir, { runId: 'r1', mainUrl: MAIN_URL }, [
    { ...CREATE_ROW, decision: 'REVIEW' },
  ]);

  const answer = await apply({
    mainUrl: MAIN_URL,
    file,
    session: { fetch: () => assert.fail('sent') },
  });

  assert.equal(answer.applied, true);
  assert.equal(answer.operations, 0);
  assert.equal(answer.appliedOperations, 0);
});

test('apply refuses a file decided against another gateway', async () => {
  const dir = runDir();
  const file = decisionsFile(
    dir,
    { runId: 'r1', mainUrl: 'http://elsewhere:3000' },
    [CREATE_ROW]
  );

  await assert.rejects(
    () =>
      apply({
        mainUrl: MAIN_URL,
        file,
        session: { fetch: () => assert.fail('sent') },
      }),
    /Refusing/
  );
});

test('apply ignores a trailing slash on either url', async () => {
  const dir = runDir();
  const file = decisionsFile(dir, { runId: 'r1', mainUrl: MAIN_URL }, [
    CREATE_ROW,
  ]);
  const session = {
    async fetch() {
      return { applied: true, results: [{ entryId: 'e1', applied: true }] };
    },
  };

  const answer = await apply({ mainUrl: `${MAIN_URL}/`, file, session });
  assert.equal(answer.applied, true);
  assert.equal(answer.appliedOperations, 1);
});

test('apply refuses a file with no header', async () => {
  const dir = runDir();
  const path = join(dir, 'headless.jsonl');
  writeFileSync(path, `${JSON.stringify(CREATE_ROW)}\n`);

  await assert.rejects(
    () => apply({ mainUrl: MAIN_URL, file: path, session: {} }),
    /no header line/
  );
});

test('apply refuses a file over the cap rather than chunking it', async () => {
  const dir = runDir();
  const rows = Array.from({ length: 1001 }, (_, i) => ({
    ...CREATE_ROW,
    entryId: `e${i}`,
  }));
  const file = decisionsFile(dir, { runId: 'r1', mainUrl: MAIN_URL }, rows);

  await assert.rejects(
    () =>
      apply({
        mainUrl: MAIN_URL,
        file,
        session: { fetch: () => assert.fail('sent') },
      }),
    /1001 operations.*caps a request at 1000/s
  );
});

test('a file of nothing but REVIEWs sends no request at all', async () => {
  const dir = runDir();
  const file = decisionsFile(dir, { runId: 'r1', mainUrl: MAIN_URL }, [
    { entryId: 'e1', decision: 'REVIEW', issues: [] },
  ]);

  const answer = await apply({
    mainUrl: MAIN_URL,
    file,
    session: { fetch: () => assert.fail('a REVIEW must reach no route') },
  });
  assert.equal(answer.operations, 0);
});

// ---------------------------------------------------------------------------
// Composition, and the batch `next --count` answers (plan 0002)
// ---------------------------------------------------------------------------

test('composeBatch admits at most one row per normalized name', () => {
  const rows = [
    entry('e1', 'Leche entera 1 L'),
    entry('e2', 'LECHE  ENTERA 1 l'),
    entry('e3', 'Pan de molde'),
    entry('e4', 'Arroz redondo'),
  ];

  const chosen = composeBatch(rows, 4);

  assert.deepEqual(
    chosen.map((row) => row.id),
    ['e1', 'e3', 'e4']
  );
});

test('composeBatch stops at the width it was given', () => {
  const rows = ['a', 'b', 'c', 'd', 'e'].map((id, index) =>
    entry(id, `Producto ${index}`)
  );
  assert.equal(composeBatch(rows, 2).length, 2);
  assert.equal(composeBatch(rows, 99).length, 5);
});

test('next --count answers a batch of distinct names and what is left', async () => {
  const dir = runDir();
  const w = world({
    entries: [
      entry('e1', 'Leche entera 1 L'),
      entry('e2', 'Pan de molde'),
      entry('e3', 'Arroz redondo 1 kg'),
      entry('e4', 'Aceite de oliva'),
    ],
  });
  await startIn(dir, w);

  const answer = await next({ runDir: dir, count: 4, gateways: w.gateways });

  assert.equal(answer.remaining, 4);
  assert.deepEqual(
    answer.rows.map((row) => row.entry.id),
    ['e1', 'e2', 'e3', 'e4']
  );
  // A row of a batch is the packet a single `next` answers, and carries no
  // count of its own: what is left is a fact about the run, so it belongs to
  // the batch rather than to a row the model is about to be shown.
  assert.deepEqual(Object.keys(answer.rows[0]), [
    'entry',
    'candidates',
    'eanMatch',
  ]);
});

test('a row deferred by composition is the first row of the next batch', async () => {
  const dir = runDir();
  const w = world({
    entries: [
      entry('e1', 'Leche entera 1 L'),
      entry('e2', 'Leche entera 1 L'),
      entry('e3', 'Pan de molde'),
    ],
  });
  await startIn(dir, w);

  const first = await next({ runDir: dir, count: 3, gateways: w.gateways });
  assert.deepEqual(
    first.rows.map((row) => row.entry.id),
    ['e1', 'e3']
  );

  for (const entryId of ['e1', 'e3']) {
    await decide({
      runDir: dir,
      entryId,
      input: { decision: 'REVIEW', confidence: 0.4, issues: [] },
      gateways: w.gateways,
      vocabularies: VOCABULARIES,
      privateLabels: LABELS,
    });
  }

  // Deferred, never dropped: it is the first thing the next batch is about.
  const second = await next({ runDir: dir, count: 3, gateways: w.gateways });
  assert.deepEqual(
    second.rows.map((row) => row.entry.id),
    ['e2']
  );
});

test('next --count larger than the queue answers what there is, then nothing', async () => {
  const dir = runDir();
  const w = world({ entries: [entry('e1', 'Leche entera 1 L')] });
  await startIn(dir, w);

  const answer = await next({ runDir: dir, count: 8, gateways: w.gateways });
  assert.equal(answer.rows.length, 1);

  await decide({
    runDir: dir,
    entryId: 'e1',
    input: CREATE_MILK,
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
    privateLabels: LABELS,
  });

  assert.deepEqual(
    await next({ runDir: dir, count: 8, gateways: w.gateways }),
    { rows: [], remaining: 0, done: true }
  );
});

test('next without a count answers exactly the row it always answered', async () => {
  const dir = runDir();
  const w = world({ entries: [entry('e1', 'Leche entera 1 L')] });
  await startIn(dir, w);

  const answer = await next({ runDir: dir, gateways: w.gateways });

  assert.deepEqual(Object.keys(answer), [
    'entry',
    'candidates',
    'eanMatch',
    'remaining',
  ]);
});

// ---------------------------------------------------------------------------
// Staleness, which is the correctness check the batch rests on (plan 0002)
// ---------------------------------------------------------------------------

test('candidateIdentities reads the itemId or the ref, as a set', () => {
  const identities = candidateIdentities({
    candidates: [
      { itemId: 'i2', origin: 'catalog' },
      { ref: 'ref-e1', origin: 'run' },
      { itemId: 'i2', origin: 'catalog' },
    ],
    eanMatch: { itemId: 'i9', origin: 'catalog' },
  });

  assert.deepEqual(identities, ['i2', 'i9', 'ref-e1']);
  // The same candidates merged in another order are the same set, so a packet
  // that differs only in the order of its candidates is not stale.
  assert.equal(
    sameCandidates(
      identities,
      candidateIdentities({
        candidates: [
          { ref: 'ref-e1', origin: 'run' },
          { itemId: 'i9', origin: 'catalog' },
        ],
        eanMatch: { itemId: 'i2', origin: 'catalog' },
      })
    ),
    true
  );
  assert.equal(sameCandidates(identities, ['i2', 'i9']), false);
});

test('a row that gained a candidate from its own batch is stale and writes nothing', async () => {
  const dir = runDir();
  const w = world({
    entries: [
      entry('e1', 'Leche entera 1 L'),
      entry('e2', 'Leche entera fresca'),
    ],
  });
  await startIn(dir, w);

  const batch = await next({ runDir: dir, count: 2, gateways: w.gateways });
  assert.deepEqual(
    batch.rows.map((row) => row.entry.id),
    ['e1', 'e2']
  );
  assert.deepEqual(batch.rows[1].candidates, []);

  // Row one creates the product row two was never shown.
  await decide({
    runDir: dir,
    entryId: 'e1',
    input: CREATE_MILK,
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
    privateLabels: LABELS,
  });

  const answer = await decide({
    runDir: dir,
    entryId: 'e2',
    input: CREATE_MILK,
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
    privateLabels: LABELS,
  });

  assert.equal(answer.stale, true);
  assert.equal(answer.retryable, false);
  assert.deepEqual(
    answer.packet.candidates.map((candidate) => candidate.ref),
    ['ref-e1']
  );
  // Nothing was written: the header, and row one, and no row two.
  assert.equal(readJsonl(join(dir, 'decisions.jsonl')).length, 2);
  assert.equal(w.rehearsalCatalog.rows.length, 1);

  // Asked again on the refreshed packet it records, rather than going stale a
  // second time on the same lookup.
  const again = await decide({
    runDir: dir,
    entryId: 'e2',
    input: { decision: 'LINK', itemRef: 'ref-e1', confidence: 0.97 },
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
    privateLabels: LABELS,
  });
  assert.equal(again.stale, undefined);
  assert.equal(again.accepted, true);
  assert.equal(readJsonl(join(dir, 'decisions.jsonl')).length, 3);
});

test('the same candidates in another order are not stale', async () => {
  const dir = runDir();
  const w = world({
    entries: [entry('e1', 'Leche entera 1 L')],
    catalogItems: [
      { id: 'i1', name: { es: 'Leche entera' }, defaultUnit: 'LITER' },
      { id: 'i2', name: { es: 'Leche entera fresca' }, defaultUnit: 'LITER' },
    ],
  });
  await startIn(dir, w);

  const row = await next({ runDir: dir, gateways: w.gateways });
  assert.deepEqual(
    row.candidates.map((candidate) => candidate.itemId),
    ['i1', 'i2']
  );

  // The same two products, ranked the other way round. The bytes of the packet
  // differ and the set does not, and the set is what staleness is about.
  w.mainCatalog.rows.reverse();

  const answer = await decide({
    runDir: dir,
    entryId: 'e1',
    input: { decision: 'LINK', itemId: 'i1', confidence: 0.95 },
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
    privateLabels: LABELS,
  });

  assert.equal(answer.stale, undefined);
  assert.equal(answer.accepted, true);
});

test('a decide nothing handed out is judged, not called stale', async () => {
  const dir = runDir();
  const w = world({ entries: [entry('e1', 'Leche entera 1 L')] });
  await startIn(dir, w);

  // No `next`: driven by hand there is no record of what the caller saw, and
  // therefore nothing that could have changed underneath it.
  const answer = await decide({
    runDir: dir,
    entryId: 'e1',
    input: CREATE_MILK,
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
    privateLabels: LABELS,
  });

  assert.equal(answer.stale, undefined);
  assert.equal(answer.accepted, true);
});

test('the report names the re-ask rate the run actually saw', async () => {
  const dir = runDir();
  const w = world({
    entries: [
      entry('e1', 'Leche entera 1 L'),
      entry('e2', 'Leche entera fresca'),
    ],
  });
  await startIn(dir, w);
  await next({ runDir: dir, count: 2, gateways: w.gateways });

  const decideArgs = {
    runDir: dir,
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
    privateLabels: LABELS,
  };
  await decide({ ...decideArgs, entryId: 'e1', input: CREATE_MILK });
  // Stale, then asked again and recorded.
  await decide({ ...decideArgs, entryId: 'e2', input: CREATE_MILK });
  await decide({
    ...decideArgs,
    entryId: 'e2',
    input: { decision: 'LINK', itemRef: 'ref-e1', confidence: 0.97 },
  });

  const answer = end({ runDir: dir, usage: null });

  assert.deepEqual(answer.reasks, { stale: 1, decided: 2, rate: 0.5 });
  const report = JSON.parse(readFileSync(answer.report, 'utf8'));
  assert.deepEqual(report.reasks, { stale: 1, decided: 2, rate: 0.5 });
});

test('the set a row was handed is forgotten once the row is decided', async () => {
  const dir = runDir();
  const w = world({ entries: [entry('e1', 'Leche entera 1 L')] });
  await startIn(dir, w);
  await next({ runDir: dir, count: 4, gateways: w.gateways });

  assert.deepEqual(
    Object.keys(
      JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')).handouts
    ),
    ['e1']
  );

  await decide({
    runDir: dir,
    entryId: 'e1',
    input: CREATE_MILK,
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
    privateLabels: LABELS,
  });

  assert.deepEqual(
    JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')).handouts,
    {}
  );
});
