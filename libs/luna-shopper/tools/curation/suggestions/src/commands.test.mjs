import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

/** The registry the fake main gateway answers, one house label and one not. */
const BRANDS = [
  {
    id: 'b-hacendado',
    key: 'hacendado',
    label: 'Hacendado',
    privateLabelSupermarketId: 'sm-1',
    itemCount: 4,
  },
  {
    id: 'b-pascual',
    key: 'pascual',
    label: 'Pascual',
    privateLabelSupermarketId: null,
    itemCount: 2,
  },
];

/** The same, plus a brand a person registered as a spelling of another (plan 0005). */
const LINKED_BRANDS = [
  ...BRANDS,
  {
    id: 'b-deborah',
    key: 'deborah',
    label: 'Deborah',
    privateLabelSupermarketId: null,
    canonicalBrandId: null,
    itemCount: 12,
  },
  {
    id: 'b-deborah-48h',
    key: 'deborah48h',
    label: 'DEBORAH 48H',
    privateLabelSupermarketId: null,
    canonicalBrandId: 'b-deborah',
    itemCount: 0,
  },
];

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
function world({
  entries = [],
  catalogItems = [],
  verifyFails = null,
  brands = BRANDS,
} = {}) {
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
    brands,
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
  // A run started against a Claude model reads as false rather than as
  // undefined, so nothing downstream has to tell the two apart.
  assert.equal(state.local, false);
  // The run directory never holds a password.
  assert.equal(JSON.stringify(state).includes('password'), false);

  const [header] = readJsonl(join(dir, 'decisions.jsonl'));
  assert.equal(header.header, true);
  assert.equal(header.mainUrl, MAIN_URL);
  assert.equal(header.rehearsalUrl, REHEARSAL_URL);
  assert.equal(header.model, 'claude-sonnet-5');
});

test('start snapshots the whole registry into brands.json', async () => {
  const dir = runDir();
  const w = world({ entries: [entry('e1', 'Leche entera 1 L')] });

  const answer = await startIn(dir, w);

  const snapshot = JSON.parse(readFileSync(join(dir, 'brands.json'), 'utf8'));
  assert.deepEqual(snapshot.brands, BRANDS);
  assert.ok(Date.parse(snapshot.readAt) > 0);
  assert.equal(answer.brands, 2);
  // The one thing an operator has to know about a snapshot: it is a moment.
  assert.ok(
    answer.notes.some((note) =>
      /Read 2 brands\. A brand registered after this moment is not seen by this run\./.test(
        note
      )
    )
  );
  // The private labels reach the prompt and the rest of the registry does not.
  assert.match(answer.prompt, /`Hacendado` belongs to Mercadona/);
  assert.doesNotMatch(answer.prompt, /Pascual/);
  assert.equal(
    w.mainSession.calls.filter(
      (call) => call.path === '/v1/admin/catalog/brands'
    ).length,
    1
  );
});

test('an empty registry is allowed when asked for, and said out loud', async () => {
  const dir = runDir();
  const w = world({ entries: [entry('e1', 'Leche')], brands: [] });

  const answer = await startIn(dir, w, { allowEmptyRegistry: true });

  assert.equal(answer.brands, 0);
  assert.ok(answer.notes.some((note) => /every CREATE naming one/.test(note)));
  assert.match(answer.prompt, /- \(none\)/);
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
  });

  const answer = await decide({
    runDir: dir,
    entryId: 'e2',
    input: { decision: 'LINK', itemRef: 'ref-e1', confidence: 0.97 },
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
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
  });

  // A ref the packet did not show is a slip worth one more attempt (plan
  // 0006), and a second one is the REVIEW.
  assert.equal(answer.retryable, true);
  assert.equal(answer.decision, null);
  assert.ok(answer.issues.some((i) => i.code === 'LINK_TARGET_NOT_SHOWN'));

  const last = await decide({
    runDir: dir,
    entryId: 'e1',
    input: { decision: 'LINK', itemRef: 'ref-invented', confidence: 0.99 },
    final: true,
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
  });
  assert.equal(last.decision.decision, 'REVIEW');
  assert.ok(last.issues.some((i) => i.code === 'LINK_TARGET_NOT_SHOWN'));
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
  });

  assert.equal(answer.retryable, false);
  assert.equal(answer.decision.decision, 'REVIEW');
  assert.ok(answer.issues.some((i) => i.code === 'MODEL_OUTPUT_INVALID'));
  assert.equal(readJsonl(join(dir, 'decisions.jsonl')).length, 2);
});

test('a glitched name is retryable and writes nothing', async () => {
  const dir = runDir();
  const w = world({ entries: [entry('e1', 'Mayonesa 450 ml')] });
  await startIn(dir, w);

  const answer = await decide({
    runDir: dir,
    entryId: 'e1',
    input: {
      ...CREATE_MILK,
      item: { ...CREATE_MILK.item, nameEs: 'May1onesa', nameEn: null },
    },
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
  });

  // Not a judgment the model stands by: one token of the generation went
  // wrong, so the row is asked again rather than handed to a person.
  assert.equal(answer.retryable, true);
  assert.equal(answer.accepted, false);
  assert.equal(answer.decision, null);
  assert.deepEqual(
    answer.issues.map((i) => i.code),
    ['NAME_GLITCH']
  );
  assert.equal(readJsonl(join(dir, 'decisions.jsonl')).length, 1);
  assert.equal(w.rehearsalCatalog.rows.length, 0);
});

test('--final records a second glitch as a REVIEW carrying the code', async () => {
  const dir = runDir();
  const w = world({ entries: [entry('e1', 'Mayonesa 450 ml')] });
  await startIn(dir, w);

  const answer = await decide({
    runDir: dir,
    entryId: 'e1',
    input: {
      ...CREATE_MILK,
      item: { ...CREATE_MILK.item, nameEs: 'May1onesa', nameEn: null },
    },
    final: true,
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
  });

  assert.equal(answer.retryable, false);
  assert.equal(answer.decision.decision, 'REVIEW');
  assert.equal(answer.decision.proposedDecision, 'CREATE');
  assert.ok(answer.issues.some((i) => i.code === 'NAME_GLITCH'));
  assert.equal(w.rehearsalCatalog.rows.length, 0);
  assert.equal(readJsonl(join(dir, 'decisions.jsonl')).length, 2);
});

test('a sizeless CREATE from a local model is recorded as a REVIEW', async () => {
  const dir = runDir();
  const w = world({ entries: [entry('e1', 'Sombra dúo Monochrome n30')] });
  await startIn(dir, w, { model: 'gemma4:12b', local: true });

  const state = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
  assert.equal(state.local, true);

  const answer = await decide({
    runDir: dir,
    entryId: 'e1',
    input: {
      ...CREATE_MILK,
      item: {
        ...CREATE_MILK.item,
        nameEs: 'Sombra dúo Monochrome n30',
        nameEn: null,
        unitSize: null,
        defaultUnit: 'UNIT',
      },
    },
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
  });

  // A judgment and not a glitch, so the row goes to a person on the first
  // answer rather than buying a second attempt.
  assert.equal(answer.retryable, false);
  assert.equal(answer.decision.decision, 'REVIEW');
  assert.equal(answer.decision.proposedDecision, 'CREATE');
  assert.ok(answer.issues.some((i) => i.code === 'SIZELESS_CREATE'));
  // A REVIEW writes no product into the rehearsal catalog, so the next row's
  // search does not meet a twin nobody accepted.
  assert.equal(w.rehearsalCatalog.rows.length, 0);

  // And the report carries it with no special casing, because every REVIEW is
  // reported with its issues verbatim.
  const { report } = end({ runDir: dir });
  const written = JSON.parse(readFileSync(report, 'utf8'));
  assert.equal(written.counts.REVIEW, 1);
  assert.ok(
    written.reviews[0].issues.some((i) => i.code === 'SIZELESS_CREATE')
  );
});

test('the same sizeless CREATE from a Claude model is a CREATE', async () => {
  const dir = runDir();
  const w = world({ entries: [entry('e1', 'Sombra dúo Monochrome n30')] });
  await startIn(dir, w);

  const answer = await decide({
    runDir: dir,
    entryId: 'e1',
    input: {
      ...CREATE_MILK,
      item: {
        ...CREATE_MILK.item,
        nameEs: 'Sombra dúo Monochrome n30',
        nameEn: null,
        unitSize: null,
        defaultUnit: 'UNIT',
      },
    },
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
  });

  assert.equal(answer.accepted, true);
  assert.equal(answer.decision.decision, 'CREATE');
  assert.deepEqual(answer.issues, []);
  assert.equal(w.rehearsalCatalog.rows.length, 1);
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
  });

  assert.equal(answer.decision.decision, 'REVIEW');
  assert.ok(answer.issues.some((i) => i.code === 'REHEARSAL_WRITE_FAILED'));
});

test('decide reads the snapshot and never asks the gateway for a brand', async () => {
  const dir = runDir();
  const w = world({
    entries: [entry('e1', 'Zumo de naranja', { brand: null })],
  });
  await startIn(dir, w);
  const before = w.mainSession.calls.length;

  const answer = await decide({
    runDir: dir,
    entryId: 'e1',
    input: {
      ...CREATE_MILK,
      item: { ...CREATE_MILK.item, brand: '+Proteínas' },
    },
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
  });

  assert.equal(answer.decision.decision, 'REVIEW');
  assert.ok(answer.issues.some((i) => i.code === 'BRAND_UNREGISTERED'));
  assert.deepEqual(
    w.mainSession.calls
      .slice(before)
      .filter((call) => call.path === '/v1/admin/catalog/brands'),
    []
  );
});

test('a CREATE writing a registered spelling is asked once more', async () => {
  const dir = runDir();
  const w = world({
    entries: [entry('e1', 'Máscara de pestañas', { brand: 'DEBORAH 48H' })],
    brands: LINKED_BRANDS,
  });
  await startIn(dir, w);

  const answer = await decide({
    runDir: dir,
    entryId: 'e1',
    input: {
      ...CREATE_MILK,
      item: { ...CREATE_MILK.item, brand: 'DEBORAH 48H' },
    },
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
  });

  // The registry answers the question, so the row buys the second attempt the
  // one retry it already had, with the correct brand named in the detail.
  assert.equal(answer.retryable, true);
  assert.equal(answer.accepted, false);
  assert.equal(answer.decision, null);
  assert.deepEqual(
    answer.issues.map((i) => i.code),
    ['BRAND_IS_LINKED']
  );
  assert.match(answer.issues[0].detail, /so the brand is "Deborah"/);
  assert.equal(readJsonl(join(dir, 'decisions.jsonl')).length, 1);
  assert.equal(w.rehearsalCatalog.rows.length, 0);
});

test('the second answer naming the brand is recorded as the model decided', async () => {
  const dir = runDir();
  const w = world({
    entries: [entry('e1', 'Máscara de pestañas', { brand: 'DEBORAH 48H' })],
    brands: LINKED_BRANDS,
  });
  await startIn(dir, w);

  const answer = await decide({
    runDir: dir,
    entryId: 'e1',
    input: { ...CREATE_MILK, item: { ...CREATE_MILK.item, brand: 'Deborah' } },
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
  });

  // The printed brand is a spelling of the one written, so the source check is
  // quiet too: that is the pair of them comparing canonical brands.
  assert.equal(answer.decision.decision, 'CREATE');
  assert.deepEqual(answer.issues, []);
});

test('--final records a second linked spelling as a REVIEW carrying the code', async () => {
  const dir = runDir();
  const w = world({
    entries: [entry('e1', 'Máscara de pestañas', { brand: 'DEBORAH 48H' })],
    brands: LINKED_BRANDS,
  });
  await startIn(dir, w);

  const answer = await decide({
    runDir: dir,
    entryId: 'e1',
    input: {
      ...CREATE_MILK,
      item: { ...CREATE_MILK.item, brand: 'DEBORAH 48H' },
    },
    final: true,
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
  });

  assert.equal(answer.retryable, false);
  assert.equal(answer.decision.decision, 'REVIEW');
  assert.equal(answer.decision.proposedDecision, 'CREATE');
  assert.ok(answer.issues.some((i) => i.code === 'BRAND_IS_LINKED'));
  assert.equal(w.rehearsalCatalog.rows.length, 0);
});

test('a row raising both retryable codes carries both details into one retry', async () => {
  // There is one retry budget and two codes that spend it, so a row that earns
  // both has to be told both things at once or the second attempt fixes one
  // defect and is recorded for the other. `decide` answers every retryable
  // issue it found, and the orchestrator joins their details into the single
  // re-ask it sends.
  const dir = runDir();
  const w = world({
    entries: [entry('e1', 'Máscara de pestañas', { brand: 'DEBORAH 48H' })],
    brands: LINKED_BRANDS,
  });
  await startIn(dir, w);

  const answer = await decide({
    runDir: dir,
    entryId: 'e1',
    input: {
      ...CREATE_MILK,
      item: {
        ...CREATE_MILK.item,
        nameEs: 'May1onesa',
        nameEn: null,
        brand: 'DEBORAH 48H',
      },
    },
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
  });

  assert.equal(answer.retryable, true);
  assert.deepEqual(answer.issues.map((i) => i.code).sort(), [
    'BRAND_IS_LINKED',
    'NAME_GLITCH',
  ]);
  for (const found of answer.issues) {
    assert.ok(found.detail.length > 0, found.code);
  }
});

test('a CREATE with no brand is never demoted for it', async () => {
  const dir = runDir();
  const w = world({ entries: [entry('e1', 'Leche entera 1 L')] });
  await startIn(dir, w);

  const answer = await decide({
    runDir: dir,
    entryId: 'e1',
    input: CREATE_MILK,
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
  });

  assert.equal(answer.decision.decision, 'CREATE');
  assert.deepEqual(answer.issues, []);
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

test('a resumed run applies the registry it started with', async () => {
  const dir = runDir();
  // The list the fake gateway answers, mutated after `start` has read it: a
  // brand registered while the walk runs. The next walk sees it and this one
  // does not, because every step after `start` reads the file.
  const registry = [...BRANDS];
  const w = world({
    entries: [entry('e1', 'Leche entera 1 L')],
    brands: registry,
  });
  await startIn(dir, w);
  registry.push({
    id: 'b-proteinas',
    key: 'proteinas',
    label: '+Proteínas',
    privateLabelSupermarketId: null,
  });
  w.mainSession.calls.length = 0;

  const answer = await decide({
    runDir: dir,
    entryId: 'e1',
    input: {
      ...CREATE_MILK,
      item: { ...CREATE_MILK.item, brand: '+Proteínas' },
    },
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
  });

  assert.equal(answer.decision.decision, 'REVIEW');
  assert.ok(answer.issues.some((i) => i.code === 'BRAND_UNREGISTERED'));
  assert.deepEqual(
    w.mainSession.calls.filter(
      (call) => call.path === '/v1/admin/catalog/brands'
    ),
    []
  );

  // And the snapshot on disk is still the one `start` wrote.
  const snapshot = JSON.parse(readFileSync(join(dir, 'brands.json'), 'utf8'));
  assert.deepEqual(
    snapshot.brands.map((row) => row.key),
    ['hacendado', 'pascual']
  );
});

// ---------------------------------------------------------------------------
// end
// ---------------------------------------------------------------------------

test('the report counts the run unregistered brands by rows', async () => {
  const dir = runDir();
  const w = world({
    entries: [
      entry('e1', 'Yogur natural'),
      entry('e2', 'Yogur de fresa'),
      entry('e3', 'Queso curado'),
    ],
  });
  await startIn(dir, w);

  const create = (brand) => ({
    ...CREATE_MILK,
    item: { ...CREATE_MILK.item, brand },
  });
  // One key, two spellings, and the more frequent one is the one an operator
  // is shown when they go to register it.
  for (const [entryId, brand] of [
    ['e1', '+Proteínas'],
    ['e2', '+ Proteinas'],
    ['e3', '+Proteínas'],
  ]) {
    await decide({
      runDir: dir,
      entryId,
      input: create(brand),
      gateways: w.gateways,
      vocabularies: VOCABULARIES,
    });
  }

  const report = JSON.parse(readFileSync(end({ runDir: dir }).report, 'utf8'));
  assert.deepEqual(report.unregisteredBrands, [
    { key: 'proteinas', spelling: '+Proteínas', rows: 3 },
  ]);
});

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
  // A run that registered nothing new says so with an empty list rather than
  // by leaving the field out.
  assert.deepEqual(report.unregisteredBrands, []);
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
  });

  const answer = await decide({
    runDir: dir,
    entryId: 'e2',
    input: CREATE_MILK,
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
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
  });

  assert.deepEqual(
    JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')).handouts,
    {}
  );
});

// ---------------------------------------------------------------------------
// Plan 0006: the empty registry, shared EANs and a target nobody was shown
// ---------------------------------------------------------------------------

test('start stops on an empty registry, prints propose-brands and writes no run', async () => {
  const dir = runDir();
  const w = world({ entries: [entry('e1', 'Leche')], brands: [] });

  await assert.rejects(
    () => startIn(dir, w, { chain: 'sm-1' }),
    (error) => {
      assert.match(
        error.message,
        /brand registry on http:\/\/localhost:3000 is empty/
      );
      assert.match(
        error.message,
        /cli\.mjs propose-brands --run-dir \S+ --main-url http:\/\/localhost:3000 --main-user dev-admin --chain sm-1/
      );
      assert.match(error.message, /--allow-empty-registry/);
      return true;
    }
  );
  // Nothing to resume and nothing to refuse later: the same directory takes
  // the `start` that follows the registration.
  assert.equal(existsSync(join(dir, 'state.json')), false);
  assert.equal(
    w.mainSession.calls.some(
      (call) => call.path === '/v1/admin/harvest/entries'
    ),
    false
  );
});

/** Three rows of one chain printing one barcode, a fourth on another chain. */
function sharedEanWorld(catalogItems = []) {
  return world({
    entries: [
      entry('e1', 'Alubias blancas', { ean: '8480000000017' }),
      entry('e2', 'Pan de molde'),
      entry('e3', 'Alubias pintas', { ean: '8480000000017' }),
      entry('e4', 'Alubias rojas', { ean: '8480000000017' }),
      entry('e5', 'Alubias negras', {
        ean: '8480000000017',
        supermarketId: 'sm-2',
      }),
    ],
    catalogItems,
  });
}

test('start indexes the queue by EAN within a chain', async () => {
  const dir = runDir();
  const w = sharedEanWorld();

  const answer = await startIn(dir, w);

  assert.equal(answer.sharedEans, 3);
  assert.ok(
    answer.notes.some((note) => /3 queued entries print an EAN/.test(note))
  );
  const snapshot = JSON.parse(
    readFileSync(join(dir, 'shared-eans.json'), 'utf8')
  );
  assert.deepEqual(snapshot.entries, {
    e1: ['e3', 'e4'],
    e3: ['e1', 'e4'],
    e4: ['e1', 'e3'],
  });

  const batch = await next({ runDir: dir, count: 4, gateways: w.gateways });
  const byId = Object.fromEntries(batch.rows.map((row) => [row.entry.id, row]));
  assert.deepEqual(byId.e1.entry.sharedEan, ['e3', 'e4']);
  // A barcode printed once on its chain says nothing about the row.
  assert.equal(byId.e2.entry.sharedEan, null);
});

test('a LINK on a shared EAN is a REVIEW, even when both sides print that EAN', async () => {
  const dir = runDir();
  const w = sharedEanWorld([
    {
      id: 'i1',
      name: { es: 'Alubias blancas' },
      brand: null,
      ean: '8480000000017',
      unitSize: null,
      defaultUnit: 'UNIT',
    },
  ]);
  await startIn(dir, w);
  const row = await next({ runDir: dir, gateways: w.gateways });
  assert.equal(row.entry.id, 'e1');
  assert.equal(row.eanMatch.itemId, 'i1');

  const answer = await decide({
    runDir: dir,
    entryId: 'e1',
    input: { decision: 'LINK', itemId: 'i1', confidence: 0.99 },
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
  });

  assert.equal(answer.decision.decision, 'REVIEW');
  assert.equal(answer.decision.proposedDecision, 'LINK');
  assert.equal(answer.decision.itemId, null);
  assert.deepEqual(codesOf(answer.issues), ['SHARED_EAN']);
  assert.match(answer.issues[0].detail, /8480000000017.*e3, e4/);
});

test('a CREATE on a shared EAN is a REVIEW and writes nothing to the rehearsal', async () => {
  const dir = runDir();
  const w = sharedEanWorld();
  await startIn(dir, w);

  const answer = await decide({
    runDir: dir,
    entryId: 'e3',
    input: {
      ...CREATE_MILK,
      item: {
        ...CREATE_MILK.item,
        nameEs: 'Alubias pintas',
        ean: '8480000000017',
      },
    },
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
  });

  assert.equal(answer.decision.decision, 'REVIEW');
  assert.equal(answer.decision.proposedDecision, 'CREATE');
  assert.ok(codesOf(answer.issues).includes('SHARED_EAN'));
  assert.equal(w.rehearsalCatalog.rows.length, 0);
});

test('a shared EAN buys no second attempt, whatever else the answer got wrong', async () => {
  const dir = runDir();
  const w = sharedEanWorld();
  await startIn(dir, w);

  // Unparseable, and a glitched name: both retryable on any other row.
  const broken = await decide({
    runDir: dir,
    entryId: 'e1',
    input: { decision: 'MAYBE' },
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
  });
  assert.equal(broken.retryable, false);
  assert.equal(broken.decision.decision, 'REVIEW');
  assert.deepEqual(codesOf(broken.issues), [
    'MODEL_OUTPUT_INVALID',
    'SHARED_EAN',
  ]);

  const glitched = await decide({
    runDir: dir,
    entryId: 'e3',
    input: {
      ...CREATE_MILK,
      item: { ...CREATE_MILK.item, nameEs: 'Alub1ias pintas' },
    },
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
  });
  assert.equal(glitched.retryable, false);
  assert.equal(glitched.decision.decision, 'REVIEW');
  assert.ok(codesOf(glitched.issues).includes('SHARED_EAN'));
  assert.ok(codesOf(glitched.issues).includes('NAME_GLITCH'));
});

test('a real id the packet did not show is refused, and the catalog is not asked', async () => {
  const dir = runDir();
  const w = world({
    entries: [
      entry('e1', 'Leche entera 1 L', { unitSize: 1, sizeFormat: 'l' }),
    ],
    catalogItems: [
      {
        id: 'i1',
        name: { es: 'Leche entera' },
        brand: null,
        unitSize: 1,
        defaultUnit: 'LITER',
      },
      // Real, and never surfaced by the search for the entry's name.
      {
        id: 'i-hidden',
        name: { es: 'Detergente' },
        brand: null,
        unitSize: 1,
        defaultUnit: 'LITER',
      },
    ],
  });
  await startIn(dir, w);
  const row = await next({ runDir: dir, gateways: w.gateways });
  assert.deepEqual(
    row.candidates.map((c) => c.itemId),
    ['i1']
  );

  const answer = await decide({
    runDir: dir,
    entryId: 'e1',
    input: { decision: 'LINK', itemId: 'i-hidden', confidence: 0.99 },
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
  });
  assert.equal(answer.retryable, true);
  assert.equal(answer.decision, null);
  assert.deepEqual(codesOf(answer.issues), ['LINK_TARGET_NOT_SHOWN']);
  assert.match(
    answer.issues[0].detail,
    /i-hidden was not among the candidates/
  );
  assert.equal(
    w.mainSession.calls.some((call) => call.path.endsWith('/i-hidden')),
    false
  );

  const last = await decide({
    runDir: dir,
    entryId: 'e1',
    input: { decision: 'LINK', itemId: 'i-hidden', confidence: 0.99 },
    final: true,
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
  });
  assert.equal(last.decision.decision, 'REVIEW');
  assert.equal(last.decision.proposedDecision, 'LINK');
  assert.ok(codesOf(last.issues).includes('LINK_TARGET_NOT_SHOWN'));
  assert.ok(!codesOf(last.issues).includes('LINK_TARGET_MISSING'));
});

test('a LINK onto a candidate stating the same format in another unit is a LINK', async () => {
  const dir = runDir();
  const w = world({
    entries: [
      entry('e1', 'Fabada asturiana', { unitSize: 0.42, sizeFormat: 'kg' }),
    ],
    catalogItems: [
      {
        id: 'i1',
        name: { es: 'Fabada asturiana' },
        brand: null,
        unitSize: 420,
        defaultUnit: 'GRAM',
      },
    ],
  });
  await startIn(dir, w);
  await next({ runDir: dir, gateways: w.gateways });

  const answer = await decide({
    runDir: dir,
    entryId: 'e1',
    input: { decision: 'LINK', itemId: 'i1', confidence: 0.97 },
    gateways: w.gateways,
    vocabularies: VOCABULARIES,
  });

  assert.equal(answer.decision.decision, 'LINK');
  assert.equal(answer.decision.itemId, 'i1');
  assert.deepEqual(answer.issues, []);
});

test('the proposed item is dropped only when the catalog answers 404', async () => {
  const dir = runDir();
  const w = world({
    entries: [entry('e1', 'Leche entera', { itemId: 'i-gone' })],
  });
  await startIn(dir, w);

  const row = await next({ runDir: dir, gateways: w.gateways });
  assert.deepEqual(row.candidates, []);

  // Any other failure is not an answer about the product, so the walk hears it
  // rather than a packet that silently lost the ladder's own proposal.
  const fetch = w.mainSession.fetch;
  w.mainSession.fetch = async (path, init) => {
    if (path.endsWith('/i-gone')) {
      const error = new Error(`GET ${path} answered 503`);
      error.status = 503;
      throw error;
    }
    return fetch(path, init);
  };
  await assert.rejects(
    () => next({ runDir: dir, gateways: w.gateways }),
    /answered 503/
  );
});

function codesOf(issues) {
  return (issues ?? []).map((entry) => entry.code);
}
