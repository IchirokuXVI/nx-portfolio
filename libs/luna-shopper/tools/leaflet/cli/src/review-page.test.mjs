import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPage,
  cellsOf,
  compareRows,
  main,
  parseArgs,
  parseMine,
  parsePages,
  rowId,
} from './review-page.mjs';

const row = (over = {}) => ({
  name: 'Filetes de merluza',
  brand: 'Artiq',
  unitSize: 400,
  sizeFormat: 'g',
  price: 2.75,
  unitPrice: 6.88,
  unitPriceLabel: "KILO 6'88",
  categoryPath: ['CONGELADOS'],
  leaflet: {
    format: '400 g',
    basis: 'unit',
    wasPrice: null,
    loyalty: false,
    promotion: null,
  },
  ...over,
});

test('two readings that agree on every field are "agree"', () => {
  const a = cellsOf(row());
  const b = cellsOf(row({ brand: 'ARTIQ' }));
  const verdict = compareRows([a, b]);
  assert.equal(verdict.status, 'agree');
  assert.deepEqual(verdict.diffs, []);
});

test('a different name alone is a wording difference', () => {
  const a = cellsOf(row());
  const b = cellsOf(row({ name: 'Filetes de merluza sin piel 400 g' }));
  assert.equal(compareRows([a, b]).status, 'wording');
});

test('a different price, size or label is a row to check', () => {
  const a = cellsOf(row());
  assert.equal(compareRows([a, cellsOf(row({ price: 2.95 }))]).status, 'check');
  assert.equal(
    compareRows([a, cellsOf(row({ unitSize: 40, sizeFormat: 'cl' }))]).status,
    'check'
  );
  const label = compareRows([a, cellsOf(row({ unitPriceLabel: null }))]);
  assert.equal(label.status, 'check');
  assert.deepEqual(label.diffs, ['label']);
});

test('a reading with no row at that index is a row to check', () => {
  assert.equal(compareRows([cellsOf(row()), null]).status, 'check');
});

test('one reading alone has nothing to compare', () => {
  assert.equal(compareRows([cellsOf(row())]).status, 'single');
});

test('a person’s markdown table is read by page', () => {
  const mine = parseMine(
    [
      '| Page | # | Name | Brand | Size | Price | Footer | Basis | Notes |',
      '|---|---|---|---|---|---|---|---|---|',
      '| 4 FRUTERÍA | 1 | Aguacate HASS | null | none | 4.29 | €/KILO | kg | |',
      '| 4 | 2 | Banana | null | none | 1.29 | €/KILO | kg | origin printed |',
      'Not a row.',
    ].join('\n')
  );
  assert.equal(mine[4].length, 2);
  assert.equal(mine[4][0].name, 'Aguacate HASS');
  assert.equal(mine[4][1].notes, 'origin printed');
});

test('the page carries one article per row with its id and the saving controls', () => {
  const html = buildPage({
    leaflet: 'deza-2026-11',
    title: 'Deza Review',
    runs: ['opus', 'sonnet'],
    pages: [
      {
        page: 15,
        heading: 'CONGELADOS',
        image: 'pages/page_15.jpg',
        rows: [
          {
            id: rowId(15, 0),
            cells: [cellsOf(row()), cellsOf(row({ price: 2.95 }))],
            mine: null,
            verdict: 'Sonnet misread the price.',
          },
        ],
      },
    ],
  });
  assert.match(html, /<article class="row check" id="p15r1" data-row="p15r1">/);
  assert.match(html, /<span class="idx">15\.1<\/span>/);
  assert.match(html, /id="download-comments"/);
  assert.match(html, /id="w-p15r1"/);
  assert.match(html, /id="c-p15r1"/);
  assert.match(html, /Sonnet misread the price\./);
  assert.match(html, /"deza-2026-11"/);
  assert.match(html, /<td class="hard">2\.95<\/td>/);
});

test('the arguments name runs as label=dir and pages as a list', () => {
  const flags = parseArgs([
    '--run',
    'opus=a',
    '--run',
    'sonnet=b',
    '--pages',
    '4,10-12',
    '--out',
    'x',
  ]);
  assert.deepEqual(flags.runs, [
    { label: 'opus', dir: 'a' },
    { label: 'sonnet', dir: 'b' },
  ]);
  assert.deepEqual(parsePages(flags.pages), [4, 10, 11, 12]);
  assert.throws(() => parseArgs(['--run', 'nolabel']), /label=<dir>/);
  assert.throws(() => parsePages('4,x'), /not a list of pages/);
});

test("a person's table with CRLF line endings is read", () => {
  const mine = parseMine(
    '| page | # | name |\r\n|---|---|---|\r\n| 4 FRUTERÍA | 1 | Pera | B | 1 kg | 1.99 | KILO | unit | |\r\n| 4 | 2 | Kiwi | B | 1 kg | 2.49 | KILO | unit | |\r\n'
  );
  assert.equal(mine[4].length, 2);
  assert.equal(mine[4][1].name, 'Kiwi');
});

test('the leaflet id cannot close the script or expand a replacement pattern', () => {
  const html = buildPage({
    leaflet: "x$&</script>$'",
    title: 't',
    runs: ['a'],
    pages: [],
  });
  // The JSON escape of "<", spelled out so the test reads it literally.
  const lt = String.fromCharCode(92) + 'u003c';
  assert.ok(html.includes(`var LEAFLET = "x$&${lt}/script>$'";`));
  assert.equal(html.match(/<\/script>/g).length, 1);
});

test('the CLI refuses a leaflet id that is not one plain path segment', () => {
  assert.throws(
    () =>
      main([
        '--leaflet',
        'deza/2026',
        '--pages',
        '4',
        '--images',
        'nowhere',
        '--out',
        'nowhere',
        '--run',
        'a=nowhere',
      ]),
    /--leaflet deza\/2026 must be letters/
  );
});
