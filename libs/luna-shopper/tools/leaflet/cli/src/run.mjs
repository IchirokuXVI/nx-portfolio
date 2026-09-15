/**
 * The eight steps, in order, and each one can refuse.
 *
 * 1. Census. What kind of document this is, before anything is asked of a model.
 * 2. Render. Every page to a PNG under `<out>/pages/`.
 * 3. Layout check. The chain's own description against the first three pages.
 * 4. Read. One call per page, writing `<out>/import/page_NN.json` as it goes.
 * 5. Sanity pass. Which rows to look at, whatever produced them.
 * 6. Leaflet metadata. `<out>/import/leaflet.json`, with the printed validity.
 * 7. Build, drift check, validate. The three existing scripts, unchanged.
 * 8. Report. What was read, what to look at, and the upload call to make.
 *
 * Every process, file and clock this file touches is injected, so the whole of
 * it runs under `node --test` with no renderer installed and no model called.
 *
 * Zero npm dependencies, Node built ins only. Not browser reachable.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { censusImages, censusPdf, formatCensus } from './census.mjs';
import { runCommand, runStreamed } from './child.mjs';
import {
  askValidity,
  buildLeafletJson,
  extractionTool,
  formatReport,
  formatValidity,
  runScripts,
  validityWarning,
  writeLeafletJson,
  writePagesManifest,
} from './document.mjs';
import { checkLayout, checkPages, formatMismatch } from './layout-check.mjs';
import {
  collectManualReadings,
  promptFile,
  writePromptFile,
  writeRunFile,
} from './manual.mjs';
import { localEngineNotice, localEngineShortNotice } from './notice.mjs';
import { readPages } from './read-pages.mjs';
import {
  installLines,
  pageImagePath,
  pagesInDirectory,
  findRenderer as probeRenderer,
  renderPages,
} from './render.mjs';
import { sanityPass } from './sanity.mjs';

/** A directory that has to exist before anything writes into it. */
const ensure = (mkdir, ...dirs) => {
  for (const dir of dirs) {
    mkdir(dir, { recursive: true });
  }
};

/**
 * `1-12,31` into `[1, ..., 12, 31]`, or every page when nothing was asked.
 *
 * A page outside the leaflet is refused here rather than failing at render
 * time, where it reads as a broken PDF.
 */
export function parsePages(spec, pageCount) {
  if (spec === undefined || spec === null || spec === true || spec === '') {
    return Array.from({ length: pageCount }, (unused, index) => index + 1);
  }
  const wanted = new Set();
  for (const part of String(spec).split(',')) {
    const piece = part.trim();
    if (piece === '') {
      continue;
    }
    const range = /^(\d+)-(\d+)$/.exec(piece);
    if (range) {
      const from = Number(range[1]);
      const until = Number(range[2]);
      if (from > until) {
        throw new Error(`--pages ${piece} counts backwards.`);
      }
      for (let page = from; page <= until; page++) {
        wanted.add(page);
      }
      continue;
    }
    if (!/^\d+$/.test(piece)) {
      throw new Error(`--pages ${piece} is not a page or a range of pages.`);
    }
    wanted.add(Number(piece));
  }
  const pages = [...wanted].sort((a, b) => a - b);
  if (pages.length === 0) {
    throw new Error('--pages named no page at all.');
  }
  const past = pages.filter((page) => page > pageCount || page < 1);
  if (past.length > 0 && pageCount > 0) {
    throw new Error(
      `--pages names ${past.join(', ')}, and the leaflet has ${pageCount} page(s).`
    );
  }
  return pages;
}

/**
 * One read, end to end.
 *
 * `engine` is null in manual mode, which is the one mode with no `ask` to call.
 */
export async function runRead({
  chain,
  defaults,
  source,
  sourceIsDirectory,
  outDir,
  pagesSpec = null,
  dpi,
  resume = false,
  dryRun = false,
  manual = false,
  timeoutMs,
  engine = null,
  engineName,
  model = null,
  isLocal = false,
  prompt,
  layout,
  stripFence,
  stdout = process.stdout,
  stderr = process.stderr,
  run = runCommand,
  stream = runStreamed,
  findRenderer = probeRenderer,
  mkdir = mkdirSync,
  writeFile = writeFileSync,
  readFile = readFileSync,
  exists = existsSync,
  listPages = pagesInDirectory,
  now = () => new Date(),
}) {
  const pagesDir = join(outDir, 'pages');
  const importDir = join(outDir, 'import');
  ensure(mkdir, outDir, pagesDir, importDir);

  const notice = isLocal ? localEngineNotice(engineName, model) : null;
  if (notice) {
    // Before the run as well as after: the warning is worth nothing to somebody
    // who has already waited eleven minutes and started reading the output.
    stdout.write(`${notice}\n\n`);
  }

  // 1 and 2. The census, then the renderer, unless the pages arrived rendered.
  let renderer = null;
  let census;
  if (sourceIsDirectory) {
    census = censusImages(source, listPages);
  } else {
    renderer = await findRenderer({ run });
    census = await censusPdf({ pdf: source, renderer, run, readFile });
  }
  stdout.write(`${formatCensus(census)}\n`);

  if (census.pageCount === 0) {
    throw new Error(
      sourceIsDirectory
        ? `${source} holds no page_NN.png, so there is nothing to read.`
        : `${source} answers no page count. A PDF that keeps its page objects in a compressed object stream needs PyMuPDF installed for the census to read it.`
    );
  }

  const pages = parsePages(pagesSpec, census.pageCount);

  if (dryRun) {
    // The census and the layout, and nothing that costs a render or a call.
    stdout.write(
      `\nWhat one page of ${chain.slug} should look like:\n\n${layout}\n`
    );
    stdout.write(
      '\n--dry-run, so no page was rendered and no page was read.\n'
    );
    return { code: 0, dryRun: true };
  }

  if (sourceIsDirectory) {
    const there = listPages(source);
    const absent = pages.filter((page) => !there.includes(page));
    if (absent.length > 0) {
      throw new Error(
        `${source} has no page_${String(absent[0]).padStart(2, '0')}.png, and ${absent.length} page(s) are missing in all.`
      );
    }
  } else {
    if (!renderer) {
      stdout.write(`\n${installLines()}\n`);
      return { code: 2, rendered: false };
    }
    const toRender = resume
      ? pages.filter((page) => !exists(pageImagePath(pagesDir, page)))
      : pages;
    if (toRender.length > 0) {
      stdout.write(
        `\nRendering ${toRender.length} page(s) at ${dpi} dpi with ${renderer.label}.\n`
      );
      await renderPages({
        renderer,
        pdf: source,
        outDir: pagesDir,
        dpi,
        pages: toRender,
        run,
      });
    }
  }

  const imageDir = sourceIsDirectory ? source : pagesDir;
  const imagesFor = (page) => [
    {
      mediaType: 'image/png',
      data: readFile(pageImagePath(imageDir, page)).toString('base64'),
    },
  ];

  // What the pick up needs and nothing records: the PDF and the chain.
  writeRunFile(
    outDir,
    {
      chain: chain.slug,
      pdf: resolve(source),
      pdfIsDirectory: sourceIsDirectory === true,
      pages,
      dpi,
      engine: engineName,
      model,
      startedAt: now().toISOString(),
    },
    writeFile
  );

  const warnings = [];
  let readings;
  let pagesRead = 0;
  let skipped = [];

  if (manual && !resume) {
    // The hand off. The run stops here and the person reads the pages.
    const path = writePromptFile(
      outDir,
      promptFile({
        slug: chain.slug,
        prompt,
        layout,
        census: formatCensus(census),
        pages,
        pagesDir: imageDir,
        importDir,
        outDir,
      }),
      writeFile
    );
    stdout.write(
      [
        '',
        `Paste ${path} into Claude Code, or into any model you like.`,
        'It names every page image by its absolute path and where each answer goes.',
        '',
        'Then pick the run back up with:',
        `  npx nx run luna-shopper/leaflet-cli:read -- --out ${outDir} --resume --engine manual`,
        '',
      ].join('\n')
    );
    return { code: 0, handedOff: true, promptPath: path };
  }

  if (manual) {
    // The pick up. Nothing is edited: a bad reading is named and refused.
    readings = collectManualReadings({
      pages,
      importDir,
      stripFence,
      exists,
      readFile,
    });
    pagesRead = readings.size;
  } else {
    // 3. The layout check, which is the only step that needs the model and the
    // chain description to agree. Manual mode never reaches it: the layout is
    // in PROMPT.md and the person reading the pages is the one checking it.
    const verdict = await checkLayout({
      engine,
      layout,
      images: checkPages(pages).flatMap(imagesFor),
      stripFence,
    });
    if (!verdict.ok) {
      stdout.write(`\n${formatMismatch(chain.slug, verdict.differences)}\n`);
      return { code: 1, layoutMismatch: true };
    }
    stdout.write(
      verdict.unreadable
        ? `\nLayout check: the model's answer could not be read, so the run carries on. Look at the first pages yourself.\n`
        : `\nLayout check: the first ${checkPages(pages).length} page(s) match chains/${chain.slug}/layout.md.\n`
    );

    // 4. The pages.
    const read = await readPages({
      engine,
      prompt,
      pages,
      pagesDir: imageDir,
      importDir,
      resume,
      timeoutMs,
      stripFence,
      readFile,
      writeFile,
      exists,
      imagesFor,
      stderr,
    });
    readings = read.readings;
    warnings.push(...read.warnings);
    skipped = read.skipped;
    pagesRead = readings.size;
  }

  // 5. The sanity pass, for every engine, because every model has a systematic
  // defect and only the defect differs.
  warnings.push(...sanityPass(readings));

  // 6. The leaflet's own file. Manual mode has no engine to ask, so its validity
  // is left for the operator to fill in by hand rather than guessed.
  const validity = manual
    ? { from: null, until: null, raw_text: null }
    : await askValidity({ engine, images: imagesFor(pages[0]), stripFence });
  // A leaflet that arrived as images has no one file to take a digest of, so
  // the run writes a manifest of the page digests and points `pdf` at that.
  const digested = sourceIsDirectory
    ? writePagesManifest({
        importDir,
        imageDir,
        pages,
        pageFile: pageImagePath,
        readFile,
        writeFile,
      })
    : resolve(source);
  const leaflet = buildLeafletJson({
    pdf: relative(importDir, digested) || digested,
    pageCount: census.pageCount,
    fixedSections: defaults.fixedSections ?? {},
    validity,
    tool: extractionTool({
      engine: engineName,
      model,
      slug: chain.slug,
      notice: isLocal ? localEngineShortNotice(engineName, model) : null,
    }),
    date: now().toISOString(),
  });
  writeLeafletJson(importDir, leaflet, writeFile);
  stdout.write(`\n${formatValidity(leaflet)}\n`);
  const validityNote = validityWarning(leaflet);
  if (validityNote) {
    warnings.push(validityNote);
  }

  // 7. The three existing scripts, unchanged.
  const outcome = await runScripts({
    slug: chain.slug,
    importDir,
    outDir,
    chain,
    stream,
    exists,
    stdout,
  });

  // 8. The report.
  stdout.write(
    `${formatReport({
      slug: chain.slug,
      pagesRead,
      skipped,
      warnings,
      outcome,
      readFile,
      exists,
      notice,
    })}\n`
  );

  // A run that did not produce a valid document ends non-zero, whichever of the
  // three steps stopped it. A shell that read zero here would treat a refused
  // reading as a finished one.
  const ready = outcome.built && outcome.validated === 'valid';
  return { code: ready ? 0 : 1, outcome, warnings };
}
