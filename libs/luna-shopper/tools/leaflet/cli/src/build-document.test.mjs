import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDocument, readPer } from './build-document.mjs';
import {
  listChains,
  loadChainDefaults,
  readPrompt,
  resolveChain,
} from './chains.mjs';
import { unknownKeys } from './reading.mjs';

/** The heading every chain prompt puts its worked example under. */
const EXAMPLE_HEADING = 'EXAMPLE OF A WHOLE ANSWER';

/** The JSON array a chain's prompt shows as its worked example. */
function promptExample(slug) {
  const prompt = readPrompt(resolveChain(slug)).replace(/\r\n/g, '\n');
  const at = prompt.indexOf(EXAMPLE_HEADING);
  assert.ok(at >= 0, `${slug}/prompt.txt has no "${EXAMPLE_HEADING}"`);
  const start = prompt.indexOf('\n[', at) + 1;
  const end = prompt.indexOf('\n]', start) + 2;
  assert.ok(start > 0 && end > start, `${slug}'s example is not an array`);
  return JSON.parse(prompt.slice(start, end));
}

const LEAFLET = {
  pdf: 'leaflet.pdf',
  page_count: 1,
  validity: {
    from: '2026-09-01',
    until: '2026-09-30',
    raw_text: 'DEL 1 AL 30 DE SEPTIEMBRE',
  },
  extraction: { tool: 'a test', date: '2026-09-01T00:00:00.000Z' },
};
const SOURCE = { file: 'leaflet.pdf', sha256: 'a'.repeat(64) };

async function build(slug, rows, leafletJson = LEAFLET) {
  const defaults = await loadChainDefaults(resolveChain(slug));
  return buildDocument({
    chain: slug,
    readings: [{ page: 5, rows }],
    leafletJson,
    source: SOURCE,
    sections: defaults.sections,
    fixedSections: defaults.fixedSections,
    toolName: defaults.toolName,
  });
}

/** The promotion types whose headline price is not what one unit costs. */
const CONDITIONAL = new Set([
  'second_unit_discount',
  'multibuy_unit_price',
  'multibuy_total',
  'buy_n_get_free',
]);

/** Deza prints no loyalty badge, so its example has no card price to carry. */
const NO_LOYALTY = new Set(['deza']);

test('every chain has a prompt, and the test below reads all four', () => {
  assert.deepEqual(listChains(), ['deza', 'dia', 'el-jamon', 'lidl']);
});

for (const slug of listChains()) {
  test(`${slug}: the prompt's own example names no key the builder does not read`, () => {
    for (const row of promptExample(slug)) {
      assert.deepEqual(unknownKeys(row), [], row.name);
    }
  });

  test(`${slug}: the prompt's own example survives the build`, async () => {
    const rows = promptExample(slug);
    const { document, unknownKeys: unknown } = await build(slug, rows);
    assert.deepEqual(unknown, []);
    assert.equal(document.products.length, rows.length);

    const seen = {
      loyalty: false,
      promotionPrice: false,
      measured: false,
      size: false,
      label: false,
      validity: false,
    };

    rows.forEach((row, index) => {
      const product = document.products[index];
      const leaflet = row.leaflet;
      const promotion = leaflet.promotion;
      assert.equal(product.name, row.name);

      // Loyalty: the flag survives, and a card price is never a till price.
      assert.equal(product.extra.loyalty.required, leaflet.loyalty);
      if (leaflet.loyalty) {
        seen.loyalty = true;
        assert.equal(product.price, undefined, `${row.name} is a card price`);
        assert.equal(product.extra.headline_price.amount, row.price);
      }

      // The promotion, with its wording and every number it printed.
      if (promotion) {
        assert.equal(product.extra.promotion.type, promotion.type);
        assert.equal(product.extra.promotion.raw_text, promotion.rawText);
        if (promotion.singleUnitPrice !== null) {
          assert.equal(
            product.extra.promotion.single_unit_price.amount,
            promotion.singleUnitPrice
          );
        }
        if (promotion.totalPrice !== null) {
          assert.equal(
            product.extra.promotion.total_price.amount,
            promotion.totalPrice
          );
        }
        if (promotion.requiredQuantity !== null) {
          assert.equal(
            product.extra.promotion.required_quantity,
            promotion.requiredQuantity
          );
        }
      }
      if (
        !leaflet.loyalty &&
        promotion &&
        CONDITIONAL.has(promotion.type) &&
        promotion.singleUnitPrice !== null
      ) {
        seen.promotionPrice = true;
        assert.equal(product.price.amount, promotion.singleUnitPrice);
      }

      // The basis, and no till price on a per kilo or per litre tile.
      assert.equal(product.extra.basis, leaflet.basis);
      if (leaflet.basis === 'kg' || leaflet.basis === 'l') {
        seen.measured = true;
        assert.equal(
          product.price,
          undefined,
          `${row.name} is priced by ${leaflet.basis}`
        );
      }

      // The size, as printed and as a number.
      if (row.unitSize !== null) {
        seen.size = true;
        assert.equal(product.size.quantity, row.unitSize);
        assert.equal(product.size.label, leaflet.format);
      }

      // The comparison line, with the printed wording as its label. A card
      // price's comparison figure is a card figure too, so it stays in
      // `extra` with the rest of that tile and off the product.
      if (row.unitPrice !== null && row.unitPriceLabel !== null) {
        assert.equal(product.extra.printed_unit_price.raw, row.unitPriceLabel);
        if (leaflet.loyalty) {
          assert.equal(product.unit_price, undefined);
        } else {
          seen.label = true;
          assert.equal(product.unit_price.amount, row.unitPrice);
          assert.equal(product.unit_price.label, row.unitPriceLabel);
        }
      }

      // An offer's own end date, opened with the leaflet's own start.
      if (leaflet.validUntil) {
        seen.validity = true;
        assert.deepEqual(product.validity, {
          from: LEAFLET.validity.from,
          until: leaflet.validUntil,
        });
        assert.equal(product.extra.validity_text, leaflet.validityText);
        assert.ok(product.extra.validity_assumption);
      } else {
        assert.equal(product.validity, undefined);
      }

      // No price leaves the builder that the tile did not print as a till
      // price: the headline, or on a conditional tile the single unit price.
      if (product.price) {
        const allowed =
          promotion && CONDITIONAL.has(promotion.type)
            ? promotion.singleUnitPrice
            : row.price;
        assert.equal(product.price.amount, allowed, row.name);
      }
    });

    for (const [what, present] of Object.entries(seen)) {
      if (what === 'loyalty' && NO_LOYALTY.has(slug)) {
        continue;
      }
      assert.ok(present, `${slug}'s example shows no ${what}`);
    }
  });
}

test('a reading in the old flat El Jamon shape still builds, with no converter', async () => {
  // Two rows of the plan 0150 reading, verbatim.
  const rows = [
    {
      name: 'Cerveza con Alcohol Estrella del Sur',
      brand: 'Estrella del Sur',
      format: '1 L.',
      price: 1.05,
      basis: 'unit',
      was_price: 1.18,
      unit_price: null,
      unit_price_per: null,
      loyalty: true,
      promotion: {
        type: 'price_drop',
        required_quantity: null,
        effective_unit_price: null,
        total_price: null,
        single_unit_price: null,
      },
    },
    {
      name: 'Cerveza Radler Cruzcampo',
      brand: 'Cruzcampo',
      format: 'lata 33 cl.',
      price: 0.39,
      basis: 'unit',
      was_price: null,
      unit_price: 1.97,
      unit_price_per: 'l',
      loyalty: false,
      promotion: {
        type: 'second_unit_discount',
        required_quantity: 2,
        effective_unit_price: null,
        total_price: 1.18,
        single_unit_price: 0.79,
      },
    },
  ];
  const { document, unknownKeys: unknown } = await build('el-jamon', rows);
  assert.deepEqual(unknown, []);
  const [card, radler] = document.products;

  assert.equal(card.price, undefined);
  assert.equal(card.extra.loyalty.required, true);
  assert.equal(card.extra.was_price.amount, 1.18);
  assert.equal(card.size.label, '1 L.');

  // The second unit's 0.39 stays in the headline, and one can costs 0.79.
  assert.equal(radler.price.amount, 0.79);
  assert.equal(radler.extra.headline_price.amount, 0.39);
  assert.equal(radler.extra.promotion.total_price.amount, 1.18);
  assert.equal(radler.unit_price.amount, 1.97);

  // A promotion with no wording is kept, and a warning says so.
  assert.equal(radler.extra.promotion.type, 'second_unit_discount');
  assert.ok(
    document.warnings.some((warning) => /with no wording/.test(warning.message))
  );
});

test('every key neither shape names is reported, once per page', async () => {
  const row = {
    name: 'Leche',
    price: 0.99,
    colour: 'white',
    leaflet: {
      basis: 'unit',
      stock: 3,
      promotion: { type: 'price_drop', rawText: 'ANTES 1', minimum: 1 },
    },
  };
  const { unknownKeys: unknown } = await build('deza', [row, row]);
  assert.deepEqual(unknown, [
    { page: 5, key: 'colour' },
    { page: 5, key: 'leaflet.promotion.minimum' },
    { page: 5, key: 'leaflet.stock' },
  ]);
});

test('an end date with no start to open it states no window, and says why', async () => {
  const row = {
    name: 'Ginebra',
    price: 9.99,
    leaflet: {
      basis: 'unit',
      validUntil: '2026-09-14',
      validityText: 'OFERTA VÁLIDA HASTA EL 14-9-2026',
    },
  };
  const noStart = {
    ...LEAFLET,
    validity: { from: null, until: null, raw_text: null },
  };
  const { document } = await build('el-jamon', [row], noStart);
  assert.equal(document.products[0].validity, undefined);
  assert.equal(
    document.products[0].extra.validity_text,
    'OFERTA VÁLIDA HASTA EL 14-9-2026'
  );
  assert.ok(
    document.warnings.some((warning) => /no start day/.test(warning.message))
  );

  const bad = { ...row, leaflet: { ...row.leaflet, validUntil: '14-9-2026' } };
  const second = await build('el-jamon', [bad]);
  assert.equal(second.document.products[0].validity, undefined);
  assert.ok(
    second.document.warnings.some((warning) =>
      /not a YYYY-MM-DD/.test(warning.message)
    )
  );
});

test('readPer reads the words, the abbreviations and the flat enum', () => {
  const cases = [
    ["LITRO 1'18", 'l'],
    ["KILO 3'61", 'kg'],
    ["100 ml 3'63", '100ml'],
    ['LAVADO 0,23', 'wash'],
    ['EUR/Ud', 'unit'],
    ['1,23 €/kg', 'kg'],
    ['0,46 €/l', 'l'],
    ['2,03 €/100 g', '100g'],
    ['13,99 €/g', 'g'],
    ['1,06 €/ud.', 'unit'],
    ['La ud sale a 0,66 €', 'unit'],
    ['el litro le sale a 1,61€', 'l'],
    ['100 ml. le sale a 0,93', '100ml'],
  ];
  for (const [label, per] of cases) {
    assert.equal(readPer(label), per, label);
  }
  assert.equal(readPer(null, 'kg'), 'kg');
  assert.equal(readPer('el litro le sale a', '100ml'), '100ml');
  assert.equal(readPer('sale a', null), null);
});
