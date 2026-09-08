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
import { TEST_UNITS, makeCatalog, makeFakeSession } from './test-fakes.mjs';

const MAIN_URL = 'http://localhost:3000';
const REHEARSAL_URL = 'http://localhost:43000';

const VOCABULARIES = {
  units: TEST_UNITS,
  unitFamilies: deriveUnitFamilies(TEST_UNITS),
};

function item(id, nameEs, overrides = {}) {
  return {
    id,
    name: { es: nameEs, en: null },
    brand: null,
    ean: null,
    unitSize: 1,
    defaultUnit: 'LITER',
    category: 'DAIRY',
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
function world({
  items = [],
  groups = [],
  verifyFails = null,
  createGroupFails = false,
} = {}) {
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
    createGroupFails,
  });
  const sessions = { main: mainSession, rehearsal: rehearsalSession };
  return {
    mainCatalog,
    rehearsalCatalog,
    sessions,
    gateways: {
      main: makeGateway(mainSession),
      rehearsal: makeGateway(rehearsalSession),
    },
    makeSession: ({ label }) => sessions[label],
  };
}

function assign(groupId, confidence = 0.95) {
  return {
    decision: 'ASSIGN',
    groupId,
    confidence,
    reasoning: 'same purchase',
  };
}

function assignRef(groupRef, confidence = 0.95) {
  return {
    decision: 'ASSIGN',
    groupRef,
    confidence,
    reasoning: 'the group made earlier',
  };
}

function createGroup(nameEs, slug, overrides = {}) {
  return {
    decision: 'CREATE_GROUP',
    confidence: 0.95,
    reasoning: 'nothing fits',
    group: {
      nameEs,
      nameEn: nameEs,
      slug,
      referenceUnit: 'LITER',
      synonyms: { es: [], en: [] },
      ...overrides,
    },
  };
}

// ---------------------------------------------------------------------------
// start
// ---------------------------------------------------------------------------

test('start verifies both logins, counts the ungrouped products and answers the prompt', async () => {
  const dir = runDir();
  const { makeSession } = world({
    items: [
      item('i1', 'Leche entera'),
      item('i2', 'Leche semidesnatada'),
      item('i3', 'Aceite', { productGroupId: 'g9' }),
    ],
  });

  const answer = await start({
    mainUrl: MAIN_URL,
    rehearsalUrl: REHEARSAL_URL,
    runDir: dir,
    makeSession,
    vocabularies: VOCABULARIES,
  });

  assert.ok(answer.runId);
  // The grouped product is not part of the queue and is not counted.
  assert.equal(answer.remaining, 2);
  assert.match(answer.prompt, /product group/i);
  const state = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
  assert.equal(state.mainUrl, MAIN_URL);
  assert.equal(state.total, 2);
});

test('start stops on a login that fails, before any model token is spent', async () => {
  for (const gateway of ['main', 'rehearsal']) {
    const dir = runDir();
    const { makeSession } = world({
      items: [item('i1', 'Leche')],
      verifyFails: gateway,
    });
    await assert.rejects(
      () =>
        start({
          mainUrl: MAIN_URL,
          rehearsalUrl: REHEARSAL_URL,
          runDir: dir,
          makeSession,
          vocabularies: VOCABULARIES,
        }),
      new RegExp(`could not sign in on the ${gateway} gateway`)
    );
  }
});

test('start refuses to overwrite a run directory that already holds a run', async () => {
  const dir = runDir();
  const { makeSession } = world({ items: [item('i1', 'Leche')] });
  const options = {
    mainUrl: MAIN_URL,
    rehearsalUrl: REHEARSAL_URL,
    runDir: dir,
    makeSession,
    vocabularies: VOCABULARIES,
  };

  await start(options);
  await assert.rejects(() => start(options), /already holds run/);
});

// ---------------------------------------------------------------------------
// next
// ---------------------------------------------------------------------------

async function started(dir, w) {
  await start({
    mainUrl: MAIN_URL,
    rehearsalUrl: REHEARSAL_URL,
    runDir: dir,
    makeSession: w.makeSession,
    vocabularies: VOCABULARIES,
  });
  return w;
}

test('next answers one product with the groups a search found', async () => {
  const dir = runDir();
  const w = await started(
    dir,
    world({
      items: [item('i1', 'Leche semidesnatada')],
      groups: [group('g1', 'Leche semidesnatada', 'leche-semidesnatada')],
    })
  );

  const answer = await next({ runDir: dir, gateways: w.gateways });

  assert.equal(answer.item.id, 'i1');
  assert.equal(answer.remaining, 1);
  assert.equal(answer.candidates.length, 1);
  assert.deepEqual(answer.candidates[0], {
    groupId: 'g1',
    origin: 'catalog',
    nameEs: 'Leche semidesnatada',
    nameEn: null,
    slug: 'leche-semidesnatada',
    referenceUnit: 'LITER',
    synonyms: { es: [], en: [] },
  });
});

test('next answers done once every product has been decided', async () => {
  const dir = runDir();
  const w = await started(dir, world({ items: [item('i1', 'Leche entera')] }));

  await decide({
    runDir: dir,
    itemId: 'i1',
    input: { decision: 'REVIEW', confidence: 0.2, issues: [] },
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
  });

  assert.deepEqual(await next({ runDir: dir, gateways: w.gateways }), {
    done: true,
    remaining: 0,
  });
});

/**
 * The merge, at `next` time and not at prefetch time.
 *
 * Two products of the same purchase, an empty catalog, and the second one's
 * only candidate is the group the first one's `decide` created. This is the
 * whole reason the rehearsal slot exists: candidates computed in advance would
 * offer none, and the run would invent the same group twice.
 */
test('a group this run created is a candidate for the next product', async () => {
  const dir = runDir();
  const w = await started(
    dir,
    world({
      items: [
        item('i1', 'Leche semidesnatada'),
        item('i2', 'Leche semidesnatada'),
      ],
    })
  );

  const first = await next({ runDir: dir, gateways: w.gateways });
  assert.deepEqual(first.candidates, []);

  await decide({
    runDir: dir,
    itemId: 'i1',
    input: createGroup('Leche semidesnatada', 'leche-semidesnatada'),
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
  });

  const second = await next({ runDir: dir, gateways: w.gateways });

  assert.equal(second.item.id, 'i2');
  assert.equal(second.candidates.length, 1);
  assert.deepEqual(second.candidates[0].ref, 'ref-i1');
  assert.equal(second.candidates[0].origin, 'run');
  assert.equal(second.candidates[0].groupId, undefined);
});

/** A rehearsal group nothing in this run created could never be replayed. */
test('a rehearsal group with no ref is not offered as a candidate', async () => {
  const dir = runDir();
  const w = await started(dir, world({ items: [item('i1', 'Leche entera')] }));
  w.rehearsalCatalog.createGroup({
    name: { es: 'Leche entera' },
    slug: 'leche-entera',
    referenceUnit: 'LITER',
  });

  const answer = await next({ runDir: dir, gateways: w.gateways });
  assert.deepEqual(answer.candidates, []);
});

/**
 * The JSONL is the record of truth, because it is appended before the state is
 * rewritten. A kill between the two must not cost a decision.
 */
test('the walk skips a decided product even when the state lost it', async () => {
  const dir = runDir();
  const w = await started(
    dir,
    world({ items: [item('i1', 'Leche entera'), item('i2', 'Aceite')] })
  );

  await decide({
    runDir: dir,
    itemId: 'i1',
    input: { decision: 'REVIEW', confidence: 0.1, issues: [] },
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
  });

  const statePath = join(dir, 'state.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  state.decidedIds = [];
  writeFileSync(statePath, JSON.stringify(state));

  const answer = await next({ runDir: dir, gateways: w.gateways });
  assert.equal(answer.item.id, 'i2');
});

// ---------------------------------------------------------------------------
// decide
// ---------------------------------------------------------------------------

test('a reply that breaks the schema is retryable and writes nothing', async () => {
  const dir = runDir();
  const w = await started(dir, world({ items: [item('i1', 'Leche')] }));

  const answer = await decide({
    runDir: dir,
    itemId: 'i1',
    input: { decision: 'MAYBE', confidence: 1 },
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
  });

  assert.equal(answer.retryable, true);
  assert.equal(answer.accepted, false);
  assert.equal(readJsonl(join(dir, 'decisions.jsonl')).length, 1);
});

test('--final records a broken reply as a REVIEW carrying the parse failure', async () => {
  const dir = runDir();
  const w = await started(dir, world({ items: [item('i1', 'Leche')] }));

  const answer = await decide({
    runDir: dir,
    itemId: 'i1',
    input: { decision: 'MAYBE', confidence: 1 },
    final: true,
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
  });

  assert.equal(answer.retryable, false);
  assert.equal(answer.decision.decision, 'REVIEW');
  assert.equal(answer.issues[0].code, 'MODEL_OUTPUT_INVALID');
});

test('confidence below the threshold demotes a decision to REVIEW', async () => {
  const dir = runDir();
  const w = await started(
    dir,
    world({
      items: [item('i1', 'Leche semidesnatada')],
      groups: [group('g1', 'Leche semidesnatada', 'leche-semidesnatada')],
    })
  );

  const answer = await decide({
    runDir: dir,
    itemId: 'i1',
    input: assign('g1', 0.7),
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
  });

  assert.equal(answer.decision.decision, 'REVIEW');
  assert.equal(answer.decision.proposedDecision, 'ASSIGN');
  assert.ok(answer.issues.some((one) => one.code === 'LOW_CONFIDENCE'));
});

test('a clean ASSIGN is recorded with the expect the server re-asserts', async () => {
  const dir = runDir();
  const w = await started(
    dir,
    world({
      items: [item('i1', 'Leche semidesnatada')],
      groups: [group('g1', 'Leche semidesnatada', 'leche-semidesnatada')],
    })
  );

  const answer = await decide({
    runDir: dir,
    itemId: 'i1',
    input: assign('g1'),
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
  });

  assert.equal(answer.accepted, true);
  assert.equal(answer.decision.decision, 'ASSIGN');
  assert.equal(answer.decision.groupId, 'g1');
  assert.deepEqual(answer.decision.expect, { productGroupId: null });
  // An ASSIGN writes nowhere, not even in the rehearsal slot: what the next
  // product's search has to see is a group, and no group was made.
  assert.equal(w.rehearsalCatalog.groups.length, 0);
});

test('a CREATE_GROUP writes the group in the rehearsal slot and never in the main catalog', async () => {
  const dir = runDir();
  const w = await started(
    dir,
    world({ items: [item('i1', 'Aceite de oliva')] })
  );

  const answer = await decide({
    runDir: dir,
    itemId: 'i1',
    input: createGroup('Aceite de oliva', 'aceite-de-oliva'),
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
  });

  assert.equal(answer.decision.decision, 'CREATE_GROUP');
  assert.equal(answer.decision.ref, 'ref-i1');
  assert.equal(answer.decision.rehearsalGroupId, 'created-1');
  assert.equal(w.rehearsalCatalog.groups.length, 1);
  assert.equal(w.mainCatalog.groups.length, 0);
});

test('a rehearsal write that fails demotes the decision to REVIEW', async () => {
  const dir = runDir();
  const w = await started(
    dir,
    world({ items: [item('i1', 'Aceite de oliva')], createGroupFails: true })
  );

  const answer = await decide({
    runDir: dir,
    itemId: 'i1',
    input: createGroup('Aceite de oliva', 'aceite-de-oliva'),
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
  });

  assert.equal(answer.decision.decision, 'REVIEW');
  assert.equal(answer.decision.proposedDecision, 'CREATE_GROUP');
  assert.ok(answer.issues.some((one) => one.code === 'REHEARSAL_WRITE_FAILED'));
});

test('an ASSIGN by ref binds to the group this run created', async () => {
  const dir = runDir();
  const w = await started(
    dir,
    world({
      items: [
        item('i1', 'Leche semidesnatada'),
        item('i2', 'Leche semidesnatada'),
      ],
    })
  );

  await decide({
    runDir: dir,
    itemId: 'i1',
    input: createGroup('Leche semidesnatada', 'leche-semidesnatada'),
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
  });

  const answer = await decide({
    runDir: dir,
    itemId: 'i2',
    input: assignRef('ref-i1'),
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
  });

  assert.equal(answer.decision.decision, 'ASSIGN');
  assert.equal(answer.decision.groupRef, 'ref-i1');
  assert.equal(answer.decision.groupId, null);
});

test('an invented ref is a REVIEW, not a binding', async () => {
  const dir = runDir();
  const w = await started(dir, world({ items: [item('i1', 'Leche')] }));

  const answer = await decide({
    runDir: dir,
    itemId: 'i1',
    input: assignRef('ref-nobody'),
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
  });

  assert.equal(answer.decision.decision, 'REVIEW');
  assert.ok(answer.issues.some((one) => one.code === 'GROUP_TARGET_MISSING'));
});

/**
 * The slug is not a word the listing searches, so it is looked up as its words.
 *
 * Without that second search a proposal whose slug collides with a group the
 * product's own name did not find would reach the file and fail on the server,
 * taking the whole batch with it.
 */
test('a slug already taken by a group the name search missed is a REVIEW', async () => {
  const dir = runDir();
  const w = await started(
    dir,
    world({
      items: [item('i1', 'Bebida blanca de vaca')],
      groups: [group('g1', 'Leche entera', 'leche-entera')],
    })
  );

  const answer = await decide({
    runDir: dir,
    itemId: 'i1',
    input: createGroup('Otra leche', 'leche-entera'),
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
  });

  assert.equal(answer.decision.decision, 'REVIEW');
  assert.ok(answer.issues.some((one) => one.code === 'SLUG_TAKEN'));
});

test('a product somebody grouped since the walk read it is a REVIEW', async () => {
  const dir = runDir();
  const w = await started(
    dir,
    world({
      items: [item('i1', 'Leche semidesnatada')],
      groups: [group('g1', 'Leche semidesnatada', 'leche-semidesnatada')],
    })
  );

  // Somebody sorts it between the page and the decision.
  w.mainCatalog.items[0].productGroupId = 'g9';

  const answer = await decide({
    runDir: dir,
    itemId: 'i1',
    input: assign('g1'),
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
  });

  assert.equal(answer.decision.decision, 'REVIEW');
  assert.ok(answer.issues.some((one) => one.code === 'ALREADY_GROUPED'));
  assert.deepEqual(answer.decision.expect, { productGroupId: 'g9' });
});

test('deciding one product twice is refused', async () => {
  const dir = runDir();
  const w = await started(dir, world({ items: [item('i1', 'Leche')] }));
  const input = { decision: 'REVIEW', confidence: 0.1, issues: [] };

  await decide({
    runDir: dir,
    itemId: 'i1',
    input,
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
  });
  await assert.rejects(
    () =>
      decide({
        runDir: dir,
        itemId: 'i1',
        input,
        gateways: w.gateways,
        vocabularies: VOCABULARIES,
      }),
    /already in/
  );
});

// ---------------------------------------------------------------------------
// end
// ---------------------------------------------------------------------------

test('end writes a report naming the counts, the groups and every review', async () => {
  const dir = runDir();
  const w = await started(
    dir,
    world({
      items: [item('i1', 'Aceite de oliva'), item('i2', 'Cosa rara')],
    })
  );

  await decide({
    runDir: dir,
    itemId: 'i1',
    input: createGroup('Aceite de oliva', 'aceite-de-oliva'),
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
  });
  await decide({
    runDir: dir,
    itemId: 'i2',
    input: { decision: 'REVIEW', confidence: 0.3, issues: [] },
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
  });

  const answer = end({ runDir: dir, usage: { inputTokens: 10 } });
  const report = JSON.parse(readFileSync(answer.report, 'utf8'));

  assert.deepEqual(report.counts, { ASSIGN: 0, CREATE_GROUP: 1, REVIEW: 1 });
  assert.equal(report.decided, 2);
  assert.deepEqual(report.usage, { inputTokens: 10 });
  assert.deepEqual(report.groupsCreated, [
    {
      ref: 'ref-i1',
      slug: 'aceite-de-oliva',
      nameEs: 'Aceite de oliva',
      referenceUnit: 'LITER',
    },
  ]);
  assert.equal(report.reviews.length, 1);
  assert.equal(report.reviews[0].itemId, 'i2');
});

// ---------------------------------------------------------------------------
// apply
// ---------------------------------------------------------------------------

const CREATE_ROW = {
  itemId: 'i1',
  expect: { productGroupId: null },
  decision: 'CREATE_GROUP',
  ref: 'ref-i1',
  group: {
    nameEs: 'Leche semidesnatada',
    nameEn: 'Semi-skimmed milk',
    slug: 'leche-semidesnatada',
    referenceUnit: 'LITER',
    synonyms: { es: ['leche semi'], en: [] },
  },
};

const ASSIGN_REF_ROW = {
  itemId: 'i2',
  expect: { productGroupId: null },
  decision: 'ASSIGN',
  groupRef: 'ref-i1',
  groupId: null,
};

const ASSIGN_ID_ROW = {
  itemId: 'i3',
  expect: { productGroupId: null },
  decision: 'ASSIGN',
  groupId: 'g9',
  groupRef: null,
};

const REVIEW_ROW = {
  itemId: 'i4',
  expect: { productGroupId: null },
  decision: 'REVIEW',
};

function decisionsFile(dir, header, rows) {
  const path = join(dir, 'decisions.jsonl');
  const lines = [{ header: true, ...header }, ...rows]
    .map((line) => JSON.stringify(line))
    .join('\n');
  writeFileSync(path, `${lines}\n`);
  return path;
}

/**
 * Every create, then every assignment.
 *
 * The order is the contract: a `groupRef` means nothing until the `createGroup`
 * that declared it has been read. A CREATE_GROUP also contributes the
 * assignment of the product it was made for, which is easy to forget and would
 * leave that product ungrouped beside its own group.
 */
test('buildOperations puts the creates first and assigns the product each was made for', () => {
  const operations = buildOperations([
    CREATE_ROW,
    ASSIGN_REF_ROW,
    ASSIGN_ID_ROW,
    REVIEW_ROW,
  ]);

  assert.deepEqual(
    operations.map((op) => [op.op, op.itemId ?? op.ref]),
    [
      ['createGroup', 'ref-i1'],
      ['assignItem', 'i1'],
      ['assignItem', 'i2'],
      ['assignItem', 'i3'],
    ]
  );
  assert.deepEqual(operations[0], {
    op: 'createGroup',
    ref: 'ref-i1',
    name: { es: 'Leche semidesnatada', en: 'Semi-skimmed milk' },
    slug: 'leche-semidesnatada',
    referenceUnit: 'LITER',
    synonyms: { es: ['leche semi'], en: [] },
  });
  assert.equal(operations[1].groupRef, 'ref-i1');
  assert.equal(operations[2].groupRef, 'ref-i1');
  assert.equal(operations[3].groupId, 'g9');
  assert.deepEqual(operations[3].expect, { productGroupId: null });
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
  // The catalog route names no run id, so none is sent.
  assert.equal(sent[0].body.runId, undefined);
  assert.equal(sent[0].body.operations.length, 3);
  assert.equal(answer.applied, true);
  assert.equal(answer.appliedOperations, 3);
  assert.equal(answer.runId, 'r1');
  assert.deepEqual(answer.createdGroups, [{ ref: 'ref-i1', groupId: 'g-new' }]);
});

/** A refusal is a 201 answer, so the verdict is the server's and not a count. */
test('apply reports the reason a refused file was refused', async () => {
  const dir = runDir();
  const file = decisionsFile(dir, { runId: 'r1', mainUrl: MAIN_URL }, [
    ASSIGN_ID_ROW,
  ]);
  const session = {
    async fetch() {
      return {
        applied: false,
        error: 'one product no longer matches what the file expected',
        results: [
          {
            op: 'assignItem',
            itemId: 'i3',
            applied: false,
            error: { code: 'EXPECT_MISMATCH', detail: 'it has a group now' },
          },
        ],
        createdGroups: [],
      };
    },
  };

  const answer = await apply({ mainUrl: MAIN_URL, file, session });

  assert.equal(answer.applied, false);
  assert.equal(answer.appliedOperations, 0);
  assert.match(answer.error, /no longer matches/);
  assert.equal(answer.results[0].error.code, 'EXPECT_MISMATCH');
});

test('apply refuses a file decided against another gateway', async () => {
  const dir = runDir();
  const file = decisionsFile(
    dir,
    { runId: 'r1', mainUrl: 'http://elsewhere:3000' },
    [ASSIGN_ID_ROW]
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
      return { applied: true, results: [{ itemId: 'i3', applied: true }] };
    },
  };

  const answer = await apply({ mainUrl: `${MAIN_URL}/`, file, session });
  assert.equal(answer.applied, true);
});

test('apply refuses a file with no header', async () => {
  const dir = runDir();
  const path = join(dir, 'headless.jsonl');
  writeFileSync(path, `${JSON.stringify(ASSIGN_ID_ROW)}\n`);

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

  await assert.rejects(
    () =>
      apply({
        mainUrl: MAIN_URL,
        file,
        session: { fetch: () => assert.fail('sent') },
      }),
    /1000/
  );
});

test('a file holding only REVIEWs sends nothing and is not a refusal', async () => {
  const dir = runDir();
  const file = decisionsFile(dir, { runId: 'r1', mainUrl: MAIN_URL }, [
    REVIEW_ROW,
  ]);

  const answer = await apply({
    mainUrl: MAIN_URL,
    file,
    session: { fetch: () => assert.fail('sent') },
  });

  assert.equal(answer.applied, true);
  assert.equal(answer.operations, 0);
});

// ---------------------------------------------------------------------------
// A whole walk
// ---------------------------------------------------------------------------

/**
 * next, decide, next, decide, end, apply, with nothing faked but the network.
 *
 * The second product is the same purchase as the first, so the run must reach
 * `apply` with one group and two assignments rather than two groups.
 */
test('a whole run sorts two products of one purchase into one group', async () => {
  const dir = runDir();
  const w = await started(
    dir,
    world({
      items: [
        item('i1', 'Leche semidesnatada'),
        item('i2', 'Leche semidesnatada'),
      ],
    })
  );

  const first = await next({ runDir: dir, gateways: w.gateways });
  await decide({
    runDir: dir,
    itemId: first.item.id,
    input: createGroup('Leche semidesnatada', 'leche-semidesnatada'),
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
  });

  const second = await next({ runDir: dir, gateways: w.gateways });
  await decide({
    runDir: dir,
    itemId: second.item.id,
    input: assignRef(second.candidates[0].ref),
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
  });

  assert.deepEqual(await next({ runDir: dir, gateways: w.gateways }), {
    done: true,
    remaining: 0,
  });

  const report = JSON.parse(readFileSync(end({ runDir: dir }).report, 'utf8'));
  assert.deepEqual(report.counts, { ASSIGN: 1, CREATE_GROUP: 1, REVIEW: 0 });

  const sent = [];
  const answer = await apply({
    mainUrl: MAIN_URL,
    file: join(dir, 'decisions.jsonl'),
    session: {
      async fetch(path, init) {
        sent.push(init.body);
        return {
          applied: true,
          results: init.body.operations.map(() => ({ applied: true })),
          createdGroups: [{ ref: 'ref-i1', groupId: 'g-new' }],
        };
      },
    },
  });

  assert.equal(answer.applied, true);
  assert.deepEqual(
    sent[0].operations.map((op) => op.op),
    ['createGroup', 'assignItem', 'assignItem']
  );
  assert.equal(sent[0].operations[1].groupRef, 'ref-i1');
  assert.equal(sent[0].operations[2].groupRef, 'ref-i1');
});
