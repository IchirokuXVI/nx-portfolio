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
 * `--finish` is steps 5 to 8 alone, for a manual run whose pages a person wrote
 * (plan 0003). See `finishRun`.
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
  checkPageCommand,
  finishCommand,
  formatPageList,
  resumeCommand,
} from './commands.mjs';
import {
  askValidity,
  buildLeafletJson,
  extractionTool,
  formatReport,
  formatValidity,
  mergeLeafletJson,
  readLeafletJson,
  resolveValidity,
  runScripts,
  validityWarning,
  windowKnown,
  writeLeafletJson,
  writePagesManifest,
} from './document.mjs';
import { checkLayout, checkPages, formatMismatch } from './layout-check.mjs';
import {
  collectManualReadings,
  mergeRunFile,
  promptFile,
  writePromptFile,
  writeRunFile,
} from './manual.mjs';
import { localEngineNotice, localEngineShortNotice } from './notice.mjs';
import { keepAnswer, readPages } from './read-pages.mjs';
import {
  installLines,
  pageImagePath,
  pagesInDirectory,
  findRenderer as probeRenderer,
  renderPages,
} from './render.mjs';
import { sanityPass } from './sanity.mjs';

/**
 * Where a layout check answer nobody could read is kept.
 *
 * The page readings keep theirs as `page_NN.attempt_K.txt`, and this is the one
 * other model call the run carries on from rather than stopping at. The
 * validity answer is not kept beside them: an unreadable answer and a cover
 * that prints no dates both parse to the same three nulls there, so a file
 * would be written for a cover that answered perfectly well.
 */
export const LAYOUT_ANSWER_FILE = 'layout-check.attempt_1.txt';

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
 * Step 2 with the renderer it found, and the next one when that one cannot.
 *
 * A renderer that answered the probe and then wrote no page at all is not a
 * renderer for this PDF: ImageMagick without Ghostscript is the case, and on
 * the machine of backend plan 0150 it stood in front of everything else. So the
 * run says what failed and asks for the next renderer, and Docker is the last
 * of them. A renderer that wrote some pages and then failed is a broken page,
 * and that one is named and stops the run.
 *
 * Answers the renderer that rendered, or null when none could.
 */
async function renderWithFallback({
  renderer,
  findRenderer,
  render,
  run,
  source,
  pagesDir,
  dpi,
  pages,
  exists,
  stdout,
}) {
  const tried = [];
  let current = renderer;
  while (current) {
    stdout.write(
      `\nRendering ${pages.length} page(s) at ${dpi} dpi with ${current.label}.\n`
    );
    try {
      await render({
        renderer: current,
        pdf: source,
        outDir: pagesDir,
        dpi,
        pages,
        run,
        exists,
        say: (line) => stdout.write(`${line}\n`),
      });
      return current;
    } catch (error) {
      if (error?.rendered !== 0) {
        throw error;
      }
      tried.push(current.key);
      stdout.write(
        `${error.message}\n${current.label} answered the probe and rendered no page, so the run tries the next renderer.\n`
      );
      current = await findRenderer({ run, skip: tried });
    }
  }
  return null;
}

/**
 * One read, end to end.
 *
 * `engine` is null in manual mode, which is the one mode with no `ask` to call.
 *
 * `statedValidity` is this run's `--valid-from` and `--valid-until`, and
 * `recordedValidity` is what an earlier run of this `--out` was given, read
 * back from `run.json` by the caller on a resume.
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
  statedValidity = {},
  recordedValidity = null,
  prompt,
  layout,
  stripFence,
  stdout = process.stdout,
  stderr = process.stderr,
  run = runCommand,
  stream = runStreamed,
  findRenderer = probeRenderer,
  render = renderPages,
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

  // A folder of images with no `--pages` is read for the pages it holds, and
  // not for every number up to the highest of them (plan 0003).
  const pages =
    sourceIsDirectory && (pagesSpec === null || pagesSpec === undefined)
      ? census.pages
      : parsePages(pagesSpec, census.pageCount);

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
    const toRender = resume
      ? pages.filter((page) => !exists(pageImagePath(pagesDir, page)))
      : pages;
    // A resume whose pages are all rendered needs no renderer at all.
    if (toRender.length > 0) {
      const used = renderer
        ? await renderWithFallback({
            renderer,
            findRenderer,
            render,
            run,
            source,
            pagesDir,
            dpi,
            pages: toRender,
            exists,
            stdout,
          })
        : null;
      if (!used) {
        stdout.write(`\n${installLines()}\n`);
        return { code: 2, rendered: false };
      }
    }
  }

  const imageDir = sourceIsDirectory ? source : pagesDir;

  // What the pick up needs and nothing records: the PDF, the chain, the pages
  // and the dates the operator stated. A resume merges into what the first pass
  // wrote rather than writing it whole (plan 0003).
  const stated = ['from', 'until'].some((field) => statedValidity?.[field]);
  const record = {
    chain: chain.slug,
    pdf: resolve(source),
    pdfIsDirectory: sourceIsDirectory === true,
    pages,
    pageCount: census.pageCount,
    dpi,
    engine: engineName,
    model,
    ...(stated
      ? {
          validity: {
            from: statedValidity.from ?? null,
            until: statedValidity.until ?? null,
          },
        }
      : {}),
  };
  if (resume) {
    mergeRunFile(
      outDir,
      { ...record, resumedAt: now().toISOString() },
      { writeFile, exists, readFile }
    );
  } else {
    writeRunFile(
      outDir,
      { ...record, startedAt: now().toISOString() },
      writeFile
    );
  }

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
        'Check each page as it is written, for example the first one:',
        `  ${checkPageCommand({ outDir, page: pages[0] })}`,
        '',
        'When every page is written, build, drift check and validate with:',
        `  ${finishCommand({ outDir })}`,
        '',
      ].join('\n')
    );
    return { code: 0, handedOff: true, promptPath: path };
  }

  const imagesFor = (page) => [
    {
      mediaType: 'image/png',
      data: readFile(pageImagePath(imageDir, page)).toString('base64'),
    },
  ];

  const warnings = [];
  let readings;
  let skipped = [];

  if (manual) {
    // The pick up. Nothing is edited: a bad reading is named and refused.
    readings = collectManualReadings({
      pages,
      importDir,
      stripFence,
      exists,
      readFile,
    });
  } else {
    // 3. The layout check, which is the only step that needs the model and the
    // chain description to agree. Manual mode never reaches it: the layout is
    // in PROMPT.md and the person reading the pages is the one checking it.
    const verdict = await checkLayout({
      engine,
      layout,
      images: checkPages(pages).flatMap(imagesFor),
      stripFence,
      keep: (text) =>
        keepAnswer(join(importDir, LAYOUT_ANSWER_FILE), text, writeFile),
    });
    if (!verdict.ok) {
      stdout.write(`\n${formatMismatch(chain.slug, verdict.differences)}\n`);
      return { code: 1, layoutMismatch: true };
    }
    stdout.write(
      verdict.unreadable
        ? `\nLayout check: the model's answer could not be read, so the run carries on.${verdict.kept ? ` The raw answer is in ${verdict.kept}.` : ''} Look at the first pages yourself.\n`
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
  }

  return completeRun({
    chain,
    defaults,
    outDir,
    importDir,
    imageDir,
    source,
    sourceIsDirectory,
    pages,
    pageCount: census.pageCount,
    readings,
    warnings,
    skipped,
    engine,
    engineName,
    model,
    isLocal,
    notice,
    statedValidity,
    recordedValidity,
    askImages: engine ? imagesFor(pages[0]) : null,
    stripFence,
    stdout,
    stream,
    readFile,
    writeFile,
    exists,
    now,
  });
}

/**
 * Steps 5 to 8, whatever produced the readings: the sanity pass, the leaflet's
 * own file, the three scripts, and the report.
 *
 * The cover is asked for the window only when an engine is there to ask and
 * nobody has said both bounds already: not this run's flags, not a person
 * editing `leaflet.json`, and not the flags an earlier run recorded.
 */
async function completeRun({
  chain,
  defaults,
  outDir,
  importDir,
  imageDir,
  source,
  sourceIsDirectory,
  pages,
  pageCount,
  readings,
  warnings,
  skipped,
  engine,
  engineName,
  model,
  isLocal,
  notice,
  statedValidity,
  recordedValidity,
  askImages,
  stripFence,
  stdout,
  stream,
  readFile,
  writeFile,
  exists,
  now,
}) {
  // 5. The sanity pass, for every engine, because every model has a systematic
  // defect and only the defect differs.
  warnings.push(...sanityPass(readings));

  // 6. The leaflet's own file, over whatever a person already filled in.
  const existing = readLeafletJson(importDir, { exists, readFile });
  const known = windowKnown({
    stated: statedValidity,
    existing: existing?.validity,
    recorded: recordedValidity,
  });
  const asked =
    engine && !known
      ? await askValidity({ engine, images: askImages, stripFence })
      : null;
  const { validity, origins } = resolveValidity({
    stated: statedValidity,
    existing: existing?.validity,
    recorded: recordedValidity,
    asked,
  });
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
  const leaflet = mergeLeafletJson(
    buildLeafletJson({
      pdf: relative(importDir, digested) || digested,
      pageCount,
      fixedSections: defaults.fixedSections ?? {},
      validity,
      tool: extractionTool({
        engine: engineName,
        model,
        slug: chain.slug,
        notice: isLocal ? localEngineShortNotice(engineName, model) : null,
      }),
      date: now().toISOString(),
    }),
    existing
  );
  writeLeafletJson(importDir, leaflet, writeFile);
  stdout.write(`\n${formatValidity(leaflet, origins)}\n`);
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
      pagesRead: readings.size,
      skipped,
      warnings,
      outcome,
      readFile,
      exists,
      notice,
      importDir,
      resume:
        engineName === 'manual'
          ? finishCommand({ outDir })
          : resumeCommand({ outDir, engineName, model, pages, pageCount }),
    })}\n`
  );

  // A run that did not produce a valid document ends non-zero, whichever of the
  // three steps stopped it. A shell that read zero here would treat a refused
  // reading as a finished one.
  const ready = outcome.built && outcome.validated === 'valid';
  return { code: ready ? 0 : 1, outcome, warnings };
}

/**
 * `--finish`: a manual run's last three steps, from `run.json` alone (plan
 * 0003).
 *
 * The chain, the pages, the page count, the dpi and the dates all come from the
 * file the first pass wrote, so the command is `--out` and `--finish` and nothing
 * else. It renders nothing, asks no model, and refuses a page with no reading or
 * an unreadable one exactly as the manual pick up does. Build, drift check and
 * validate then run in order and stop at the first failure.
 */
export async function finishRun({
  chain,
  defaults,
  outDir,
  recorded,
  statedValidity = {},
  stripFence,
  stdout = process.stdout,
  stream = runStreamed,
  writeFile = writeFileSync,
  readFile = readFileSync,
  exists = existsSync,
  now = () => new Date(),
}) {
  const pages = Array.isArray(recorded?.pages) ? recorded.pages : [];
  if (pages.length === 0) {
    throw new Error(
      `${join(outDir, 'run.json')} names no pages, so there is nothing to finish. Start the run again with --pdf.`
    );
  }
  const importDir = join(outDir, 'import');
  const sourceIsDirectory = recorded.pdfIsDirectory === true;
  const pageCount = recorded.pageCount ?? Math.max(...pages);
  const engineName = recorded.engine ?? 'manual';

  stdout.write(
    `Finishing ${outDir}: ${chain.slug}, pages ${formatPageList(pages)} of ${pageCount}, ${recorded.dpi ?? defaults.dpi} dpi, read by ${engineName}${recorded.model && engineName !== 'manual' ? ` ${recorded.model}` : ''}.\n`
  );

  const readings = collectManualReadings({
    pages,
    importDir,
    stripFence,
    exists,
    readFile,
  });

  if (['from', 'until'].some((field) => statedValidity?.[field])) {
    mergeRunFile(
      outDir,
      {
        validity: {
          from: statedValidity.from ?? null,
          until: statedValidity.until ?? null,
        },
      },
      { writeFile, exists, readFile }
    );
  }

  return completeRun({
    chain,
    defaults,
    outDir,
    importDir,
    imageDir: sourceIsDirectory ? recorded.pdf : join(outDir, 'pages'),
    source: recorded.pdf,
    sourceIsDirectory,
    pages,
    pageCount,
    readings,
    warnings: [],
    skipped: [],
    engine: null,
    engineName,
    model: recorded.model ?? null,
    isLocal: false,
    notice: null,
    statedValidity,
    recordedValidity: recorded.validity ?? null,
    askImages: null,
    stripFence,
    stdout,
    stream,
    readFile,
    writeFile,
    exists,
    now,
  });
}
