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
  });
});

test('brandMatch answers the registry label, not the printed spelling', () => {
  // Catalog stores the registered label on every item written with the key
  // (plan 0115 section 4), so this is what a CREATE is told to write.
  assert.deepEqual(match('HACENDADO'), {
    label: 'Hacendado',
    privateLabelOf: 'Mercadona',
  });
});

test('a brand with no chain names no chain', () => {
  assert.deepEqual(match('Carbonell'), {
    label: 'Carbonell',
    privateLabelOf: null,
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
