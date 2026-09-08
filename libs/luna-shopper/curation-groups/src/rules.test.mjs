import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  buildSystemPrompt,
  canonicalSlug,
  deriveUnitFamilies,
  groupWords,
  isValidSlug,
  loadUnits,
  loadVocabularies,
  normalizeName,
  proposedWords,
  slugWords,
} from './rules.mjs';
import { TEST_UNITS } from './test-fakes.mjs';

test('normalizeName drops case, accents and punctuation', () => {
  assert.equal(
    normalizeName('Aceite de Oliva Virgen Extra'),
    'aceite de oliva virgen extra'
  );
  assert.equal(normalizeName('Leche  Semidesnatada!'), 'leche semidesnatada');
  assert.equal(normalizeName('Jamón Ibérico'), 'jamon iberico');
  assert.equal(normalizeName(null), '');
});

/**
 * The cases `product-group.service.ts#validateSlug` decides, both ways.
 *
 * A slug the service would accept must not send a product to a person, and one
 * it would refuse must never reach a decisions file, so this pair has to agree
 * with that function and not merely be strict.
 */
test('isValidSlug agrees with the catalog service', () => {
  for (const slug of ['leche', 'leche-semidesnatada', 'a1-b2', ' LECHE ']) {
    assert.equal(isValidSlug(slug), true, `${slug} should be accepted`);
  }
  for (const slug of [
    'Leche_Semidesnatada',
    'leche--semi',
    '-leche',
    'leche-',
    'leche semi',
    'lechê',
    '',
    null,
  ]) {
    assert.equal(isValidSlug(slug), false, `${slug} should be refused`);
  }
});

test('canonicalSlug is what catalog would store', () => {
  assert.equal(canonicalSlug('  Leche-Semi  '), 'leche-semi');
});

/** A slug is looked up as its words, because the listing searches names. */
test('slugWords turns a handle back into something searchable', () => {
  assert.equal(slugWords('leche-semidesnatada'), 'leche semidesnatada');
  assert.equal(slugWords(''), '');
});

test('groupWords and proposedWords read both locales and both synonym lists', () => {
  const existing = groupWords({
    name: { es: 'Leche semidesnatada', en: 'Semi-skimmed milk' },
    synonyms: { es: ['leche semi'], en: ['semi milk'] },
  });
  assert.equal(existing.has('leche semidesnatada'), true);
  assert.equal(existing.has('semi skimmed milk'), true);
  assert.equal(existing.has('semi milk'), true);

  const proposed = proposedWords({
    nameEs: 'Leche Semidesnatada',
    nameEn: null,
    synonyms: { es: ['Leche Semi'] },
  });
  assert.equal(proposed.has('leche semidesnatada'), true);
  assert.equal(proposed.has('leche semi'), true);
});

test('deriveUnitFamilies places every unit the catalog names', () => {
  const families = deriveUnitFamilies(TEST_UNITS);
  assert.equal(families.get('GRAM'), 'weight');
  assert.equal(families.get('KILOGRAM'), 'weight');
  assert.equal(families.get('LITER'), 'volume');
  assert.equal(families.get('MILLILITER'), 'volume');
  assert.equal(families.get('UNIT'), 'count');
  assert.equal(families.get('PACK'), 'count');
  assert.equal(families.get('FURLONG'), undefined);
});

/** The real document, so a unit added to the enum reaches this library. */
test('the committed OpenAPI document answers the unit vocabulary', () => {
  const { units, unitFamilies } = loadVocabularies();
  assert.ok(units.includes('LITER'));
  assert.ok(units.length >= 4);
  assert.equal(unitFamilies.get('LITER'), 'volume');
});

test('a document with no vocabulary names the command that regenerates it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'curation-groups-'));
  const path = join(dir, 'openapi.json');
  writeFileSync(path, JSON.stringify({ components: { schemas: {} } }));

  assert.throws(
    () => loadUnits(pathToFileURL(path)),
    /luna-shopper-backend-gateway:openapi/
  );
});

/**
 * The prompt carries the vocabulary and no directory.
 *
 * The directory is what plan 0099 put in the second cached system block and
 * what this library deliberately dropped, so its absence is worth asserting:
 * a run against a catalog holding thousands of groups must not grow the prompt
 * by one line per group.
 */
test('the system prompt carries the rules and the units with their families', () => {
  const prompt = buildSystemPrompt({
    template: '# Rules\n\nBody.',
    units: TEST_UNITS,
  });

  assert.match(prompt, /# Rules/);
  assert.match(prompt, /## Unit vocabulary/);
  assert.match(prompt, /- `LITER` \(volume\)/);
  assert.match(prompt, /- `PACK` \(count\)/);
  assert.doesNotMatch(prompt, /directory/i);
});
