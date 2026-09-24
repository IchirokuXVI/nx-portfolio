import assert from 'node:assert/strict';
import test from 'node:test';
import { stripFence } from '../../../../../shared/model-engines/src/index.mjs';
import { checkPage, jsonLines, rowProblems } from './check-page.mjs';
import { readingPath } from './read-pages.mjs';

/** One row in the shape every chain prompt asks for, and nothing wrong. */
const GOOD_ROW = {
  name: 'Cerveza Radler Cruzcampo',
  brand: 'Cruzcampo',
  unitSize: 330,
  sizeFormat: 'ml',
  price: 0.39,
  unitPrice: 1.18,
  unitPriceLabel: 'el litro le sale a 1,18€',
  category: 'BEVERAGES',
  categoryPath: ['BEBIDAS'],
  leaflet: {
    format: 'lata 33 cl.',
    basis: 'unit',
    wasPrice: null,
    loyalty: false,
    validUntil: null,
    validityText: null,
    promotion: {
      type: 'second_unit_discount',
      rawText: '-50% 2a Unidad',
      requiredQuantity: 2,
      effectiveUnitPrice: null,
      totalPrice: 1.18,
      singleUnitPrice: 0.79,
    },
  },
};

/** One page file on a disk that is a Map. */
function onDisk(text, page = 5) {
  const files = new Map([[readingPath('/out/import', page), text]]);
  return {
    page,
    importDir: '/out/import',
    outDir: '/out',
    stripFence,
    exists: (path) => files.has(path),
    readFile: (path) => files.get(path),
  };
}

test('a good page passes, and says so', () => {
  const result = checkPage(onDisk(`${JSON.stringify([GOOD_ROW], null, 2)}\n`));
  assert.equal(result.ok, true);
  const text = result.lines.join('\n');
  assert.match(text, /page 5: .*page_05\.json, 1 row\(s\)/);
  assert.match(text, /the shape is right/);
  assert.doesNotMatch(text, /problem/);
});

test('a bad page names every problem with the line it sits on', () => {
  const bad = structuredClone(GOOD_ROW);
  bad.price = '0,39';
  bad.leaflet.basis = 'box';
  delete bad.leaflet.promotion.rawText;
  bad.leaflet.promotion.single_unit_price = 0.79;
  bad.colour = 'red';
  const text = `${JSON.stringify([GOOD_ROW, bad], null, 2)}\n`;
  const result = checkPage(onDisk(text));
  assert.equal(result.ok, false);
  const printed = result.lines.join('\n');
  // The line numbers are the file's own, so an editor goes straight there.
  const lineOf = (needle, from = 0) =>
    text
      .split('\n')
      .findIndex((line, index) => index >= from && line.includes(needle)) + 1;
  const second = text
    .split('\n')
    .findIndex((line, index) => index > 2 && line.trim() === '{');
  assert.match(
    printed,
    new RegExp(
      `line ${lineOf('"price": "0,39"')}, row 2 \\(Cerveza Radler Cruzcampo\\): price is the text "0,39", and it has to be a number`
    )
  );
  assert.match(
    printed,
    new RegExp(
      `line ${lineOf('"basis": "box"')}, row 2 .*leaflet\\.basis is "box", and it has to be one of unit, pack, kg, l`
    )
  );
  assert.match(
    printed,
    new RegExp(
      `line ${lineOf('"promotion": {', second)}, row 2 .*leaflet\\.promotion\\.rawText is missing`
    )
  );
  assert.match(
    printed,
    /leaflet\.promotion\.single_unit_price is the flat shape plan 0002 retired\. Write it as singleUnitPrice/
  );
  assert.match(
    printed,
    new RegExp(
      `line ${lineOf('"colour"')}, row 2 .*colour is a key no reading shape names`
    )
  );
  assert.match(printed, /problem\(s\)\. Fix the file and check it again with:/);
  assert.match(
    printed,
    /npx nx run luna-shopper\/leaflet-cli:read -- --out \/out --check-page 5/
  );
});

test('a page that is not JSON names the line the parser stopped on', () => {
  const result = checkPage(onDisk('[\n  {"name": "a",\n  "price": 1,,\n}]\n'));
  assert.equal(result.ok, false);
  assert.match(result.lines.join('\n'), /line 3: not JSON/);
});

test('a page that is an object and not an array is refused', () => {
  const result = checkPage(onDisk('{"offers": []}'));
  assert.equal(result.ok, false);
  assert.match(
    result.lines.join('\n'),
    /line 1: the file holds object, and it has to be one JSON array/
  );
});

test('a page that is not there says where to write it', () => {
  const result = checkPage({ ...onDisk('[]'), page: 7 });
  assert.equal(result.ok, false);
  assert.match(
    result.lines.join('\n'),
    /page 7: there is no .*page_07\.json yet/
  );
});

test('the sanity pass is printed as rows to look at, and does not fail the page', () => {
  const drop = structuredClone(GOOD_ROW);
  drop.name = 'Leche Entera';
  drop.leaflet.wasPrice = 0.3;
  drop.leaflet.promotion = null;
  const text = `\`\`\`json\n${JSON.stringify([drop], null, 2)}\n\`\`\`\n`;
  const result = checkPage(onDisk(text));
  assert.equal(result.ok, true);
  const printed = result.lines.join('\n');
  assert.match(printed, /Sanity pass, 1 row\(s\) to look at/);
  // The fence moves every line down by one, and the count still starts at the
  // top of the file: the fence, the bracket, then the row.
  assert.match(
    printed,
    /line 3: \[was price is not above the price\] page 5, Leche Entera/
  );
});

test('an empty page is a page with no priced product, and is right', () => {
  assert.equal(checkPage(onDisk('[]\n')).ok, true);
});

test('the line map keys every value by its path', () => {
  const lines = jsonLines(
    '[\n  {\n    "a": 1,\n    "b": { "c": [2, 3] }\n  }\n]'
  );
  assert.equal(lines.get(''), 1);
  assert.equal(lines.get('0'), 2);
  assert.equal(lines.get('0.a'), 3);
  assert.equal(lines.get('0.b.c'), 4);
});

test('a row in the old flat shape is told where each key moved', () => {
  const problems = rowProblems({
    name: 'Leche',
    was_price: 1.2,
    unit_price_per: 'l',
  }).map((entry) => entry.message);
  assert.ok(
    problems.includes(
      'was_price is the flat shape plan 0002 retired. Write it as leaflet.wasPrice'
    )
  );
  assert.ok(
    problems.some((message) =>
      message.startsWith('unit_price_per is the flat shape')
    )
  );
  assert.ok(
    problems.some((message) => message.startsWith('leaflet is missing'))
  );
});
