import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  AUDIT_ORIGIN,
  CHANGE_LIST_KIND,
  foldChanges,
  sameValue,
} from './changes.mjs';
import {
  BATCH_PATH,
  CLASS,
  DECISION_CLASS,
  LOOKUP_PATH,
  SHORT_WASH_WORD,
  WASH_SUM,
  batchEntry,
  classify,
  dropUnits,
  makeTargetClient,
  prepareDecisions,
  replayChanges,
  replayDecisions,
  runReplay,
  runReplayIdentity,
  washCount,
} from './replay.mjs';

// Made up ids only: nothing here names a real product or entry.
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function sink() {
  const written = [];
  return { write: (text) => written.push(text), text: () => written.join('') };
}

/** A product as the lookup answers it. */
const product = (n, over = {}) => ({
  id: id(n),
  name: { es: `Producto ${n}`, en: `Product ${n}` },
  brand: 'Marca',
  unitSize: 500,
  approxWeight: null,
  quantityStep: null,
  defaultUnit: 'GRAM',
  packCount: null,
  categories: [{ slug: 'leche' }],
  ...over,
});

/** A change as the folding answers it. */
const change = (n, fields, over = {}) => ({
  itemId: id(n),
  class: null,
  reason: null,
  identity: {
    name: { es: `Producto ${n}`, en: `Product ${n}` },
    brand: 'Marca',
  },
  fields,
  unguarded: [],
  ...over,
});

class HttpError extends Error {
  constructor(status, body) {
    super(`answered ${status}`);
    this.status = status;
    this.body = body === undefined ? undefined : JSON.stringify(body);
  }
}

/**
 * A target gateway in memory: the lookup, the source rows and the batch, with
 * the batch's expect compared as catalog compares it. `refuse(entries)` may
 * throw before anything is written, to play a refusal.
 */
function fakeTarget(items, { entries = {}, refuse = null } = {}) {
  const store = new Map(items.map((item) => [item.id, structuredClone(item)]));
  const calls = [];
  const client = {
    requests: 0,
    async request(path, init = {}) {
      client.requests += 1;
      calls.push({ path, method: init.method ?? 'GET', body: init.body });
      if (path === LOOKUP_PATH) {
        return {
          items: init.body.ids
            .filter((key) => store.has(key))
            .map((key) => structuredClone(store.get(key))),
        };
      }
      const rows = /\/v1\/admin\/harvest\/items\/(.+)\/entries/.exec(path);
      if (rows) {
        return {
          items: entries[decodeURIComponent(rows[1])] ?? [],
          nextCursor: null,
        };
      }
      if (path === BATCH_PATH) {
        refuse?.(init.body.items, store);
        const failures = [];
        for (const entry of init.body.items) {
          const held = store.get(entry.itemId);
          const fields = [];
          for (const [field, expected] of Object.entries(entry.expect)) {
            const actual =
              field === 'categorySlugs'
                ? held.categories.map((c) => c.slug)
                : held[field];
            const kind =
              field === 'name'
                ? 'name'
                : field === 'brand'
                  ? 'brand'
                  : field === 'categorySlugs'
                    ? 'slugs'
                    : 'number';
            if (!sameValue(kind, expected, actual)) {
              fields.push({ field, expected, actual });
            }
          }
          if (fields.length) {
            failures.push({ itemId: entry.itemId, fields });
          }
        }
        if (failures.length) {
          throw new HttpError(409, {
            code: 'item_expectation_failed',
            details: { failures },
          });
        }
        for (const { itemId, expect: _expect, ...edit } of init.body.items) {
          const held = store.get(itemId);
          for (const [field, value] of Object.entries(edit)) {
            if (field === 'categorySlugs') {
              held.categories = value.map((slug) => ({ slug }));
            } else {
              held[field] = value;
            }
          }
        }
        return { items: [] };
      }
      throw new Error(`unexpected ${path}`);
    },
  };
  return { client, calls, store };
}

const patches = (calls) => calls.filter((call) => call.path === BATCH_PATH);

// --- Classes -----------------------------------------------------------------

test('one product per class of the table', () => {
  const size = (from, to) => [{ field: 'unitSize', from, to }];
  const cases = [
    [
      change(1, [], { class: CLASS.NOT_CARRIED, reason: 'created locally' }),
      product(1),
      CLASS.NOT_CARRIED,
    ],
    [
      change(2, [], { class: CLASS.LOCAL_GAP, reason: 'gap' }),
      product(2),
      CLASS.LOCAL_GAP,
    ],
    [change(3, size(500, 450)), undefined, CLASS.NO_TWIN],
    [
      change(4, size(500, 450)),
      product(4, { mergedInto: id(40) }),
      CLASS.MERGED,
    ],
    [
      change(5, size(53, null)),
      product(5, { unitSize: 53, defaultUnit: 'UNIT' }),
      CLASS.WASH,
      [{ status: 'ACTIVE', sizeFormat: ' 35+18 lavados ' }],
    ],
    [
      change(6, size(500, 450)),
      product(6, { name: { es: 'Otro', en: 'Other' } }),
      CLASS.IDENTITY,
    ],
    [change(7, size(500, 450)), product(7, { unitSize: 450 }), CLASS.ALREADY],
    [change(8, size(500, 450)), product(8, { unitSize: 400 }), CLASS.CONFLICT],
    [change(9, size(500, 450)), product(9), CLASS.APPLY],
  ];
  for (const [given, item, expected, washRows = null] of cases) {
    assert.equal(
      classify(given, item, { washRows }).class,
      expected,
      given.itemId
    );
  }
});

test('the order of the table decides when two classes apply', () => {
  // merged and renamed: merged first
  const merged = classify(
    change(1, [{ field: 'unitSize', from: 500, to: 450 }]),
    product(1, {
      mergedInto: id(2),
      name: { es: 'Otro' },
    })
  );
  assert.equal(merged.class, CLASS.MERGED);
  assert.equal(merged.survivor, id(2));
  // a wash product renamed on the target is still the wash task's
  const wash = classify(
    change(3, [{ field: 'unitSize', from: 40, to: null }]),
    product(3, { unitSize: 40, defaultUnit: 'UNIT', name: { es: 'Otro' } }),
    { washRows: [{ status: 'ACTIVE', sizeFormat: '40lav' }] }
  );
  assert.equal(wash.class, CLASS.WASH);
  // renamed and already there: identity first
  const renamed = classify(
    change(4, [{ field: 'unitSize', from: 500, to: 450 }]),
    product(4, { unitSize: 450, brand: 'Otra' })
  );
  assert.equal(renamed.class, CLASS.IDENTITY);
  // one field conflicting holds back a field that would apply
  const held = classify(
    change(5, [
      { field: 'unitSize', from: 500, to: 450 },
      { field: 'packCount', from: null, to: 6 },
    ]),
    product(5, { packCount: 4 })
  );
  assert.equal(held.class, CLASS.CONFLICT);
});

test('a list with only the Spanish half compares that half and expects no name', () => {
  const weak = change(1, [{ field: 'unitSize', from: 500, to: 450 }], {
    identity: { name: { es: 'Producto 1', en: null } },
  });
  const line = classify(weak, product(1), { esOnly: true });
  assert.equal(line.class, CLASS.APPLY);
  const entry = batchEntry(line, { esOnly: true });
  assert.equal(entry.expect.name, undefined);
  assert.equal(entry.expect.brand, undefined);
});

// --- Write -------------------------------------------------------------------

test('a dry run sends no PATCH', async () => {
  const { client, calls } = fakeTarget([product(1)]);
  const { lines } = await replayChanges({
    changes: [change(1, [{ field: 'unitSize', from: 500, to: 450 }])],
    client,
  });
  assert.equal(lines[0].class, CLASS.APPLY);
  assert.equal(patches(calls).length, 0);
  assert.deepEqual(
    calls.map((call) => call.method),
    ['POST']
  );
});

test('the expect holds from plus name and brand, and a field already at to is not sent', () => {
  const line = classify(
    change(1, [
      { field: 'unitSize', from: 500, to: 450 },
      { field: 'packCount', from: null, to: 6 },
      { field: 'categories', from: ['leche'], to: ['leche', 'bebidas'] },
    ]),
    product(1, { packCount: 6 })
  );
  assert.deepEqual(batchEntry(line), {
    itemId: id(1),
    unitSize: 450,
    categorySlugs: ['leche', 'bebidas'],
    expect: {
      unitSize: 500,
      categorySlugs: ['leche'],
      name: { es: 'Producto 1', en: 'Product 1' },
      brand: 'Marca',
    },
  });
});

test('a write changes the apply class only, and a second dry run finds it already there', async () => {
  const items = [product(1), product(2, { unitSize: 400 }), product(3)];
  const { client, calls, store } = fakeTarget(items);
  const changes = [1, 2, 3].map((n) =>
    change(n, [{ field: 'unitSize', from: 500, to: 450 }])
  );
  const first = await replayChanges({ changes, client, write: true });
  assert.deepEqual(
    first.lines.map((line) => line.class),
    [CLASS.APPLY, CLASS.CONFLICT, CLASS.APPLY]
  );
  assert.equal(patches(calls).length, 1);
  assert.equal(store.get(id(2)).unitSize, 400);
  assert.equal(store.get(id(1)).unitSize, 450);
  const second = await replayChanges({ changes, client });
  assert.deepEqual(
    second.lines.map((line) => line.class),
    [CLASS.ALREADY, CLASS.CONFLICT, CLASS.ALREADY]
  );
});

test('item_expectation_failed on two of five sends the other three again and classes the two by field', async () => {
  const items = [1, 2, 3, 4, 5].map((n) => product(n));
  const { client, calls, store } = fakeTarget(items);
  const changes = items.map((item, index) =>
    change(index + 1, [{ field: 'unitSize', from: 500, to: 450 }])
  );
  const { lines: classed } = await replayChanges({ changes, client });
  // Both move after the lookup, before the write: one renamed, one resized.
  store.get(id(2)).brand = 'Otra';
  store.get(id(4)).unitSize = 300;
  const { writeApply } = await import('./replay.mjs');
  await writeApply(client, classed, { batchSize: 100 });
  const sent = patches(calls);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].body.items.length, 3);
  assert.equal(classed[1].class, CLASS.IDENTITY);
  assert.equal(classed[3].class, CLASS.CONFLICT);
  assert.equal(classed[3].fields[0].target, 300);
  assert.equal(store.get(id(4)).unitSize, 300);
  assert.equal(store.get(id(2)).unitSize, 500);
  for (const n of [1, 3, 5]) {
    assert.equal(store.get(id(n)).unitSize, 450);
  }
});

test('brand_unregistered in a batch of eight isolates the one product in at most three splits', async () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => product(n));
  const bad = id(6);
  const { client, calls } = fakeTarget(items, {
    refuse: (entries) => {
      if (entries.some((entry) => entry.itemId === bad)) {
        throw new HttpError(400, {
          code: 'brand_unregistered',
          detail: 'Marca Nueva is not registered',
        });
      }
    },
  });
  const changes = items.map((item, index) =>
    change(index + 1, [
      {
        field: 'brand',
        from: 'Marca',
        to: index === 5 ? 'Marca Nueva' : 'Marca',
      },
    ])
  );
  // Make every product an edit: seven change the size, the bad one the brand.
  for (const [index, given] of changes.entries()) {
    if (index !== 5) {
      given.fields = [{ field: 'unitSize', from: 500, to: 450 }];
    }
  }
  const { lines } = await replayChanges({ changes, client, write: true });
  const refused = lines.filter((line) => line.class === CLASS.REFUSED);
  assert.equal(refused.length, 1);
  assert.equal(refused[0].itemId, bad);
  assert.equal(refused[0].code, 'brand_unregistered');
  // 8, then 4 + 4, then 2 + 2 of the bad half, then 1 + 1: seven sends.
  assert.ok(patches(calls).length <= 7);
  assert.equal(lines.filter((line) => line.written).length, 7);
});

test('a 504 reads the batch again and sends only what did not land', async () => {
  const items = [1, 2, 3].map((n) => product(n));
  let lost = true;
  const { client, calls, store } = fakeTarget(items, {
    refuse: (entries, held) => {
      if (lost) {
        lost = false;
        // The first product landed before the proxy gave up.
        held.get(entries[0].itemId).unitSize = 450;
        throw new HttpError(504);
      }
    },
  });
  const changes = items.map((item, index) =>
    change(index + 1, [{ field: 'unitSize', from: 500, to: 450 }])
  );
  const { lines } = await replayChanges({
    changes,
    client,
    write: true,
    stderr: sink(),
  });
  const sent = patches(calls);
  assert.equal(sent.length, 2);
  assert.deepEqual(
    sent[1].body.items.map((entry) => entry.itemId),
    [id(2), id(3)]
  );
  assert.equal(lines[0].class, CLASS.ALREADY);
  assert.equal(lines[0].afterLostAnswer, true);
  assert.equal(store.get(id(3)).unitSize, 450);
});

test('a 429 waits the seconds the answer names and sends the same request again', async () => {
  const waits = [];
  let answers = 0;
  const session = {
    async fetch() {
      answers += 1;
      if (answers === 1) {
        throw new HttpError(429, {
          code: 'rate_limited',
          details: { retryAfterSeconds: 7 },
        });
      }
      return { items: [] };
    },
  };
  let clock = 0;
  const client = makeTargetClient({
    session,
    stderr: sink(),
    sleep: async (ms) => {
      waits.push(ms);
      clock += ms;
    },
    now: () => clock,
  });
  const answer = await client.request(LOOKUP_PATH, {
    method: 'POST',
    body: { ids: [] },
  });
  assert.deepEqual(answer, { items: [] });
  assert.equal(answers, 2);
  assert.ok(waits.includes(7000));
});

test('the client paces itself to ten requests a second', async () => {
  const waits = [];
  let clock = 0;
  const client = makeTargetClient({
    session: { fetch: async () => ({}) },
    sleep: async (ms) => {
      waits.push(ms);
      clock += ms;
    },
    now: () => clock,
  });
  await client.request('/a');
  await client.request('/b');
  await client.request('/c');
  assert.deepEqual(waits, [100, 100]);
});

// --- Wash rule ---------------------------------------------------------------

test('the wash rule: a sum and a short word, at a UNIT size equal to the count', async () => {
  assert.equal(washCount('35+18 lavados'), 53);
  assert.equal(washCount('40lav'), 40);
  assert.equal(washCount('40 lv.'), 40);
  assert.equal(washCount('caja de 40 lavados'), null);

  const run = async (item, rows) => {
    const { client, calls } = fakeTarget([item], {
      entries: { [item.id]: rows },
    });
    const from = Number(item.unitSize);
    const { lines } = await replayChanges({
      changes: [
        change(Number(item.id.slice(-2)), [
          { field: 'unitSize', from, to: null },
        ]),
      ],
      client,
    });
    return {
      line: lines[0],
      reads: calls.filter((call) => call.path.includes('/entries')).length,
    };
  };

  const excluded = await run(
    product(11, { unitSize: 53, defaultUnit: 'UNIT' }),
    [{ status: 'ACTIVE', sizeFormat: '35+18 lavados' }]
  );
  assert.equal(excluded.line.class, CLASS.WASH);
  assert.equal(excluded.reads, 1);

  const otherCount = await run(
    product(12, { unitSize: 42, defaultUnit: 'UNIT' }),
    [{ status: 'ACTIVE', sizeFormat: '40lav' }]
  );
  assert.equal(otherCount.line.class, CLASS.APPLY);

  const millilitres = await run(
    product(13, { unitSize: 40, defaultUnit: 'MILLILITER' }),
    [{ status: 'ACTIVE', sizeFormat: '40lav' }]
  );
  assert.equal(millilitres.line.class, CLASS.APPLY);
  assert.equal(millilitres.reads, 0);

  const candidate = await run(
    product(14, { unitSize: 40, defaultUnit: 'UNIT' }),
    [{ status: 'CANDIDATE', sizeFormat: '40lav' }]
  );
  assert.equal(candidate.line.class, CLASS.APPLY);
});

test('the two wash literals are the source of release task 0007 wash-sizes.ts', () => {
  const path = fileURLToPath(
    new URL(
      '../../../../../../apps/luna-shopper-backend/harvester/src/app/release-tasks/wash-sizes.ts',
      import.meta.url
    )
  );
  const text = readFileSync(path, 'utf8');
  const literal = (name) => {
    const match = new RegExp(`const ${name} = /(.+)/([a-z]*);`).exec(text);
    assert.ok(
      match,
      `wash-sizes.ts declares ${name} as a regular expression literal`
    );
    return { source: match[1], flags: match[2] };
  };
  for (const [name, mine] of [
    ['SHORT_WASH_WORD', SHORT_WASH_WORD],
    ['WASH_SUM', WASH_SUM],
  ]) {
    assert.deepEqual(
      literal(name),
      { source: mine.source, flags: mine.flags },
      name
    );
  }
});

// --- Report ------------------------------------------------------------------

test('a replay writes one report with one class per product and prints counts only', async () => {
  const { client } = fakeTarget([product(1), product(2, { unitSize: 450 })]);
  const changeList = {
    header: {
      header: true,
      kind: CHANGE_LIST_KIND,
      origin: AUDIT_ORIGIN,
      otherEntities: { brands: 2 },
    },
    lines: [
      {
        itemId: id(1),
        line: 2,
        action: 'UPDATE',
        before: { unitSize: 500, ean: null },
        after: { unitSize: 450, ean: '8410000000000' },
        current: {
          name: { es: 'Producto 1', en: 'Product 1' },
          brand: 'Marca',
        },
      },
      {
        itemId: id(2),
        line: 3,
        action: 'UPDATE',
        before: { unitSize: 500 },
        after: { unitSize: 450 },
        current: {
          name: { es: 'Producto 2', en: 'Product 2' },
          brand: 'Marca',
        },
      },
    ],
  };
  let written = null;
  const stderr = sink();
  const report = await runReplay({
    changeFile: 'changes.jsonl',
    changeList,
    folded: foldChanges(changeList),
    targetUrl: 'http://localhost:43700',
    write: false,
    batchSize: 100,
    reportPath: 'report.json',
    client,
    stderr,
    writeFile: (path, text) => {
      written = JSON.parse(text);
    },
  });
  assert.equal(written.header.dryRun, true);
  assert.match(written.header.dryRunLimits, /cannot predict/);
  assert.equal(report.counts.classes[CLASS.APPLY], 1);
  assert.equal(report.counts.classes[CLASS.ALREADY], 1);
  assert.deepEqual(written.notCarried, {
    otherEntities: { brands: 2 },
    unguardedFields: { ean: 1 },
  });
  assert.doesNotMatch(stderr.text(), /00000000-0000/);
  assert.doesNotMatch(stderr.text(), /Producto/);
});

// --- Identity pass -----------------------------------------------------------

const identityReport = (targetUrl) => ({
  header: { targetUrl },
  lines: [1, 2].map((n) => ({
    itemId: id(n),
    class: CLASS.IDENTITY,
    fields: [{ field: 'unitSize', from: 500, to: 450, target: 500 }],
    identity: {
      local: { name: { es: `Viejo ${n}`, en: null }, brand: 'Marca' },
      target: {
        name: { es: `Producto ${n}`, en: `Product ${n}` },
        brand: 'Marca',
      },
    },
  })),
});

test('the identity pass refuses a report of another url', async () => {
  const { client, calls } = fakeTarget([]);
  await assert.rejects(
    () =>
      runReplayIdentity({
        reportFile: 'r.json',
        previous: identityReport('http://elsewhere:3000'),
        targetUrl: 'http://localhost:43700',
        write: true,
        reportPath: 'x.json',
        client,
        stderr: sink(),
        writeFile: () => assert.fail('written'),
      }),
    /Refusing/
  );
  assert.equal(calls.length, 0);
});

test('--only sends only the named products, under the target name and brand from the report', async () => {
  const { client, calls, store } = fakeTarget([product(1), product(2)]);
  await runReplayIdentity({
    reportFile: 'r.json',
    previous: identityReport('http://localhost:43700/'),
    targetUrl: 'http://localhost:43700',
    only: [id(2)],
    write: true,
    batchSize: 100,
    reportPath: 'x.json',
    client,
    stderr: sink(),
    writeFile: () => undefined,
  });
  const sent = patches(calls);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].body.items, [
    {
      itemId: id(2),
      unitSize: 450,
      expect: {
        unitSize: 500,
        name: { es: 'Producto 2', en: 'Product 2' },
        brand: 'Marca',
      },
    },
  ]);
  assert.equal(store.get(id(1)).unitSize, 500);
  assert.equal(store.get(id(2)).unitSize, 450);
});

// --- Section 6: decisions ----------------------------------------------------

const observed = {
  name: 'Leche',
  brand: null,
  ean: null,
  sizeFormat: '1 l',
  unitSize: 1000,
  sizeUnit: 'MILLILITER',
  packCount: null,
  soldByWeight: false,
  approxWeight: null,
};
const expect = {
  status: 'CANDIDATE',
  lastSeenAt: '2026-11-20T00:00:00.000Z',
  observed,
};
const linkRow = (n, itemId) => ({
  entryId: `e${n}`,
  decision: 'LINK',
  itemId,
  expect,
});
const createRow = (n) => ({
  entryId: `e${n}`,
  decision: 'CREATE',
  ref: `r${n}`,
  item: { nameEs: 'x' },
  expect,
});
const linkRef = (n, ref) => ({
  entryId: `e${n}`,
  decision: 'LINK',
  itemRef: ref,
  expect,
});

test('a decisions file without the content expect is refused whole', () => {
  const bare = {
    ...linkRow(1, id(1)),
    expect: { status: 'CANDIDATE', lastSeenAt: 'x' },
  };
  assert.throws(
    () =>
      prepareDecisions({
        file: 'd.jsonl',
        header: { header: true },
        records: [linkRow(2, id(2)), bare],
        implementation: 'suggestions',
      }),
    /1 of the 2 decided rows .* carry no complete expect\.observed/
  );
  assert.throws(
    () =>
      prepareDecisions({
        file: 'd.jsonl',
        header: { header: true },
        records: [],
        implementation: 'groups',
      }),
    /Only those are replayed/
  );
});

test('a prepared decision expects status and content, and no lastSeenAt', () => {
  const prepared = prepareDecisions({
    file: 'd.jsonl',
    header: { header: true },
    records: [linkRow(1, id(1)), { entryId: 'e9', decision: 'REVIEW' }],
    implementation: 'suggestions',
  });
  assert.equal(prepared.records.length, 1);
  assert.deepEqual(prepared.records[0].expect, {
    status: 'CANDIDATE',
    observed,
  });
});

test('an accept of a product with no twin is dropped, and a dropped create takes its unit', () => {
  const records = [createRow(1), linkRef(2, 'r1'), linkRow(3, id(3))];
  const { kept, removed } = dropUnits(
    records,
    new Map([['e1', { class: DECISION_CLASS.CONFLICT }]])
  );
  assert.deepEqual(
    kept.map((record) => record.entryId),
    ['e3']
  );
  assert.deepEqual(
    removed.map((line) => [line.entryId, line.class]),
    [
      ['e1', DECISION_CLASS.CONFLICT],
      ['e2', DECISION_CLASS.DROPPED_WITH_UNIT],
    ]
  );
});

test('a refusal at VALIDATE drops the refused units and sends the rest', async () => {
  const prepared = {
    header: { header: true, runId: 'r', mainUrl: 'http://local:3000' },
    records: [
      linkRow(1, id(1)),
      linkRow(2, id(2)),
      createRow(3),
      linkRef(4, 'r3'),
      linkRow(5, id(99)),
    ],
  };
  const sent = [];
  const files = new Map();
  const result = await replayDecisions({
    prepared,
    items: new Map([
      [id(1), {}],
      [id(2), {}],
    ]),
    write: true,
    partBase: 'report.decisions',
    splitParts: (records) => [records],
    writeFile: (path, text) => files.set(path, text),
    applyFile: async (path) => {
      const records = files
        .get(path)
        .trim()
        .split('\n')
        .slice(1)
        .map((text) => JSON.parse(text));
      sent.push(records.map((record) => record.entryId));
      if (sent.length === 1) {
        return {
          applied: false,
          failedStep: 'VALIDATE',
          results: [
            { entryId: 'e1', error: null },
            {
              entryId: 'e2',
              error: { code: 'NOT_PENDING', detail: 'decided' },
            },
            {
              entryId: 'e3',
              error: { code: 'EXPECT_MISMATCH', detail: 'moved' },
            },
            { entryId: 'e4', error: null },
          ],
        };
      }
      return { applied: true, results: [] };
    },
  });
  assert.deepEqual(sent, [['e1', 'e2', 'e3', 'e4'], ['e1']]);
  const byEntry = Object.fromEntries(
    result.lines.map((line) => [line.entryId, line.class])
  );
  assert.deepEqual(byEntry, {
    e1: DECISION_CLASS.APPLIED,
    e2: DECISION_CLASS.DECIDED_ON_TARGET,
    e3: DECISION_CLASS.CONFLICT,
    e4: DECISION_CLASS.DROPPED_WITH_UNIT,
    e5: DECISION_CLASS.NO_TWIN,
  });
});

test('a dry run of decisions sends nothing', async () => {
  const result = await replayDecisions({
    prepared: { header: { header: true }, records: [linkRow(1, id(1))] },
    items: new Map([[id(1), {}]]),
    write: false,
    applyFile: () => assert.fail('sent'),
    splitParts: () => assert.fail('split'),
  });
  assert.deepEqual(
    result.lines.map((line) => line.class),
    [DECISION_CLASS.APPLY]
  );
});
