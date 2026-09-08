import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildSystemPrompt,
  carriesBrand,
  carriesSize,
  indexPrivateLabels,
  loadPrivateLabels,
  loadVocabularies,
  normalizeName,
} from './rules.mjs';

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

test('the private label map is normalized on both sides', () => {
  const labels = indexPrivateLabels({ Hacendado: 'Mercadona' });
  assert.deepEqual(labels.get('hacendado'), {
    brand: 'Hacendado',
    chain: 'Mercadona',
    chainKey: 'mercadona',
  });
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
    privateLabels: loadPrivateLabels(),
  });
  assert.match(prompt, /## Category vocabulary/);
  assert.match(prompt, /- `DAIRY`/);
  assert.match(prompt, /## Unit vocabulary/);
  assert.match(prompt, /- `LITER`/);
  assert.match(prompt, /## Known private labels/);
  assert.match(prompt, /`Hacendado` belongs to Mercadona/);
  // The six naming rules the validators enforce come from the markdown file.
  assert.match(prompt, /rule/i);
});
