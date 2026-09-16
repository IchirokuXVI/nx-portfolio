import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  ISSUE_DETAIL_MAX,
  REASONING_MAX,
  brandKey,
  buildDecisionSchema,
  buildSystemPrompt,
  carriesBrand,
  carriesGlitch,
  carriesSize,
  indexBrands,
  loadPromptTemplate,
  loadVocabularies,
  normalizeName,
} from './rules.mjs';

function fixture(name) {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
  );
}

const BRANDS = fixture('brands.json').items;
const SUPERMARKETS = fixture('supermarkets.json').items;

test('normalizeName folds case, accents and punctuation', () => {
  assert.equal(normalizeName('Leche Semidesnatada'), 'leche semidesnatada');
  assert.equal(normalizeName('ACEITE DE OLIVA'), 'aceite de oliva');
  assert.equal(normalizeName('Jamón Ibérico'), 'jamon iberico');
  assert.equal(normalizeName('Yogur, natural.'), 'yogur natural');
});

test('normalizeName collapses runs of separators', () => {
  assert.equal(normalizeName('  pan   de   molde  '), 'pan de molde');
});

test('normalizeName treats two spellings of one name alike', () => {
  assert.equal(normalizeName('Atún claro'), normalizeName('ATUN CLARO'));
});

test('carriesSize knows a printed size from a range name', () => {
  assert.equal(carriesSize('Leche entera 1 L'), true);
  assert.equal(carriesSize('Leche entera 1L'), true);
  assert.equal(carriesSize('Yogur natural pack 4 uds'), true);
  assert.equal(carriesSize('Aceite de oliva 0,4 kg'), true);
  assert.equal(carriesSize('Leche entera'), false);
  assert.equal(carriesSize('Pan de molde'), false);
});

test('carriesBrand compares normalized tokens', () => {
  assert.equal(carriesBrand('Leche Hacendado entera', 'Hacendado'), true);
  assert.equal(carriesBrand('Leche entera', 'Hacendado'), false);
  assert.equal(carriesBrand('Queso Ifa Unnia curado', 'Ifa Unnia'), true);
  assert.equal(carriesBrand('Queso curado', 'Ifa Unnia'), false);
  assert.equal(carriesBrand('anything', ''), false);
});

test('carriesGlitch knows a broken word from a real one', () => {
  assert.equal(carriesGlitch('May1onesa'), true);
  assert.equal(carriesGlitch('Yogur de fres1a'), true);
  assert.equal(carriesGlitch('Beb1ida de avena'), true);

  assert.equal(carriesGlitch('Leche entera'), false);
  assert.equal(carriesGlitch('Omega 3'), false);
  assert.equal(carriesGlitch('Vitamina B12'), false);
  assert.equal(carriesGlitch('Agua H2O'), false);
  assert.equal(carriesGlitch('agua h2o'), false);
  assert.equal(carriesGlitch(null), false);
});

test('carriesGlitch leaves a shade code alone, which is not negotiable', () => {
  // A shade code is the only thing telling two shades of one line apart, and
  // rule 1 merges anything the name does not separate. A validator that
  // refused `n4N` would refuse every cosmetics row on the queue.
  assert.equal(carriesGlitch('Corrector Terracotta n4N'), false);
  assert.equal(carriesGlitch('Sombra dúo Monochrome n30'), false);
  assert.equal(
    carriesGlitch('Polvos compactos Terracotta Original n03'),
    false
  );
  assert.equal(carriesGlitch('Protector solar spf25'), false);
});

test('the prompt names the line rule, both domains, and the glitch code', () => {
  const template = loadPromptTemplate();
  // A line name and a shade code stay in the name and the brand leaves it.
  // One grocery example and two cosmetics ones, because the defect was
  // measured on both queues and reads differently on each.
  assert.match(template, /\+Proteínas/);
  assert.match(template, /Delicias del mar/);
  assert.match(template, /Monochrome n30/);
  assert.match(template, /Terracotta Original n03/);
  // Every code the validators can emit is named in the prompt, so a model can
  // read its answer against the list before it sends it.
  assert.match(template, /NAME_GLITCH/);
  // The two caps are stated in prose as well as in the schema, because a
  // schema `maxLength` is advice to some providers.
  assert.match(template, new RegExp(String(REASONING_MAX)));
  assert.match(template, new RegExp(String(ISSUE_DETAIL_MAX)));
});

test('the brandKey copy answers every pair the contracts cases pin', () => {
  // The contracts function is TypeScript and this library is plain `.mjs` with
  // no build step, so the two are held together by this file rather than by an
  // import. A pair added on the backend side fails here until the copy agrees.
  const cases = JSON.parse(
    readFileSync(
      new URL(
        '../../../../contracts/src/lib/brands/brand-key.cases.json',
        import.meta.url
      ),
      'utf8'
    )
  );
  assert.ok(cases.length > 0);
  for (const [text, key] of cases) {
    assert.equal(brandKey(text), key, `brandKey(${JSON.stringify(text)})`);
  }
});

test('brandKey is not normalizeName, which is why the registry has its own', () => {
  assert.equal(brandKey('El Pozo'), brandKey('ElPozo'));
  assert.notEqual(normalizeName('El Pozo'), normalizeName('ElPozo'));
});

test('indexBrands keys the registry by brandKey', () => {
  const brands = indexBrands(BRANDS);
  assert.deepEqual(brands.get('hacendado'), {
    id: 'brand-hacendado',
    key: 'hacendado',
    label: 'Hacendado',
    privateLabelSupermarketId: 'sm-mercadona',
  });
  assert.equal(brands.get('carbonell').privateLabelSupermarketId, null);
  assert.equal(brands.get('Hacendado'), undefined);
});

test('indexBrands drops a row whose label has no key', () => {
  const brands = indexBrands([{ id: 'b1', key: null, label: '---' }]);
  assert.equal(brands.size, 0);
});

test('the vocabularies come from the committed OpenAPI document', () => {
  const { categories, units } = loadVocabularies();
  assert.ok(categories.includes('DAIRY'));
  assert.ok(units.includes('LITER'));
});

test('a document with no vocabulary names the command that regenerates it', () => {
  const empty = new URL('./fixtures/empty-openapi.json', import.meta.url);
  assert.throws(
    () => loadVocabularies(empty),
    /luna-shopper-backend-gateway:openapi/
  );
});

test('the system prompt carries the rules, both vocabularies and the labels', () => {
  const prompt = buildSystemPrompt({
    categories: ['DAIRY', 'PANTRY'],
    units: ['LITER', 'UNIT'],
    brands: indexBrands(BRANDS),
    supermarkets: SUPERMARKETS,
  });
  assert.match(prompt, /## Category vocabulary/);
  assert.match(prompt, /- `DAIRY`/);
  assert.match(prompt, /## Unit vocabulary/);
  assert.match(prompt, /- `LITER`/);
  assert.match(prompt, /## Known private labels/);
  assert.match(prompt, /`Hacendado` belongs to Mercadona/);
  // The six naming rules the validators enforce come from the markdown file.
  assert.match(prompt, /rule/i);
  // The registry itself is not in here, only the private labels of it. A brand
  // with no chain is a line the model is billed for on every row and does not
  // need: the library resolves the brand and the packet carries the answer.
  assert.doesNotMatch(prompt, /Pascual/);
});

test('the prompt names brandMatch and the range rule', () => {
  const template = loadPromptTemplate();
  assert.match(template, /entry\.brandMatch/);
  assert.match(template, /brandMatch\.label/);
  assert.match(template, /BRAND_UNREGISTERED/);
  assert.match(template, /BRAND_DIFFERS_FROM_SOURCE/);
  // A range is never a brand, which is the defect the registry was built for.
  assert.match(template, /A range, a flavour or a claim is never a brand/);
});

test('the decision schema takes its enums from the same two vocabularies', () => {
  const schema = buildDecisionSchema({
    categories: ['DAIRY', 'PANTRY'],
    units: ['LITER', 'UNIT'],
  });

  assert.deepEqual(schema.properties.decision.enum, [
    'LINK',
    'CREATE',
    'REVIEW',
  ]);
  // A category the catalog does not have cannot be answered at all, rather
  // than being described in prose and refused after the fact.
  // Neither vocabulary admits `null`: a required field whose type admits
  // `null` is satisfied by `null`, and the checker refuses both of them null.
  // A product with no printed size is sold by the piece, so its unit is UNIT
  // and only `unitSize` stays nullable.
  assert.deepEqual(schema.properties.item.properties.category.enum, [
    'DAIRY',
    'PANTRY',
  ]);
  assert.deepEqual(schema.properties.item.properties.defaultUnit.enum, [
    'LITER',
    'UNIT',
  ]);
  assert.deepEqual(schema.properties.item.properties.unitSize.type, [
    'number',
    'null',
  ]);
  assert.deepEqual(schema.required, [
    'decision',
    'confidence',
    'issues',
    'reasoning',
  ]);
});

test('the decision schema leaves the semantics to the validators', () => {
  const schema = buildDecisionSchema({
    categories: ['DAIRY'],
    units: ['UNIT'],
  });

  // The root stays the object it has always been, so an engine that reads no
  // `anyOf` is exactly as well off as it was before the alternatives existed.
  for (const field of ['itemId', 'itemRef', 'item']) {
    assert.ok(!schema.required.includes(field), field);
  }
  // The id a LINK names still has to be one of the candidates this row was
  // offered, and nothing expressible here can say so.
  assert.equal(JSON.stringify(schema).includes('candidate'), false);
});

// ---------------------------------------------------------------------------
// The four shapes a decision can take (plan 0003)
// ---------------------------------------------------------------------------

/**
 * The keywords the schema is allowed to use.
 *
 * This is the real constraint and not a stylistic one: the schema is converted
 * to a grammar by llama.cpp on the Ollama path, and that converter understands
 * a subset of JSON Schema. `if`/`then` is the obvious way to write a
 * discriminated shape and is not in the subset, which is why the alternatives
 * are an `anyOf`. Asserting the keyword set is how a later edit that reaches
 * for an unsupported one is caught here rather than by a run that quietly
 * stops constraining anything.
 */
const ALLOWED_KEYWORDS = new Set([
  'anyOf',
  'const',
  'enum',
  'items',
  'maxLength',
  'maximum',
  'minimum',
  'properties',
  'required',
  'type',
]);

function keywordsOf(schema, found = new Set()) {
  if (!schema || typeof schema !== 'object') {
    return found;
  }
  if (Array.isArray(schema)) {
    for (const entry of schema) {
      keywordsOf(entry, found);
    }
    return found;
  }
  for (const [key, value] of Object.entries(schema)) {
    found.add(key);
    // Under `properties` the keys are field names rather than keywords.
    if (key === 'properties') {
      for (const child of Object.values(value ?? {})) {
        keywordsOf(child, found);
      }
      continue;
    }
    if (key === 'required' || key === 'enum') {
      continue;
    }
    keywordsOf(value, found);
  }
  return found;
}

/**
 * A validator for exactly the keywords above, and no more.
 *
 * Hand written rather than pulled from npm, because this library has no npm
 * dependencies and because the subset is the point: a validator that supported
 * more than the grammar converter does would pass documents the real run
 * cannot enforce.
 */
function validates(schema, value) {
  if (Array.isArray(schema.anyOf)) {
    return schema.anyOf.some((alternative) => validates(alternative, value));
  }
  if ('const' in schema) {
    return value === schema.const;
  }
  if (Array.isArray(schema.enum)) {
    return schema.enum.includes(value);
  }
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const actual =
    value === null
      ? 'null'
      : Array.isArray(value)
        ? 'array'
        : typeof value === 'number'
          ? 'number'
          : typeof value;
  if (schema.type !== undefined && !types.includes(actual)) {
    return false;
  }
  if (actual === 'string' && typeof schema.maxLength === 'number') {
    return value.length <= schema.maxLength;
  }
  if (actual === 'array' && schema.items) {
    return value.every((entry) => validates(schema.items, entry));
  }
  if (actual !== 'object') {
    return true;
  }
  for (const field of schema.required ?? []) {
    if (!(field in value)) {
      return false;
    }
  }
  for (const [field, child] of Object.entries(schema.properties ?? {})) {
    if (field in value && !validates(child, value[field])) {
      return false;
    }
  }
  return true;
}

const SCHEMA = buildDecisionSchema({
  categories: ['DAIRY', 'PANTRY'],
  units: ['LITER', 'UNIT'],
});

const CREATE = {
  decision: 'CREATE',
  item: {
    nameEs: 'Leche entera',
    nameEn: 'Whole milk',
    brand: 'Hacendado',
    unitSize: 1,
    defaultUnit: 'LITER',
    category: 'DAIRY',
    ean: null,
  },
  confidence: 0.95,
  issues: [],
  reasoning: 'Rule 1: no candidate is the same format.',
};

test('the schema uses only keywords the grammar converter understands', () => {
  const used = [...keywordsOf(SCHEMA)].filter(
    (keyword) => !ALLOWED_KEYWORDS.has(keyword)
  );
  assert.deepEqual(used, []);
});

test('every decision the checker accepts is a decision the schema allows', () => {
  assert.equal(validates(SCHEMA, CREATE), true);
  assert.equal(
    validates(SCHEMA, {
      decision: 'LINK',
      itemId: 'i1',
      confidence: 0.97,
      issues: [],
      reasoning: 'Rule 1: same brand, same format.',
    }),
    true
  );
  assert.equal(
    validates(SCHEMA, {
      decision: 'LINK',
      itemRef: 'ref-e1',
      confidence: 0.97,
      issues: [],
      reasoning: 'Rule 1: the product this run created two rows ago.',
    }),
    true
  );
  assert.equal(
    validates(SCHEMA, {
      decision: 'REVIEW',
      confidence: 0.5,
      issues: [{ code: 'FORMAT_UNKNOWN', detail: 'No size anywhere.' }],
      reasoning: 'Rule 1 cannot be tested.',
    }),
    true
  );
});

test('a CREATE carrying no item is not a document the schema allows', () => {
  // This is the whole of plan 0003's largest lever. The schema used to type
  // `item` as `["object", "null"]` and leave it optional, so a CREATE with a
  // null item was a legal token stream, and the decider refused it one request
  // later as `a CREATE needs an "item" object`.
  assert.equal(validates(SCHEMA, { ...CREATE, item: null }), false);
  const { item, ...withoutItem } = CREATE;
  assert.ok(item);
  assert.equal(validates(SCHEMA, withoutItem), false);

  // The three fields the checker refuses a CREATE without are required here
  // too, for the same reason and at the same cost.
  for (const field of ['nameEs', 'category', 'defaultUnit']) {
    const stripped = { ...CREATE.item };
    delete stripped[field];
    assert.equal(
      validates(SCHEMA, { ...CREATE, item: stripped }),
      false,
      field
    );
  }
});

test('a half filled item is refused by the loose root, with no alternation', () => {
  // The claude engine never sees the alternatives: the Messages API refuses an
  // `anyOf` at the top level of a tool schema, so `claude-cli.mjs` strips it.
  // The loose root is therefore the whole of what holds sonnet to a shape, and
  // 26 of 80 SuperCash rows were re-asked for `a CREATE needs
  // "item.defaultUnit"` before it required anything.
  const { anyOf, ...root } = SCHEMA;
  assert.ok(anyOf);

  assert.equal(validates(root, CREATE), true);
  for (const field of ['nameEs', 'category', 'defaultUnit']) {
    const stripped = { ...CREATE.item };
    delete stripped[field];
    assert.equal(validates(root, { ...CREATE, item: stripped }), false, field);
  }

  // `item` stays nullable at the root, because the root describes a LINK and a
  // REVIEW too and neither carries one. `required` applies to an object, so a
  // null item is left alone.
  assert.equal(
    validates(root, {
      decision: 'REVIEW',
      item: null,
      confidence: 0.5,
      issues: [],
      reasoning: 'Rule 1 cannot be tested.',
    }),
    true
  );

  // Required and nullable is not required. Sonnet low answered
  // `unitSize: null, defaultUnit: null` on 15 of 80 sizeless SuperCash rows
  // while the unit was required but nullable, and every one was re-asked.
  // The loose root refuses a null unit, and a null size stays allowed.
  assert.equal(
    validates(root, { ...CREATE, item: { ...CREATE.item, defaultUnit: null } }),
    false
  );
  assert.equal(
    validates(root, { ...CREATE, item: { ...CREATE.item, unitSize: null } }),
    true
  );

  // The two halves agree by construction: every alternative that carries an
  // item requires the same three fields and types them the same way.
  for (const alternative of anyOf) {
    const item = alternative.properties.item;
    if (item) {
      assert.deepEqual(item.required, SCHEMA.properties.item.required);
      assert.deepEqual(item.properties, SCHEMA.properties.item.properties);
      assert.equal(item.type, 'object');
    }
  }
});

test('a LINK naming no target is not a document the schema allows', () => {
  const link = {
    decision: 'LINK',
    confidence: 0.97,
    issues: [],
    reasoning: 'Rule 1.',
  };
  assert.equal(validates(SCHEMA, link), false);
  assert.equal(validates(SCHEMA, { ...link, itemId: null }), false);
  assert.equal(validates(SCHEMA, { ...link, itemRef: null }), false);
});

test('the schema caps the two fields that are billed on every row', () => {
  assert.equal(SCHEMA.properties.reasoning.maxLength, REASONING_MAX);
  assert.equal(
    SCHEMA.properties.issues.items.properties.detail.maxLength,
    ISSUE_DETAIL_MAX
  );
  assert.equal(
    validates(SCHEMA, { ...CREATE, reasoning: 'x'.repeat(REASONING_MAX + 1) }),
    false
  );
  assert.equal(
    validates(SCHEMA, {
      ...CREATE,
      issues: [{ code: 'X', detail: 'y'.repeat(ISSUE_DETAIL_MAX + 1) }],
    }),
    false
  );
});
