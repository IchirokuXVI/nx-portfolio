import assert from 'node:assert/strict';
import test from 'node:test';
import { CHECKS, readRow, sanityPass } from './sanity.mjs';

/** One page's rows, as the pass takes them. */
const page = (rows, number = 5) => new Map([[number, rows]]);

/** A row the checks are happy with, in the camelCase shape. */
const clean = {
  name: 'Leche entera Pascual',
  brand: 'Pascual',
  price: 0.99,
  unitPrice: 0.99,
  unitPriceLabel: 'LITRO 0,99',
  leaflet: { basis: 'unit', wasPrice: null, loyalty: false, promotion: null },
};

test('a clean page raises nothing', () => {
  assert.deepEqual(sanityPass(page([clean])), []);
});

test('both reading shapes are read, so no chain passes a check by accident', () => {
  const camel = readRow({
    price: 1,
    unitPrice: 2,
    unitPriceLabel: 'KILO 2',
    leaflet: {
      wasPrice: 3,
      loyalty: true,
      basis: 'kg',
      promotion: { type: 'price_drop', singleUnitPrice: 1, totalPrice: 4 },
    },
  });
  const snake = readRow({
    price: 1,
    unit_price: 2,
    unit_price_per: 'kg',
    was_price: 3,
    loyalty: true,
    basis: 'kg',
    promotion: { type: 'price_drop', single_unit_price: 1, total_price: 4 },
  });
  assert.equal(camel.price, snake.price);
  assert.equal(camel.wasPrice, snake.wasPrice);
  assert.equal(camel.unitPrice, snake.unitPrice);
  assert.equal(camel.loyalty, snake.loyalty);
  assert.equal(
    camel.promotion.singleUnitPrice,
    snake.promotion.singleUnitPrice
  );
  assert.equal(camel.promotion.totalPrice, snake.promotion.totalPrice);
});

test('a price drop that invented a quantity and a unit price is named', () => {
  // A real gemma4:12b row from the El Jamon leaflet: rule 7 of the prompt
  // forbids inventing a value, and it filled both fields with the headline
  // price on 9 of 9 price drop tiles.
  const gemma = {
    name: 'Cerveza San Miguel Especial',
    brand: 'San Miguel',
    format: 'lata 33 cl.',
    price: 0.74,
    basis: 'unit',
    was_price: 0.89,
    unit_price: 2.24,
    unit_price_per: 'l',
    loyalty: false,
    promotion: {
      type: 'price_drop',
      required_quantity: 1,
      effective_unit_price: 0.74,
      total_price: 0.74,
      single_unit_price: 0.74,
    },
  };
  const warnings = sanityPass(page([gemma]));
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].name, CHECKS[0].name);
  assert.equal(warnings[0].page, 5);
  assert.equal(warnings[0].product, 'Cerveza San Miguel Especial');
  assert.match(
    warnings[0].message,
    /required_quantity 1 and single_unit_price 0.74/
  );
});

test('a price drop with nothing but a type is fine', () => {
  const row = {
    ...clean,
    leaflet: {
      ...clean.leaflet,
      wasPrice: 1.29,
      promotion: { type: 'price_drop' },
    },
  };
  assert.deepEqual(sanityPass(page([row])), []);
});

test('a second unit price that does not add up is named', () => {
  const row = {
    ...clean,
    name: 'Radler Cruzcampo',
    price: 0.39,
    leaflet: {
      ...clean.leaflet,
      promotion: {
        type: 'second_unit_discount',
        // 1.58 minus 0.79 is 0.79, not 0.39.
        totalPrice: 1.58,
        singleUnitPrice: 0.79,
      },
    },
  };
  const warnings = sanityPass(page([row]));
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].name, CHECKS[1].name);
  assert.equal(warnings[0].product, 'Radler Cruzcampo');
  assert.match(warnings[0].message, /which is 0.79/);
});

test('a second unit price that does add up raises nothing', () => {
  const row = {
    ...clean,
    price: 0.39,
    leaflet: {
      ...clean.leaflet,
      promotion: {
        type: 'second_unit_discount',
        totalPrice: 1.18,
        singleUnitPrice: 0.79,
      },
    },
  };
  assert.deepEqual(sanityPass(page([row])), []);
});

test('a was price at or below the price is named', () => {
  const swapped = {
    ...clean,
    price: 2.59,
    leaflet: { ...clean.leaflet, wasPrice: 1.99 },
  };
  const warnings = sanityPass(page([swapped]));
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].name, CHECKS[2].name);
  assert.match(warnings[0].message, /1.99 is not above price 2.59/);
});

test('a row with no number at all is named', () => {
  const blank = { name: 'Jamon serrano', leaflet: { basis: 'kg' } };
  const warnings = sanityPass(page([blank]));
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].name, CHECKS[3].name);
  assert.equal(warnings[0].product, 'Jamon serrano');
});

test('a loyalty gated row with no number is its own reason', () => {
  const gated = { name: 'Queso curado', loyalty: true };
  assert.deepEqual(sanityPass(page([gated])), []);
});

test('a unit price with no basis is named', () => {
  const row = {
    name: 'Aceite de oliva',
    unitPrice: 4.19,
    unitPriceLabel: null,
  };
  const warnings = sanityPass(page([row]));
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].name, CHECKS[4].name);
  assert.match(warnings[0].message, /4.19 names no basis/);
});

test('two rows with the same name and price are named, and the second one is', () => {
  const warnings = sanityPass(page([clean, { ...clean }]));
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].name, CHECKS[5].name);
  assert.match(warnings[0].message, /the same name and price as row 1/);
});

test('the same name at a different price is two offers, not a duplicate', () => {
  assert.deepEqual(sanityPass(page([clean, { ...clean, price: 1.29 }])), []);
});

test('every warning names its page, its product and its rule', () => {
  const readings = new Map([
    [1, [{ name: 'Sin precio' }]],
    [9, [{ name: 'Otro', unitPrice: 1 }]],
  ]);
  const warnings = sanityPass(readings);
  assert.deepEqual(
    warnings.map((entry) => [entry.page, entry.product, entry.name]),
    [
      [1, 'Sin precio', CHECKS[3].name],
      [9, 'Otro', CHECKS[4].name],
    ]
  );
});

test('a row with no name is named by its position', () => {
  const warnings = sanityPass(page([{ price: null }]));
  assert.equal(warnings[0].product, 'row 1');
});

test('nothing is edited and nothing is dropped', () => {
  const rows = [
    { ...clean, price: 2.59, leaflet: { ...clean.leaflet, wasPrice: 1.99 } },
  ];
  const before = JSON.stringify(rows);
  sanityPass(page(rows));
  assert.equal(JSON.stringify(rows), before);
  assert.equal(rows.length, 1);
});
