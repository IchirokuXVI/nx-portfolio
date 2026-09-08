import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkDecisionShape, validateDecision } from './decision.mjs';
import { deriveUnitFamilies } from './rules.mjs';
import { TEST_UNITS } from './test-fakes.mjs';

const FAMILIES = deriveUnitFamilies(TEST_UNITS);

const MILK = {
  id: 'i1',
  name: { es: 'Leche semidesnatada', en: 'Semi-skimmed milk' },
  defaultUnit: 'LITER',
};

const GROUP = {
  id: 'g1',
  name: { es: 'Leche semidesnatada', en: 'Semi-skimmed milk' },
  slug: 'leche-semidesnatada',
  referenceUnit: 'LITER',
  synonyms: { es: ['leche semi'], en: [] },
};

function createGroup(overrides = {}) {
  return {
    decision: 'CREATE_GROUP',
    confidence: 0.95,
    group: {
      nameEs: 'Aceite de oliva',
      nameEn: 'Olive oil',
      slug: 'aceite-de-oliva',
      referenceUnit: 'LITER',
      synonyms: { es: [], en: [] },
      ...overrides,
    },
  };
}

// ---------------------------------------------------------------------------
// The shape
// ---------------------------------------------------------------------------

test('a reply that is not an object is not a decision', () => {
  for (const value of [null, 'ASSIGN', 42, ['ASSIGN']]) {
    assert.equal(checkDecisionShape(value).ok, false);
  }
});

test('the decision word must be one of the three', () => {
  const answer = checkDecisionShape({ decision: 'LINK', confidence: 1 });
  assert.equal(answer.ok, false);
  assert.match(answer.error, /ASSIGN, CREATE_GROUP, REVIEW/);
});

test('confidence must be a number between zero and one', () => {
  assert.equal(
    checkDecisionShape({ decision: 'REVIEW', confidence: 'high' }).ok,
    false
  );
  assert.equal(
    checkDecisionShape({ decision: 'REVIEW', confidence: 1.5 }).ok,
    false
  );
});

/** The one shape change the split forced: a run created group has no id yet. */
test('an ASSIGN takes a groupId or a groupRef and needs one of them', () => {
  const byId = checkDecisionShape({
    decision: 'ASSIGN',
    groupId: 'g1',
    confidence: 1,
  });
  assert.equal(byId.ok, true);
  assert.equal(byId.decision.groupId, 'g1');
  assert.equal(byId.decision.groupRef, null);

  const byRef = checkDecisionShape({
    decision: 'ASSIGN',
    groupRef: 'ref-i1',
    confidence: 1,
  });
  assert.equal(byRef.ok, true);
  assert.equal(byRef.decision.groupRef, 'ref-i1');
  assert.equal(byRef.decision.groupId, null);

  const neither = checkDecisionShape({ decision: 'ASSIGN', confidence: 1 });
  assert.equal(neither.ok, false);
  assert.match(neither.error, /"groupId" or a "groupRef"/);
});

test('a CREATE_GROUP needs every field of its group', () => {
  assert.match(
    checkDecisionShape({ decision: 'CREATE_GROUP', confidence: 1 }).error,
    /"group" object/
  );
  for (const field of ['nameEs', 'nameEn', 'slug', 'referenceUnit']) {
    const proposal = createGroup();
    delete proposal.group[field];
    const answer = checkDecisionShape({ ...proposal, confidence: 1 });
    assert.equal(answer.ok, false, `${field} should be required`);
    assert.match(answer.error, new RegExp(field));
  }
});

test('synonyms must be lists, and missing ones become empty ones', () => {
  const bad = checkDecisionShape(createGroup({ synonyms: { es: 'leche' } }));
  assert.equal(bad.ok, false);
  assert.match(bad.error, /synonyms.es/);

  const good = checkDecisionShape(createGroup({ synonyms: undefined }));
  assert.equal(good.ok, true);
  assert.deepEqual(good.decision.group.synonyms, { es: [], en: [] });
});

test('a bare string issue becomes a note rather than a parse failure', () => {
  const answer = checkDecisionShape({
    decision: 'REVIEW',
    confidence: 0.4,
    issues: ['could be either group'],
  });
  assert.equal(answer.ok, true);
  assert.deepEqual(answer.decision.issues, [
    { code: 'MODEL_NOTE', detail: 'could be either group' },
  ]);
});

// ---------------------------------------------------------------------------
// The validators
// ---------------------------------------------------------------------------

test('GROUP_TARGET_MISSING when nothing answers to the name given', () => {
  const issues = validateDecision({
    decision: { decision: 'ASSIGN', groupId: 'g-nope' },
    item: MILK,
    assignTarget: null,
    unitFamilies: FAMILIES,
  });
  assert.deepEqual(
    issues.map((one) => one.code),
    ['GROUP_TARGET_MISSING']
  );
});

test('an ASSIGN onto a group of another family is a UNIT_FAMILY_MISMATCH', () => {
  const issues = validateDecision({
    decision: { decision: 'ASSIGN', groupId: 'g1' },
    item: MILK,
    assignTarget: { ...GROUP, referenceUnit: 'KILOGRAM' },
    unitFamilies: FAMILIES,
  });
  assert.deepEqual(
    issues.map((one) => one.code),
    ['UNIT_FAMILY_MISMATCH']
  );
});

test('a unit outside the vocabulary is a mismatch and never a crash', () => {
  const issues = validateDecision({
    decision: { decision: 'ASSIGN', groupId: 'g1' },
    item: { ...MILK, defaultUnit: 'FURLONG' },
    assignTarget: GROUP,
    unitFamilies: FAMILIES,
  });
  assert.equal(issues[0].code, 'UNIT_FAMILY_MISMATCH');
  assert.match(issues[0].detail, /FURLONG/);
});

test('a clean ASSIGN answers no issues', () => {
  assert.deepEqual(
    validateDecision({
      decision: { decision: 'ASSIGN', groupId: 'g1' },
      item: MILK,
      assignTarget: GROUP,
      unitFamilies: FAMILIES,
    }),
    []
  );
});

test('SLUG_INVALID on a handle catalog would refuse', () => {
  const issues = validateDecision({
    decision: checkDecisionShape(createGroup({ slug: 'Aceite_De_Oliva' }))
      .decision,
    item: { ...MILK, defaultUnit: 'LITER' },
    known: [],
    unitFamilies: FAMILIES,
  });
  assert.deepEqual(
    issues.map((one) => one.code),
    ['SLUG_INVALID']
  );
});

/** The search answered the collision, which is the change from plan 0099. */
test('SLUG_TAKEN when a group the search found already holds it', () => {
  const issues = validateDecision({
    decision: checkDecisionShape(createGroup({ slug: 'leche-semidesnatada' }))
      .decision,
    item: MILK,
    known: [GROUP],
    unitFamilies: FAMILIES,
  });
  assert.ok(issues.some((one) => one.code === 'SLUG_TAKEN'));
});

test('GROUP_DUPLICATE when a proposed word already names a group', () => {
  const issues = validateDecision({
    decision: checkDecisionShape(
      createGroup({
        nameEs: 'Leche semidesnatada',
        nameEn: 'Semi-skimmed milk',
        slug: 'leche-semi-2',
      })
    ).decision,
    item: MILK,
    known: [GROUP],
    unitFamilies: FAMILIES,
  });
  const duplicate = issues.find((one) => one.code === 'GROUP_DUPLICATE');
  assert.ok(duplicate);
  assert.match(duplicate.detail, /leche-semidesnatada/);
});

test('a synonym is enough to be a duplicate', () => {
  const issues = validateDecision({
    decision: checkDecisionShape(
      createGroup({
        nameEs: 'Otra cosa',
        nameEn: 'Something else',
        slug: 'otra-cosa',
        synonyms: { es: ['leche semi'], en: [] },
      })
    ).decision,
    item: MILK,
    known: [GROUP],
    unitFamilies: FAMILIES,
  });
  assert.ok(issues.some((one) => one.code === 'GROUP_DUPLICATE'));
});

test('a clean CREATE_GROUP against an unrelated catalog answers no issues', () => {
  assert.deepEqual(
    validateDecision({
      decision: checkDecisionShape(createGroup()).decision,
      item: MILK,
      known: [GROUP],
      unitFamilies: FAMILIES,
    }),
    []
  );
});

test('a REVIEW is never validated further', () => {
  assert.deepEqual(
    validateDecision({
      decision: { decision: 'REVIEW' },
      item: MILK,
      known: [GROUP],
      unitFamilies: FAMILIES,
    }),
    []
  );
});
