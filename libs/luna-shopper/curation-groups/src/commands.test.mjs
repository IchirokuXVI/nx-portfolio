import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  BULK_GROUP_ASSIGNMENTS_PATH,
  apply,
  buildOperations,
  decide,
  end,
  next,
  start,
} from './commands.mjs';
import { makeGateway } from './gateway.mjs';
import { deriveUnitFamilies } from './rules.mjs';
import { readJsonl } from './run-dir.mjs';
import { makeCatalog, makeFakeSession } from './test-fakes.mjs';

const MAIN_URL = 'http://localhost:3000';
const REHEARSAL_URL = 'http://localhost:43000';

const UNITS = ['UNIT', 'LITER', 'GRAM', 'KILOGRAM', 'MILLILITER', 'PACK'];
const FAMILIES = deriveUnitFamilies(UNITS);

function item(id, nameEs, overrides = {}) {
  return {
    id,
    name: { es: nameEs, en: null },
    brand: null,
    ean: null,
    unitSize: 1,
    category: 'DAIRY',
    defaultUnit: 'LITER',
    productGroupId: null,
    ...overrides,
  };
}

function group(id, nameEs, slug, overrides = {}) {
  return {
    id,
    name: { es: nameEs, en: null },
    slug,
    referenceUnit: 'LITER',
    synonyms: { es: [], en: [] },
    ...overrides,
  };
}

function runDir() {
  return mkdtempSync(join(tmpdir(), 'curation-groups-'));
}

/**
 * A whole world: a main gateway with products and groups, and an empty
 * rehearsal slot, the way `curation-cli` provisions one.
 */
function world({ items = [], groups = [], verifyFails = null } = {}) {
  const mainCatalog = makeCatalog({ items, groups });
  const rehearsalCatalog = makeCatalog({});
  const mainSession = makeFakeSession({
    catalog: mainCatalog,
    label: 'main',
    verifyFails: verifyFails === 'main',
  });
  const rehearsalSession = makeFakeSession({
    catalog: rehearsalCatalog,
    label: 'rehearsal',
    verifyFails: verifyFails === 'rehearsal',
  });

  return {
    mainCatalog,
    rehearsalCatalog,
    mainSession,
    rehearsalSession,
    makeSession: ({ label }) =>
      label === 'main' ? mainSession : rehearsalSession,
    gateways: {
      main: makeGateway(mainSession),
      rehearsal: makeGateway(rehearsalSession),
    },
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
    units: UNITS,
    ...overrides,
  });
}

function decideIn(dir, w, itemId, input, overrides = {}) {
  return decide({
    runDir: dir,
    itemId,
    input,
    gateways: w.gateways,
    unitFamilies: FAMILIES,
    ...overrides,
  });
}

const CREATE_MILK = {
  decision: 'CREATE_GROUP',
  confidence: 0.98,
  group: {
    nameEs: 'Leche semidesnatada',
    nameEn: 'Semi-skimmed milk',
    slug: 'leche-semidesnatada',
    referenceUnit: 'LITER',
    synonyms: { es: ['leche semi'], en: [] },
  },
  reasoning: 'nothing found fits',
};

// ---------------------------------------------------------------------------
// start
// ---------------------------------------------------------------------------

test('start verifies both logins, counts the products and answers the prompt', async () => {
  const dir = runDir();
  const w = world({ items: [item('i1', 'Leche'), item('i2', 'Arroz')] });

  const answer = await startIn(dir, w);

  assert.equal(answer.remaining, 2);
  assert.equal(answer.ungrouped, 2);
  assert.match(answer.prompt, /product group/i);
  assert.match(answer.prompt, /- `LITER`/);

  const state = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
  assert.equal(state.mainUrl, MAIN_URL);
  assert.equal(state.rehearsalUrl, REHEARSAL_URL);
  assert.equal(state.total, 2);
  // The username is kept and the password never was.
  assert.equal(state.mainUser, 'dev-admin');
  assert.equal(state.password, undefined);
});

test('start stops on a failed login before it counts anything', async () => {
  const dir = runDir();
  const w = world({ items: [item('i1', 'Leche')], verifyFails: 'rehearsal' });

  await assert.rejects(
    () => startIn(dir, w),
    /could not sign in on the rehearsal gateway/
  );
  assert.equal(w.mainSession.calls.length, 0);
});

test('start refuses to overwrite a run directory that already holds a run', async () => {
  const dir = runDir();
  const w = world({ items: [item('i1', 'Leche')] });
  await startIn(dir, w);
  await assert.rejects(() => startIn(dir, w), /already holds run/);
});

test('a product a group already holds is not on the walk at all', async () => {
  const dir = runDir();
  const w = world({
    items: [item('i1', 'Leche'), item('i2', 'Arroz', { productGroupId: 'g9' })],
  });

  const answer = await startIn(dir, w);
  assert.equal(answer.remaining, 1);
});

test('--limit caps the run at the products the operator asked for', async () => {
  const dir = runDir();
  const w = world({
    items: [item('i1', 'Leche'), item('i2', 'Arroz'), item('i3', 'Queso')],
  });

  const answer = await startIn(dir, w, { limit: 2 });
  assert.equal(answer.remaining, 2);
  assert.equal(answer.ungrouped, 3);
});

// ---------------------------------------------------------------------------
// next
// ---------------------------------------------------------------------------

test('next answers one product with its candidates and what is left', async () => {
  const dir = runDir();
  const w = world({
    items: [
      item('i1', 'Leche semidesnatada Hacendado 1 L'),
      item('i2', 'Arroz'),
    ],
    groups: [group('g1', 'Leche semidesnatada', 'leche-semidesnatada')],
  });
  await startIn(dir, w);

  const answer = await next({ runDir: dir, gateways: w.gateways });

  assert.equal(answer.item.id, 'i1');
  assert.equal(answer.item.nameEs, 'Leche semidesnatada Hacendado 1 L');
  assert.equal(answer.remaining, 2);
  assert.deepEqual(
    answer.candidates.map((c) => [c.groupId, c.origin]),
    [['g1', 'catalog']]
  );
});

test('next repeated without a decide answers the same product', async () => {
  const dir = runDir();
  const w = world({ items: [item('i1', 'Leche'), item('i2', 'Arroz')] });
  await startIn(dir, w);

  const first = await next({ runDir: dir, gateways: w.gateways });
  const again = await next({ runDir: dir, gateways: w.gateways });
  assert.equal(first.item.id, again.item.id);
});

test('next answers done when every product has been decided', async () => {
  const dir = runDir();
  const w = world({ items: [item('i1', 'Leche')] });
  await startIn(dir, w);

  await decideIn(dir, w, 'i1', { decision: 'REVIEW', confidence: 0.2 });

  const answer = await next({ runDir: dir, gateways: w.gateways });
  assert.deepEqual(answer, { done: true, remaining: 0 });
});

test('next walks onto the following page when a whole page is decided', async () => {
  const dir = runDir();
  const items = Array.from({ length: 25 }, (_, i) =>
    item(`i${i}`, `Leche ${i}`)
  );
  const w = world({ items });
  await startIn(dir, w);

  for (let i = 0; i < 20; i++) {
    await decideIn(dir, w, `i${i}`, { decision: 'REVIEW', confidence: 0.1 });
  }

  const answer = await next({ runDir: dir, gateways: w.gateways });
  assert.equal(answer.item.id, 'i20');

  // The cursor moved, so the next `next` does not re-read the decided page.
  const state = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
  assert.equal(state.cursor, '20');
});

test('next stops at the limit even with products left over', async () => {
  const dir = runDir();
  const w = world({ items: [item('i1', 'Leche'), item('i2', 'Arroz')] });
  await startIn(dir, w, { limit: 1 });

  await decideIn(dir, w, 'i1', { decision: 'REVIEW', confidence: 0.2 });
  assert.deepEqual(await next({ runDir: dir, gateways: w.gateways }), {
    done: true,
    remaining: 0,
  });
});

// ---------------------------------------------------------------------------
// The candidate merge
// ---------------------------------------------------------------------------

test('a group the previous decide created is a candidate on the next product', async () => {
  const dir = runDir();
  const w = world({
    items: [
      item('i1', 'Leche semidesnatada Hacendado 1 L'),
      item('i2', 'Leche semidesnatada Pascual 1 L'),
    ],
  });
  await startIn(dir, w);

  // Nothing to join, so the first product invents the group.
  const first = await next({ runDir: dir, gateways: w.gateways });
  assert.deepEqual(first.candidates, []);
  const created = await decideIn(dir, w, 'i1', CREATE_MILK);
  assert.equal(created.decision.decision, 'CREATE_GROUP');

  // The second product finds it, and finds it through the search rather than
  // through a directory this library keeps: the rehearsal gateway answered it.
  const second = await next({ runDir: dir, gateways: w.gateways });
  assert.equal(second.item.id, 'i2');
  assert.deepEqual(
    second.candidates.map((c) => [c.ref, c.origin, c.slug]),
    [['ref-i1', 'run', 'leche-semidesnatada']]
  );
  assert.equal(second.candidates[0].groupId, undefined);
});

test('a run created group is assigned onto by its ref', async () => {
  const dir = runDir();
  const w = world({
    items: [
      item('i1', 'Leche semidesnatada Hacendado 1 L'),
      item('i2', 'Leche semidesnatada Pascual 1 L'),
    ],
  });
  await startIn(dir, w);
  await decideIn(dir, w, 'i1', CREATE_MILK);

  const answer = await decideIn(dir, w, 'i2', {
    decision: 'ASSIGN',
    groupRef: 'ref-i1',
    confidence: 0.96,
  });

  assert.equal(answer.decision.decision, 'ASSIGN');
  assert.equal(answer.decision.groupRef, 'ref-i1');
  assert.equal(answer.decision.groupId, null);
  assert.deepEqual(answer.issues, []);
});

test('a ref no decide created is a REVIEW, not an assignment into nothing', async () => {
  const dir = runDir();
  const w = world({ items: [item('i1', 'Leche')] });
  await startIn(dir, w);

  const answer = await decideIn(dir, w, 'i1', {
    decision: 'ASSIGN',
    groupRef: 'ref-invented',
    confidence: 0.99,
  });

  assert.equal(answer.decision.decision, 'REVIEW');
  assert.deepEqual(
    answer.issues.map((entry) => entry.code),
    ['GROUP_TARGET_MISSING']
  );
});

test('a rehearsal id is never a groupId a decision may name', async () => {
  const dir = runDir();
  const w = world({
    items: [
      item('i1', 'Leche semidesnatada Hacendado 1 L'),
      item('i2', 'Leche semidesnatada Pascual 1 L'),
    ],
  });
  await startIn(dir, w);
  const created = await decideIn(dir, w, 'i1', CREATE_MILK);
  const rehearsalId = created.decision.rehearsalGroupId;

  const answer = await decideIn(dir, w, 'i2', {
    decision: 'ASSIGN',
    groupId: rehearsalId,
    confidence: 0.99,
  });

  assert.equal(answer.decision.decision, 'REVIEW');
  assert.deepEqual(
    answer.issues.map((entry) => entry.code),
    ['GROUP_TARGET_MISSING']
  );
});

test('the searches happen at next time, not before it', async () => {
  const dir = runDir();
  const w = world({ items: [item('i1', 'Leche'), item('i2', 'Arroz')] });
  await startIn(dir, w);
  const before = w.rehearsalSession.calls.length;

  await next({ runDir: dir, gateways: w.gateways });

  const groupSearches = w.rehearsalSession.calls
    .slice(before)
    .filter((call) => call.path === '/v1/admin/catalog/product-groups');
  assert.equal(groupSearches.length, 1);
});

// ---------------------------------------------------------------------------
// decide
// ---------------------------------------------------------------------------

test('a CREATE_GROUP writes into the rehearsal catalog and never into the main one', async () => {
  const dir = runDir();
  const w = world({ items: [item('i1', 'Leche semidesnatada Hacendado 1 L')] });
  await startIn(dir, w);

  const answer = await decideIn(dir, w, 'i1', CREATE_MILK);

  assert.equal(answer.accepted, true);
  assert.equal(w.rehearsalCatalog.groups.length, 1);
  assert.equal(w.mainCatalog.groups.length, 0);
  assert.deepEqual(w.rehearsalCatalog.groups[0].name, {
    es: 'Leche semidesnatada',
    en: 'Semi-skimmed milk',
  });

  const record = readJsonl(join(dir, 'decisions.jsonl')).at(-1);
  assert.equal(record.ref, 'ref-i1');
  assert.deepEqual(record.expect, { productGroupId: null });
  assert.equal(record.group.slug, 'leche-semidesnatada');
});

test('a confidence under the threshold is demoted and writes nothing anywhere', async () => {
  const dir = runDir();
  const w = world({ items: [item('i1', 'Leche')] });
  await startIn(dir, w);

  const answer = await decideIn(dir, w, 'i1', {
    ...CREATE_MILK,
    confidence: 0.8,
  });

  assert.equal(answer.decision.decision, 'REVIEW');
  assert.equal(answer.decision.proposedDecision, 'CREATE_GROUP');
  assert.ok(answer.issues.some((entry) => entry.code === 'LOW_CONFIDENCE'));
  assert.equal(w.rehearsalCatalog.groups.length, 0);
});

test('a decision that fails a validator is a REVIEW and writes nothing', async () => {
  const dir = runDir();
  const w = world({
    items: [item('i1', 'Queso rallado', { defaultUnit: 'GRAM' })],
  });
  await startIn(dir, w);

  const answer = await decideIn(dir, w, 'i1', CREATE_MILK);

  assert.equal(answer.decision.decision, 'REVIEW');
  assert.ok(
    answer.issues.some((entry) => entry.code === 'UNIT_FAMILY_MISMATCH')
  );
  assert.equal(w.rehearsalCatalog.groups.length, 0);
});

test('a slug the catalog already holds is a REVIEW answered by searching', async () => {
  const dir = runDir();
  const w = world({
    items: [item('i1', 'Leche semidesnatada Hacendado 1 L')],
    groups: [
      group('g1', 'Leche desnatada', 'leche-semidesnatada', {
        synonyms: { es: [], en: [] },
      }),
    ],
  });
  await startIn(dir, w);

  const answer = await decideIn(dir, w, 'i1', CREATE_MILK);

  assert.equal(answer.decision.decision, 'REVIEW');
  assert.ok(answer.issues.some((entry) => entry.code === 'SLUG_TAKEN'));
});

test('a group the search already answers to is a REVIEW rather than a twin', async () => {
  const dir = runDir();
  const w = world({
    items: [item('i1', 'Leche semidesnatada Hacendado 1 L')],
    groups: [group('g1', 'Leche semidesnatada', 'leche-semi')],
  });
  await startIn(dir, w);

  const answer = await decideIn(dir, w, 'i1', CREATE_MILK);

  assert.equal(answer.decision.decision, 'REVIEW');
  assert.ok(answer.issues.some((entry) => entry.code === 'GROUP_DUPLICATE'));
});

test('a twin this run itself created is caught by the same search', async () => {
  const dir = runDir();
  const w = world({
    items: [
      item('i1', 'Leche semidesnatada Hacendado 1 L'),
      item('i2', 'Leche semidesnatada Pascual 1 L'),
    ],
  });
  await startIn(dir, w);
  await decideIn(dir, w, 'i1', CREATE_MILK);

  const answer = await decideIn(dir, w, 'i2', CREATE_MILK);

  assert.equal(answer.decision.decision, 'REVIEW');
  const found = answer.issues.map((entry) => entry.code);
  assert.ok(found.includes('SLUG_TAKEN') || found.includes('GROUP_DUPLICATE'));
  assert.equal(w.rehearsalCatalog.groups.length, 1);
});

test('a reply that breaks the schema is retryable and writes nothing', async () => {
  const dir = runDir();
  const w = world({ items: [item('i1', 'Leche')] });
  await startIn(dir, w);

  const answer = await decideIn(dir, w, 'i1', { decision: 'MAYBE' });

  assert.equal(answer.retryable, true);
  assert.equal(answer.decision, null);
  assert.equal(readJsonl(join(dir, 'decisions.jsonl')).length, 1);
});

test('--final turns a broken reply into a recorded REVIEW', async () => {
  const dir = runDir();
  const w = world({ items: [item('i1', 'Leche')] });
  await startIn(dir, w);

  const answer = await decideIn(
    dir,
    w,
    'i1',
    { decision: 'MAYBE' },
    { final: true }
  );

  assert.equal(answer.retryable, false);
  assert.equal(answer.decision.decision, 'REVIEW');
  assert.deepEqual(
    answer.issues.map((entry) => entry.code),
    ['MODEL_OUTPUT_INVALID']
  );
});

test('a product already decided is refused rather than asked twice', async () => {
  const dir = runDir();
  const w = world({ items: [item('i1', 'Leche')] });
  await startIn(dir, w);
  await decideIn(dir, w, 'i1', { decision: 'REVIEW', confidence: 0.1 });

  await assert.rejects(
    () => decideIn(dir, w, 'i1', { decision: 'REVIEW', confidence: 0.1 }),
    /already in/
  );
});

test('a failed rehearsal write is a REVIEW that names the failure', async () => {
  const dir = runDir();
  const w = world({ items: [item('i1', 'Leche semidesnatada Hacendado 1 L')] });
  await startIn(dir, w);
  const gateways = {
    main: w.gateways.main,
    rehearsal: makeGateway(
      makeFakeSession({
        catalog: w.rehearsalCatalog,
        label: 'rehearsal',
        createFails: true,
      })
    ),
  };

  const answer = await decideIn(dir, w, 'i1', CREATE_MILK, { gateways });

  assert.equal(answer.decision.decision, 'REVIEW');
  assert.equal(answer.decision.proposedDecision, 'CREATE_GROUP');
  assert.ok(
    answer.issues.some((entry) => entry.code === 'REHEARSAL_WRITE_FAILED')
  );
});

// ---------------------------------------------------------------------------
// Resuming
// ---------------------------------------------------------------------------

test('a run resumes from a half written run directory', async () => {
  const dir = runDir();
  const w = world({
    items: [
      item('i1', 'Leche semidesnatada Hacendado 1 L'),
      item('i2', 'Leche semidesnatada Pascual 1 L'),
    ],
  });
  await startIn(dir, w);
  await decideIn(dir, w, 'i1', CREATE_MILK);

  // A kill between the append and the state rewrite: the state forgets both the
  // decision and the ref, and the JSONL still holds them.
  const statePath = join(dir, 'state.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  writeFileSync(
    statePath,
    JSON.stringify({ ...state, decidedIds: [], createdRefs: {} }, null, 2)
  );

  const answer = await next({ runDir: dir, gateways: w.gateways });
  assert.equal(answer.item.id, 'i2');
  assert.deepEqual(
    answer.candidates.map((c) => c.ref),
    ['ref-i1']
  );
});

// ---------------------------------------------------------------------------
// end
// ---------------------------------------------------------------------------

test('end writes the report with the counts, the reviews and the usage', async () => {
  const dir = runDir();
  const w = world({
    items: [
      item('i1', 'Leche semidesnatada Hacendado 1 L'),
      item('i2', 'Leche semidesnatada Pascual 1 L'),
      item('i3', 'Algo raro'),
    ],
  });
  await startIn(dir, w);
  await decideIn(dir, w, 'i1', CREATE_MILK);
  await decideIn(dir, w, 'i2', {
    decision: 'ASSIGN',
    groupRef: 'ref-i1',
    confidence: 0.95,
  });
  await decideIn(dir, w, 'i3', {
    decision: 'REVIEW',
    confidence: 0.2,
    issues: [{ code: 'UNCLEAR', detail: 'the name says nothing' }],
  });

  const answer = end({ runDir: dir, usage: { calls: 3 } });
  const report = JSON.parse(readFileSync(answer.report, 'utf8'));

  assert.deepEqual(report.counts, { ASSIGN: 1, CREATE_GROUP: 1, REVIEW: 1 });
  assert.equal(report.decided, 3);
  assert.deepEqual(report.usage, { calls: 3 });
  assert.deepEqual(
    report.reviews.map((row) => row.itemId),
    ['i3']
  );
  assert.deepEqual(report.groupsProposed, [
    {
      ref: 'ref-i1',
      slug: 'leche-semidesnatada',
      name: { es: 'Leche semidesnatada', en: 'Semi-skimmed milk' },
      referenceUnit: 'LITER',
      forItemId: 'i1',
    },
  ]);
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
  itemId: 'i1',
  decision: 'CREATE_GROUP',
  ref: 'ref-i1',
  group: {
    nameEs: 'Leche semidesnatada',
    nameEn: 'Semi-skimmed milk',
    slug: 'leche-semidesnatada',
    referenceUnit: 'LITER',
    synonyms: { es: ['leche semi'], en: [] },
  },
  expect: { productGroupId: null },
};

const ASSIGN_REF_ROW = {
  itemId: 'i2',
  decision: 'ASSIGN',
  groupId: null,
  groupRef: 'ref-i1',
  expect: { productGroupId: null },
};

const ASSIGN_ID_ROW = {
  itemId: 'i3',
  decision: 'ASSIGN',
  groupId: 'g9',
  groupRef: null,
  expect: { productGroupId: null },
};

test('buildOperations creates every group before it assigns anything', () => {
  const operations = buildOperations([
    ASSIGN_ID_ROW,
    CREATE_ROW,
    { itemId: 'i9', decision: 'REVIEW', issues: [] },
    ASSIGN_REF_ROW,
  ]);

  assert.deepEqual(
    operations.map((op) => [op.op, op.ref ?? op.itemId]),
    [
      ['createGroup', 'ref-i1'],
      ['assignItem', 'i3'],
      ['assignItem', 'i1'],
      ['assignItem', 'i2'],
    ]
  );
});

test('buildOperations sends the group body catalog names', () => {
  const [create] = buildOperations([CREATE_ROW]);
  assert.deepEqual(create, {
    op: 'createGroup',
    ref: 'ref-i1',
    name: { es: 'Leche semidesnatada', en: 'Semi-skimmed milk' },
    slug: 'leche-semidesnatada',
    referenceUnit: 'LITER',
    synonyms: { es: ['leche semi'], en: [] },
  });
});

test('a CREATE_GROUP also assigns the product that needed it, by ref', () => {
  const operations = buildOperations([CREATE_ROW]);
  assert.deepEqual(operations[1], {
    op: 'assignItem',
    itemId: 'i1',
    groupRef: 'ref-i1',
    expect: { productGroupId: null },
  });
});

test('an assignment onto a real group carries its id and its expect', () => {
  const [assign] = buildOperations([ASSIGN_ID_ROW]);
  assert.deepEqual(assign, {
    op: 'assignItem',
    itemId: 'i3',
    groupId: 'g9',
    expect: { productGroupId: null },
  });
});

test('apply sends one request and reports what the server answered', async () => {
  const dir = runDir();
  const file = decisionsFile(dir, { runId: 'r1', mainUrl: MAIN_URL }, [
    CREATE_ROW,
    ASSIGN_REF_ROW,
  ]);
  const sent = [];
  const session = {
    async fetch(path, init) {
      sent.push({ path, body: init.body });
      return {
        applied: true,
        error: null,
        results: [
          { op: 'createGroup', ref: 'ref-i1', applied: true },
          { op: 'assignItem', itemId: 'i1', applied: true },
          { op: 'assignItem', itemId: 'i2', applied: true },
        ],
        createdGroups: [{ ref: 'ref-i1', groupId: 'g-new' }],
      };
    },
  };

  const answer = await apply({ mainUrl: MAIN_URL, file, session });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].path, BULK_GROUP_ASSIGNMENTS_PATH);
  assert.equal(sent[0].body.operations.length, 3);
  // The route takes operations and nothing else: a field it does not declare is
  // refused by the gateway's own validation pipe.
  assert.deepEqual(Object.keys(sent[0].body), ['operations']);
  assert.equal(answer.applied, true);
  assert.deepEqual(answer.createdGroups, [{ ref: 'ref-i1', groupId: 'g-new' }]);
});

test('a refused request is reported rather than thrown', async () => {
  const dir = runDir();
  const file = decisionsFile(dir, { runId: 'r1', mainUrl: MAIN_URL }, [
    ASSIGN_ID_ROW,
  ]);
  const session = {
    async fetch() {
      return {
        applied: false,
        error: null,
        results: [
          {
            op: 'assignItem',
            itemId: 'i3',
            applied: false,
            error: { code: 'EXPECTATION_FAILED', detail: 'already sorted' },
          },
        ],
        createdGroups: [],
      };
    },
  };

  const answer = await apply({ mainUrl: MAIN_URL, file, session });
  assert.equal(answer.applied, false);
  assert.equal(answer.results[0].error.code, 'EXPECTATION_FAILED');
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
    ASSIGN_ID_ROW,
  ]);
  const session = {
    async fetch() {
      return { applied: true, results: [], createdGroups: [] };
    },
  };

  const answer = await apply({ mainUrl: `${MAIN_URL}/`, file, session });
  assert.equal(answer.applied, true);
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
  const rows = Array.from({ length: 501 }, (_, i) => ({
    ...CREATE_ROW,
    itemId: `i${i}`,
    ref: `ref-i${i}`,
  }));
  const file = decisionsFile(dir, { runId: 'r1', mainUrl: MAIN_URL }, rows);

  // A CREATE_GROUP is two operations, so five hundred and one of them is over
  // the thousand the route accepts.
  await assert.rejects(
    () =>
      apply({
        mainUrl: MAIN_URL,
        file,
        session: { fetch: () => assert.fail('sent') },
      }),
    /1002 operations.*caps a request at 1000/s
  );
});

test('a file of nothing but REVIEWs sends no request at all', async () => {
  const dir = runDir();
  const file = decisionsFile(dir, { runId: 'r1', mainUrl: MAIN_URL }, [
    { itemId: 'i1', decision: 'REVIEW', issues: [] },
  ]);

  const answer = await apply({
    mainUrl: MAIN_URL,
    file,
    session: { fetch: () => assert.fail('a REVIEW must reach no route') },
  });
  assert.equal(answer.operations, 0);
  assert.equal(answer.applied, false);
});
