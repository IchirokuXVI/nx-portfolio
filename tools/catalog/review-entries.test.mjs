// node --test tools/catalog/review-entries.test.mjs
//
// Nothing here touches the network. `fetch` is injected everywhere, the catalog
// and the queue are the checked in fixtures, and the model's answers are canned.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  buildSystemPrompt,
  carriesBrand,
  carriesSize,
  checkDecisionShape,
  indexPrivateLabels,
  loadPrivateLabels,
  loadVocabularies,
  normalizeName,
  reviewEntry,
  run,
  toCreateItemBody,
  validateDecision,
} from './review-entries.mjs';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const fixture = (name) =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
  );

const CATALOG_ITEMS = fixture('catalog-items.json');
const QUEUE_PAGE = fixture('queue-page.json');
const SUPERMARKETS = fixture('supermarkets.json');
const REPLIES = fixture('model-replies.json');

const { categories, units } = loadVocabularies();
const PRIVATE_LABELS = loadPrivateLabels();
const MERCADONA = SUPERMARKETS.items[0];
const EL_JAMON = SUPERMARKETS.items[1];
const itemById = (id) => CATALOG_ITEMS.find((item) => item.id === id);

const MESSAGES_URL = 'https://api.anthropic.com/v1/messages';

// ---------------------------------------------------------------------------
// A gateway and an API that answer out of the fixtures
// ---------------------------------------------------------------------------

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function modelResponse(text) {
  return jsonResponse(200, {
    content: [
      { type: 'thinking', thinking: 'weighing the candidates' },
      { type: 'text', text },
    ],
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 90,
      cache_creation_input_tokens: 10,
    },
  });
}

function searchCatalog(query) {
  const key = normalizeName(query);
  if (!key) {
    return [];
  }
  return CATALOG_ITEMS.filter((item) => {
    if (item.ean && item.ean === query) {
      return true;
    }
    return [item.name.es, item.name.en]
      .filter(Boolean)
      .map(normalizeName)
      .some((name) => name && (key.includes(name) || name.includes(key)));
  });
}

/** The five reads the pre-pass and the validators make, out of the fixtures. */
function stubGateway(overrides = {}) {
  return {
    async findByEan(ean) {
      return ean
        ? (CATALOG_ITEMS.find((item) => item.ean === ean) ?? null)
        : null;
    },
    async searchItems(query) {
      return searchCatalog(query);
    },
    async getItem(id) {
      return itemById(id) ?? null;
    },
    async accept() {
      throw new Error('accept was not expected here');
    },
    async createItem() {
      throw new Error('createItem was not expected here');
    },
    ...overrides,
  };
}

/**
 * A `fetch` that answers the gateway routes and the Messages API.
 *
 * `reply` is asked for the text of each model call, so a test can hand back
 * prose, a broken object, or the canned decision for the entry.
 */
function makeFakeFetch({ reply, calls = [], apiStatus = null }) {
  return async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, method, body });

    if (url.startsWith(MESSAGES_URL)) {
      if (apiStatus) {
        return jsonResponse(apiStatus, { error: 'nope' });
      }
      const packet = JSON.parse(
        body.messages.find((message) => message.role === 'user').content
      );
      const index = calls.filter((call) => call.url === url).length - 1;
      return modelResponse(reply(packet, index));
    }

    const parsed = new URL(url);
    const path = parsed.pathname;

    if (method === 'GET' && path === '/v1/admin/catalog/supermarkets') {
      return jsonResponse(200, SUPERMARKETS);
    }
    if (method === 'GET' && path === '/v1/admin/harvest/entries') {
      const chain = parsed.searchParams.get('supermarketId');
      return jsonResponse(200, {
        items: chain === 'sm-mercadona' ? QUEUE_PAGE.items : [],
        nextCursor: null,
      });
    }
    if (method === 'GET' && path === '/v1/admin/catalog/items') {
      return jsonResponse(200, {
        items: searchCatalog(parsed.searchParams.get('query') ?? ''),
        nextCursor: null,
      });
    }
    if (method === 'GET' && path.startsWith('/v1/admin/catalog/items/')) {
      const item = itemById(decodeURIComponent(path.split('/').pop()));
      return item
        ? jsonResponse(200, item)
        : jsonResponse(404, { detail: 'not found' });
    }
    if (
      method === 'POST' &&
      /\/v1\/admin\/harvest\/entries\/.+\/accept$/.test(path)
    ) {
      return jsonResponse(201, { pricesWritten: 1, createdItem: null });
    }
    if (
      method === 'POST' &&
      /\/v1\/admin\/harvest\/entries\/.+\/item$/.test(path)
    ) {
      return jsonResponse(201, {
        pricesWritten: 0,
        createdItem: { id: 'item-new' },
      });
    }
    return jsonResponse(404, { detail: `no fixture for ${method} ${path}` });
  };
}

const cannedReply = (packet) =>
  JSON.stringify(REPLIES.byEntry[packet.entry.id] ?? { decision: 'REVIEW' });

const ENV = { ANTHROPIC_API_KEY: 'test-key', LUNA_ADMIN_TOKEN: 'admin-token' };

async function runOverFixtures(extraArgs = []) {
  const out = mkdtempSync(join(tmpdir(), 'review-entries-'));
  const calls = [];
  const stdout = [];
  const stderr = [];
  const result = await run({
    argv: ['--chain', 'sm-mercadona', '--out-dir', out, ...extraArgs],
    env: ENV,
    fetchImpl: makeFakeFetch({ reply: cannedReply, calls }),
    sleep: async () => {},
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
    now: () => new Date('2026-09-08T10:00:00.000Z'),
  });
  return { ...result, calls, stdout, stderr, out };
}

// ---------------------------------------------------------------------------
// normalizeName, against the harvester's own spec
// ---------------------------------------------------------------------------

test('normalizeName folds case, accents and punctuation', () => {
  assert.equal(
    normalizeName('Aceite de oliva 0,4º Hacendado'),
    normalizeName('ACEITE DE OLIVA 0 4 HACENDADO')
  );
});

test('normalizeName collapses runs of separators', () => {
  assert.equal(normalizeName('  Café  --  soluble '), 'cafe soluble');
});

test('normalizeName treats two spellings of one name alike', () => {
  assert.equal(normalizeName('LECHE  entera'), normalizeName('Leche entera'));
  assert.equal(normalizeName('Olive Oil'), 'olive oil');
});

test('carriesSize knows a printed size from a range name', () => {
  assert.equal(carriesSize('Leche semidesnatada 1 L'), true);
  assert.equal(carriesSize('Galletas María 800g'), true);
  assert.equal(carriesSize('Aceite de oliva 0,4 kg'), true);
  assert.equal(carriesSize('Papel de cocina 2 uds'), true);
  assert.equal(carriesSize('Leche semidesnatada'), false);
  assert.equal(carriesSize('Elvive Total Repair 5'), false);
});

test('carriesBrand compares normalized tokens', () => {
  assert.equal(carriesBrand('Aceite de oliva Hacendado', 'hacendado'), true);
  assert.equal(carriesBrand('Champú Elvive Total', "L'Oréal Elvive"), false);
  assert.equal(carriesBrand('Aceite de oliva', 'Hacendado'), false);
  assert.equal(carriesBrand('Aceite de oliva', null), false);
});

// ---------------------------------------------------------------------------
// The decision schema
// ---------------------------------------------------------------------------

test('the schema check refuses what it cannot act on', () => {
  assert.equal(checkDecisionShape('LINK').ok, false);
  assert.equal(
    checkDecisionShape({ decision: 'MERGE', confidence: 1 }).ok,
    false
  );
  assert.equal(
    checkDecisionShape({ decision: 'LINK', confidence: 1 }).ok,
    false
  );
  assert.equal(
    checkDecisionShape({ decision: 'CREATE', confidence: 1, item: {} }).ok,
    false
  );
  assert.equal(
    checkDecisionShape({ decision: 'LINK', itemId: 'x', confidence: 3 }).ok,
    false
  );
});

test('the schema check normalizes what it accepts', () => {
  const checked = checkDecisionShape({
    decision: 'LINK',
    itemId: ' item-milk ',
    confidence: 0.95,
    issues: ['a bare string note'],
  });
  assert.equal(checked.ok, true);
  assert.equal(checked.decision.itemId, 'item-milk');
  assert.deepEqual(checked.decision.issues, [
    { code: 'MODEL_NOTE', detail: 'a bare string note' },
  ]);
  assert.equal(checked.decision.reasoning, '');
});

// ---------------------------------------------------------------------------
// The validators
// ---------------------------------------------------------------------------

const goodCreate = {
  decision: 'CREATE',
  itemId: null,
  item: {
    nameEs: 'Galletas María',
    nameEn: 'Marie biscuits',
    brand: 'Hacendado',
    unitSize: 800,
    defaultUnit: 'GRAM',
    category: 'SNACKS',
    ean: '8480000111111',
  },
  confidence: 0.95,
  issues: [],
  reasoning: '',
};

const goodLink = {
  decision: 'LINK',
  itemId: 'item-milk',
  item: null,
  confidence: 0.96,
  issues: [],
  reasoning: '',
};

const milkEntry = QUEUE_PAGE.items.find((entry) => entry.id === 'entry-milk');
const biscuitEntry = QUEUE_PAGE.items.find(
  (entry) => entry.id === 'entry-biscuits'
);

function check(overrides) {
  return validateDecision({
    entry: biscuitEntry,
    supermarket: MERCADONA,
    privateLabels: PRIVATE_LABELS,
    categories,
    units,
    ...overrides,
  });
}

const codes = (issues) => issues.map((issue) => issue.code);

test('a clean CREATE and a clean LINK raise nothing', () => {
  assert.deepEqual(check({ decision: goodCreate }), []);
  assert.deepEqual(
    check({
      decision: goodLink,
      entry: milkEntry,
      linkTarget: itemById('item-milk'),
    }),
    []
  );
});

test('CHAIN_NOT_REGISTERED fires when no catalog supermarket answers', () => {
  const issues = check({ decision: goodCreate, supermarket: null });
  assert.deepEqual(codes(issues), ['CHAIN_NOT_REGISTERED']);
});

test('NAME_CARRIES_BRAND fires on a name holding its brand', () => {
  const decision = {
    ...goodCreate,
    item: { ...goodCreate.item, nameEs: 'Galletas María Hacendado' },
  };
  assert.deepEqual(codes(check({ decision })), ['NAME_CARRIES_BRAND']);
});

test('NAME_CARRIES_SIZE fires on a name holding its size', () => {
  const decision = {
    ...goodCreate,
    item: { ...goodCreate.item, nameEs: 'Galletas María 800 g' },
  };
  assert.deepEqual(codes(check({ decision })), ['NAME_CARRIES_SIZE']);
});

test('UNKNOWN_CATEGORY and UNKNOWN_UNIT fire outside the openapi vocabularies', () => {
  const decision = {
    ...goodCreate,
    item: { ...goodCreate.item, category: 'BISCUITS', defaultUnit: 'BOX' },
  };
  assert.deepEqual(codes(check({ decision })), [
    'UNKNOWN_CATEGORY',
    'UNKNOWN_UNIT',
  ]);
});

test('EAN_CONFLICT fires when a CREATE would duplicate a barcode', () => {
  const issues = check({
    decision: goodCreate,
    eanOwner: itemById('item-bread'),
  });
  assert.deepEqual(codes(issues), ['EAN_CONFLICT']);
});

test('EAN_CONFLICT fires when a LINK target carries another barcode', () => {
  const entry = { ...milkEntry, ean: '8480000999999' };
  const issues = check({
    decision: { ...goodLink, itemId: 'item-bread' },
    entry,
    linkTarget: itemById('item-bread'),
  });
  assert.ok(codes(issues).includes('EAN_CONFLICT'));
});

test('FORMAT_MISMATCH fires when the entry and the item are different sizes', () => {
  const issues = check({
    decision: { ...goodLink, itemId: 'item-bread' },
    entry: { ...milkEntry, ean: null, unitSize: 1 },
    linkTarget: itemById('item-bread'),
  });
  assert.deepEqual(codes(issues), ['FORMAT_MISMATCH']);
});

test('LINK_TARGET_MISSING fires when catalog holds no such item', () => {
  const issues = check({
    decision: { ...goodLink, itemId: 'item-ghost' },
    entry: milkEntry,
    linkTarget: null,
  });
  assert.deepEqual(codes(issues), ['LINK_TARGET_MISSING']);
});

test('PRIVATE_LABEL_CROSSES_CHAIN fires on a CREATE and on a LINK', () => {
  const created = check({ decision: goodCreate, supermarket: EL_JAMON });
  assert.deepEqual(codes(created), ['PRIVATE_LABEL_CROSSES_CHAIN']);

  const linked = check({
    decision: { ...goodLink, itemId: 'item-ifa-milk' },
    entry: { ...milkEntry, ean: null },
    linkTarget: itemById('item-ifa-milk'),
    supermarket: MERCADONA,
  });
  assert.deepEqual(codes(linked), ['PRIVATE_LABEL_CROSSES_CHAIN']);
});

test('a private label stays quiet on its own chain', () => {
  const labels = indexPrivateLabels({ Hacendado: 'Mercadona' });
  const issues = check({ decision: goodCreate, privateLabels: labels });
  assert.deepEqual(issues, []);
});

// ---------------------------------------------------------------------------
// The system prompt and the create body
// ---------------------------------------------------------------------------

test('the system prompt carries the six rules and both vocabularies', () => {
  const system = buildSystemPrompt({
    template: readFileSync(
      new URL('./review-entries-prompt.md', import.meta.url),
      'utf8'
    ),
    categories,
    units,
    privateLabels: PRIVATE_LABELS,
  });
  assert.ok(system.includes('Same brand plus same format merges'));
  assert.ok(system.includes('A private label never crosses a chain'));
  for (const value of [...categories, ...units]) {
    assert.ok(system.includes(`\`${value}\``), `${value} is missing`);
  }
  assert.ok(system.includes('Hacendado'));
});

test('the create body names the fields CreateItemFromEntryDto names', () => {
  assert.deepEqual(toCreateItemBody(goodCreate.item), {
    name: { es: 'Galletas María', en: 'Marie biscuits' },
    brand: 'Hacendado',
    ean: '8480000111111',
    unitSize: 800,
    category: 'SNACKS',
    defaultUnit: 'GRAM',
  });
  assert.deepEqual(
    toCreateItemBody({ ...goodCreate.item, nameEn: null }).name,
    { es: 'Galletas María' }
  );
});

// ---------------------------------------------------------------------------
// One entry, end to end, with the model faked
// ---------------------------------------------------------------------------

function reviewOne(entry, reply, options = {}) {
  return reviewEntry({
    entry,
    gateway: stubGateway(options.gateway),
    supermarket: MERCADONA,
    system: 'system',
    apiKey: 'test-key',
    fetchImpl: makeFakeFetch({ reply, apiStatus: options.apiStatus ?? null }),
    sleep: async () => {},
    usage: options.usage ?? null,
    privateLabels: PRIVATE_LABELS,
    categories,
    units,
    apply: options.apply ?? false,
  });
}

test('a confidence under 0.9 is demoted to REVIEW', async () => {
  const record = await reviewOne(milkEntry, () =>
    JSON.stringify({
      decision: 'LINK',
      itemId: 'item-milk',
      confidence: 0.72,
      issues: [{ code: 'AMBIGUOUS', detail: 'two milks look alike' }],
      reasoning: 'not sure',
    })
  );
  assert.equal(record.decision, 'REVIEW');
  assert.equal(record.proposedDecision, 'LINK');
  assert.deepEqual(codes(record.issues), ['AMBIGUOUS', 'LOW_CONFIDENCE']);
  assert.equal(record.applied, false);
});

test('a reply that will not parse is retried once and then REVIEWed', async () => {
  const seen = [];
  const record = await reviewOne(milkEntry, (packet, index) => {
    seen.push(index);
    return REPLIES.invalid[Math.min(index, REPLIES.invalid.length - 1)];
  });
  assert.equal(seen.length, 2, 'the model is asked exactly twice');
  assert.equal(record.decision, 'REVIEW');
  assert.deepEqual(codes(record.issues), ['MODEL_OUTPUT_INVALID']);
  assert.equal(record.applied, false);
});

test('a reply that parses but breaks the schema is retried too', async () => {
  let calls = 0;
  const record = await reviewOne(milkEntry, () => {
    calls += 1;
    return JSON.stringify({ decision: 'LINK', confidence: 0.99 });
  });
  assert.equal(calls, 2);
  assert.equal(record.decision, 'REVIEW');
  assert.deepEqual(codes(record.issues), ['MODEL_OUTPUT_INVALID']);
});

test('a model call that keeps failing is a REVIEW, not a crash', async () => {
  const record = await reviewOne(milkEntry, () => '{}', { apiStatus: 503 });
  assert.equal(record.decision, 'REVIEW');
  assert.deepEqual(codes(record.issues), ['MODEL_CALL_FAILED']);
});

test('a fenced reply is still an answer', async () => {
  const record = await reviewOne(
    milkEntry,
    () => '```json\n' + JSON.stringify(REPLIES.byEntry['entry-milk']) + '\n```'
  );
  assert.equal(record.decision, 'LINK');
  assert.equal(record.itemId, 'item-milk');
});

// ---------------------------------------------------------------------------
// A whole dry run over the fixtures
// ---------------------------------------------------------------------------

test('a dry run decides every queued row and writes nothing', async () => {
  const { stdout, stderr, report, records, calls } = await runOverFixtures();

  // The route answers newest first, so the run works the oldest row first.
  assert.deepEqual(
    records.map((record) => record.entryId),
    [
      'entry-milk',
      'entry-biscuits',
      'entry-detergent',
      'entry-bread',
      'entry-oil',
    ]
  );
  assert.deepEqual(
    records.map((record) => record.decision),
    ['LINK', 'CREATE', 'REVIEW', 'REVIEW', 'REVIEW']
  );

  // stdout is one JSON line per entry and nothing else.
  assert.equal(stdout.length, 5);
  const parsed = stdout.map((line) => JSON.parse(line));
  assert.deepEqual(parsed[0], records[0]);
  assert.equal(parsed[0].applied, false);

  // stderr is progress, one line per entry, plus the two file paths.
  assert.equal(stderr[0], '1/5 - Leche semidesnatada');
  assert.equal(stderr[4], '5/5 - Aceite de oliva Hacendado 1 L');

  assert.deepEqual(report.counts, {
    LINK: 1,
    CREATE: 1,
    REVIEW: 3,
    applied: 0,
    failed: 0,
  });
  assert.deepEqual(
    report.reviews.map((review) => [review.entryId, codes(review.issues)]),
    [
      ['entry-detergent', ['NO_BRAND_OR_SIZE', 'LOW_CONFIDENCE']],
      ['entry-bread', ['CHAIN_NOT_REGISTERED']],
      ['entry-oil', ['NAME_CARRIES_BRAND', 'NAME_CARRIES_SIZE']],
    ]
  );
  assert.deepEqual(report.usage, {
    calls: 5,
    inputTokens: 500,
    outputTokens: 250,
    cacheReadInputTokens: 450,
    cacheCreationInputTokens: 50,
  });

  // Nothing was written, and reject is never called at all.
  assert.equal(
    calls.some(
      (call) => call.method === 'POST' && !call.url.startsWith(MESSAGES_URL)
    ),
    false
  );
  assert.equal(
    calls.some((call) => call.url.includes('/reject')),
    false
  );
});

test('the dry run writes the log and the report to disk', async () => {
  const { logUrl, reportUrl } = await runOverFixtures();
  const lines = readFileSync(logUrl, 'utf8').trim().split('\n');
  assert.equal(lines.length, 5);
  assert.equal(JSON.parse(lines[0]).entryId, 'entry-milk');
  const report = JSON.parse(readFileSync(reportUrl, 'utf8'));
  assert.equal(report.entries, 5);
  assert.equal(report.apply, false);
});

test('--limit stops the run early', async () => {
  const { records } = await runOverFixtures(['--limit', '2']);
  assert.deepEqual(
    records.map((record) => record.entryId),
    ['entry-milk', 'entry-biscuits']
  );
});

test('--apply writes through accept and the item route, and never rejects', async () => {
  const { records, report, calls } = await runOverFixtures(['--apply']);

  const writes = calls.filter(
    (call) => call.method === 'POST' && !call.url.startsWith(MESSAGES_URL)
  );
  assert.equal(writes.length, 2);
  assert.ok(
    writes[0].url.endsWith('/v1/admin/harvest/entries/entry-milk/accept')
  );
  assert.deepEqual(writes[0].body, { itemId: 'item-milk' });
  assert.ok(
    writes[1].url.endsWith('/v1/admin/harvest/entries/entry-biscuits/item')
  );
  assert.deepEqual(writes[1].body, {
    name: { es: 'Galletas María', en: 'Marie biscuits' },
    brand: 'Hacendado',
    ean: '8480000111111',
    unitSize: 800,
    category: 'SNACKS',
    defaultUnit: 'GRAM',
  });

  assert.deepEqual(
    records.filter((record) => record.applied).map((record) => record.entryId),
    ['entry-milk', 'entry-biscuits']
  );
  assert.equal(report.counts.applied, 2);
  assert.equal(report.counts.failed, 0);
});

test('a write that fails leaves the row queued and says so', async () => {
  const out = mkdtempSync(join(tmpdir(), 'review-entries-'));
  const stdout = [];
  const fetchImpl = makeFakeFetch({ reply: cannedReply });
  const failing = async (url, init) => {
    if (init?.method === 'POST' && url.endsWith('/accept')) {
      return jsonResponse(409, { detail: 'already decided' });
    }
    return fetchImpl(url, init);
  };
  const { records, report } = await run({
    argv: [
      '--chain',
      'sm-mercadona',
      '--limit',
      '1',
      '--apply',
      '--out-dir',
      out,
    ],
    env: ENV,
    fetchImpl: failing,
    sleep: async () => {},
    stdout: (line) => stdout.push(line),
    stderr: () => {},
    now: () => new Date('2026-09-08T10:00:00.000Z'),
  });
  assert.equal(records[0].applied, false);
  assert.ok(codes(records[0].issues).includes('APPLY_FAILED'));
  assert.equal(report.counts.failed, 1);
});

test('the run refuses to start without an API key', async () => {
  await assert.rejects(
    () =>
      run({ argv: [], env: {}, fetchImpl: async () => jsonResponse(200, {}) }),
    /ANTHROPIC_API_KEY/
  );
});

test('the run refuses to start without an admin session', async () => {
  await assert.rejects(
    () =>
      run({
        argv: [],
        env: { ANTHROPIC_API_KEY: 'test-key' },
        fetchImpl: async () => jsonResponse(200, {}),
      }),
    /LUNA_ADMIN_TOKEN/
  );
});
