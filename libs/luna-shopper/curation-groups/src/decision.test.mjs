import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CONFIDENCE_THRESHOLD,
  checkDecisionShape,
  validateDecision,
} from './decision.mjs';
import { deriveUnitFamilies } from './rules.mjs';

const FAMILIES = deriveUnitFamilies([
  'UNIT',
  'GRAM',
  'KILOGRAM',
  'MILLILITER',
  'LITER',
  'PACK',
]);

const MILK = {
  id: 'i1',
  name: { es: 'Leche semidesnatada Hacendado 1 L' },
  unitSize: 1,
  defaultUnit: 'LITER',
  category: 'DAIRY',
};

const MILK_GROUP = {
  id: 'g1',
  name: { es: 'Leche semidesnatada', en: 'Semi-skimmed milk' },
  slug: 'leche-semidesnatada',
  referenceUnit: 'LITER',
  synonyms: { es: ['leche semi'], en: [] },
};

function proposal({ group = {}, ...overrides } = {}) {
  return {
    decision: 'CREATE_GROUP',
    groupId: null,
    groupRef: null,
    confidence: 0.97,
    issues: [],
    reasoning: '',
    ...overrides,
    group: {
      nameEs: 'Leche semidesnatada',
      nameEn: 'Semi-skimmed milk',
      slug: 'leche-semidesnatada',
      referenceUnit: 'LITER',
      synonyms: { es: [], en: [] },
      ...group,
    },
  };
}

function codes(issues) {
  return issues.map((entry) => entry.code);
}

// ---------------------------------------------------------------------------
// The shape check
// ---------------------------------------------------------------------------

test('a reply that is not an object is not a decision', () => {
  assert.equal(checkDecisionShape(null).ok, false);
  assert.equal(checkDecisionShape([]).ok, false);
  assert.equal(checkDecisionShape('ASSIGN').ok, false);
});

test('the three decisions are the only ones there are', () => {
  const bad = checkDecisionShape({ decision: 'LINK', confidence: 1 });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /ASSIGN, CREATE_GROUP, REVIEW/);
});

test('confidence must be a number between 0 and 1', () => {
  assert.match(
    checkDecisionShape({ decision: 'REVIEW', confidence: 'high' }).error,
    /must be a number/
  );
  assert.match(
    checkDecisionShape({ decision: 'REVIEW', confidence: 1.5 }).error,
    /between 0 and 1/
  );
});

test('an ASSIGN names a group by id or by ref, and one of them is required', () => {
  const byId = checkDecisionShape({
    decision: 'ASSIGN',
    groupId: ' g1 ',
    confidence: 0.95,
  });
  assert.equal(byId.decision.groupId, 'g1');
  assert.equal(byId.decision.groupRef, null);

  const byRef = checkDecisionShape({
    decision: 'ASSIGN',
    groupRef: 'ref-i1',
    confidence: 0.95,
  });
  assert.equal(byRef.decision.groupRef, 'ref-i1');

  const neither = checkDecisionShape({ decision: 'ASSIGN', confidence: 0.95 });
  assert.equal(neither.ok, false);
  assert.match(neither.error, /"groupId" or a "groupRef"/);
});

test('a CREATE_GROUP needs all four fields of its group', () => {
  for (const field of ['nameEs', 'nameEn', 'slug', 'referenceUnit']) {
    const group = {
      nameEs: 'Leche',
      nameEn: 'Milk',
      slug: 'leche',
      referenceUnit: 'LITER',
    };
    delete group[field];
    const answer = checkDecisionShape({
      decision: 'CREATE_GROUP',
      confidence: 0.95,
      group,
    });
    assert.equal(answer.ok, false, `${field} is missing and was accepted`);
    assert.match(answer.error, new RegExp(field));
  }
});

test('the synonym lists must be lists, and are filled in when absent', () => {
  const bad = checkDecisionShape({
    decision: 'CREATE_GROUP',
    confidence: 0.95,
    group: {
      nameEs: 'Leche',
      nameEn: 'Milk',
      slug: 'leche',
      referenceUnit: 'LITER',
      synonyms: { es: 'leche semi' },
    },
  });
  assert.equal(bad.ok, false);

  const good = checkDecisionShape({
    decision: 'CREATE_GROUP',
    confidence: 0.95,
    group: {
      nameEs: 'Leche',
      nameEn: 'Milk',
      slug: 'leche',
      referenceUnit: 'LITER',
    },
  });
  assert.deepEqual(good.decision.group.synonyms, { es: [], en: [] });
});

test('a slug the service would refuse is a validator issue, not a parse failure', () => {
  const answer = checkDecisionShape({
    decision: 'CREATE_GROUP',
    confidence: 0.95,
    group: {
      nameEs: 'Leche',
      nameEn: 'Milk',
      slug: 'Leche_Semi',
      referenceUnit: 'LITER',
    },
  });
  assert.equal(answer.ok, true);
});

test('the model’s issues are kept, whatever shape they arrived in', () => {
  const answer = checkDecisionShape({
    decision: 'REVIEW',
    confidence: 0.4,
    issues: ['the name says nothing', { code: 'X', detail: 'y' }, 7],
  });
  assert.deepEqual(answer.decision.issues, [
    { code: 'MODEL_NOTE', detail: 'the name says nothing' },
    { code: 'X', detail: 'y' },
  ]);
});

// ---------------------------------------------------------------------------
// The validators
// ---------------------------------------------------------------------------

test('an ASSIGN onto a group nobody answers for is GROUP_TARGET_MISSING', () => {
  const issues = validateDecision({
    decision: { decision: 'ASSIGN', groupId: 'g-gone', groupRef: null },
    item: MILK,
    target: null,
    unitFamilies: FAMILIES,
  });
  assert.deepEqual(codes(issues), ['GROUP_TARGET_MISSING']);
});

test('an ASSIGN onto a group in another unit family is refused', () => {
  const issues = validateDecision({
    decision: { decision: 'ASSIGN', groupId: 'g1', groupRef: null },
    item: { ...MILK, defaultUnit: 'GRAM' },
    target: MILK_GROUP,
    unitFamilies: FAMILIES,
  });
  assert.deepEqual(codes(issues), ['UNIT_FAMILY_MISMATCH']);
  assert.match(issues[0].detail, /LITER \(volume\).*GRAM \(weight\)/);
});

test('an ASSIGN onto a group in the same family passes', () => {
  const issues = validateDecision({
    decision: { decision: 'ASSIGN', groupId: 'g1', groupRef: null },
    item: MILK,
    target: MILK_GROUP,
    unitFamilies: FAMILIES,
  });
  assert.deepEqual(issues, []);
});

test('a unit the vocabulary cannot place is a person’s problem, not a crash', () => {
  const issues = validateDecision({
    decision: { decision: 'ASSIGN', groupId: 'g1', groupRef: null },
    item: { ...MILK, defaultUnit: 'SHEET' },
    target: MILK_GROUP,
    unitFamilies: FAMILIES,
  });
  assert.deepEqual(codes(issues), ['UNIT_FAMILY_MISMATCH']);
  assert.match(issues[0].detail, /SHEET/);
});

test('a REVIEW is checked against nothing', () => {
  assert.deepEqual(
    validateDecision({
      decision: { decision: 'REVIEW' },
      item: MILK,
      unitFamilies: FAMILIES,
    }),
    []
  );
});

test('a slug the service would refuse is SLUG_INVALID', () => {
  const issues = validateDecision({
    decision: proposal({ group: { slug: 'Leche_Semi' } }),
    item: MILK,
    unitFamilies: FAMILIES,
  });
  assert.deepEqual(codes(issues), ['SLUG_INVALID']);
});

test('a slug somebody already holds is SLUG_TAKEN', () => {
  const issues = validateDecision({
    decision: proposal(),
    item: MILK,
    slugOwner: MILK_GROUP,
    unitFamilies: FAMILIES,
  });
  assert.ok(codes(issues).includes('SLUG_TAKEN'));
  assert.match(issues[0].detail, /leche-semidesnatada/);
});

test('an invalid slug is not also reported as taken', () => {
  const issues = validateDecision({
    decision: proposal({ group: { slug: 'Leche Semi' } }),
    item: MILK,
    slugOwner: MILK_GROUP,
    unitFamilies: FAMILIES,
  });
  assert.deepEqual(codes(issues), ['SLUG_INVALID']);
});

test('a proposal a searched group already answers to is GROUP_DUPLICATE', () => {
  const issues = validateDecision({
    decision: proposal({
      group: { slug: 'leche-semi', nameEs: 'Leche semi' },
    }),
    item: MILK,
    neighbours: [MILK_GROUP],
    unitFamilies: FAMILIES,
  });
  assert.deepEqual(codes(issues), ['GROUP_DUPLICATE']);
  assert.match(issues[0].detail, /leche semi.*leche-semidesnatada/);
});

test('a duplicate is reported once, whatever the search answered', () => {
  const issues = validateDecision({
    decision: proposal(),
    item: MILK,
    neighbours: [MILK_GROUP, { ...MILK_GROUP, id: 'g2', slug: 'leche-semi-2' }],
    unitFamilies: FAMILIES,
  });
  assert.deepEqual(codes(issues), ['GROUP_DUPLICATE']);
});

test('a group a search merely ranked is no reason to refuse a new one', () => {
  const issues = validateDecision({
    decision: proposal({
      group: {
        nameEs: 'Leche entera',
        nameEn: 'Whole milk',
        slug: 'leche-entera',
      },
    }),
    item: MILK,
    neighbours: [MILK_GROUP],
    unitFamilies: FAMILIES,
  });
  assert.deepEqual(issues, []);
});

test('a reference unit in another family than the product is refused', () => {
  const issues = validateDecision({
    decision: proposal({ group: { referenceUnit: 'KILOGRAM' } }),
    item: MILK,
    unitFamilies: FAMILIES,
  });
  assert.deepEqual(codes(issues), ['UNIT_FAMILY_MISMATCH']);
});

test('the threshold is the one the prompt states', () => {
  assert.equal(CONFIDENCE_THRESHOLD, 0.9);
});
