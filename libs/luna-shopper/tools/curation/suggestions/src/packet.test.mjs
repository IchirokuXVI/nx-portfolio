/**
 * The one field the registry puts in a packet (plan 0004).
 *
 * `brandMatch` is the whole of what the model is told about the brand registry.
 * The registry itself is read by the library and never sent, so these four
 * cases are the entire contract between the two.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { brandMatchFor, buildEntryPacket, toCandidate } from './packet.mjs';
import { indexBrands } from './rules.mjs';

const MERCADONA = { id: 'sm-1', name: { es: 'Mercadona', en: 'Mercadona' } };
const EL_JAMON = { id: 'sm-2', name: { es: 'El Jamón', en: 'El Jamón' } };
const SUPERMARKETS = [MERCADONA, EL_JAMON];

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
  // A spelling of the house label, so the chain the packet names comes from
  // the canonical brand and not from the row the printed brand found.
  {
    id: 'b-hacendado-plus',
    key: 'hacendadoproteinas',
    label: 'Hacendado +Proteínas',
    privateLabelSupermarketId: null,
    canonicalBrandId: 'b-hacendado',
  },
]);

function entry(overrides = {}) {
  return {
    id: 'e1',
    supermarketId: 'sm-1',
    name: 'Leche entera 1 L',
    brand: null,
    ean: null,
    unitSize: 1,
    ...overrides,
  };
}

function match(brand) {
  return brandMatchFor({
    entry: entry({ brand }),
    brands: BRANDS,
    supermarkets: SUPERMARKETS,
  });
}

test('brandMatch names the registered brand and the chain that owns it', () => {
  assert.deepEqual(match('Hacendado'), {
    label: 'Hacendado',
    privateLabelOf: 'Mercadona',
    printedAs: null,
  });
});

test('brandMatch answers the registry label, not the printed spelling', () => {
  // Catalog stores the registered label on every item written with the key
  // (plan 0115 section 4), so this is what a CREATE is told to write.
  assert.deepEqual(match('HACENDADO'), {
    label: 'Hacendado',
    privateLabelOf: 'Mercadona',
    printedAs: null,
  });
});

test('a brand with no chain names no chain', () => {
  assert.deepEqual(match('Carbonell'), {
    label: 'Carbonell',
    privateLabelOf: null,
    printedAs: null,
  });
});

test('a linked spelling names the brand to write and the spelling printed', () => {
  // The chain prints `DEBORAH 48H` and a person registered it as a spelling of
  // `Deborah`, so `label` is already the brand a CREATE writes and the model
  // needs no second rule to get it right on the first attempt.
  assert.deepEqual(match('DEBORAH 48H'), {
    label: 'Deborah',
    privateLabelOf: null,
    printedAs: 'DEBORAH 48H',
  });
});

test('a linked spelling takes its chain from the brand it spells', () => {
  // A linked brand owns no chain of its own (plan 0124 section 2), so reading
  // the chain off the printed row would tell the model rule 6 does not apply.
  assert.deepEqual(match('Hacendado +Proteínas'), {
    label: 'Hacendado',
    privateLabelOf: 'Mercadona',
    printedAs: 'Hacendado +Proteínas',
  });
});

test('no brand and an unregistered brand are both null', () => {
  assert.equal(match(null), null);
  assert.equal(match('+Proteínas'), null);
  assert.equal(match('-'), null);
});

test('the packet carries the field and the candidates are not annotated', () => {
  const packet = buildEntryPacket({
    entry: entry({ brand: 'Hacendado' }),
    supermarket: MERCADONA,
    candidates: [{ itemId: 'i1', brand: '+Proteínas' }],
    eanMatch: null,
    brands: BRANDS,
    supermarkets: SUPERMARKETS,
  });

  assert.deepEqual(packet.entry.brandMatch, {
    label: 'Hacendado',
    privateLabelOf: 'Mercadona',
    printedAs: null,
  });
  // A LINK takes the candidate's brand as it is: that brand is already a
  // catalog product's brand and nothing here decides anything new about it.
  assert.deepEqual(packet.candidates, [{ itemId: 'i1', brand: '+Proteínas' }]);
});

test('a packet built with no registry names no brand and still carries the field', () => {
  const packet = buildEntryPacket({
    entry: entry({ brand: 'Hacendado' }),
    supermarket: MERCADONA,
    candidates: [],
    eanMatch: null,
  });
  assert.equal(packet.entry.brandMatch, null);
});

test('the packet names the entries sharing its EAN, and null otherwise (plan 0006)', () => {
  const shared = buildEntryPacket({
    entry: entry({ ean: '8480000000017' }),
    supermarket: MERCADONA,
    candidates: [],
    eanMatch: null,
    sharedEan: ['e3', 'e4'],
  });
  assert.deepEqual(shared.entry.sharedEan, ['e3', 'e4']);

  for (const sharedEan of [undefined, null, []]) {
    const alone = buildEntryPacket({
      entry: entry(),
      supermarket: MERCADONA,
      candidates: [],
      eanMatch: null,
      sharedEan,
    });
    assert.equal(alone.entry.sharedEan, null);
  }
});

test('the packet shows the unit and the pack count of the entry (backend plan 0177)', () => {
  const packet = buildEntryPacket({
    entry: entry({
      unitSize: 0.16,
      sizeUnit: 'KILOGRAM',
      sizeFormat: 'kg',
      packCount: 16,
    }),
    supermarket: MERCADONA,
    candidates: [],
    eanMatch: null,
  });
  assert.equal(packet.entry.unitSize, 0.16);
  assert.equal(packet.entry.sizeUnit, 'KILOGRAM');
  assert.equal(packet.entry.sizeFormat, 'kg');
  assert.equal(packet.entry.packCount, 16);

  // A row no run has seen since the plan states neither, and both are null
  // rather than absent, so the model reads one shape.
  const old = buildEntryPacket({
    entry: entry(),
    supermarket: MERCADONA,
    candidates: [],
    eanMatch: null,
  });
  assert.equal(old.entry.sizeUnit, null);
  assert.equal(old.entry.packCount, null);
});

test('the packet shows whether the entry is sold by weight (backend plan 0181)', () => {
  const weighed = buildEntryPacket({
    entry: entry({
      unitSize: null,
      sizeUnit: null,
      sizeFormat: 'kg',
      soldByWeight: true,
    }),
    supermarket: MERCADONA,
    candidates: [],
    eanMatch: null,
  });
  assert.equal(weighed.entry.soldByWeight, true);
  assert.equal(weighed.entry.unitSize, null);

  // A row no run has read whole since the plan carries no such field, and the
  // packet answers false rather than leaving the key out.
  const old = buildEntryPacket({
    entry: entry(),
    supermarket: MERCADONA,
    candidates: [],
    eanMatch: null,
  });
  assert.equal(old.entry.soldByWeight, false);
});

test('a candidate shows its pack count, and null when it has none', () => {
  assert.equal(
    toCandidate({ id: 'i1', name: {}, unitSize: 160, packCount: 16 }).packCount,
    16
  );
  assert.equal(toCandidate({ id: 'i2', name: {} }).packCount, null);
  // A product this run created is shown the same way, by its ref.
  assert.deepEqual(
    (({ ref, packCount }) => ({ ref, packCount }))(
      toCandidate(
        { id: 'r1', name: {}, packCount: 6 },
        { origin: 'run', ref: 'ref-e1' }
      )
    ),
    { ref: 'ref-e1', packCount: 6 }
  );
});

test('a candidate names its categories by slug, in the order it holds them', () => {
  // An item answers its categories as rows (backend plan 0166), and the model
  // names a category by slug, so the slug is all the packet carries.
  const candidate = toCandidate({
    id: 'i1',
    name: { es: 'Pizza cuatro quesos' },
    categories: [
      { id: 'c1', parentId: 'r1', slug: 'pizzas-and-doughs', name: {} },
      { id: 'c2', parentId: 'r2', slug: 'frozen-pizzas', name: {} },
    ],
  });
  assert.deepEqual(candidate.categorySlugs, [
    'pizzas-and-doughs',
    'frozen-pizzas',
  ]);
  assert.deepEqual(toCandidate({ id: 'i2', name: {} }).categorySlugs, []);
});
