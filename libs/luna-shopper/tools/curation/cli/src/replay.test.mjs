import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { AUDIT_ORIGIN, CHANGE_LIST_KIND, foldChanges } from './changes.mjs';
import {
  BATCH_PATH,
  CLASS,
  DECISION_CLASS,
  LOOKUP_PATH,
  MAX_IDLE_DECISION_ROUNDS,
  RENAME_TRIES,
  ReplayStopped,
  SHORT_WASH_WORD,
  WASH_NOTE,
  WASH_SUM,
  batchEntry,
  capturingFetch,
  classify,
  countLines,
  countsLine,
  dropUnits,
  identityChanges,
  makeTargetClient,
  markUnsettled,
  prepareDecisions,
  replayChanges,
  replayDecisions,
  runReplay,
  runReplayIdentity,
  washCount,
  writeApply,
  writeFileAtomic,
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
  pieceCount: null,
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

// --- The fake target ---------------------------------------------------------
//
// Its comparison is written from catalog's rules (`expectationMismatches` and
// `brandKey`, backend `item.service.ts` and contracts `brand-key.ts`), not from
// the client's `sameValue`, so a test proves the client predicts the server
// instead of restating itself.

/** Catalog's brand key: accents dropped, lower case, letters and digits only. */
function serverBrandKey(text) {
  if (text == null) {
    return null;
  }
  const key = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return key === '' ? null : key;
}

function serverTrimmedOrNull(value) {
  const text = value?.trim();
  return text ? text : null;
}

/**
 * Each field an expectation names that the row does not hold, as catalog
 * finds them: a name half left out expects no name in that language, a brand
 * by key, `unitSize` and `approxWeight` as numbers because Postgres answers a
 * `numeric` as a string, `pieceCount` as a number too (backend plan 0278), the
 * rest strictly, null meaning the row holds nothing.
 */
function serverMismatches(row, expect) {
  const mismatches = [];
  const slugs = (row.categories ?? []).map((category) => category.slug);
  if (expect.name !== undefined) {
    const differs = ['en', 'es'].some(
      (locale) =>
        serverTrimmedOrNull(expect.name?.[locale]) !==
        serverTrimmedOrNull(row.name?.[locale])
    );
    if (differs) {
      mismatches.push({
        field: 'name',
        expected: expect.name,
        actual: row.name,
      });
    }
  }
  if (
    expect.brand !== undefined &&
    serverBrandKey(expect.brand) !== serverBrandKey(row.brand)
  ) {
    mismatches.push({
      field: 'brand',
      expected: expect.brand,
      actual: row.brand,
    });
  }
  for (const field of ['unitSize', 'approxWeight', 'pieceCount']) {
    if (expect[field] !== undefined) {
      const actual =
        row[field] === null || row[field] === undefined
          ? null
          : Number(row[field]);
      if (actual !== expect[field]) {
        mismatches.push({ field, expected: expect[field], actual });
      }
    }
  }
  for (const field of ['quantityStep', 'packCount']) {
    if (expect[field] !== undefined && (row[field] ?? null) !== expect[field]) {
      mismatches.push({
        field,
        expected: expect[field],
        actual: row[field] ?? null,
      });
    }
  }
  if (
    expect.defaultUnit !== undefined &&
    row.defaultUnit !== expect.defaultUnit
  ) {
    mismatches.push({
      field: 'defaultUnit',
      expected: expect.defaultUnit,
      actual: row.defaultUnit,
    });
  }
  if (expect.categorySlugs !== undefined) {
    const expected = expect.categorySlugs ?? [];
    const same =
      expected.length === slugs.length &&
      expected.every((slug, index) => slug === slugs[index]);
    if (!same) {
      mismatches.push({
        field: 'categorySlugs',
        expected: expect.categorySlugs,
        actual: [...slugs],
      });
    }
  }
  return mismatches;
}

/**
 * A target gateway in memory: the lookup, the source rows and the batch.
 *
 * The batch is all or nothing, as the route is: every expectation is compared
 * before any edit is written, and one failure refuses the request.
 * `refuse(entries, sendIndex)` may throw before anything is compared, to play a
 * refusal. `lose(sendIndex)` plays a lost answer: `'before'` answers 504 and
 * writes nothing, `'after'` writes the whole batch and then answers 504, and
 * `'late'` answers 504 and writes the whole batch once the next lookup has
 * answered, as a request that committed after the proxy gave up, and
 * `'unreadable'` writes the whole batch and answers 200 with a body that is
 * not JSON, as the session reports it.
 */
function fakeTarget(items, { entries = {}, refuse = null, lose = null } = {}) {
  const store = new Map(items.map((item) => [item.id, structuredClone(item)]));
  const calls = [];
  let sends = 0;
  let late = null;
  const commit = (batch) => {
    for (const { itemId, expect: _expect, ...edit } of batch) {
      const held = store.get(itemId);
      for (const [field, value] of Object.entries(edit)) {
        if (field === 'categorySlugs') {
          held.categories = value.map((slug) => ({ slug }));
        } else {
          held[field] = value;
        }
      }
    }
  };
  const client = {
    requests: 0,
    async request(path, init = {}) {
      client.requests += 1;
      calls.push({ path, method: init.method ?? 'GET', body: init.body });
      if (path === LOOKUP_PATH) {
        const answer = {
          items: init.body.ids
            .filter((key) => store.has(key))
            .map((key) => structuredClone(store.get(key))),
        };
        if (late) {
          commit(late);
          late = null;
        }
        return answer;
      }
      const rows = /\/v1\/admin\/harvest\/items\/(.+)\/entries/.exec(path);
      if (rows) {
        return {
          items: entries[decodeURIComponent(rows[1])] ?? [],
          nextCursor: null,
        };
      }
      if (path === BATCH_PATH) {
        sends += 1;
        refuse?.(init.body.items, sends);
        const failures = [];
        for (const entry of init.body.items) {
          const fields = serverMismatches(
            store.get(entry.itemId),
            entry.expect
          );
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
        const lost = lose?.(sends) ?? null;
        if (lost === 'before') {
          throw new HttpError(504);
        }
        if (lost === 'late') {
          late = structuredClone(init.body.items);
          throw new HttpError(504);
        }
        commit(init.body.items);
        if (lost === 'after') {
          throw new HttpError(504);
        }
        if (lost === 'unreadable') {
          const error = new HttpError(200);
          error.body = '<html>ok</html>';
          throw error;
        }
        return { items: [] };
      }
      throw new Error(`unexpected ${path}`);
    },
  };
  return { client, calls, store };
}

test('the fake compares as catalog does', () => {
  const row = {
    name: { es: ' Leche ', en: 'Milk' },
    brand: 'Hacendado',
    unitSize: '500.0000',
    approxWeight: null,
    quantityStep: null,
    defaultUnit: 'GRAM',
    packCount: null,
    categories: [{ slug: 'a' }, { slug: 'b' }],
  };
  assert.deepEqual(
    serverMismatches(row, {
      name: { es: 'Leche', en: 'Milk' },
      brand: 'HACENDADO.',
      unitSize: 500,
      approxWeight: null,
      packCount: null,
      categorySlugs: ['a', 'b'],
    }),
    []
  );
  const fields = (expect) =>
    serverMismatches(row, expect).map((mismatch) => mismatch.field);
  // a half left out expects no name in that language
  assert.deepEqual(fields({ name: { es: 'Leche' } }), ['name']);
  // a numeric string is not a number for a strict field
  assert.deepEqual(fields({ unitSize: '500' }), ['unitSize']);
  assert.deepEqual(fields({ categorySlugs: ['b', 'a'] }), ['categorySlugs']);
  assert.deepEqual(fields({ packCount: 0 }), ['packCount']);
  assert.deepEqual(fields({ pieceCount: null }), []);
  assert.deepEqual(fields({ pieceCount: 50 }), ['pieceCount']);
});

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

test('a piece count is carried as the pack count is: sent, expected, compared as a number', async () => {
  const pieces = [
    { field: 'packCount', from: null, to: 2 },
    { field: 'pieceCount', from: null, to: 100 },
  ];
  const line = classify(change(1, pieces), product(1));
  assert.equal(line.class, CLASS.APPLY);
  assert.deepEqual(batchEntry(line), {
    itemId: id(1),
    packCount: 2,
    pieceCount: 100,
    expect: {
      packCount: null,
      pieceCount: null,
      name: { es: 'Producto 1', en: 'Product 1' },
      brand: 'Marca',
    },
  });
  // A count the target already holds, answered as a string, is already there.
  assert.equal(
    classify(
      change(2, [{ field: 'pieceCount', from: '50', to: 48 }]),
      product(2, { pieceCount: '48' })
    ).class,
    CLASS.ALREADY
  );
  // A third count is a conflict.
  assert.equal(
    classify(
      change(3, [{ field: 'pieceCount', from: 50, to: 48 }]),
      product(3, { pieceCount: 60 })
    ).class,
    CLASS.CONFLICT
  );

  const { client, store } = fakeTarget([product(4), product(5)]);
  // The second product moved on the target after the edit was made.
  store.get(id(5)).pieceCount = 30;
  const changes = [4, 5].map((n) => change(n, pieces));
  const { lines } = await replayChanges({ changes, client, write: true });
  assert.deepEqual(
    lines.map((written) => written.class),
    [CLASS.APPLY, CLASS.CONFLICT]
  );
  assert.equal(store.get(id(4)).pieceCount, 100);
  assert.equal(store.get(id(4)).packCount, 2);
  assert.equal(store.get(id(5)).pieceCount, 30);
  const again = await replayChanges({ changes: [change(4, pieces)], client });
  assert.equal(again.lines[0].class, CLASS.ALREADY);
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

const sizeChanges = (count) =>
  Array.from({ length: count }, (_, index) =>
    change(index + 1, [{ field: 'unitSize', from: 500, to: 450 }])
  );
const products = (count, over = {}) =>
  Array.from({ length: count }, (_, index) => product(index + 1, over));

test('a 504 reads the batch again and sends only the batch that did not land', async () => {
  // Batch 1 lands whole and then loses its answer; batch 2 loses it unwritten.
  const { client, calls, store } = fakeTarget(products(4), {
    lose: (send) => (send === 1 ? 'after' : send === 2 ? 'before' : null),
  });
  const { lines } = await replayChanges({
    changes: sizeChanges(4),
    client,
    write: true,
    batchSize: 2,
    stderr: sink(),
  });
  const sent = patches(calls);
  assert.equal(sent.length, 3);
  assert.deepEqual(
    sent[2].body.items.map((entry) => entry.itemId),
    [id(3), id(4)]
  );
  assert.deepEqual(
    lines.map((line) => line.class),
    [CLASS.ALREADY, CLASS.ALREADY, CLASS.APPLY, CLASS.APPLY]
  );
  assert.equal(lines[0].afterLostAnswer, true);
  assert.equal(lines[2].written, true);
  for (const n of [1, 2, 3, 4]) {
    assert.equal(store.get(id(n)).unitSize, 450);
  }
});

test('a write that committed after its 504 is already there, not a conflict', async () => {
  const { client, calls, store } = fakeTarget(products(2), {
    lose: (send) => (send === 1 ? 'late' : null),
  });
  const changes = [1, 2].map((n) =>
    change(n, [
      { field: 'unitSize', from: 500, to: 450 },
      { field: 'packCount', from: null, to: 6 },
    ])
  );
  const { lines } = await replayChanges({
    changes,
    client,
    write: true,
    stderr: sink(),
  });
  // Sent, lost, read back too early (old values), sent again, refused by the
  // expect because the first send had committed by then.
  assert.equal(patches(calls).length, 2);
  assert.deepEqual(
    lines.map((line) => line.class),
    [CLASS.ALREADY, CLASS.ALREADY]
  );
  assert.equal(lines[0].afterLostAnswer, true);
  assert.equal(store.get(id(1)).packCount, 6);
});

test('an expect refusal on one field of two is still a conflict', async () => {
  const { client, store } = fakeTarget(products(1));
  const [line] = (
    await replayChanges({
      changes: [
        change(1, [
          { field: 'unitSize', from: 500, to: 450 },
          { field: 'packCount', from: null, to: 6 },
        ]),
      ],
      client,
    })
  ).lines;
  // Someone sets the size to the same new value, and nothing else.
  store.get(id(1)).unitSize = 450;
  await writeApply(client, [line]);
  assert.equal(line.class, CLASS.CONFLICT);
});

test('three lost answers in a row stop the run, and nothing is resent a fourth time', async () => {
  const { client, calls } = fakeTarget(products(2), {
    lose: () => 'before',
  });
  const lines = [];
  await assert.rejects(
    () =>
      replayChanges({
        changes: sizeChanges(2),
        client,
        write: true,
        stderr: sink(),
        lines,
      }),
    (error) =>
      error instanceof ReplayStopped &&
      /no answer 4 times/.test(error.message) &&
      error.answer.code === 'no_answer'
  );
  // The first send and three resends, each read back.
  assert.equal(patches(calls).length, 4);
  assert.equal(calls.filter((call) => call.path === LOOKUP_PATH).length, 5);
  assert.deepEqual(
    lines.map((line) => line.class),
    [CLASS.OUTCOME_UNKNOWN, CLASS.OUTCOME_UNKNOWN]
  );
  assert.equal(lines[0].error.code, 'no_answer');
  // A 504 may still commit after the last read back: not checked, and of
  // its own class, with the class it held before kept beside it.
  for (const line of lines) {
    assert.equal(line.lastKnownClass, CLASS.NOT_WRITTEN);
    assert.equal(line.checked, false);
    assert.equal(line.sentInLostRequest, true);
    assert.match(line.reason, /request was sent and its outcome is not known/);
  }
  const counts = countLines(lines);
  assert.equal(counts.outcomeUnknown, 2);
  assert.equal(counts.classes[CLASS.OUTCOME_UNKNOWN], 2);
  assert.equal(counts.classes[CLASS.NOT_WRITTEN], 0);
  assert.match(countsLine(counts), /: outcome unknown 2;/);
  assert.match(
    countsLine(counts),
    /; 2 products were sent and their outcome is not known, run the dry run again$/
  );
});

test('a 504 whose read back sees the new values is conclusive: already there, checked', async () => {
  const { client } = fakeTarget(products(2), {
    lose: () => 'after',
  });
  const { lines } = await replayChanges({
    changes: sizeChanges(2),
    client,
    write: true,
    stderr: sink(),
  });
  for (const line of lines) {
    assert.equal(line.class, CLASS.ALREADY);
    assert.equal(line.afterLostAnswer, true);
    assert.equal(line.checked, undefined);
    assert.equal(line.sentInLostRequest, undefined);
  }
  assert.equal(countLines(lines).outcomeUnknown, 0);
  assert.doesNotMatch(countsLine(countLines(lines)), /outcome is not known/);
});

/** Runs a write replay of `n` size changes and answers the report and stderr. */
async function writeRun(client, n, { batchSize = 10 } = {}) {
  const changeList = sizeChangeList(n);
  const stderr = sink();
  let report = null;
  let failure = null;
  try {
    await runReplay({
      changeFile: 'changes.jsonl',
      changeList,
      folded: foldChanges(changeList),
      targetUrl: 'http://localhost:43700',
      write: true,
      batchSize,
      reportPath: 'report.json',
      client,
      stderr,
      writeFile: (_path, text) => {
        report = JSON.parse(text);
      },
    });
  } catch (error) {
    failure = error;
  }
  return { report, stderr: stderr.text(), failure };
}

test('a 200 with an unreadable body whose read back fails leaves the products not checked', async () => {
  const fake = fakeTarget(products(2), {
    lose: (send) => (send === 1 ? 'unreadable' : null),
  });
  let lookups = 0;
  const client = {
    requests: 0,
    async request(path, init) {
      if (path === LOOKUP_PATH && ++lookups === 2) {
        throw new HttpError(504);
      }
      return fake.client.request(path, init);
    },
  };
  const { report, stderr, failure } = await writeRun(client, 2);
  assert.ok(failure instanceof ReplayStopped);
  // The server committed the batch, and the report does not say otherwise.
  assert.equal(fake.store.get(id(1)).unitSize, 450);
  assert.deepEqual(
    report.lines.map((line) => [line.class, line.checked]),
    [
      [CLASS.OUTCOME_UNKNOWN, false],
      [CLASS.OUTCOME_UNKNOWN, false],
    ]
  );
  assert.equal(report.counts.outcomeUnknown, 2);
  assert.match(
    stderr,
    /2 products were sent and their outcome is not known, run the dry run again/
  );
});

test('a resend refused for its content after a late commit is outcome unknown, last known refused', async () => {
  // Sent, 504, read back too early (old values), committed, sent again: the
  // brand check runs before the guard, so the refusal says nothing of the
  // first send.
  const { client, store } = fakeTarget(products(1), {
    lose: (send) => (send === 1 ? 'late' : null),
    refuse: (_entries, send) => {
      if (send === 2) {
        throw new HttpError(422, {
          code: 'brand_not_registered',
          detail: 'the brand is not registered',
        });
      }
    },
  });
  const { report, stderr, failure } = await writeRun(client, 1);
  assert.equal(failure, null);
  assert.equal(store.get(id(1)).unitSize, 450);
  const [line] = report.lines;
  assert.equal(line.class, CLASS.OUTCOME_UNKNOWN);
  assert.equal(line.lastKnownClass, CLASS.REFUSED);
  assert.equal(line.code, 'brand_not_registered');
  assert.equal(line.checked, false);
  assert.equal(line.sentInLostRequest, true);
  assert.equal(report.counts.outcomeUnknown, 1);
  assert.match(
    stderr,
    /1 products were sent and their outcome is not known, run the dry run again/
  );
});

test('a refused line that was never in a lost request stays checked', async () => {
  const { client } = fakeTarget(products(1), {
    refuse: () => {
      throw new HttpError(422, { code: 'brand_not_registered' });
    },
  });
  const { report, stderr } = await writeRun(client, 1);
  const [line] = report.lines;
  assert.equal(line.class, CLASS.REFUSED);
  assert.equal(line.checked, undefined);
  assert.equal(line.sentInLostRequest, undefined);
  assert.equal(report.counts.outcomeUnknown, 0);
  assert.doesNotMatch(stderr, /outcome is not known/);
});

test('a report snapshot that fails after a lost answer leaves the products outcome unknown, never not sent', async () => {
  // Batch 1 of 2 loses its answer, the read back sees the old values and the
  // first send commits after that read.
  const { client, calls, store } = fakeTarget(products(3), {
    lose: (send) => (send === 1 ? 'late' : null),
  });
  const { lines } = await replayChanges({ changes: sizeChanges(3), client });
  await assert.rejects(
    () =>
      writeApply(client, lines, {
        batchSize: 2,
        stderr: sink(),
        onAnswer: () => {
          throw new ReplayStopped('the report could not be written', {
            status: null,
            code: 'report_not_written',
            message: 'EPERM',
          });
        },
      }),
    /the report could not be written/
  );
  assert.equal(patches(calls).length, 1);
  assert.deepEqual(
    lines.map((line) => [line.class, line.checked]),
    [
      [CLASS.OUTCOME_UNKNOWN, false],
      [CLASS.OUTCOME_UNKNOWN, false],
      [CLASS.NOT_SENT, undefined],
    ]
  );
  assert.match(lines[0].reason, /outcome is not known/);
  // And the target does hold them.
  assert.equal(store.get(id(1)).unitSize, 450);
  assert.equal(store.get(id(2)).unitSize, 450);
  assert.equal(store.get(id(3)).unitSize, 500);
});

test('a run that stops on batch 2 of 3 keeps batch 1 written and batch 3 not sent', async () => {
  const { client, calls, store } = fakeTarget(products(3), {
    refuse: (_entries, send) => {
      if (send === 2) {
        throw new HttpError(500, { code: 'internal', detail: 'boom' });
      }
    },
  });
  const changeList = {
    header: { header: true, kind: CHANGE_LIST_KIND, origin: AUDIT_ORIGIN },
    lines: [1, 2, 3].map((n) => ({
      itemId: id(n),
      line: n + 1,
      action: 'UPDATE',
      before: { unitSize: 500 },
      after: { unitSize: 450 },
      current: {
        name: { es: `Producto ${n}`, en: `Product ${n}` },
        brand: 'Marca',
      },
    })),
  };
  let written = null;
  const stderr = sink();
  await assert.rejects(
    () =>
      runReplay({
        changeFile: 'changes.jsonl',
        changeList,
        folded: foldChanges(changeList),
        targetUrl: 'http://localhost:43700',
        write: true,
        batchSize: 1,
        reportPath: 'report.json',
        client,
        stderr,
        writeFile: (_path, text) => {
          written = JSON.parse(text);
        },
      }),
    ReplayStopped
  );
  assert.deepEqual(
    written.lines.map((line) => [line.class, Boolean(line.written)]),
    [
      [CLASS.APPLY, true],
      [CLASS.OUTCOME_UNKNOWN, false],
      [CLASS.NOT_SENT, false],
    ]
  );
  assert.equal(written.lines[1].lastKnownClass, CLASS.NOT_WRITTEN);
  assert.equal(written.lines[1].error.status, 500);
  assert.equal(written.lines[1].error.code, 'internal');
  assert.match(written.header.stoppedBy, /answered 500/);
  assert.equal(written.header.error.status, 500);
  assert.equal(written.counts.written, 1);
  assert.equal(written.counts.classes[CLASS.NOT_SENT], 1);
  // The batch the server failed on was read back once, and nothing after it
  // was sent.
  assert.equal(patches(calls).length, 2);
  assert.equal(store.get(id(1)).unitSize, 450);
  assert.equal(store.get(id(2)).unitSize, 500);
  assert.equal(store.get(id(3)).unitSize, 500);
  assert.doesNotMatch(stderr.text(), /00000000-0000/);
});

for (const [status, body] of [
  [429, { code: 'rate_limited', details: { retryAfterSeconds: 1 } }],
  [403, { code: 'forbidden' }],
  [500, { code: 'internal' }],
]) {
  test(`a ${status} inside the write stops the run instead of splitting the batch`, async () => {
    const { client, calls } = fakeTarget(products(8), {
      refuse: () => {
        throw new HttpError(status, body);
      },
    });
    const lines = [];
    await assert.rejects(
      () =>
        replayChanges({
          changes: sizeChanges(8),
          client,
          write: true,
          batchSize: 4,
          stderr: sink(),
          lines,
        }),
      (error) => error instanceof ReplayStopped && error.status === status
    );
    assert.equal(patches(calls).length, 1);
    // A 500 may hide a write that commits after the read back, so its
    // products are outcome unknown; a 429 or a 403 refused the request.
    const stopped = status === 500 ? CLASS.OUTCOME_UNKNOWN : CLASS.NOT_WRITTEN;
    assert.deepEqual(
      lines.map((line) => line.class),
      [...Array(4).fill(stopped), ...Array(4).fill(CLASS.NOT_SENT)]
    );
    assert.equal(lines[0].error.status, status);
    assert.equal(lines[0].checked, status === 500 ? false : undefined);
  });
}

test('a 429 the client waits out three times then stops the write', async () => {
  const { client: fake } = fakeTarget(products(2));
  let sends = 0;
  const session = {
    async fetch(path, init) {
      if (path === BATCH_PATH) {
        sends += 1;
        throw new HttpError(429, {
          code: 'rate_limited',
          details: { retryAfterSeconds: 1 },
        });
      }
      return fake.request(path, init);
    },
  };
  let clock = 0;
  const client = makeTargetClient({
    session,
    stderr: sink(),
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
  });
  const lines = [];
  await assert.rejects(
    () =>
      replayChanges({
        changes: sizeChanges(2),
        client,
        write: true,
        stderr: sink(),
        lines,
      }),
    /still answered 429 after 3 waits/
  );
  assert.equal(sends, 4);
  assert.deepEqual(
    lines.map((line) => line.class),
    [CLASS.NOT_WRITTEN, CLASS.NOT_WRITTEN]
  );
});

test('a 413 halves the batch size once, and a second one stops the run', async () => {
  const { client, calls } = fakeTarget(products(8), {
    refuse: (entries) => {
      if (entries.length > 2) {
        throw new HttpError(413, { code: 'payload_too_large' });
      }
    },
  });
  const { lines } = await replayChanges({
    changes: sizeChanges(8),
    client,
    write: true,
    batchSize: 4,
    stderr: sink(),
  });
  // 4 refused, then 2 + 2, then the next batches of 2: 2 + 2.
  assert.deepEqual(
    patches(calls).map((call) => call.body.items.length),
    [4, 2, 2, 2, 2]
  );
  assert.ok(lines.every((line) => line.written));

  const tight = fakeTarget(products(4), {
    refuse: (entries) => {
      if (entries.length > 1) {
        throw new HttpError(413, { code: 'payload_too_large' });
      }
    },
  });
  await assert.rejects(
    () =>
      replayChanges({
        changes: sizeChanges(4),
        client: tight.client,
        write: true,
        batchSize: 4,
        stderr: sink(),
      }),
    /413 for a batch of 2/
  );
  assert.equal(patches(tight.calls).length, 2);
});

test('the client sends numbers where catalog stores numeric strings', async () => {
  const { client, store } = fakeTarget([product(1, { unitSize: '500.0000' })]);
  const { lines } = await replayChanges({
    changes: sizeChanges(1),
    client,
    write: true,
  });
  assert.equal(lines[0].written, true);
  assert.equal(store.get(id(1)).unitSize, 450);
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
  assert.equal(excluded.line.itemId, id(11));
  assert.equal(excluded.line.washTask.text, '35+18 lavados');
  assert.equal(excluded.line.washTask.count, 53);
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

test('the wash rule drops only the size: the other fields of the product are still sent', () => {
  const rows = [{ status: 'ACTIVE', sizeFormat: '40lav' }];
  const item = product(15, {
    unitSize: 40,
    defaultUnit: 'UNIT',
    packCount: null,
  });
  const line = classify(
    change(15, [
      { field: 'unitSize', from: 40, to: null },
      { field: 'defaultUnit', from: 'UNIT', to: 'GRAM' },
      { field: 'packCount', from: null, to: 2 },
    ]),
    item,
    { washRows: rows }
  );
  assert.equal(line.class, CLASS.APPLY);
  assert.deepEqual(
    line.fields.map((field) => field.field),
    ['packCount']
  );
  assert.equal(line.washTask.text, '40lav');
  assert.deepEqual(
    line.washTask.fields.map((field) => field.field),
    ['unitSize', 'defaultUnit']
  );
  assert.match(line.washTask.note, /size was left/);
  assert.deepEqual(batchEntry(line), {
    itemId: id(15),
    packCount: 2,
    expect: {
      packCount: null,
      name: { es: 'Producto 15', en: 'Product 15' },
      brand: 'Marca',
    },
  });

  const whole = classify(
    change(16, [{ field: 'unitSize', from: 40, to: null }]),
    product(16, { unitSize: 40, defaultUnit: 'UNIT' }),
    { washRows: rows }
  );
  assert.equal(whole.class, CLASS.WASH);

  const counts = countLines([line, whole]);
  assert.equal(counts.classes[CLASS.WASH], 1);
  assert.equal(counts.classes[CLASS.APPLY], 1);
  assert.equal(counts.sizeLeftToWashTask, 1);
  assert.match(
    countsLine(counts),
    /excluded: wash task 1, apply 1; the size of 1 more left to the wash task/
  );
});

test('a unit change dropped with a wash size says that nobody carries it and a person sets it', () => {
  const rows = [{ status: 'ACTIVE', sizeFormat: '40lav' }];
  const unitNote =
    'the unit change (defaultUnit from UNIT to KILOGRAM) was not carried, and release task 0009 will not carry it either, because it only clears the size: set the unit on the target by hand';

  // Excluded whole: the size and the unit were the only fields.
  const whole = classify(
    change(17, [
      { field: 'unitSize', from: 40, to: null },
      { field: 'defaultUnit', from: 'UNIT', to: 'KILOGRAM' },
    ]),
    product(17, { unitSize: 40, defaultUnit: 'UNIT' }),
    { washRows: rows }
  );
  assert.equal(whole.class, CLASS.WASH);
  assert.equal(whole.washTask.note, `${WASH_NOTE}. ${unitNote}`);

  // Another field is still sent, and the note on the line says the same.
  const partly = classify(
    change(18, [
      { field: 'unitSize', from: 40, to: null },
      { field: 'defaultUnit', from: 'UNIT', to: 'KILOGRAM' },
      { field: 'packCount', from: null, to: 2 },
    ]),
    product(18, { unitSize: 40, defaultUnit: 'UNIT', packCount: null }),
    { washRows: rows }
  );
  assert.equal(partly.class, CLASS.APPLY);
  assert.equal(partly.washTask.note, `${WASH_NOTE}. ${unitNote}`);
  assert.equal(batchEntry(partly).defaultUnit, undefined);

  // A size alone keeps the plain note.
  const sizeOnly = classify(
    change(19, [{ field: 'unitSize', from: 40, to: null }]),
    product(19, { unitSize: 40, defaultUnit: 'UNIT' }),
    { washRows: rows }
  );
  assert.equal(sizeOnly.washTask.note, WASH_NOTE);
  assert.doesNotMatch(sizeOnly.washTask.note, /unit change/);
});

test('a unit change to UNIT dropped with a wash size keeps the plain note, since the target holds UNIT', () => {
  const rows = [{ status: 'ACTIVE', sizeFormat: '40lav' }];

  // Excluded whole: the size and the unit were the only fields.
  const whole = classify(
    change(20, [
      { field: 'unitSize', from: 40, to: null },
      { field: 'defaultUnit', from: 'GRAM', to: 'UNIT' },
    ]),
    product(20, { unitSize: 40, defaultUnit: 'UNIT' }),
    { washRows: rows }
  );
  assert.equal(whole.class, CLASS.WASH);
  assert.equal(whole.washTask.note, WASH_NOTE);
  assert.doesNotMatch(whole.washTask.note, /unit change|by hand/);

  // Another field is still sent, and the unit change is still not sent.
  const partly = classify(
    change(21, [
      { field: 'unitSize', from: 40, to: null },
      { field: 'defaultUnit', from: 'GRAM', to: 'UNIT' },
      { field: 'packCount', from: null, to: 2 },
    ]),
    product(21, { unitSize: 40, defaultUnit: 'UNIT', packCount: null }),
    { washRows: rows }
  );
  assert.equal(partly.class, CLASS.APPLY);
  assert.equal(partly.washTask.note, WASH_NOTE);
  assert.equal(batchEntry(partly).defaultUnit, undefined);
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

test('the identity pass reads a report of the old version and one with outcome unknown lines alike', () => {
  const base = identityReport('http://localhost:43700');
  const unsettled = (n, klass) => ({
    itemId: id(n),
    class: klass,
    fields: [{ field: 'unitSize', from: 500, to: 450, target: 500 }],
    identity: { local: null, target: null },
    checked: false,
    sentInLostRequest: true,
  });
  // The old version left such a line as `not written` with `checked: false`.
  const old = {
    ...base,
    lines: [...base.lines, unsettled(3, CLASS.NOT_WRITTEN)],
  };
  const current = {
    ...base,
    lines: [
      ...base.lines,
      { ...unsettled(3, CLASS.OUTCOME_UNKNOWN), lastKnownClass: 'not written' },
    ],
  };
  for (const report of [old, current]) {
    assert.deepEqual(
      identityChanges(report).map((change) => change.itemId),
      [id(1), id(2)]
    );
    assert.deepEqual(
      identityChanges(report, { only: [id(2), id(3)] }).map(
        (change) => change.itemId
      ),
      [id(2)]
    );
  }
});

test('markUnsettled gives a flagged line its own class once, and the count follows the class', () => {
  const line = (n, over) => ({
    itemId: id(n),
    class: CLASS.APPLY,
    fields: [],
    identity: { local: null, target: null },
    ...over,
  });
  const lines = [
    line(1, { sentInLostRequest: true }),
    line(2, { class: CLASS.REFUSED, sentInLostRequest: true }),
    line(3, { written: true }),
    line(4, { class: CLASS.NOT_WRITTEN }),
  ];
  markUnsettled(lines);
  // A second call, as the keeper makes after the write, changes nothing.
  markUnsettled(lines);
  assert.deepEqual(
    lines.map((entry) => [entry.class, entry.lastKnownClass, entry.checked]),
    [
      [CLASS.OUTCOME_UNKNOWN, CLASS.NOT_WRITTEN, false],
      [CLASS.OUTCOME_UNKNOWN, CLASS.REFUSED, false],
      [CLASS.APPLY, undefined, undefined],
      [CLASS.NOT_WRITTEN, undefined, undefined],
    ]
  );
  const counts = countLines(lines);
  assert.equal(counts.outcomeUnknown, 2);
  assert.equal(counts.classes[CLASS.OUTCOME_UNKNOWN], 2);
  assert.equal(
    lines.filter((entry) => entry.checked === false).length,
    counts.outcomeUnknown
  );
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
  packaging: 'Brik',
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
  // A file written before decision 154a holds nine fields, no packaging.
  const { packaging: _packaging, ...nine } = observed;
  assert.throws(
    () =>
      prepareDecisions({
        file: 'd.jsonl',
        header: { header: true },
        records: [
          { ...linkRow(1, id(1)), expect: { ...expect, observed: nine } },
        ],
        implementation: 'suggestions',
      }),
    /1 of the 1 decided rows .* carry no complete expect\.observed/
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

// --- The record of a write that stops ---------------------------------------

/** A change list of `count` size edits, as the export writes it. */
const sizeChangeList = (count) => ({
  header: { header: true, kind: CHANGE_LIST_KIND, origin: AUDIT_ORIGIN },
  lines: Array.from({ length: count }, (_, index) => ({
    itemId: id(index + 1),
    line: index + 2,
    action: 'UPDATE',
    before: { unitSize: 500 },
    after: { unitSize: 450 },
    current: {
      name: { es: `Producto ${index + 1}`, en: `Product ${index + 1}` },
      brand: 'Marca',
    },
  })),
});

/**
 * The fake target, with batch `held` kept in flight until `release` is
 * called. `inFlight` resolves once that batch has been sent.
 */
function holdingTarget(items, held, options = {}) {
  const fake = fakeTarget(items, options);
  let release;
  let entered;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const inFlight = new Promise((resolve) => {
    entered = resolve;
  });
  let sends = 0;
  const client = {
    get requests() {
      return fake.client.requests;
    },
    async request(path, init) {
      if (path === BATCH_PATH && ++sends === held) {
        entered();
        await gate;
      }
      return fake.client.request(path, init);
    },
  };
  return { ...fake, client, inFlight, release };
}

const reportDir = () => mkdtempSync(join(tmpdir(), 'curation-report-'));
const readReport = (path) => JSON.parse(readFileSync(path, 'utf8'));

test('the report on disk lists batch 1 as written while batch 2 is in flight', async () => {
  const target = holdingTarget(products(3), 2);
  const reportPath = join(reportDir(), 'report.json');
  const changeList = sizeChangeList(3);
  const run = runReplay({
    changeFile: 'changes.jsonl',
    changeList,
    folded: foldChanges(changeList),
    targetUrl: 'http://localhost:43700',
    write: true,
    batchSize: 1,
    reportPath,
    client: target.client,
    stderr: sink(),
  });
  await target.inFlight;
  const during = readReport(reportPath);
  assert.deepEqual(
    during.lines.map((line) => [line.class, Boolean(line.written)]),
    [
      [CLASS.APPLY, true],
      [CLASS.APPLY, false],
      [CLASS.APPLY, false],
    ]
  );
  assert.equal(during.counts.written, 1);
  assert.equal(during.header.endedAt, null);
  assert.match(during.header.inProgress, /had not finished/);
  // The temp file of the atomic write is gone once it is renamed.
  assert.deepEqual(readdirSync(join(reportPath, '..')), ['report.json']);

  target.release();
  await run;
  const after = readReport(reportPath);
  assert.equal(after.counts.written, 3);
  assert.equal(after.header.inProgress, undefined);
  assert.notEqual(after.header.endedAt, null);
});

test('a signal during batch 2 writes the report: batch 1 written, 2 not checked, 3 not sent', async () => {
  const target = holdingTarget(products(3), 2);
  const reportPath = join(reportDir(), 'report.json');
  const changeList = sizeChangeList(3);
  const controls = {};
  const stderr = sink();
  const run = runReplay({
    changeFile: 'changes.jsonl',
    changeList,
    folded: foldChanges(changeList),
    targetUrl: 'http://localhost:43700',
    write: true,
    batchSize: 1,
    reportPath,
    client: target.client,
    stderr,
    controls,
  });
  await target.inFlight;
  assert.equal(controls.interrupt('SIGINT'), true);
  const written = readReport(reportPath);
  assert.deepEqual(
    written.lines.map((line) => [line.class, Boolean(line.written)]),
    [
      [CLASS.APPLY, true],
      [CLASS.OUTCOME_UNKNOWN, false],
      [CLASS.NOT_SENT, false],
    ]
  );
  assert.equal(written.lines[1].checked, false);
  assert.equal(written.lines[1].lastKnownClass, CLASS.NOT_WRITTEN);
  assert.equal(written.lines[1].error.code, 'interrupted');
  assert.equal(written.counts.outcomeUnknown, 1);
  assert.equal(written.lines[0].checked, undefined);
  assert.match(written.header.stoppedBy, /stopped with SIGINT/);
  assert.equal(written.header.inProgress, undefined);
  assert.match(stderr.text(), /1 written/);
  assert.match(stderr.text(), /report: /);

  // What the run does after the signal changes nothing on disk.
  target.release();
  await run;
  assert.deepEqual(readReport(reportPath), written);
});

test('a signal during the lookup reports every product not sent', async () => {
  let entered;
  const inFlight = new Promise((resolve) => {
    entered = resolve;
  });
  const calls = [];
  // A target that takes the lookup and never answers it.
  const client = {
    requests: 0,
    request: (path) => {
      calls.push(path);
      entered();
      return new Promise(() => undefined);
    },
  };
  const reportPath = join(reportDir(), 'report.json');
  const changeList = sizeChangeList(2);
  const controls = {};
  runReplay({
    changeFile: 'changes.jsonl',
    changeList,
    folded: foldChanges(changeList),
    targetUrl: 'http://localhost:43700',
    write: true,
    batchSize: 1,
    reportPath,
    client,
    stderr: sink(),
    controls,
  });
  await inFlight;
  controls.interrupt('SIGTERM');
  const written = readReport(reportPath);
  assert.deepEqual(
    written.lines.map((line) => line.class),
    [CLASS.NOT_SENT, CLASS.NOT_SENT]
  );
  assert.deepEqual(calls, [LOOKUP_PATH]);
});

test('a commit that lands after the timeout and after the read back, then a signal, leaves the products outcome unknown', async () => {
  // Batch 1 of 2 gets no answer; the read back sees the old values; the
  // server commits right after that read; the operator stops the run before
  // the batch is sent again.
  const { client, store } = fakeTarget(products(3), {
    lose: (send) => (send === 1 ? 'late' : null),
  });
  const changeList = sizeChangeList(3);
  const controls = {};
  const stderr = sink();
  let snapshots = 0;
  let stopped = null;
  let heldAtStop = null;
  const run = runReplay({
    changeFile: 'changes.jsonl',
    changeList,
    folded: foldChanges(changeList),
    targetUrl: 'http://localhost:43700',
    write: true,
    batchSize: 2,
    reportPath: 'report.json',
    client,
    stderr,
    controls,
    writeFile: (_path, text) => {
      const report = JSON.parse(text);
      if (report.header.stoppedBy) {
        stopped = report;
        return;
      }
      snapshots += 1;
      if (snapshots === 1) {
        // The answer to batch 1 was sorted; the signal comes before the
        // resend leaves.
        assert.equal(controls.interrupt('SIGINT'), true);
        heldAtStop = [1, 2, 3].map((n) => store.get(id(n)).unitSize);
      }
    },
  });
  await run;
  assert.ok(stopped, 'the signal wrote the report');
  assert.deepEqual(
    stopped.lines.map((line) => [line.class, line.checked]),
    [
      [CLASS.OUTCOME_UNKNOWN, false],
      [CLASS.OUTCOME_UNKNOWN, false],
      [CLASS.NOT_SENT, undefined],
    ]
  );
  for (const line of stopped.lines.slice(0, 2)) {
    assert.equal(line.sentInLostRequest, true);
    assert.match(line.reason, /request was sent and its outcome is not known/);
  }
  assert.equal(stopped.counts.outcomeUnknown, 2);
  assert.match(
    stderr.text(),
    /2 products were sent and their outcome is not known, run the dry run again/
  );
  // At the stop the target held what the report could not confirm.
  assert.deepEqual(heldAtStop, [450, 450, 500]);
});

test('a rename refused with EPERM is tried again, and the report lands', () => {
  const dir = reportDir();
  const path = join(dir, 'report.json');
  let refusals = 0;
  const waits = [];
  writeFileAtomic(path, 'newest\n', {
    rename: (from, to) => {
      if (refusals < 2) {
        refusals += 1;
        throw Object.assign(new Error('EPERM: operation not permitted'), {
          code: 'EPERM',
        });
      }
      renameSync(from, to);
    },
    wait: (ms) => waits.push(ms),
  });
  assert.equal(readFileSync(path, 'utf8'), 'newest\n');
  assert.equal(waits.length, 2);
  assert.deepEqual(readdirSync(dir), ['report.json']);
});

test('a rename that keeps failing keeps the temp file and names its path; the next write removes it', () => {
  const dir = reportDir();
  const path = join(dir, 'report.json');
  writeFileSync(path, 'older\n');
  let tries = 0;
  let thrown = null;
  try {
    writeFileAtomic(path, 'newest\n', {
      rename: () => {
        tries += 1;
        throw Object.assign(new Error('EBUSY: resource busy or locked'), {
          code: 'EBUSY',
        });
      },
      wait: () => undefined,
    });
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown, 'the write failed');
  assert.equal(tries, RENAME_TRIES);
  assert.equal(thrown.code, 'EBUSY');
  assert.ok(thrown.message.includes(thrown.tempPath), thrown.message);
  assert.ok(existsSync(thrown.tempPath));
  assert.equal(readFileSync(thrown.tempPath, 'utf8'), 'newest\n');
  assert.equal(readFileSync(path, 'utf8'), 'older\n');

  // Once the file is free again, the next write leaves no stale temp file.
  writeFileAtomic(path, 'newer still\n');
  assert.equal(readFileSync(path, 'utf8'), 'newer still\n');
  assert.equal(existsSync(thrown.tempPath), false);
  assert.deepEqual(readdirSync(dir), ['report.json']);
});

test('a failed report write prints the counts and the stop, then throws the write failure', async () => {
  const { client } = fakeTarget(products(2), {
    refuse: (_entries, send) => {
      if (send === 2) {
        throw new HttpError(500, { code: 'internal', detail: 'boom' });
      }
    },
  });
  const changeList = sizeChangeList(2);
  const stderr = sink();
  let snapshots = 0;
  await assert.rejects(
    () =>
      runReplay({
        changeFile: 'changes.jsonl',
        changeList,
        folded: foldChanges(changeList),
        targetUrl: 'http://localhost:43700',
        write: true,
        batchSize: 1,
        reportPath: 'report.json',
        client,
        stderr,
        writeFile: (_path, text) => {
          if (JSON.parse(text).header.inProgress) {
            snapshots += 1;
            return;
          }
          throw new Error('ENOSPC: no space left on device');
        },
      }),
    (error) =>
      /the report could not be written to report\.json: ENOSPC/.test(
        error.message
      ) &&
      error.cause instanceof ReplayStopped &&
      error.cause.status === 500
  );
  assert.equal(snapshots, 1);
  const text = stderr.text();
  const counts = text.indexOf('2 products:');
  const stop = text.indexOf('the write stopped: the target answered 500');
  assert.ok(counts >= 0 && stop > counts, text);
  assert.doesNotMatch(text, /report: /);
});

test('a report that cannot be written after batch 1 stops the run before batch 2', async () => {
  const { client, calls } = fakeTarget(products(2));
  const changeList = sizeChangeList(2);
  await assert.rejects(
    () =>
      runReplay({
        changeFile: 'changes.jsonl',
        changeList,
        folded: foldChanges(changeList),
        targetUrl: 'http://localhost:43700',
        write: true,
        batchSize: 1,
        reportPath: 'report.json',
        client,
        stderr: sink(),
        writeFile: () => {
          throw new Error('EBUSY: resource busy or locked');
        },
      }),
    /the report could not be written to report\.json: EBUSY/
  );
  assert.equal(patches(calls).length, 1);
});

test('a 200 whose body is not JSON is a lost answer: read back, and counted apart', async () => {
  const { client, calls } = fakeTarget(products(2), {
    lose: (send) => (send === 1 ? 'unreadable' : null),
  });
  const { lines } = await replayChanges({
    changes: sizeChanges(2),
    client,
    write: true,
    stderr: sink(),
  });
  assert.equal(patches(calls).length, 1);
  assert.deepEqual(
    lines.map((line) => line.class),
    [CLASS.ALREADY, CLASS.ALREADY]
  );
  const counts = countLines(lines);
  assert.equal(counts.written, 0);
  assert.equal(counts.landedAfterLostAnswer, 2);
  assert.match(
    countsLine(counts),
    /0 written, 2 more landed after a lost answer/
  );
});

test('a resend refused as already there after a lost answer is counted apart from written', async () => {
  const { client } = fakeTarget(products(2), {
    lose: (send) => (send === 1 ? 'late' : null),
  });
  const { lines } = await replayChanges({
    changes: sizeChanges(2),
    client,
    write: true,
    stderr: sink(),
  });
  const counts = countLines(lines);
  assert.equal(counts.classes[CLASS.ALREADY], 2);
  assert.equal(counts.written, 0);
  assert.equal(counts.landedAfterLostAnswer, 2);
});

test('a request with no answer in time is a lost answer', async () => {
  const capture = capturingFetch(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason));
      }),
    { timeoutMs: 5 }
  );
  await assert.rejects(
    () => capture.fetchImpl('http://localhost:43700/x', { method: 'PATCH' }),
    (error) => error.name === 'TimeoutError' && error.status === undefined
  );
});

test('a 413 halves the group it refused, not the configured size', async () => {
  const { client, calls } = fakeTarget(products(30), {
    refuse: (entries) => {
      if (entries.length > 20) {
        throw new HttpError(413, { code: 'payload_too_large' });
      }
    },
  });
  const { lines } = await replayChanges({
    changes: sizeChanges(30),
    client,
    write: true,
    batchSize: 100,
    stderr: sink(),
  });
  assert.deepEqual(
    patches(calls).map((call) => call.body.items.length),
    [30, 15, 15]
  );
  assert.ok(lines.every((line) => line.written));
});

test('a lost answer to a decisions part reads the rows back and classes them by the target', async () => {
  const { client } = fakeTarget([], {
    entries: {
      [id(1)]: [{ id: 'e1', status: 'ACTIVE', itemId: id(1) }],
      [id(2)]: [{ id: 'e2', status: 'CANDIDATE', itemId: id(2) }],
      [id(3)]: [],
    },
  });
  const prepared = {
    header: { header: true, runId: 'r' },
    records: [
      linkRow(1, id(1)),
      linkRow(2, id(2)),
      linkRow(3, id(3)),
      createRow(4),
    ],
  };
  const lost = new Error('socket hang up');
  const lines = [];
  await assert.rejects(
    () =>
      replayDecisions({
        prepared,
        items: new Map([1, 2, 3].map((n) => [id(n), {}])),
        write: true,
        partBase: 'report.decisions',
        splitParts: (records) => [records],
        writeFile: () => undefined,
        applyFile: async () => {
          throw lost;
        },
        client,
        lines,
      }),
    ReplayStopped
  );
  const byEntry = Object.fromEntries(
    lines.map((line) => [line.entryId, [line.class, line.checked]])
  );
  assert.deepEqual(byEntry, {
    e1: [DECISION_CLASS.DECIDED_ON_TARGET, undefined],
    // Still pending right after a part with no answer: the part may land
    // after the read, so the row is not checked.
    e2: [DECISION_CLASS.NOT_WRITTEN, false],
    e3: [DECISION_CLASS.NOT_WRITTEN, false],
    e4: [DECISION_CLASS.NOT_WRITTEN, false],
  });
  assert.equal(lines[0].targetStatus, 'ACTIVE');
  assert.match(lines[1].detail, /may still land after that read/);
});

test('a decisions part that timed out, or got a 504, leaves a pending row not checked; a 2xx settles it', async () => {
  const entries = {
    [id(2)]: [{ id: 'e2', status: 'CANDIDATE', itemId: id(2) }],
  };
  const timeout = new Error('The operation was aborted due to timeout');
  timeout.name = 'TimeoutError';
  const gateway = new HttpError(504);
  const unreadable = new HttpError(201);
  unreadable.body = '<html>ok</html>';
  for (const [lost, checked] of [
    [timeout, false],
    [gateway, false],
    [unreadable, undefined],
  ]) {
    const { client } = fakeTarget([], { entries });
    const lines = [];
    await assert.rejects(
      () =>
        replayDecisions({
          prepared: {
            header: { header: true, runId: 'r' },
            records: [linkRow(2, id(2))],
          },
          items: new Map([[id(2), {}]]),
          write: true,
          partBase: 'report.decisions',
          splitParts: (records) => [records],
          writeFile: () => undefined,
          applyFile: async () => {
            throw lost;
          },
          client,
          lines,
        }),
      ReplayStopped
    );
    assert.deepEqual(
      lines.map((line) => [line.class, line.checked]),
      [[DECISION_CLASS.NOT_WRITTEN, checked]],
      lost.message
    );
  }
});

test('the products a decisions part left orphaned are copied into the report', async () => {
  const { client } = fakeTarget([product(1)]);
  const changeList = sizeChangeList(0);
  const orphan = id(7);
  let report = null;
  const stderr = sink();
  // Refused at a step other than VALIDATE: a stopped run, with its error in
  // the header, and the part after it not sent.
  await assert.rejects(
    () =>
      runReplay({
        changeFile: 'changes.jsonl',
        changeList,
        folded: foldChanges(changeList),
        targetUrl: 'http://localhost:43700',
        write: true,
        batchSize: 1,
        reportPath: 'report.json',
        client,
        stderr,
        writeFile: (path, text) => {
          if (path === 'report.json') {
            report = JSON.parse(text);
          }
        },
        decisions: {
          file: 'd.jsonl',
          prepared: {
            header: { header: true, runId: 'r' },
            records: [createRow(1), createRow(2)],
          },
          splitParts: (records) => records.map((record) => [record]),
          applyFile: async () => ({
            applied: false,
            failedStep: 'APPLY',
            error: 'step three failed',
            results: [],
            orphanedItemIds: [orphan],
          }),
        },
      }),
    (error) =>
      error instanceof ReplayStopped &&
      /the decisions stopped: the target refused a part at APPLY/.test(
        error.message
      )
  );
  assert.deepEqual(report.decisions.orphanedItemIds, [orphan]);
  assert.match(report.header.stoppedBy, /refused a part at APPLY/);
  assert.deepEqual(report.header.error, {
    status: null,
    code: 'APPLY',
    message: 'step three failed',
  });
  assert.deepEqual(
    report.decisions.lines.map((line) => [line.entryId, line.class]),
    [
      ['e1', DECISION_CLASS.REFUSED],
      ['e2', DECISION_CLASS.NOT_SENT],
    ]
  );
  assert.equal(report.header.inProgress, undefined);
  assert.doesNotMatch(stderr.text(), /step three failed/);
});

test('a decisions part refused in three rounds that each drop a row is not cut short by the idle cap', async () => {
  const sent = [];
  const records = [1, 2, 3, 4, 5].map((n) => linkRow(n, id(n)));
  const result = await replayDecisions({
    prepared: { header: { header: true, runId: 'r' }, records },
    items: new Map([1, 2, 3, 4, 5].map((n) => [id(n), {}])),
    write: true,
    partBase: 'report.decisions',
    splitParts: (all) => [all],
    writeFile: () => undefined,
    applyFile: async (path) => {
      sent.push(path);
      // Rounds 1 to 3 each refuse one row; round 4 is applied.
      if (sent.length <= 3) {
        return {
          applied: false,
          failedStep: 'VALIDATE',
          results: [
            {
              entryId: `e${sent.length}`,
              error: { code: 'EXPECT_MISMATCH', detail: 'moved' },
            },
          ],
        };
      }
      return { applied: true, results: [] };
    },
  });
  assert.ok(MAX_IDLE_DECISION_ROUNDS < 3);
  assert.equal(sent.length, 4);
  assert.match(sent[3], /round-4/);
  assert.deepEqual(
    result.lines.map((line) => [line.entryId, line.class]),
    [
      ['e1', DECISION_CLASS.CONFLICT],
      ['e2', DECISION_CLASS.CONFLICT],
      ['e3', DECISION_CLASS.CONFLICT],
      ['e4', DECISION_CLASS.APPLIED],
      ['e5', DECISION_CLASS.APPLIED],
    ]
  );
});

test('a decisions part refused in rounds that drop nothing stops after the cap', async () => {
  const sent = [];
  const lines = [];
  await assert.rejects(
    () =>
      replayDecisions({
        prepared: {
          header: { header: true, runId: 'r' },
          records: [linkRow(1, id(1)), linkRow(2, id(2))],
        },
        items: new Map([1, 2].map((n) => [id(n), {}])),
        write: true,
        partBase: 'report.decisions',
        splitParts: (records) => [records],
        writeFile: () => undefined,
        applyFile: async (path) => {
          sent.push(path);
          return {
            applied: false,
            failedStep: 'VALIDATE',
            results: [
              { entryId: 'e9', error: { code: 'NOT_FOUND', detail: 'gone' } },
            ],
          };
        },
        lines,
      }),
    /refused one part 2 times in a row and named none of its rows/
  );
  assert.equal(sent.length, MAX_IDLE_DECISION_ROUNDS);
  assert.deepEqual(
    lines.map((line) => [line.entryId, line.class, line.code]),
    [
      ['e1', DECISION_CLASS.REFUSED, 'no_progress'],
      ['e2', DECISION_CLASS.REFUSED, 'no_progress'],
    ]
  );
});
