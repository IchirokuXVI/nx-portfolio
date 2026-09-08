import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildSystemPrompt,
  canonicalSlug,
  deriveUnitFamilies,
  groupWords,
  isValidSlug,
  itemLabel,
  itemSearchKey,
  loadUnits,
  normalizeName,
  proposedWords,
  slugWords,
} from './rules.mjs';

test('normalizeName folds case, accents and punctuation', () => {
  assert.equal(normalizeName('Leche Semidesnatada'), 'leche semidesnatada');
  assert.equal(normalizeName('Papel higiénico'), 'papel higienico');
  assert.equal(normalizeName('Yogur, natural.'), 'yogur natural');
  assert.equal(normalizeName('  pan   de   molde  '), 'pan de molde');
});

/**
 * The slug cases, matched one for one to
 * `product-group.service.ts#validateSlug`. The service trims and lower cases
 * before it tests, so a slug it would accept after trimming must not send a
 * product to a person, and one it would refuse must never reach a POST.
 */
test('isValidSlug accepts exactly what validateSlug accepts', () => {
  assert.equal(isValidSlug('leche-semidesnatada'), true);
  assert.equal(isValidSlug('aceite-de-oliva-virgen-extra'), true);
  assert.equal(isValidSlug('cafe2'), true);
  assert.equal(isValidSlug('  Leche-Semi  '), true);
});

test('isValidSlug refuses what validateSlug refuses', () => {
  assert.equal(isValidSlug('Leche_Semidesnatada'), false);
  assert.equal(isValidSlug('leche semidesnatada'), false);
  assert.equal(isValidSlug('leche--semi'), false);
  assert.equal(isValidSlug('-leche'), false);
  assert.equal(isValidSlug('leche-'), false);
  assert.equal(isValidSlug('papel-higiénico'), false);
  assert.equal(isValidSlug(''), false);
  assert.equal(isValidSlug(null), false);
});

test('canonicalSlug is what catalog would store', () => {
  assert.equal(canonicalSlug('  Leche-Semi  '), 'leche-semi');
});

test('slugWords turns a handle back into something a search can answer', () => {
  assert.equal(slugWords('leche-semidesnatada'), 'leche semidesnatada');
  assert.equal(slugWords('cafe'), 'cafe');
});

test('a group answers to its two names and both synonym lists', () => {
  const words = groupWords({
    name: { es: 'Leche semidesnatada', en: 'Semi-skimmed milk' },
    synonyms: { es: ['Leche semi'], en: ['semi skimmed'] },
  });
  assert.equal(words.has('leche semidesnatada'), true);
  assert.equal(words.has('semi skimmed milk'), true);
  assert.equal(words.has('leche semi'), true);
});

test('a proposal answers to the same kinds of word', () => {
  const words = proposedWords({
    nameEs: 'Leche semidesnatada',
    nameEn: 'Semi-skimmed milk',
    synonyms: { es: ['leche semi'], en: [] },
  });
  assert.deepEqual(
    [...words].sort(),
    ['leche semi', 'leche semidesnatada', 'semi skimmed milk'].sort()
  );
});

test('a product is searched for by its Spanish name, else its English one', () => {
  assert.equal(
    itemSearchKey({ name: { es: 'Leche Entera 1 L', en: 'Whole milk' } }),
    'leche entera 1 l'
  );
  assert.equal(itemSearchKey({ name: { en: 'Whole milk' } }), 'whole milk');
  assert.equal(itemSearchKey({ name: {} }), '');
});

test('a product with no name at all is still labeled by something', () => {
  assert.equal(itemLabel({ id: 'i1' }), 'i1');
  assert.equal(itemLabel(null), '(unnamed)');
});

test('unit families are derived from the vocabulary, not retyped', () => {
  const families = deriveUnitFamilies([
    'UNIT',
    'GRAM',
    'KILOGRAM',
    'MILLILITER',
    'LITER',
    'PACK',
  ]);
  assert.equal(families.get('GRAM'), 'weight');
  assert.equal(families.get('KILOGRAM'), 'weight');
  assert.equal(families.get('MILLILITER'), 'volume');
  assert.equal(families.get('LITER'), 'volume');
  assert.equal(families.get('UNIT'), 'count');
  assert.equal(families.get('PACK'), 'count');
});

test('a unit that fits no family is left out rather than guessed at', () => {
  const families = deriveUnitFamilies(['LITER', 'SHEET']);
  assert.equal(families.has('SHEET'), false);
});

test('the unit vocabulary comes from the committed OpenAPI document', () => {
  const units = loadUnits();
  assert.ok(units.includes('LITER'));
  assert.ok(units.includes('UNIT'));
});

test('every unit the document names can be placed in a family', () => {
  const units = loadUnits();
  const families = deriveUnitFamilies(units);
  assert.deepEqual(
    units.filter((unit) => !families.has(unit)),
    []
  );
});

test('a document with no vocabulary names the command that regenerates it', () => {
  const empty = new URL('./fixtures/empty-openapi.json', import.meta.url);
  assert.throws(() => loadUnits(empty), /luna-shopper-backend-gateway:openapi/);
});

test('the system prompt carries the rules and the unit vocabulary', () => {
  const prompt = buildSystemPrompt({ units: ['LITER', 'UNIT'] });
  assert.match(prompt, /## Unit vocabulary/);
  assert.match(prompt, /- `LITER`/);
  // The grouping rules come from the markdown file beside the source.
  assert.match(prompt, /Brand never separates items/);
  assert.match(prompt, /groupRef/);
});
