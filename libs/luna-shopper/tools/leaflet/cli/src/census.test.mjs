import assert from 'node:assert/strict';
import test from 'node:test';
import { censusPdf, formatCensus, groupSizes, scanPdf } from './census.mjs';

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

test('the page count comes from the page objects and not the Pages node', () => {
  const scanned = scanPdf(THREE_PAGES);
  assert.equal(scanned.pageCount, 3);
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
  assert.match(census.pageCountFrom, /\/Type \/Page/);
  assert.equal(census.textLayer, null);
  assert.match(formatCensus(census), /text layer: unknown/);
});

test('PyMuPDF answers the whole census in one call and wins over the scan', async () => {
  const calls = [];
  const census = await censusPdf({
    pdf: 'a.pdf',
    renderer: { key: 'pymupdf', command: 'python' },
    readFile: () => THREE_PAGES,
    run: async (command, args) => {
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
