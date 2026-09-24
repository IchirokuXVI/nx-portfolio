/**
 * The one field the registry puts in a packet (plan 0004).
 *
 * `brandMatch` is the whole of what the model is told about the brand registry.
 * The registry itself is read by the library and never sent, so these four
 * cases are the entire contract between the two.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { brandMatchFor, buildEntryPacket } from './packet.mjs';
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
