import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  checkDecisionShape,
  issue,
  retryableIssues,
  validateDecision,
} from './decision.mjs';
import { indexPrivateLabels } from './rules.mjs';

const CATEGORIES = ['DAIRY', 'PANTRY', 'OTHER'];
const UNITS = ['UNIT', 'LITER', 'GRAM'];
const LABELS = indexPrivateLabels({ Hacendado: 'Mercadona' });

const MERCADONA = { id: 'sm-1', name: { es: 'Mercadona', en: 'Mercadona' } };
const EL_JAMON = { id: 'sm-2', name: { es: 'El Jamón', en: 'El Jamón' } };

const ENTRY = {
  id: 'e1',
  supermarketId: 'sm-1',
  name: 'Leche entera 1 L',
  brand: null,
  ean: null,
  unitSize: 1,
};

function goodItem(overrides = {}) {
  return {
    nameEs: 'Leche entera',
    nameEn: 'Whole milk',
    brand: 'Hacendado',
    unitSize: 1,
    defaultUnit: 'LITER',
    category: 'DAIRY',
    ean: null,
    ...overrides,
  };
}

function createDecision(item = goodItem()) {
  return {
    decision: 'CREATE',
    itemId: null,
    itemRef: null,
    item,
    confidence: 1,
    issues: [],
    reasoning: '',
  };
}

function linkDecision(itemId = 'i1') {
  return {
    decision: 'LINK',
    itemId,
    itemRef: null,
    item: null,
    confidence: 1,
    issues: [],
    reasoning: '',
  };
}

function codes(issues) {
  return issues.map((entry) => entry.code);
}

// ---------------------------------------------------------------------------
// The schema check
// ---------------------------------------------------------------------------

test('the schema check refuses what it cannot act on', () => {
  assert.match(checkDecisionShape(null).error, /not a JSON object/);
  assert.match(checkDecisionShape([]).error, /not a JSON object/);
  assert.match(
    checkDecisionShape({ decision: 'MAYBE' }).error,
    /must be one of/
  );
  assert.match(
    checkDecisionShape({ decision: 'REVIEW', confidence: 'high' }).error,
    /"confidence" must be a number/
  );
  assert.match(
    checkDecisionShape({ decision: 'REVIEW', confidence: 2 }).error,
    /between 0 and 1/
  );
  assert.match(
    checkDecisionShape({ decision: 'LINK', confidence: 1 }).error,
    /needs an "itemId" or an "itemRef"/
  );
  assert.match(
    checkDecisionShape({ decision: 'CREATE', confidence: 1 }).error,
    /needs an "item" object/
  );
  assert.match(
    checkDecisionShape({ decision: 'CREATE', confidence: 1, item: {} }).error,
    /needs "item.nameEs"/
  );
  assert.match(
    checkDecisionShape({
      decision: 'CREATE',
      confidence: 1,
      item: {
        nameEs: 'Leche',
        category: 'DAIRY',
        defaultUnit: 'LITER',
        unitSize: '1',
      },
    }).error,
    /"item.unitSize" must be a number or null/
  );
});

test('a LINK may name a run created product by ref', () => {
  const checked = checkDecisionShape({
    decision: 'LINK',
    itemRef: 'ref-e1',
    confidence: 0.95,
  });
  assert.equal(checked.ok, true);
  assert.equal(checked.decision.itemRef, 'ref-e1');
  assert.equal(checked.decision.itemId, null);
});

test('the schema check normalizes what it accepts', () => {
  const checked = checkDecisionShape({
    decision: 'CREATE',
    confidence: 0.95,
    item: {
      nameEs: '  Leche entera  ',
      nameEn: '',
      brand: '  Hacendado ',
      category: ' DAIRY ',
      defaultUnit: ' LITER ',
    },
    issues: ['a bare string note', { code: 'X', detail: 'y' }, 42],
    reasoning: '  because  ',
  });
  assert.equal(checked.ok, true);
  assert.equal(checked.decision.item.nameEs, 'Leche entera');
  assert.equal(checked.decision.item.nameEn, null);
  assert.equal(checked.decision.item.brand, 'Hacendado');
  assert.equal(checked.decision.item.unitSize, null);
  assert.equal(checked.decision.reasoning, 'because');
  assert.deepEqual(checked.decision.issues, [
    { code: 'MODEL_NOTE', detail: 'a bare string note' },
    { code: 'X', detail: 'y' },
  ]);
});

// ---------------------------------------------------------------------------
// The validators
// ---------------------------------------------------------------------------

test('a clean CREATE and a clean LINK raise nothing', () => {
  assert.deepEqual(
    validateDecision({
      decision: createDecision(),
      entry: ENTRY,
      supermarket: MERCADONA,
      privateLabels: LABELS,
      categories: CATEGORIES,
      units: UNITS,
    }),
    []
  );
  assert.deepEqual(
    validateDecision({
      decision: linkDecision(),
      entry: ENTRY,
      supermarket: MERCADONA,
      linkTarget: { id: 'i1', brand: 'Hacendado', unitSize: 1, ean: null },
      privateLabels: LABELS,
      categories: CATEGORIES,
      units: UNITS,
    }),
    []
  );
});

test('CHAIN_NOT_REGISTERED fires when no catalog supermarket answers', () => {
  const issues = validateDecision({
    decision: createDecision(),
    entry: ENTRY,
    supermarket: null,
    categories: CATEGORIES,
    units: UNITS,
  });
  assert.ok(codes(issues).includes('CHAIN_NOT_REGISTERED'));
});

test('NAME_CARRIES_BRAND fires on a name holding its brand', () => {
  const issues = validateDecision({
    decision: createDecision(goodItem({ nameEs: 'Leche Hacendado entera' })),
    entry: ENTRY,
    supermarket: MERCADONA,
    privateLabels: LABELS,
    categories: CATEGORIES,
    units: UNITS,
  });
  assert.ok(codes(issues).includes('NAME_CARRIES_BRAND'));
});

test('NAME_CARRIES_SIZE fires on a name holding its size', () => {
  const issues = validateDecision({
    decision: createDecision(goodItem({ nameEs: 'Leche entera 1 L' })),
    entry: ENTRY,
    supermarket: MERCADONA,
    privateLabels: LABELS,
    categories: CATEGORIES,
    units: UNITS,
  });
  assert.ok(codes(issues).includes('NAME_CARRIES_SIZE'));
});

test('NAME_GLITCH fires on a digit wedged inside a word, on either name', () => {
  // The measured shape of the defect: one token of a local model's generation
  // goes wrong and the rest of the decision is perfectly good.
  for (const item of [
    goodItem({ nameEs: 'May1onesa' }),
    goodItem({ nameEn: 'Straw1berry yoghurt' }),
    goodItem({ nameEs: 'Beb1ida de avena' }),
  ]) {
    const issues = validateDecision({
      decision: createDecision(item),
      entry: ENTRY,
      supermarket: MERCADONA,
      privateLabels: LABELS,
      categories: CATEGORIES,
      units: UNITS,
    });
    assert.ok(codes(issues).includes('NAME_GLITCH'), item.nameEs);
  }
});

test('NAME_GLITCH leaves a real name alone, digit or no digit', () => {
  for (const name of [
    'Leche entera',
    'Agua H2O',
    'Omega 3',
    'Vitamina B12',
    'Yogur 0% M.G.',
    'Refresco de cola zero',
    // The shade code is the whole of what tells two shades of one line apart.
    'Corrector Terracotta n4N',
    'Sombra dúo Monochrome n30',
  ]) {
    const issues = validateDecision({
      decision: createDecision(goodItem({ nameEs: name, nameEn: null })),
      entry: ENTRY,
      supermarket: MERCADONA,
      privateLabels: LABELS,
      categories: CATEGORIES,
      units: UNITS,
    });
    assert.equal(codes(issues).includes('NAME_GLITCH'), false, name);
  }
});

test('NAME_GLITCH is the one issue worth asking the same row about again', () => {
  // Every other validator reports a judgment the model stands by, and asking
  // again would get the same answer.
  assert.deepEqual(
    retryableIssues([
      issue('NAME_GLITCH', 'nameEs "May1onesa" has a digit inside a word.'),
      issue('NAME_CARRIES_SIZE', 'it states a size'),
      issue('FORMAT_MISMATCH', 'one litre against one and a half'),
    ]).map((entry) => entry.code),
    ['NAME_GLITCH']
  );
  assert.deepEqual(retryableIssues([]), []);
  assert.deepEqual(retryableIssues(undefined), []);
});

test('SIZELESS_CREATE fires on a CREATE with no size, from a local model only', () => {
  const sizeless = createDecision(
    goodItem({ nameEs: 'Sombra dúo Monochrome n30', unitSize: null })
  );
  const validate = (local) =>
    validateDecision({
      decision: sizeless,
      entry: { ...ENTRY, name: 'Sombra dúo Monochrome n30', unitSize: null },
      supermarket: MERCADONA,
      privateLabels: LABELS,
      categories: CATEGORIES,
      units: UNITS,
      local,
    });

  const flagged = validate(true);
  assert.ok(codes(flagged).includes('SIZELESS_CREATE'));
  // The detail names the product, because the row an operator is handed is
  // read on its name and not on its entry id.
  assert.match(
    flagged.find((entry) => entry.code === 'SIZELESS_CREATE').detail,
    /Sombra dúo Monochrome n30/
  );

  // The same decision from a Claude model stands. Twenty seven of eighty
  // SuperCash rows carry no printed size, and sonnet is trusted to have meant
  // the ones it creates.
  assert.deepEqual(validate(false), []);
});

test('SIZELESS_CREATE leaves a CREATE that states a size alone, local or not', () => {
  // Zero is a size the model measured, not a size it could not find, and only
  // null says the second thing.
  for (const unitSize of [1, 0, 750]) {
    for (const local of [true, false]) {
      const issues = validateDecision({
        decision: createDecision(goodItem({ unitSize })),
        entry: ENTRY,
        supermarket: MERCADONA,
        privateLabels: LABELS,
        categories: CATEGORIES,
        units: UNITS,
        local,
      });
      assert.equal(
        codes(issues).includes('SIZELESS_CREATE'),
        false,
        `${unitSize} local=${local}`
      );
    }
  }
});

test('SIZELESS_CREATE says nothing about a LINK, sizeless target or not', () => {
  for (const unitSize of [null, 1]) {
    for (const local of [true, false]) {
      const issues = validateDecision({
        decision: linkDecision('i1'),
        entry: { ...ENTRY, unitSize: null },
        supermarket: MERCADONA,
        linkTarget: { id: 'i1', brand: null, ean: null, unitSize },
        privateLabels: LABELS,
        categories: CATEGORIES,
        units: UNITS,
        local,
      });
      assert.equal(
        codes(issues).includes('SIZELESS_CREATE'),
        false,
        `${unitSize} local=${local}`
      );
    }
  }
});

test('SIZELESS_CREATE is a judgment the model stands by, so it is not retryable', () => {
  // The model is applying the rule the prompt gave it, so the same row asked
  // again comes back the same. It goes to a person instead.
  assert.deepEqual(
    retryableIssues([
      issue('SIZELESS_CREATE', '"Corrector Terracotta n4N" has no size.'),
    ]),
    []
  );
});

test('UNKNOWN_CATEGORY and UNKNOWN_UNIT fire outside the openapi vocabularies', () => {
  const issues = validateDecision({
    decision: createDecision(
      goodItem({ category: 'CHEESE', defaultUnit: 'BOTTLE' })
    ),
    entry: ENTRY,
    supermarket: MERCADONA,
    privateLabels: LABELS,
    categories: CATEGORIES,
    units: UNITS,
  });
  assert.ok(codes(issues).includes('UNKNOWN_CATEGORY'));
  assert.ok(codes(issues).includes('UNKNOWN_UNIT'));
});

test('EAN_CONFLICT fires when a CREATE would duplicate a barcode', () => {
  const issues = validateDecision({
    decision: createDecision(goodItem({ ean: '8410000000001' })),
    entry: ENTRY,
    supermarket: MERCADONA,
    eanOwner: { id: 'i9' },
    privateLabels: LABELS,
    categories: CATEGORIES,
    units: UNITS,
  });
  assert.ok(codes(issues).includes('EAN_CONFLICT'));
});

test('EAN_CONFLICT fires when a LINK target carries another barcode', () => {
  const issues = validateDecision({
    decision: linkDecision(),
    entry: { ...ENTRY, ean: '8410000000001' },
    supermarket: MERCADONA,
    linkTarget: { id: 'i1', ean: '8410000000002', unitSize: 1 },
    categories: CATEGORIES,
    units: UNITS,
  });
  assert.ok(codes(issues).includes('EAN_CONFLICT'));
});

test('FORMAT_MISMATCH fires when the entry and the item are different sizes', () => {
  const issues = validateDecision({
    decision: linkDecision(),
    entry: ENTRY,
    supermarket: MERCADONA,
    linkTarget: { id: 'i1', unitSize: 1.5 },
    categories: CATEGORIES,
    units: UNITS,
  });
  assert.ok(codes(issues).includes('FORMAT_MISMATCH'));
});

test('LINK_TARGET_MISSING fires when catalog holds no such item', () => {
  const issues = validateDecision({
    decision: linkDecision('nope'),
    entry: ENTRY,
    supermarket: MERCADONA,
    linkTarget: null,
    categories: CATEGORIES,
    units: UNITS,
  });
  assert.ok(codes(issues).includes('LINK_TARGET_MISSING'));
});

test('LINK_TARGET_MISSING names a ref when the decision named one', () => {
  const issues = validateDecision({
    decision: {
      decision: 'LINK',
      itemId: null,
      itemRef: 'ref-e9',
      item: null,
      confidence: 1,
      issues: [],
      reasoning: '',
    },
    entry: ENTRY,
    supermarket: MERCADONA,
    linkTarget: null,
    categories: CATEGORIES,
    units: UNITS,
  });
  assert.match(
    issues.find((i) => i.code === 'LINK_TARGET_MISSING').detail,
    /ref-e9/
  );
});

test('PRIVATE_LABEL_CROSSES_CHAIN fires on a CREATE and on a LINK', () => {
  const onCreate = validateDecision({
    decision: createDecision(),
    entry: { ...ENTRY, supermarketId: 'sm-2' },
    supermarket: EL_JAMON,
    privateLabels: LABELS,
    categories: CATEGORIES,
    units: UNITS,
  });
  assert.ok(codes(onCreate).includes('PRIVATE_LABEL_CROSSES_CHAIN'));

  const onLink = validateDecision({
    decision: linkDecision(),
    entry: { ...ENTRY, supermarketId: 'sm-2' },
    supermarket: EL_JAMON,
    linkTarget: { id: 'i1', brand: 'Hacendado', unitSize: 1 },
    privateLabels: LABELS,
    categories: CATEGORIES,
    units: UNITS,
  });
  assert.ok(codes(onLink).includes('PRIVATE_LABEL_CROSSES_CHAIN'));
});

test('a private label stays quiet on its own chain', () => {
  const issues = validateDecision({
    decision: createDecision(),
    entry: ENTRY,
    supermarket: MERCADONA,
    privateLabels: LABELS,
    categories: CATEGORIES,
    units: UNITS,
  });
  assert.deepEqual(issues, []);
});
