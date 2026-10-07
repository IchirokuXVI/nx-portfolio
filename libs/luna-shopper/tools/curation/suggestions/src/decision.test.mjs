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

/** Leaf slugs of the category tree (backend plan 0173, appendix A). */
const CATEGORIES = ['milk', 'oils', 'uncategorised'];
const UNITS = ['UNIT', 'LITER', 'GRAM', 'KILOGRAM', 'MILLILITER', 'PACK'];

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
  // One name, two businesses (backend plan 0178): the registered `Poseidon` is
  // a cologne, and `Poseidon Food` is the fish brand El Jamón prints as
  // `Poseidón`.
  {
    id: 'b-poseidon',
    key: 'poseidon',
    label: 'Poseidon',
    privateLabelSupermarketId: null,
    canonicalBrandId: null,
  },
  {
    id: 'b-poseidon-food',
    key: 'poseidonfood',
    label: 'Poseidon Food',
    privateLabelSupermarketId: null,
    canonicalBrandId: null,
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
    // A CREATE is written in a base unit (backend plan 0183).
    unitSize: 1000,
    defaultUnit: 'MILLILITER',
    categorySlugs: ['milk'],
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
        nameEn: 'Milk',
        categorySlugs: ['milk'],
        defaultUnit: 'LITER',
        unitSize: '1',
      },
    }).error,
    /"item.unitSize" must be a number or null/
  );
  // One or more slugs (backend plan 0166): a lone string, an empty list and a
  // list of blanks are all a CREATE with no category.
  for (const categorySlugs of [undefined, 'milk', [], ['  '], [42]]) {
    assert.match(
      checkDecisionShape({
        decision: 'CREATE',
        confidence: 1,
        item: {
          nameEs: 'Leche',
          nameEn: 'Milk',
          categorySlugs,
          defaultUnit: 'LITER',
        },
      }).error,
      /needs "item.categorySlugs", one or more category slugs/,
      JSON.stringify(categorySlugs)
    );
  }
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
      nameEn: '  Whole milk ',
      brand: '  Hacendado ',
      categorySlugs: [' milk ', 'plant-based-drinks-and-horchata', 'milk', ''],
      defaultUnit: ' LITER ',
    },
    issues: ['a bare string note', { code: 'X', detail: 'y' }, 42],
    reasoning: '  because  ',
  });
  assert.equal(checked.ok, true);
  assert.equal(checked.decision.item.nameEs, 'Leche entera');
  // Trimmed, blanks dropped, and a repeat named once, in the order meant.
  assert.deepEqual(checked.decision.item.categorySlugs, [
    'milk',
    'plant-based-drinks-and-horchata',
  ]);
  assert.equal(checked.decision.item.nameEn, 'Whole milk');
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
      decision: createDecision(goodItem({ nameEs: name })),
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

test('UNKNOWN_CATEGORY and UNKNOWN_UNIT fire outside the two vocabularies', () => {
  const issues = validateDecision({
    decision: createDecision(
      // `DAIRY` is the retired enum value and `eggs-milk-and-butter` a root, which
      // holds no product: neither is a leaf slug the tree answered.
      goodItem({
        categorySlugs: ['milk', 'DAIRY', 'eggs-milk-and-butter'],
        defaultUnit: 'BOTTLE',
      })
    ),
    entry: ENTRY,
    supermarket: MERCADONA,
    brands: BRANDS,
    supermarkets: SUPERMARKETS,
    categories: CATEGORIES,
    units: UNITS,
  });
  // One issue per slug the tree does not hold, and none for the one it does.
  assert.deepEqual(
    issues
      .filter((entry) => entry.code === 'UNKNOWN_CATEGORY')
      .map((entry) => entry.detail),
    [
      '"DAIRY" is not a leaf slug of the category tree this run read.',
      '"eggs-milk-and-butter" is not a leaf slug of the category tree this run read.',
    ]
  );
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

/**
 * A salmon loin El Jamón prints `Poseidón` on, as the queue answers it.
 *
 * `brandMatches` is what the gateway composes: the key's own brand, then every
 * brand a homonym points that key at. With no homonym registered it holds the
 * cologne alone.
 */
function salmon(brandMatches) {
  return {
    ...ENTRY,
    supermarketId: 'sm-2',
    name: 'Lomos de salmón 250 g',
    brand: 'Poseidón',
    brandMatches,
  };
}
const POSEIDON_MATCH = {
  brandId: 'b-poseidon',
  key: 'poseidon',
  label: 'Poseidon',
  privateLabelSupermarketId: null,
  printedAs: null,
};
const POSEIDON_FOOD_MATCH = {
  brandId: 'b-poseidon-food',
  key: 'poseidonfood',
  label: 'Poseidon Food',
  privateLabelSupermarketId: null,
  printedAs: null,
};

function decideSalmon(entry, brand) {
  return validateDecision({
    decision: createDecision(goodItem({ brand })),
    entry,
    supermarket: EL_JAMON,
    brands: BRANDS,
    supermarkets: SUPERMARKETS,
    categories: CATEGORIES,
    units: UNITS,
  });
}

test('a CREATE under Poseidon Food is accepted for a row printed "Poseidón" when the homonym is registered (backend plan 0178)', () => {
  const withHomonym = salmon([POSEIDON_MATCH, POSEIDON_FOOD_MATCH]);

  assert.deepEqual(decideSalmon(withHomonym, 'Poseidon Food'), []);
  // The key's own brand stays an answer: the curator chooses, the gate does
  // not.
  assert.deepEqual(decideSalmon(withHomonym, 'Poseidon'), []);
});

test('the same CREATE is refused when the homonym is not registered', () => {
  for (const entry of [
    salmon([POSEIDON_MATCH]),
    // A gateway that predates the plan sends no list at all.
    salmon(undefined),
  ]) {
    const issues = decideSalmon(entry, 'Poseidon Food');
    assert.deepEqual(codes(issues), ['BRAND_DIFFERS_FROM_SOURCE']);
    assert.match(
      issues[0].detail,
      /the chain prints "Poseidón", a registered brand/
    );
    assert.match(issues[0].detail, /"Poseidon Food"/);
  }
});

test('a homonym widens the answer to the brands it names, and no further', () => {
  const withHomonym = salmon([POSEIDON_MATCH, POSEIDON_FOOD_MATCH]);

  const other = decideSalmon(withHomonym, 'Carbonell');
  assert.deepEqual(codes(other), ['BRAND_DIFFERS_FROM_SOURCE']);
  // Both brands are named, so the person reading the REVIEW sees the choice.
  assert.match(
    other[0].detail,
    /names the registered brands "Poseidon" and "Poseidon Food", and the decision writes "Carbonell"/
  );

  const dropped = decideSalmon(withHomonym, null);
  assert.deepEqual(codes(dropped), ['BRAND_DIFFERS_FROM_SOURCE']);
  assert.match(dropped[0].detail, /writes no brand/);
});

test('a homonym on a printed key nothing holds makes its brand the source’s brand', () => {
  const entry = {
    ...salmon([POSEIDON_FOOD_MATCH]),
    brand: 'Salmones del Norte',
  };

  assert.deepEqual(decideSalmon(entry, 'Poseidon Food'), []);
  assert.deepEqual(codes(decideSalmon(entry, 'Carbonell')), [
    'BRAND_DIFFERS_FROM_SOURCE',
  ]);
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

// ---------------------------------------------------------------------------
// Backend plan 0177: the row states its own unit, and a pack count joins a
// count to a weight
// ---------------------------------------------------------------------------

test('"75 cl" stated as 750 ml links onto a 750 ml product', () => {
  // What LIDL and the leaflet import write: the number is already millilitres
  // and the printed text still says centilitres. The row's own unit is read,
  // so the text is never multiplied by ten on top of it.
  const entry = { unitSize: 750, sizeUnit: 'MILLILITER', sizeFormat: '75 cl' };
  assert.deepEqual(
    linkIssues(entry, { unitSize: 750, defaultUnit: 'MILLILITER' }),
    []
  );
  assert.deepEqual(
    linkIssues(entry, { unitSize: 0.75, defaultUnit: 'LITER' }),
    []
  );
});

test('"75 cl" stated as 750 ml is refused onto a 500 ml product', () => {
  const found = validateDecision({
    decision: linkDecision(),
    entry: {
      ...ENTRY,
      unitSize: 750,
      sizeUnit: 'MILLILITER',
      sizeFormat: '75 cl',
    },
    supermarket: MERCADONA,
    linkTarget: { id: 'i1', unitSize: 500, defaultUnit: 'MILLILITER' },
    categories: CATEGORIES,
    units: UNITS,
  });
  assert.deepEqual(codes(found), ['FORMAT_MISMATCH']);
  // The detail states the unit the row is in, not the printed word.
  assert.match(found[0].detail, /750 MILLILITER.*500 MILLILITER/);
});

test('the row unit is read first, whatever the printed text ends in', () => {
  // The six leaflet links the October 2026 curation saw refused: Burn 50 cl,
  // a vinegar "37,5 cl" and the rest, each already in millilitres.
  for (const [unitSize, sizeFormat] of [
    [500, '50 cl'],
    [375, '37,5 cl'],
    [750, '75cl'],
  ]) {
    assert.deepEqual(
      linkIssues(
        { unitSize, sizeUnit: 'MILLILITER', sizeFormat },
        { unitSize, defaultUnit: 'MILLILITER' }
      ),
      [],
      sizeFormat
    );
  }
  // One source, two shapes: LIDL keeps `1,28 l` at 1.28 and says so.
  assert.deepEqual(
    linkIssues(
      { unitSize: 1.28, sizeUnit: 'LITER', sizeFormat: '1,28 l' },
      { unitSize: 1280, defaultUnit: 'MILLILITER' }
    ),
    []
  );
});

test('a row with no sizeUnit falls back to the printed text, as before', () => {
  // A row no run has seen since the plan. It compares exactly as it did, which
  // is right for a source that kept the printed unit...
  assert.deepEqual(
    linkIssues(
      { unitSize: 33, sizeUnit: null, sizeFormat: '33 cl' },
      { unitSize: 330, defaultUnit: 'MILLILITER' }
    ),
    []
  );
  // ...and still wrong for one that had already converted, which is the
  // defect a run rewriting the row removes.
  assert.ok(
    linkIssues(
      { unitSize: 750, sizeFormat: '75 cl' },
      { unitSize: 750, defaultUnit: 'MILLILITER' }
    ).includes('FORMAT_MISMATCH')
  );
});

test('"16 ud" links onto 160 g with packCount 16', () => {
  // A box of sixteen capsules, sized by count at one chain and by weight at
  // another. The pack count is what says they are one box.
  assert.deepEqual(
    linkIssues(
      { unitSize: 16, sizeUnit: 'UNIT', sizeFormat: '16 ud' },
      { unitSize: 160, defaultUnit: 'GRAM', packCount: 16 }
    ),
    []
  );
  assert.deepEqual(
    linkIssues(
      { unitSize: 16, sizeUnit: 'UNIT', sizeFormat: '16 ud' },
      { unitSize: 0.16, defaultUnit: 'KILOGRAM', packCount: 16 }
    ),
    []
  );
});

test('"16 ud" is refused onto 160 g with no pack count', () => {
  for (const packCount of [null, undefined]) {
    const found = validateDecision({
      decision: linkDecision(),
      entry: {
        ...ENTRY,
        unitSize: 16,
        sizeUnit: 'UNIT',
        sizeFormat: '16 ud',
      },
      supermarket: MERCADONA,
      linkTarget: { id: 'i1', unitSize: 160, defaultUnit: 'GRAM', packCount },
      categories: CATEGORIES,
      units: UNITS,
    });
    assert.deepEqual(codes(found), ['FORMAT_MISMATCH']);
    assert.match(found[0].detail, /16 UNIT.*160 GRAM/);
  }
});

test('a count and a weight are joined by the same pack count and by nothing else', () => {
  // A different count is a different box.
  assert.ok(
    linkIssues(
      { unitSize: 16, sizeUnit: 'UNIT', sizeFormat: '16 ud' },
      { unitSize: 300, defaultUnit: 'GRAM', packCount: 30 }
    ).includes('FORMAT_MISMATCH')
  );
  // The other way round: the row is the one sized by weight, as Mercadona
  // states product 11801, and the product was created from a `16 ud` row.
  const byWeight = {
    unitSize: 0.16,
    sizeUnit: 'KILOGRAM',
    sizeFormat: 'kg',
    packCount: 16,
  };
  assert.deepEqual(
    linkIssues(byWeight, { unitSize: 16, defaultUnit: 'UNIT' }),
    []
  );
  assert.ok(
    linkIssues(
      { ...byWeight, packCount: null },
      { unitSize: 16, defaultUnit: 'UNIT' }
    ).includes('FORMAT_MISMATCH')
  );
  // Both sides stating one count agree, whatever the count side's size reads.
  assert.deepEqual(
    linkIssues(
      { unitSize: 1, sizeUnit: 'UNIT', sizeFormat: 'ud', packCount: 16 },
      { unitSize: 160, defaultUnit: 'GRAM', packCount: 16 }
    ),
    []
  );
  // A weight is still never a volume, pack count or not.
  assert.ok(
    linkIssues(
      { unitSize: 160, sizeUnit: 'GRAM', sizeFormat: '160 g', packCount: 16 },
      { unitSize: 160, defaultUnit: 'MILLILITER', packCount: 16 }
    ).includes('FORMAT_MISMATCH')
  );
});

test('a CREATE can carry packCount, and only a count that is one', () => {
  const shape = (packCount) =>
    checkDecisionShape({
      decision: 'CREATE',
      confidence: 1,
      issues: [],
      reasoning: '',
      item: { ...goodItem(), packCount },
    });

  assert.equal(shape(16).decision.item.packCount, 16);
  // Null, absent and 1 state no count, and the key is then absent, which is
  // what lets the create take the count the row itself read.
  for (const none of [null, undefined, 1]) {
    const checked = shape(none);
    assert.equal(checked.ok, true);
    assert.equal('packCount' in checked.decision.item, false);
  }
  for (const bad of [0, 1001, 2.5, '16']) {
    const checked = shape(bad);
    assert.equal(checked.ok, false, String(bad));
    assert.match(checked.error, /item\.packCount/);
  }
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

// ---------------------------------------------------------------------------
// Base units (backend plan 0183)
// ---------------------------------------------------------------------------

function createIssues(item) {
  return validateDecision({
    decision: createDecision(goodItem(item)),
    entry: ENTRY,
    supermarket: MERCADONA,
    brands: BRANDS,
    supermarkets: SUPERMARKETS,
    categories: CATEGORIES,
    units: UNITS,
  });
}

test('NOT_A_BASE_UNIT refuses a CREATE of 1 LITER, and names what to write', () => {
  const found = createIssues({ unitSize: 1, defaultUnit: 'LITER' });
  assert.deepEqual(codes(found), ['NOT_A_BASE_UNIT']);
  assert.equal(
    found[0].detail,
    '1 LITER is not a base unit. A CREATE is written in GRAM, MILLILITER or UNIT: write 1000 MILLILITER.'
  );
});

test('NOT_A_BASE_UNIT passes a CREATE of KILOGRAM with a null size', () => {
  // A product sold by weight: priced per kilo and weighed at the till.
  assert.deepEqual(
    createIssues({ unitSize: null, defaultUnit: 'KILOGRAM' }),
    []
  );
});

test('NOT_A_BASE_UNIT refuses a sized KILOGRAM, any LITER and any PACK', () => {
  const sized = createIssues({ unitSize: 0.25, defaultUnit: 'KILOGRAM' });
  assert.deepEqual(codes(sized), ['NOT_A_BASE_UNIT']);
  assert.match(sized[0].detail, /write 250 GRAM\.$/);

  const litre = createIssues({ unitSize: null, defaultUnit: 'LITER' });
  assert.deepEqual(codes(litre), ['NOT_A_BASE_UNIT']);
  assert.match(litre[0].detail, /write no size MILLILITER\.$/);

  const pack = createIssues({ unitSize: 6, defaultUnit: 'PACK' });
  assert.deepEqual(codes(pack), ['NOT_A_BASE_UNIT']);
  assert.match(pack[0].detail, /write 6 UNIT\.$/);
});

test('NOT_A_BASE_UNIT passes grams, millilitres and a count, sized or not', () => {
  for (const item of [
    { unitSize: 250, defaultUnit: 'GRAM' },
    { unitSize: 1500, defaultUnit: 'MILLILITER' },
    { unitSize: 16, defaultUnit: 'UNIT' },
    { unitSize: null, defaultUnit: 'UNIT' },
  ]) {
    assert.deepEqual(createIssues(item), []);
  }
});

test('NOT_A_BASE_UNIT is not worth a second attempt and says nothing about a LINK', () => {
  assert.deepEqual(
    retryableIssues([issue('NOT_A_BASE_UNIT', '1 LITER is not a base unit.')]),
    []
  );
  // A LINK creates nothing: the product it names keeps the unit it has.
  assert.deepEqual(
    validateDecision({
      decision: linkDecision(),
      entry: ENTRY,
      supermarket: MERCADONA,
      linkTarget: {
        id: 'i1',
        brand: 'Hacendado',
        unitSize: 1,
        defaultUnit: 'LITER',
        ean: null,
      },
      brands: BRANDS,
      supermarkets: SUPERMARKETS,
      categories: CATEGORIES,
      units: UNITS,
    }),
    []
  );
});

// ---------------------------------------------------------------------------
// What a created product must carry (backend plan 0184)
// ---------------------------------------------------------------------------

function createIssuesOf(item) {
  return validateDecision({
    decision: createDecision(item),
    entry: ENTRY,
    supermarket: MERCADONA,
    brands: BRANDS,
    supermarkets: SUPERMARKETS,
    categories: CATEGORIES,
    units: UNITS,
  });
}

test('the schema check refuses a CREATE with no nameEn, so the row is asked again', () => {
  for (const nameEn of [undefined, null, '', '   ', 42]) {
    const checked = checkDecisionShape({
      decision: 'CREATE',
      confidence: 1,
      item: { ...goodItem(), nameEn },
    });
    assert.equal(checked.ok, false, JSON.stringify(nameEn));
    assert.match(checked.error, /needs "item.nameEn"/);
  }
});

test('NAME_EN_MISSING fires on a CREATE that reached the validators with no nameEn', () => {
  // The shape check refuses such a reply, so this is a decision built some
  // other way. It goes to a person and not to a route that would refuse the
  // whole file for it.
  for (const nameEn of [null, undefined, '', '  ']) {
    const issues = createIssuesOf(goodItem({ nameEn }));
    assert.deepEqual(
      codes(issues),
      ['NAME_EN_MISSING'],
      JSON.stringify(nameEn)
    );
    assert.match(issues[0].detail, /Leche entera/);
  }
});

test('NAME_EN_MISSING is quiet on a CREATE with both names, and on a LINK', () => {
  assert.deepEqual(createIssuesOf(goodItem()), []);
  // A brand name, a range word and a foreign product name are written the
  // same in both languages, and that is a name in both.
  assert.deepEqual(
    createIssuesOf(
      goodItem({ nameEs: 'Pain au chocolat', nameEn: 'Pain au chocolat' })
    ),
    []
  );
  assert.deepEqual(
    validateDecision({
      decision: linkDecision(),
      entry: ENTRY,
      supermarket: MERCADONA,
      linkTarget: {
        id: 'i1',
        brand: 'Hacendado',
        unitSize: 1,
        defaultUnit: 'LITER',
        ean: null,
      },
      brands: BRANDS,
      supermarkets: SUPERMARKETS,
      categories: CATEGORIES,
      units: UNITS,
    }),
    []
  );
});

test('NAME_EN_MISSING is a judgment for a person, not a second attempt', () => {
  assert.deepEqual(
    retryableIssues([issue('NAME_EN_MISSING', 'no nameEn')]),
    []
  );
});

test('NAME_CARRIES_SIZE fires on a Spanish name that ends in the word pack', () => {
  for (const nameEs of [
    'Cerveza pack',
    'Cerveza Pack',
    'Cerveza PACK',
    'Cerveza especial (pack)',
    'Cerveza pack.',
    'Yogur natural, pack',
  ]) {
    const issues = createIssuesOf(goodItem({ nameEs }));
    assert.deepEqual(codes(issues), ['NAME_CARRIES_SIZE'], nameEs);
    assert.match(issues[0].detail, /ends in "pack"/, nameEs);
    assert.match(issues[0].detail, /packCount/, nameEs);
  }
});

test('a name that only holds the letters of pack, or says it elsewhere, is left alone', () => {
  for (const nameEs of [
    'Mochila Backpack',
    'Pack de cervezas',
    'Cerveza packs',
    'Leche entera',
  ]) {
    assert.deepEqual(createIssuesOf(goodItem({ nameEs })), [], nameEs);
  }
});

test('a name that ends in a counted pack is reported once, by the size check', () => {
  const issues = createIssuesOf(goodItem({ nameEs: 'Cerveza 6 pack' }));
  assert.deepEqual(codes(issues), ['NAME_CARRIES_SIZE']);
  assert.match(issues[0].detail, /states a size/);
});

test('a CREATE keeps a real barcode and drops an in-store or invalid one', () => {
  const eanOf = (ean) =>
    checkDecisionShape({
      decision: 'CREATE',
      confidence: 1,
      item: { ...goodItem(), ean },
    }).decision.item.ean;

  assert.equal(eanOf('4006381333931'), '4006381333931');
  assert.equal(eanOf(' 4006381333931 '), '4006381333931');
  // One shop's own code, a stub of one, a short code and a wrong check digit.
  for (const ean of [
    '2000000000008',
    '2204500000000',
    '84100100012',
    '4006381333932',
    '',
    null,
    undefined,
  ]) {
    assert.equal(eanOf(ean), null, JSON.stringify(ean));
  }
});

// ---------------------------------------------------------------------------
// A product has more than one barcode (backend plan 0185)
// ---------------------------------------------------------------------------

/** Whole milk as Mercadona prints it from a second factory. */
const MILK_ROW = {
  ...ENTRY,
  brand: 'Hacendado',
  ean: '8402001047251',
  unitSize: 1,
  sizeUnit: 'LITER',
};

/** The catalog product, created from the first factory's barcode. */
const MILK_PRODUCT = {
  id: 'i1',
  brand: 'Hacendado',
  ean: '8402001002083',
  eans: ['8402001002083'],
  unitSize: 1000,
  defaultUnit: 'MILLILITER',
};

function secondBarcodeIssues(overrides = {}) {
  return validateDecision({
    decision: linkDecision(),
    entry: MILK_ROW,
    supermarket: MERCADONA,
    linkTarget: MILK_PRODUCT,
    brands: BRANDS,
    supermarkets: SUPERMARKETS,
    categories: CATEGORIES,
    units: UNITS,
    ...overrides,
  });
}

test('a LINK with a different EAN, the same brand and the same format passes', () => {
  // The case the plan was written about: the same brand, the same name, the
  // same size, another barcode. It used to be an EAN_CONFLICT, and the row
  // stayed in the queue for ever.
  assert.deepEqual(secondBarcodeIssues(), []);
});

test('a LINK onto a product while another product holds the row’s EAN is refused', () => {
  const issues = secondBarcodeIssues({ rowEanOwner: { id: 'i9' } });
  assert.deepEqual(codes(issues), ['EAN_CONFLICT']);
  assert.match(issues[0].detail, /8402001047251/);
  assert.match(issues[0].detail, /item i9 holds it, not i1/);

  // Also when the target holds no barcode at all: the barcode still names
  // another product.
  assert.deepEqual(
    codes(
      secondBarcodeIssues({
        linkTarget: { ...MILK_PRODUCT, ean: null, eans: [] },
        rowEanOwner: { id: 'i9' },
      })
    ),
    ['EAN_CONFLICT']
  );
});

test('a LINK onto the product that holds the row’s EAN passes, whichever of its barcodes it is', () => {
  const holder = {
    ...MILK_PRODUCT,
    eans: ['8402001002083', '8402001047251'],
  };
  assert.deepEqual(
    secondBarcodeIssues({ linkTarget: holder, rowEanOwner: { id: 'i1' } }),
    []
  );
  // The barcode is its second one, so `ean` alone would have said "different".
  assert.notEqual(holder.ean, MILK_ROW.ean);
});

test('a different EAN is still a conflict when the brand is not the same', () => {
  // Another brand, an entry with no brand, and a target with none. A chain
  // can leave the brand off a product whose name states one, so "both have
  // none" does not say the two are one brand.
  for (const [entry, linkTarget] of [
    [{ ...MILK_ROW, brand: 'Carbonell' }, MILK_PRODUCT],
    [{ ...MILK_ROW, brand: null }, MILK_PRODUCT],
    [MILK_ROW, { ...MILK_PRODUCT, brand: null }],
    [
      { ...MILK_ROW, brand: null },
      { ...MILK_PRODUCT, brand: null },
    ],
  ]) {
    const issues = secondBarcodeIssues({ entry, linkTarget });
    assert.deepEqual(codes(issues), ['EAN_CONFLICT'], String(entry.brand));
    assert.match(issues[0].detail, /does not show the same brand\./);
  }
});

test('a different EAN is still a conflict when the format is not known to be the same', () => {
  // A size missing on either side is "not known", and a person looks.
  const sizeless = secondBarcodeIssues({
    entry: { ...MILK_ROW, unitSize: null },
  });
  assert.deepEqual(codes(sizeless), ['EAN_CONFLICT']);
  assert.match(sizeless[0].detail, /does not show the same format\./);

  // Another size is two issues, as it always was: the format, and the barcode
  // that nothing now explains.
  assert.deepEqual(
    codes(
      secondBarcodeIssues({ entry: { ...MILK_ROW, unitSize: 1.5 } })
    ).sort(),
    ['EAN_CONFLICT', 'FORMAT_MISMATCH']
  );
});

test('a registered spelling of the target’s brand is the same brand', () => {
  // The chain prints `Hacendado +Proteínas`, which a person linked to
  // `Hacendado`: one brand, so a second barcode is allowed.
  assert.deepEqual(
    secondBarcodeIssues({
      entry: { ...MILK_ROW, brand: 'Hacendado +Proteínas' },
    }),
    []
  );
});

test('a product from a gateway that lists no eans is read by its one ean', () => {
  const old = { ...MILK_PRODUCT };
  delete old.eans;
  assert.deepEqual(secondBarcodeIssues({ linkTarget: old }), []);
  assert.deepEqual(
    codes(
      secondBarcodeIssues({
        entry: { ...MILK_ROW, brand: null },
        linkTarget: old,
      })
    ),
    ['EAN_CONFLICT']
  );
});
