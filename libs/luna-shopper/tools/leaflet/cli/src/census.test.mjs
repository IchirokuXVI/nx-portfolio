import assert from 'node:assert/strict';
import test from 'node:test';
import {
  censusImages,
  censusPdf,
  formatCensus,
  groupSizes,
  scanPdf,
} from './census.mjs';

/** A PDF's own bytes, cut down to the two things the scan reads. */
const THREE_PAGES = Buffer.from(
  [
    '%PDF-1.4',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Count 3 >> endobj',
    '3 0 obj << /Type /Page /MediaBox [0 0 467 794] >> endobj',
    '4 0 obj << /Type /Page /MediaBox [0 0 467 794] >> endobj',
    '5 0 obj << /Type/Page /MediaBox [ 0 0 595.28 841.89 ] >> endobj',
  ].join('\n'),
  'latin1'
);

/** One revision of a PDF: its objects, then the cross reference table and the
 * trailer that locate them. `prev` is where the revision before it put its own
 * table, which is what makes a revision an incremental update. */
function appendRevision(pdf, objects, { prev = null } = {}) {
  let out = pdf;
  const offsets = new Map();
  for (const [number, body] of objects) {
    offsets.set(number, Buffer.byteLength(out, 'latin1'));
    out += `${number} 0 obj\n${body}\nendobj\n`;
  }
  const xrefAt = Buffer.byteLength(out, 'latin1');
  out += 'xref\n';
  if (prev === null) {
    out += `0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const [number] of objects) {
      out += `${String(offsets.get(number)).padStart(10, '0')} 00000 n \n`;
    }
  } else {
    for (const [number] of objects) {
      out += `${number} 1\n${String(offsets.get(number)).padStart(10, '0')} 00000 n \n`;
    }
  }
  const trailer =
    prev === null ? '/Size 6 /Root 1 0 R' : `/Size 6 /Root 1 0 R /Prev ${prev}`;
  out += `trailer\n<< ${trailer} >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return { pdf: out, xrefAt };
}

/**
 * A small synthetic PDF of two pages, saved once and then saved again with an
 * incremental update that rotates page one.
 *
 * The update appends a second copy of page object 3 and edits nothing, which is
 * what an incremental save does. So the bytes hold three `/Type /Page` objects
 * for two pages, the shape that made a 44 page leaflet count as 85 (plan 0005).
 */
function twoPagesSavedTwice() {
  const page = (extra = '') =>
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 467 794] /Contents 5 0 R${extra} >>`;
  const first = appendRevision('%PDF-1.4\n', [
    [1, '<< /Type /Catalog /Pages 2 0 R >>'],
    [2, '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>'],
    [3, page()],
    [4, page()],
    [5, '<< /Length 0 >>\nstream\n\nendstream'],
  ]);
  const second = appendRevision(first.pdf, [[3, page(' /Rotate 90')]], {
    prev: first.xrefAt,
  });
  return Buffer.from(second.pdf, 'latin1');
}

test('with no trailer to find the tree by, the page count is the distinct page objects', () => {
  const scanned = scanPdf(THREE_PAGES);
  assert.equal(scanned.pageCount, 3);
  assert.match(scanned.pageCountFrom, /distinct \/Type \/Page objects/);
});

test('a 2 page PDF that holds an incremental update of one page counts 2 pages', () => {
  const bytes = twoPagesSavedTwice();
  // The defect this guards: page one is in the file twice, so counting every
  // page object answers three.
  assert.equal(bytes.toString('latin1').match(/\/Type \/Page /g).length, 3);

  const scanned = scanPdf(bytes);
  assert.equal(scanned.pageCount, 2);
  assert.match(scanned.pageCountFrom, /page tree/);
  assert.deepEqual(groupSizes(scanned.sizes), [
    { width: 467, height: 794, pages: 2 },
  ]);
});

test('with no readable page tree, a rewritten page is still one page', () => {
  // The same file with its catalog out of reach, as it is when a PDF keeps it
  // in a compressed object stream.
  const bytes = twoPagesSavedTwice()
    .toString('latin1')
    .replace('/Type /Catalog /Pages 2 0 R', '/Type /Catalog');
  const scanned = scanPdf(bytes);
  assert.equal(scanned.pageCount, 2);
  assert.match(scanned.pageCountFrom, /distinct \/Type \/Page objects/);
  assert.equal(scanned.sizes.length, 2);
});

test('the page sizes are read in points, with no space needed after /Type', () => {
  const sizes = groupSizes(scanPdf(THREE_PAGES).sizes);
  assert.deepEqual(sizes, [
    { width: 467, height: 794, pages: 2 },
    { width: 595, height: 842, pages: 1 },
  ]);
});

test('a PDF whose page objects are compressed answers zero, and says nothing more', () => {
  const scanned = scanPdf(Buffer.from('%PDF-1.7\n8 0 obj << /ObjStm >>'));
  assert.equal(scanned.pageCount, 0);
  assert.deepEqual(scanned.sizes, []);
});

test('with no tool at all the census is the byte scan and the text layer is unknown', async () => {
  const census = await censusPdf({
    pdf: 'a.pdf',
    renderer: null,
    readFile: () => THREE_PAGES,
    run: async () => ({ started: false, code: -1, stdout: '', stderr: '' }),
  });
  assert.equal(census.pageCount, 3);
  assert.match(census.pageCountFrom, /distinct \/Type \/Page objects/);
  assert.equal(census.textLayer, null);
  assert.match(formatCensus(census), /text layer: unknown/);
});

test('PyMuPDF answers the whole census in one call and wins over the scan', async () => {
  const calls = [];
  const census = await censusPdf({
    pdf: 'a.pdf',
    renderer: { key: 'pymupdf', command: 'python' },
    readFile: () => THREE_PAGES,
    run: async (command) => {
      calls.push(command);
      return {
        started: true,
        code: 0,
        stdout: JSON.stringify({
          pages: 40,
          sizes: Array.from({ length: 40 }, () => [595, 842]),
          text: Array.from({ length: 40 }, (_, index) => index < 28),
        }),
        stderr: '',
      };
    },
  });
  assert.deepEqual(calls, ['python']);
  assert.equal(census.pageCount, 40);
  assert.equal(census.pageCountFrom, 'PyMuPDF');
  assert.equal(census.textLayerFrom, 'PyMuPDF');
  const printed = formatCensus(census);
  assert.match(printed, /pages: 40/);
  assert.match(printed, /text layer: 28 of 40 pages/);
});

test('pdftotext answers the text layer when PyMuPDF is not the renderer', async () => {
  const census = await censusPdf({
    pdf: 'a.pdf',
    renderer: { key: 'pdftoppm', command: 'pdftoppm' },
    readFile: () => THREE_PAGES,
    run: async (command, args) => {
      if (command !== 'pdftotext') {
        return { started: false, code: -1, stdout: '', stderr: '' };
      }
      if (args.includes('-v')) {
        return { started: true, code: 0, stdout: '', stderr: 'pdftotext 24' };
      }
      // Page 2 is flat artwork and prints nothing.
      const page = args[args.indexOf('-f') + 1];
      return {
        started: true,
        code: 0,
        stdout: page === '2' ? '  \n' : 'CARNICERIA',
        stderr: '',
      };
    },
  });
  assert.deepEqual(census.textLayer, [true, false, true]);
  assert.equal(census.textLayerFrom, 'pdftotext');
  assert.match(formatCensus(census), /pages with text: 1, 3/);
});

test('a folder of page images counts its highest page, and names what is there', () => {
  // Pages 5 to 16, as backend plan 0150 rendered them.
  const present = Array.from({ length: 12 }, (_, index) => index + 5);
  const census = censusImages('/pages', () => present);
  assert.equal(census.pageCount, 16);
  assert.deepEqual(census.pages, present);
  const printed = formatCensus(census);
  assert.match(printed, /pages: 16, from the highest page_NN.png/);
  assert.match(printed, /page images there: 12, pages 5-16/);
  // It names the input, rather than blaming a tool that is not needed.
  assert.match(printed, /The input is a directory of page images/);
  assert.doesNotMatch(printed, /Neither PyMuPDF nor pdftotext is installed/);
});

test('an empty folder counts no pages', () => {
  assert.equal(censusImages('/pages', () => []).pageCount, 0);
});
