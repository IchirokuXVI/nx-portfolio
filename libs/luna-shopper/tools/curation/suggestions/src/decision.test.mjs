import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  checkDecisionShape,
  issue,
  retryableIssues,
  sharedEanIssue,
  validateDecision,
} from './decision.mjs';
import { indexBrands } from './rules.mjs';

const CATEGORIES = ['DAIRY', 'PANTRY', 'OTHER'];
const UNITS = ['UNIT', 'LITER', 'GRAM'];

const MERCADONA = { id: 'sm-1', name: { es: 'Mercadona', en: 'Mercadona' } };
const EL_JAMON = { id: 'sm-2', name: { es: 'El Jamón', en: 'El Jamón' } };
const SUPERMARKETS = [MERCADONA, EL_JAMON];

/**
 * The registry as `start` snapshotted it.
 *
 * One house label, one free brand, one spelling linked to a brand of its own
 * and one spelling linked to the house label (plan 0005). A linked row carries
 * no chain, which is what the backend writes when a person links one.
 */
const BRANDS = indexBrands([
  {
    id: 'b-hacendado',
    key: 'hacendado',
    label: 'Hacendado',
    privateLabelSupermarketId: 'sm-1',
  },
  {
    id: 'b-carbonell',
    key: 'carbonell',
    label: 'Carbonell',
    privateLabelSupermarketId: null,
  },
  {
    id: 'b-deborah',
    key: 'deborah',
    label: 'Deborah',
    privateLabelSupermarketId: null,
    canonicalBrandId: null,
  },
  {
    id: 'b-deborah-48h',
    key: 'deborah48h',
    label: 'DEBORAH 48H',
    privateLabelSupermarketId: null,
    canonicalBrandId: 'b-deborah',
  },
  {
    id: 'b-hacendado-plus',
    key: 'hacendadoproteinas',
    label: 'Hacendado +Proteínas',
    privateLabelSupermarketId: null,
    canonicalBrandId: 'b-hacendado',
  },
]);

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
      brands: BRANDS,
      supermarkets: SUPERMARKETS,
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
      brands: BRANDS,
      supermarkets: SUPERMARKETS,
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
    brands: BRANDS,
    supermarkets: SUPERMARKETS,
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
    brands: BRANDS,
    supermarkets: SUPERMARKETS,
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
      brands: BRANDS,
      supermarkets: SUPERMARKETS,
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
      brands: BRANDS,
      supermarkets: SUPERMARKETS,
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
      brands: BRANDS,
      supermarkets: SUPERMARKETS,
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
        brands: BRANDS,
        supermarkets: SUPERMARKETS,
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
        brands: BRANDS,
        supermarkets: SUPERMARKETS,
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
    brands: BRANDS,
    supermarkets: SUPERMARKETS,
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
    brands: BRANDS,
    supermarkets: SUPERMARKETS,
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
    brands: BRANDS,
    supermarkets: SUPERMARKETS,
    categories: CATEGORIES,
    units: UNITS,
  });
  assert.ok(codes(onCreate).includes('PRIVATE_LABEL_CROSSES_CHAIN'));

  const onLink = validateDecision({
    decision: linkDecision(),
    entry: { ...ENTRY, supermarketId: 'sm-2' },
    supermarket: EL_JAMON,
    linkTarget: { id: 'i1', brand: 'Hacendado', unitSize: 1 },
    brands: BRANDS,
    supermarkets: SUPERMARKETS,
    categories: CATEGORIES,
    units: UNITS,
  });
  assert.ok(codes(onLink).includes('PRIVATE_LABEL_CROSSES_CHAIN'));
});

test('BRAND_UNREGISTERED fires on a CREATE the registry cannot place', () => {
  const issues = validateDecision({
    decision: createDecision(goodItem({ brand: '+Proteínas' })),
    entry: ENTRY,
    supermarket: MERCADONA,
    brands: BRANDS,
    supermarkets: SUPERMARKETS,
    categories: CATEGORIES,
    units: UNITS,
  });
  const found = issues.find((i) => i.code === 'BRAND_UNREGISTERED');
  assert.ok(found);
  assert.match(found.detail, /\+Proteínas/);
  // `end` counts the run's unregistered brands off these two fields rather
  // than off the sentence.
  assert.equal(found.brand, '+Proteínas');
  assert.equal(found.brandKey, 'proteinas');
});

test('BRAND_UNREGISTERED leaves a LINK and a null brand alone', () => {
  const onLink = validateDecision({
    decision: linkDecision(),
    entry: ENTRY,
    supermarket: MERCADONA,
    linkTarget: { id: 'i1', brand: '+Proteínas', unitSize: 1 },
    brands: BRANDS,
    supermarkets: SUPERMARKETS,
    categories: CATEGORIES,
    units: UNITS,
  });
  assert.ok(!codes(onLink).includes('BRAND_UNREGISTERED'));

  // A product with no brand is a real product, and null is a real answer.
  const noBrand = validateDecision({
    decision: createDecision(goodItem({ brand: null })),
    entry: ENTRY,
    supermarket: MERCADONA,
    brands: BRANDS,
    supermarkets: SUPERMARKETS,
    categories: CATEGORIES,
    units: UNITS,
  });
  assert.deepEqual(noBrand, []);
});

test('BRAND_UNREGISTERED is quiet on a registered key in another spelling', () => {
  // Catalog stores the registered label whatever spelling the request sent
  // (plan 0115 section 4), so a spelling difference is never a person's time.
  const issues = validateDecision({
    decision: createDecision(goodItem({ brand: 'HACENDADO' })),
    entry: ENTRY,
    supermarket: MERCADONA,
    brands: BRANDS,
    supermarkets: SUPERMARKETS,
    categories: CATEGORIES,
    units: UNITS,
  });
  assert.deepEqual(issues, []);
});

test('BRAND_DIFFERS_FROM_SOURCE fires for another brand and for null', () => {
  const source = { ...ENTRY, brand: 'Hacendado' };

  const other = validateDecision({
    decision: createDecision(goodItem({ brand: 'Carbonell' })),
    entry: source,
    supermarket: MERCADONA,
    brands: BRANDS,
    supermarkets: SUPERMARKETS,
    categories: CATEGORIES,
    units: UNITS,
  });
  const found = other.find((i) => i.code === 'BRAND_DIFFERS_FROM_SOURCE');
  assert.ok(found);
  assert.match(found.detail, /Hacendado/);
  assert.match(found.detail, /Carbonell/);

  const dropped = validateDecision({
    decision: createDecision(goodItem({ brand: null })),
    entry: source,
    supermarket: MERCADONA,
    brands: BRANDS,
    supermarkets: SUPERMARKETS,
    categories: CATEGORIES,
    units: UNITS,
  });
  assert.ok(codes(dropped).includes('BRAND_DIFFERS_FROM_SOURCE'));
});

test('BRAND_DIFFERS_FROM_SOURCE is quiet when the chain prints no registered brand', () => {
  const issues = validateDecision({
    decision: createDecision(goodItem({ brand: 'Hacendado' })),
    entry: { ...ENTRY, brand: 'A range name' },
    supermarket: MERCADONA,
    brands: BRANDS,
    supermarkets: SUPERMARKETS,
    categories: CATEGORIES,
    units: UNITS,
  });
  assert.deepEqual(issues, []);
});

test('neither brand code is retryable', () => {
  assert.deepEqual(
    retryableIssues([
      issue('BRAND_UNREGISTERED', 'x'),
      issue('BRAND_DIFFERS_FROM_SOURCE', 'y'),
    ]),
    []
  );
});

// ---------------------------------------------------------------------------
// A brand registered as a spelling of another one (plan 0005)
// ---------------------------------------------------------------------------

test('BRAND_IS_LINKED fires on a CREATE writing a registered spelling', () => {
  const issues = validateDecision({
    decision: createDecision(goodItem({ brand: 'DEBORAH 48H' })),
    entry: ENTRY,
    supermarket: MERCADONA,
    brands: BRANDS,
    supermarkets: SUPERMARKETS,
    categories: CATEGORIES,
    units: UNITS,
  });

  const found = issues.find((i) => i.code === 'BRAND_IS_LINKED');
  assert.ok(found);
  // The detail is the whole of what the model is told on the retry, so it
  // names the brand to write and says the name may change with it.
  assert.match(found.detail, /"DEBORAH 48H" is registered as a spelling of/);
  assert.match(found.detail, /so the brand is "Deborah"/);
  assert.match(found.detail, /belongs in the name, not in the brand/);
  // A linked brand is a registered brand, so the other code never fires for it.
  assert.ok(!codes(issues).includes('BRAND_UNREGISTERED'));
});

test('BRAND_IS_LINKED is quiet on the brand the spelling names', () => {
  const issues = validateDecision({
    decision: createDecision(goodItem({ brand: 'Deborah' })),
    entry: ENTRY,
    supermarket: MERCADONA,
    brands: BRANDS,
    supermarkets: SUPERMARKETS,
    categories: CATEGORIES,
    units: UNITS,
  });
  assert.deepEqual(issues, []);
});

test('BRAND_IS_LINKED leaves a LINK and an unregistered brand alone', () => {
  const onLink = validateDecision({
    decision: linkDecision(),
    entry: ENTRY,
    supermarket: MERCADONA,
    linkTarget: { id: 'i1', brand: 'DEBORAH 48H', unitSize: 1 },
    brands: BRANDS,
    supermarkets: SUPERMARKETS,
    categories: CATEGORIES,
    units: UNITS,
  });
  assert.ok(!codes(onLink).includes('BRAND_IS_LINKED'));

  const unregistered = validateDecision({
    decision: createDecision(goodItem({ brand: 'Deborah 72H' })),
    entry: ENTRY,
    supermarket: MERCADONA,
    brands: BRANDS,
    supermarkets: SUPERMARKETS,
    categories: CATEGORIES,
    units: UNITS,
  });
  assert.ok(!codes(unregistered).includes('BRAND_IS_LINKED'));
  assert.ok(codes(unregistered).includes('BRAND_UNREGISTERED'));
});

test('BRAND_IS_LINKED is the second issue worth asking a row about again', () => {
  // The retry carries the correct brand, which the first attempt was not told
  // in a sentence it had to read. That makes it a different question rather
  // than the same one, which is the whole test of a retryable code.
  assert.deepEqual(
    retryableIssues([issue('BRAND_IS_LINKED', 'x')]).map((i) => i.code),
    ['BRAND_IS_LINKED']
  );
});

test('BRAND_DIFFERS_FROM_SOURCE compares the brands the spellings name', () => {
  // The chain prints `DEBORAH 48H` and the decision writes `Deborah`, which is
  // the answer the packet asked for. Two spellings of one brand do not differ.
  const issues = validateDecision({
    decision: createDecision(goodItem({ brand: 'Deborah' })),
    entry: { ...ENTRY, brand: 'DEBORAH 48H' },
    supermarket: MERCADONA,
    brands: BRANDS,
    supermarkets: SUPERMARKETS,
    categories: CATEGORIES,
    units: UNITS,
  });
  assert.deepEqual(issues, []);

  // And it still fires on a brand that is neither.
  const other = validateDecision({
    decision: createDecision(goodItem({ brand: 'Carbonell' })),
    entry: { ...ENTRY, brand: 'DEBORAH 48H' },
    supermarket: MERCADONA,
    brands: BRANDS,
    supermarkets: SUPERMARKETS,
    categories: CATEGORIES,
    units: UNITS,
  });
  assert.ok(codes(other).includes('BRAND_DIFFERS_FROM_SOURCE'));
});

test('rule 6 reads the chain through the link, on a CREATE and on a LINK', () => {
  // `Hacendado +Proteínas` is a spelling of Mercadona's house label and owns no
  // chain of its own, so reading the chain off the row the spelling names
  // would walk straight past the hard stop.
  const onCreate = validateDecision({
    decision: createDecision(goodItem({ brand: 'Hacendado +Proteínas' })),
    entry: { ...ENTRY, supermarketId: 'sm-2' },
    supermarket: EL_JAMON,
    brands: BRANDS,
    supermarkets: SUPERMARKETS,
    categories: CATEGORIES,
    units: UNITS,
  });
  const found = onCreate.find((i) => i.code === 'PRIVATE_LABEL_CROSSES_CHAIN');
  assert.ok(found);
  assert.match(found.detail, /"Hacendado" is Mercadona's own label/);

  const onLink = validateDecision({
    decision: linkDecision(),
    entry: { ...ENTRY, supermarketId: 'sm-2' },
    supermarket: EL_JAMON,
    linkTarget: { id: 'i1', brand: 'Hacendado +Proteínas', unitSize: 1 },
    brands: BRANDS,
    supermarkets: SUPERMARKETS,
    categories: CATEGORIES,
    units: UNITS,
  });
  assert.ok(codes(onLink).includes('PRIVATE_LABEL_CROSSES_CHAIN'));

  // And it is quiet on the chain that owns the label it is a spelling of.
  const ownChain = validateDecision({
    decision: createDecision(goodItem({ brand: 'Hacendado +Proteínas' })),
    entry: ENTRY,
    supermarket: MERCADONA,
    brands: BRANDS,
    supermarkets: SUPERMARKETS,
    categories: CATEGORIES,
    units: UNITS,
  });
  assert.ok(!codes(ownChain).includes('PRIVATE_LABEL_CROSSES_CHAIN'));
});

test('a private label stays quiet on its own chain', () => {
  const issues = validateDecision({
    decision: createDecision(),
    entry: ENTRY,
    supermarket: MERCADONA,
    brands: BRANDS,
    supermarkets: SUPERMARKETS,
    categories: CATEGORIES,
    units: UNITS,
  });
  assert.deepEqual(issues, []);
});

test('the private label comparison is by chain id, not by chain name', () => {
  // The chain's name is not what the registry declares. A supermarket list
  // that spells the chain differently, or does not hold it at all, changes
  // nothing about who owns the brand.
  const issues = validateDecision({
    decision: createDecision(),
    entry: { ...ENTRY, supermarketId: 'sm-2' },
    supermarket: { id: 'sm-2', name: { es: 'MERCADONA S.A.' } },
    brands: BRANDS,
    supermarkets: [],
    categories: CATEGORIES,
    units: UNITS,
  });
  assert.ok(codes(issues).includes('PRIVATE_LABEL_CROSSES_CHAIN'));
});

// ---------------------------------------------------------------------------
// Plan 0006: formats in base units, a target nobody was shown, shared EANs
// ---------------------------------------------------------------------------

function linkIssues(entry, linkTarget) {
  return codes(
    validateDecision({
      decision: linkDecision(),
      entry: { ...ENTRY, ...entry },
      supermarket: MERCADONA,
      linkTarget: { id: 'i1', ...linkTarget },
      categories: CATEGORIES,
      units: UNITS,
    })
  );
}

test('FORMAT_MISMATCH reads 420 g and 0.42 kg as one format', () => {
  // Row 173 of the plan 0150 walk: Mercadona prints the unit alone and states
  // the number in kilograms, and the catalog product was created in grams.
  assert.deepEqual(
    linkIssues(
      { unitSize: 0.42, sizeFormat: 'kg' },
      { unitSize: 420, defaultUnit: 'GRAM' }
    ),
    []
  );
  // The other way round, and with the size printed whole.
  assert.deepEqual(
    linkIssues(
      { unitSize: 420, sizeFormat: '420 g' },
      { unitSize: 0.42, defaultUnit: 'KILOGRAM' }
    ),
    []
  );
  assert.deepEqual(
    linkIssues(
      { unitSize: 1.5, sizeFormat: 'l' },
      { unitSize: 1500, defaultUnit: 'MILLILITER' }
    ),
    []
  );
  // Centilitres are millilitres times ten.
  assert.deepEqual(
    linkIssues(
      { unitSize: 33, sizeFormat: '33 cl' },
      { unitSize: 330, defaultUnit: 'MILLILITER' }
    ),
    []
  );
});

test('FORMAT_MISMATCH still fires on a different size once converted', () => {
  const found = validateDecision({
    decision: linkDecision(),
    entry: { ...ENTRY, unitSize: 0.5, sizeFormat: 'kg' },
    supermarket: MERCADONA,
    linkTarget: { id: 'i1', unitSize: 420, defaultUnit: 'GRAM' },
    categories: CATEGORIES,
    units: UNITS,
  });
  assert.ok(codes(found).includes('FORMAT_MISMATCH'));
  // The detail names both units, which is what the reviewer has to see.
  assert.match(
    found.find((entry) => entry.code === 'FORMAT_MISMATCH').detail,
    /0\.5 kg.*420 GRAM/
  );
});

test('FORMAT_MISMATCH never reads a weight as a volume', () => {
  assert.ok(
    linkIssues(
      { unitSize: 1, sizeFormat: 'kg' },
      { unitSize: 1, defaultUnit: 'LITER' }
    ).includes('FORMAT_MISMATCH')
  );
});

test('FORMAT_MISMATCH compares the numbers when a unit cannot be read', () => {
  // `m` is metres, which the catalog has no unit for.
  assert.ok(
    linkIssues(
      { unitSize: 0.42, sizeFormat: 'm' },
      { unitSize: 420, defaultUnit: 'GRAM' }
    ).includes('FORMAT_MISMATCH')
  );
  assert.deepEqual(
    linkIssues(
      { unitSize: 30, sizeFormat: 'm' },
      { unitSize: 30, defaultUnit: 'UNIT' }
    ),
    []
  );
});

test('LINK_TARGET_NOT_SHOWN fires in place of LINK_TARGET_MISSING', () => {
  const found = validateDecision({
    decision: linkDecision('i-real'),
    entry: ENTRY,
    supermarket: MERCADONA,
    // A real product the caller could have fetched. It still was not shown.
    linkTarget: null,
    linkTargetShown: false,
    categories: CATEGORIES,
    units: UNITS,
  });
  assert.deepEqual(codes(found), ['LINK_TARGET_NOT_SHOWN']);
  assert.match(found[0].detail, /i-real was not among the candidates/);
});

test('LINK_TARGET_NOT_SHOWN is worth asking the same row about again', () => {
  assert.deepEqual(
    retryableIssues([
      issue('LINK_TARGET_NOT_SHOWN', 'not shown'),
      issue('LINK_TARGET_MISSING', 'gone'),
      issue('SHARED_EAN', 'shared'),
    ]).map((entry) => entry.code),
    ['LINK_TARGET_NOT_SHOWN']
  );
});

test('SHARED_EAN names the barcode and the other entries, and only when shared', () => {
  const found = sharedEanIssue({ ...ENTRY, ean: '8480000000017' }, [
    'e3',
    'e4',
  ]);
  assert.equal(found.code, 'SHARED_EAN');
  assert.match(found.detail, /EAN 8480000000017 .*e3, e4/);
  assert.equal(sharedEanIssue(ENTRY, null), null);
  assert.equal(sharedEanIssue(ENTRY, []), null);
});
