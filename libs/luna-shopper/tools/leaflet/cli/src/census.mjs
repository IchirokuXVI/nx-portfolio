/**
 * What kind of document this leaflet is, printed before anything is asked of a
 * model.
 *
 * It is step 1 because the two chains read so far were not the same kind of
 * document at all: El Jamon is 40 pages with a text layer on 28 of them, Deza
 * is 62 pages of flat images. A reader told that in advance reads differently
 * from one that finds out on page nine.
 *
 * **The page count comes from the PDF's own bytes**, by counting its
 * `/Type /Page` objects, so a census costs nothing and needs nothing installed.
 * A PDF that keeps its page objects in a compressed object stream answers zero
 * to that scan, and then the renderer is asked instead: PyMuPDF answers the
 * whole census in one call, and everything else answers the page count alone.
 *
 * **The text layer is reported when something can read it and "unknown"
 * otherwise.** PyMuPDF and `pdftotext` both answer it and neither is a
 * dependency, so a machine with only ImageMagick gets an honest "unknown"
 * rather than a number this file made up.
 *
 * Zero npm dependencies, Node built ins only. Not browser reachable.
 */

import { readFileSync } from 'node:fs';
import { runCommand } from './child.mjs';
import { formatPageList } from './commands.mjs';
import { PY_CENSUS, pagesInDirectory } from './render.mjs';

/** A page object, and not the `/Pages` tree node that holds them. */
const PAGE_OBJECT = /\/Type\s*\/Page(?![A-Za-z])/g;

/** A page box, in points. */
const MEDIA_BOX =
  /\/MediaBox\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\]/g;

/**
 * The page count and the page sizes the PDF states about itself.
 *
 * Answers a page count of zero for a PDF whose page objects live in an object
 * stream, which is the caller's signal to ask a tool instead.
 */
export function scanPdf(bytes) {
  const text = Buffer.isBuffer(bytes)
    ? bytes.toString('latin1')
    : String(bytes);
  const pageCount = (text.match(PAGE_OBJECT) ?? []).length;
  const sizes = [];
  for (const match of text.matchAll(MEDIA_BOX)) {
    sizes.push({
      width: Math.round(Number(match[3]) - Number(match[1])),
      height: Math.round(Number(match[4]) - Number(match[2])),
    });
  }
  return { pageCount, sizes };
}

/** The distinct page sizes, each with how many pages carry it. */
export function groupSizes(sizes) {
  const counts = new Map();
  for (const size of sizes) {
    const key = `${size.width}x${size.height}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, pages]) => {
      const [width, height] = key.split('x').map(Number);
      return { width, height, pages };
    });
}

/** PyMuPDF's one call answer, or null when this renderer is not PyMuPDF or the
 * call did not produce JSON. */
async function pymupdfCensus({ renderer, pdf, run, cwd }) {
  if (!renderer || renderer.key !== 'pymupdf') {
    return null;
  }
  const answer = await run(renderer.command, ['-c', PY_CENSUS, pdf], { cwd });
  if (!answer.started || answer.code !== 0) {
    return null;
  }
  try {
    return JSON.parse(answer.stdout.trim());
  } catch {
    return null;
  }
}

/** Whether each page carries a text layer, read with `pdftotext`, or null when
 * that tool is not there. */
async function pdftotextLayer({ pdf, pageCount, run, cwd }) {
  const probe = await run('pdftotext', ['-v'], { cwd });
  if (!probe.started) {
    return null;
  }
  const layer = [];
  for (let page = 1; page <= pageCount; page++) {
    const answer = await run(
      'pdftotext',
      ['-f', String(page), '-l', String(page), pdf, '-'],
      { cwd }
    );
    layer.push(answer.started && answer.stdout.trim().length > 0);
  }
  return layer;
}

/**
 * The census of one PDF.
 *
 * `renderer` is whatever `findRenderer` chose, or null when the pages were
 * handed over already rendered.
 */
export async function censusPdf({
  pdf,
  renderer = null,
  run = runCommand,
  readFile = readFileSync,
  cwd,
}) {
  const scanned = scanPdf(readFile(pdf));
  let pageCount = scanned.pageCount;
  let pageCountFrom = "the PDF's own /Type /Page objects";
  let sizes = groupSizes(scanned.sizes);
  let textLayer = null;
  let textLayerFrom = null;

  const byPyMuPdf = await pymupdfCensus({ renderer, pdf, run, cwd });
  if (byPyMuPdf) {
    pageCount = byPyMuPdf.pages;
    pageCountFrom = 'PyMuPDF';
    sizes = groupSizes(
      (byPyMuPdf.sizes ?? []).map(([width, height]) => ({ width, height }))
    );
    textLayer = byPyMuPdf.text ?? null;
    textLayerFrom = textLayer ? 'PyMuPDF' : null;
  }

  if (textLayer === null && pageCount > 0) {
    textLayer = await pdftotextLayer({ pdf, pageCount, run, cwd });
    textLayerFrom = textLayer ? 'pdftotext' : null;
  }

  return {
    kind: 'pdf',
    source: pdf,
    pageCount,
    pageCountFrom,
    sizes,
    textLayer,
    textLayerFrom,
  };
}

/**
 * The census of a directory that already holds the page images.
 *
 * **The page count is the highest page number there, not how many files there
 * are** (plan 0003). A folder holding `page_05.png` to `page_16.png` is pages 5
 * to 16 of a leaflet of at least 16 pages, and counting it as 12 refused pages
 * 13 to 16 as past the end. `pages` is the ones that are there, and a run with
 * no `--pages` reads exactly those.
 */
export function censusImages(dir, listPages = pagesInDirectory) {
  const pages = listPages(dir);
  return {
    kind: 'images',
    source: dir,
    pageCount: pages.length > 0 ? Math.max(...pages) : 0,
    pageCountFrom: 'the highest page_NN.png in the directory',
    pages,
    sizes: [],
    textLayer: null,
    textLayerFrom: null,
  };
}

/** The census as the operator reads it, one block of lines. */
export function formatCensus(census) {
  const lines = [`Census of ${census.source}`];
  lines.push(`  pages: ${census.pageCount}, from ${census.pageCountFrom}`);
  if (census.kind === 'images') {
    lines.push(
      `  page images there: ${census.pages.length}, pages ${formatPageList(census.pages) || 'none'}`,
      '  text layer: not read. The input is a directory of page images, and an image carries no text layer.'
    );
    return lines.join('\n');
  }
  if (census.sizes.length > 0) {
    lines.push(
      `  page size: ${census.sizes
        .map(
          (size) =>
            `${size.width} by ${size.height} pt on ${size.pages} page(s)`
        )
        .join(', ')}`
    );
  }
  if (census.textLayer) {
    const withText = census.textLayer
      .map((has, index) => (has ? index + 1 : null))
      .filter((page) => page !== null);
    lines.push(
      `  text layer: ${withText.length} of ${census.textLayer.length} pages, read with ${census.textLayerFrom}`
    );
    if (withText.length > 0 && withText.length < census.textLayer.length) {
      lines.push(`  pages with text: ${withText.join(', ')}`);
    }
  } else {
    lines.push(
      '  text layer: unknown. Neither PyMuPDF nor pdftotext is installed, and neither is a dependency of this tool.'
    );
  }
  return lines.join('\n');
}
