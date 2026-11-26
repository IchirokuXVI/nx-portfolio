import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUDIT_ORIGIN,
  CARRIED_FIELDS,
  CHANGE_LIST_KIND,
  LOCAL_GAP,
  NOT_CARRIED,
  carriedField,
  exportChanges,
  exportCommand,
  exportItemsSql,
  foldChanges,
  foldProduct,
  parseActors,
  readChangeList,
  sameValue,
  wireValue,
} from './changes.mjs';

// Made up ids: nothing here names a real product, entry or operator.
const ACTOR = '00000000-0000-4000-8000-0000000000a1';
const ACTOR_2 = '00000000-0000-4000-8000-0000000000a2';
const ITEM = '00000000-0000-4000-8000-000000000001';

function sink() {
  const written = [];
  return { write: (text) => written.push(text), text: () => written.join('') };
}

const line = (fields, extra = {}) => ({
  auditId: extra.auditId ?? `a${Math.random()}`,
  at: '2026-11-20T10:00:00.000Z',
  action: 'UPDATE',
  itemId: ITEM,
  current: { name: { es: 'Leche', en: 'Milk' }, brand: 'Marca' },
  ...fields,
  ...extra,
});

// --- Export ------------------------------------------------------------------

test('the export runs psql read only in the slot catalog container', () => {
  const { command, args } = exportCommand(7, 'SELECT 1');
  assert.equal(command, 'docker');
  assert.deepEqual(args.slice(0, 3), ['exec', '-i', 'luna-slot7-catalog-db-1']);
  assert.ok(args.includes('psql'));
  const read = args.indexOf('SET default_transaction_read_only = on');
  assert.ok(read > 0);
  assert.equal(args[read - 1], '-c');
  assert.equal(args.at(-1), 'SELECT 1');
  assert.equal(
    exportCommand(0, 'x').args[2],
    'luna-shopper-backend-catalog-db-1'
  );
});

test('the export SQL names one actor or two, admin rows of items only', () => {
  const window = {
    actors: [ACTOR],
    since: '2026-11-20T00:00:00.000Z',
    until: '2026-11-21T00:00:00.000Z',
  };
  const one = exportItemsSql(window);
  assert.match(one, /a\.entity = 'items'/);
  assert.match(one, /a\."actorKind" = 'ADMIN'/);
  assert.match(one, new RegExp(`ARRAY\\['${ACTOR}'\\]::uuid\\[\\]`));
  assert.match(one, /a\.at >= '2026-11-20T00:00:00.000Z'::timestamptz/);
  assert.match(one, /ORDER BY a\.at, a\.id/);
  const two = exportItemsSql({ ...window, actors: [ACTOR, ACTOR_2] });
  assert.match(two, new RegExp(`ARRAY\\['${ACTOR}', '${ACTOR_2}'\\]`));
});

test('an actor that is not a uuid is refused, and none at all is too', () => {
  assert.throws(() => parseActors([]), /--actor is required/);
  assert.throws(() => parseActors(["x' OR 1=1"]), /not an admin id/);
  assert.deepEqual(parseActors([`${ACTOR},${ACTOR_2}`, ACTOR]), [
    ACTOR,
    ACTOR_2,
  ]);
});

test('the export writes a header with the counts of other tables', async () => {
  const calls = [];
  const run = async (command, args) => {
    calls.push(args.at(-1));
    return calls.length === 1
      ? {
          code: 0,
          stdout: `${JSON.stringify(line({ before: { packCount: null }, after: { packCount: 6 } }))}\n`,
          stderr: '',
        }
      : { code: 0, stdout: '{"supermarket_items" : 3}\n', stderr: '' };
  };
  let written = null;
  const stderr = sink();
  const result = await exportChanges({
    file: 'changes.jsonl',
    slot: 7,
    actors: [ACTOR],
    since: '2026-11-20T00:00:00.000Z',
    until: '2026-11-21T00:00:00.000Z',
    run,
    stderr,
    now: () => new Date('2026-11-26T00:00:00.000Z'),
    writeFile: (path, text) => {
      written = text;
    },
  });
  const [header, first] = written
    .trim()
    .split('\n')
    .map((text) => JSON.parse(text));
  assert.equal(header.header, true);
  assert.equal(header.kind, CHANGE_LIST_KIND);
  assert.equal(header.origin, AUDIT_ORIGIN);
  assert.equal(header.slot, 7);
  assert.deepEqual(header.actors, [ACTOR]);
  assert.deepEqual(header.otherEntities, { supermarket_items: 3 });
  assert.equal(first.itemId, ITEM);
  assert.equal(result.lines, 1);
  assert.equal(calls.length, 2);
  // Counts and the path only: no id and no name on stderr.
  assert.doesNotMatch(stderr.text(), new RegExp(ITEM));
  assert.match(stderr.text(), /1 audit rows of 1 products to changes\.jsonl/);
});

test('the export is refused without --since, before anything runs', async () => {
  await assert.rejects(
    () =>
      exportChanges({
        file: 'x',
        slot: 7,
        actors: [ACTOR],
        run: () => assert.fail('ran'),
        stderr: sink(),
      }),
    /--since is required/
  );
});

// --- File ----------------------------------------------------------------------

const file = (header, lines) =>
  [header, ...lines].map((entry) => JSON.stringify(entry)).join('\n');

test('a header of another origin is read', () => {
  const { header, lines } = readChangeList('c.jsonl', () =>
    file({ header: true, kind: CHANGE_LIST_KIND, origin: 'fixes-tsv' }, [
      { itemId: ITEM, before: { unitSize: 53 }, after: { unitSize: null } },
    ])
  );
  assert.equal(header.origin, 'fixes-tsv');
  assert.equal(lines.length, 1);
  assert.equal(foldChanges({ header, lines }).esOnlyIdentity, true);
});

test('a line without itemId is refused with its line number', () => {
  assert.throws(
    () =>
      readChangeList('c.jsonl', () =>
        file({ header: true, kind: CHANGE_LIST_KIND, origin: AUDIT_ORIGIN }, [
          { itemId: ITEM, before: {}, after: {} },
          { before: {}, after: {} },
        ])
      ),
    /c\.jsonl line 3 names no itemId/
  );
});

test('a file with no header, or of another kind, is refused', () => {
  assert.throws(
    () => readChangeList('c.jsonl', () => JSON.stringify({ itemId: ITEM })),
    /does not start with a header/
  );
  assert.throws(
    () =>
      readChangeList('c.jsonl', () =>
        JSON.stringify({ header: true, kind: 'decisions' })
      ),
    /not a catalog-changes list/
  );
});

// --- Folding -----------------------------------------------------------------

test('two edits of one field chain into one change', () => {
  const change = foldProduct(ITEM, [
    line({ before: { unitSize: 53 }, after: { unitSize: 50 } }),
    line({ before: { unitSize: '50.0000' }, after: { unitSize: null } }),
  ]);
  assert.equal(change.class, null);
  assert.deepEqual(change.fields, [{ field: 'unitSize', from: 53, to: null }]);
});

test('a broken chain is a local gap', () => {
  const change = foldProduct(ITEM, [
    line({ before: { unitSize: 53 }, after: { unitSize: 50 } }),
    line({ before: { unitSize: 40 }, after: { unitSize: null } }),
  ]);
  assert.equal(change.class, LOCAL_GAP);
});

test('a field put back to its from is dropped, and a product with nothing left too', () => {
  const back = foldProduct(ITEM, [
    line({
      before: { packCount: 6, unitSize: 1 },
      after: { packCount: 4, unitSize: 2 },
    }),
    line({ before: { packCount: 4 }, after: { packCount: 6 } }),
  ]);
  assert.deepEqual(back.fields, [{ field: 'unitSize', from: 1, to: 2 }]);
  const nothing = foldChanges({
    header: { origin: AUDIT_ORIGIN },
    lines: [
      line({ before: { packCount: 6 }, after: { packCount: 4 } }),
      line({ before: { packCount: 4 }, after: { packCount: 6 } }),
    ],
  });
  assert.equal(nothing.changes.length, 0);
  assert.equal(nothing.dropped, 1);
});

test('a CREATE, a DELETE and a merge line are not carried', () => {
  for (const [lines, reason] of [
    [
      [line({ action: 'CREATE', before: null, after: { name: { es: 'x' } } })],
      /created locally/,
    ],
    [
      [line({ action: 'DELETE', before: { name: { es: 'x' } }, after: null })],
      /deleted locally/,
    ],
    [
      [
        line({
          before: { mergedIntoId: null },
          after: { mergedIntoId: 'survivor', mergedAt: 'now' },
        }),
      ],
      /merged locally/,
    ],
  ]) {
    const change = foldProduct(ITEM, lines);
    assert.equal(change.class, NOT_CARRIED);
    assert.match(change.reason, reason);
  }
});

test('the identity is the from of a renamed product, and current otherwise', () => {
  const renamed = foldProduct(ITEM, [
    line({
      before: { name: { es: 'Lehce', en: 'Milk' }, brand: 'Vieja' },
      after: { name: { es: 'Leche', en: 'Milk' }, brand: 'Marca' },
    }),
  ]);
  assert.deepEqual(renamed.identity, {
    name: { es: 'Lehce', en: 'Milk' },
    brand: 'Vieja',
  });
  const kept = foldProduct(ITEM, [
    line({ before: { packCount: null }, after: { packCount: 6 } }),
  ]);
  assert.deepEqual(kept.identity, {
    name: { es: 'Leche', en: 'Milk' },
    brand: 'Marca',
  });
});

test('fields no expect guards are reported apart, and derived fields are read and not kept', () => {
  const change = foldProduct(ITEM, [
    line({
      before: { ean: null, brand: 'A', brandKey: 'a', brandId: null },
      after: { ean: '8410000000000', brand: 'B', brandKey: 'b', brandId: 'x' },
    }),
  ]);
  assert.deepEqual(change.fields, [{ field: 'brand', from: 'A', to: 'B' }]);
  assert.deepEqual(change.unguarded, [
    { field: 'ean', from: null, to: '8410000000000' },
  ]);
  const only = foldProduct(ITEM, [
    line({ before: { sku: null }, after: { sku: 'S1' } }),
  ]);
  assert.equal(only.class, NOT_CARRIED);
});

// --- Comparison ----------------------------------------------------------------

test('53.0000 equals 53, a trimmed half of a name equals, categories in another order differ', () => {
  assert.equal(sameValue('number', '53.0000', 53), true);
  assert.equal(sameValue('number', null, undefined), true);
  assert.equal(
    sameValue(
      'name',
      { es: ' Leche ', en: 'Milk' },
      { es: 'Leche', en: 'Milk ' }
    ),
    true
  );
  assert.equal(
    sameValue('name', { es: 'Leche' }, { es: 'Leche', en: 'Milk' }),
    false
  );
  assert.equal(
    sameValue(
      'name',
      { es: 'Leche' },
      { es: 'Leche', en: 'Milk' },
      { esOnly: true }
    ),
    true
  );
  assert.equal(sameValue('slugs', ['a', 'b'], ['b', 'a']), false);
  assert.equal(sameValue('slugs', ['a', 'b'], ['a', 'b']), true);
  assert.equal(sameValue('brand', ' Marca ', 'MARCA'), true);
});

test('every carried field is one entry with a kind, so a new guarded field is one line', () => {
  for (const spec of CARRIED_FIELDS) {
    assert.equal(typeof spec.field, 'string');
    assert.equal(typeof spec.send, 'string');
    assert.equal(typeof spec.read, 'function');
    assert.ok(['name', 'brand', 'number', 'text', 'slugs'].includes(spec.kind));
  }
  assert.deepEqual(
    CARRIED_FIELDS.map((spec) => spec.send),
    [
      'name',
      'brand',
      'unitSize',
      'approxWeight',
      'quantityStep',
      'defaultUnit',
      'packCount',
      'pieceCount',
      'categorySlugs',
    ]
  );
});

test('a piece count edit is carried and guarded, not reported unguarded', () => {
  const change = foldProduct(ITEM, [
    line({ before: { pieceCount: null }, after: { pieceCount: 50 } }),
    line({ before: { pieceCount: 50 }, after: { pieceCount: '48' } }),
  ]);
  assert.equal(change.class, null);
  assert.deepEqual(change.fields, [
    { field: 'pieceCount', from: null, to: '48' },
  ]);
  assert.deepEqual(change.unguarded, []);
  assert.equal(wireValue(carriedField('pieceCount'), '48'), 48);
  assert.equal(carriedField('pieceCount').kind, carriedField('packCount').kind);
});
