/**
 * Steps 6, 7 and 8: the leaflet's own small file, the three existing scripts,
 * and the report.
 *
 * Nothing here decides a price. `to-harvest-document.mjs` owns the three price
 * rules and keeps owning them, `build-document.mjs` calls it, and this file
 * starts that script as a child process and reads the report it wrote. A CLI
 * that decided a till price would be a second authority on the one question the
 * whole harvester exists to answer.
 *
 * **The validity window is asked of the model once, against the cover, and
 * every field it fills is printed for the operator to confirm**, because a wrong
 * date silently mis-scopes every price on the leaflet. A bound the leaflet does
 * not print stays null and survives into the file as null, which is what makes
 * the document carry no `validity` and say so in its warnings.
 *
 * **A person's word outranks the cover** (plan 0003). `--valid-from` and
 * `--valid-until` set a bound on any engine, a bound somebody typed into
 * `leaflet.json` survives every resume, and the cover is asked only for what
 * neither of them says. See `resolveValidity` and `mergeLeafletJson`.
 *
 * **A drift refusal stops the run before validate**, and `--update-baseline` is
 * never passed. A baseline is accepted by a person, by hand, after looking at
 * the document, so the report prints the exact command and never runs it.
 *
 * **The command never uploads.** The report ends by printing the document's
 * path and the call to make with it. A leaflet reading is accepted by a person
 * looking at it, and a tool that posted its own output would remove the only
 * review the pipeline has.
 *
 * Zero npm dependencies, Node built ins only. Not browser reachable.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runStreamed } from './child.mjs';
import { updateBaselineCommand } from './commands.mjs';
import { formatWarning, warning } from './read-pages.mjs';

/** The three scripts are addressed beside this file rather than through the
 * workspace root, so the working directory never decides whether they resolve. */
const scriptPath = (name) => fileURLToPath(new URL(name, import.meta.url));

/** What the model is asked about the cover, once, for the printed window. */
export const VALIDITY_PROMPT = [
  'This is the cover of a Spanish supermarket leaflet (folleto).',
  '',
  'Return ONLY a JSON object, no prose and no code fence:',
  '',
  '{ "from": "YYYY-MM-DD", "until": "YYYY-MM-DD", "raw_text": "the dates exactly as printed" }',
  '',
  'Rules:',
  '1. Only report a bound the page actually prints. Use null for one it does not.',
  '2. Do not guess a year the page does not print. If the page prints a day and a',
  '   month with no year, still write null for that bound and put what it printed',
  '   in raw_text.',
  '3. raw_text is the printed line, verbatim, or null when the page prints no dates.',
].join('\n');

const str = (value) =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

/** The validity object out of a model answer, with nulls for what it did not
 * fill. Anything unreadable answers all nulls and a warning. */
export function parseValidity(text, stripFence) {
  const empty = { from: null, until: null, raw_text: null };
  if (typeof text !== 'string' || text.trim() === '') {
    return empty;
  }
  let parsed;
  try {
    parsed = JSON.parse(stripFence(text));
  } catch {
    return empty;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return empty;
  }
  return {
    from: str(parsed.from),
    until: str(parsed.until),
    raw_text: str(parsed.raw_text),
  };
}

/** The cover, asked once. */
export async function askValidity({ engine, images, stripFence }) {
  const answer = await engine.ask(VALIDITY_PROMPT, { images });
  return parseValidity(answer?.text, stripFence);
}

/**
 * The leaflet's own small file, as the README's table names its fields.
 *
 * `extraction.tool` names the engine, the model and the chain prompt, and
 * carries the local engine notice when there was one.
 */
export function buildLeafletJson({
  pdf,
  pageCount,
  fixedSections = {},
  validity = { from: null, until: null, raw_text: null },
  campaign = null,
  tool,
  date,
  notes = [],
}) {
  return {
    pdf,
    page_count: pageCount,
    fixed_sections: fixedSections,
    validity: {
      from: validity.from ?? null,
      until: validity.until ?? null,
      raw_text: validity.raw_text ?? null,
    },
    campaign,
    extraction: { tool, date },
    notes,
  };
}

/** What `extraction.tool` says: who read it, with what, and what that costs. */
export function extractionTool({ engine, model, slug, notice = null }) {
  const base = `${engine}${model ? ` ${model}` : ''} via luna-shopper/leaflet-cli, chains/${slug}/prompt.txt`;
  return notice ? `${base}. ${notice}` : base;
}

/** What a date bound must look like, and a day that exists. */
export function isDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

/**
 * The window, bound by bound, from whoever said it with the most authority.
 *
 * - `stated` is this run's `--valid-from` and `--valid-until`, typed now.
 * - `existing` is `leaflet.json` as it stands, which a person may have filled
 *   by hand between two runs.
 * - `recorded` is the flags an earlier run of this `--out` was given, kept in
 *   `run.json`.
 * - `asked` is what the model read off the cover, or null when it was not asked.
 *
 * Answers the window and where each field came from, which is printed beside it.
 */
export function resolveValidity({
  stated = {},
  existing = null,
  recorded = null,
  asked = null,
}) {
  const sources = [
    ['this run', stated],
    ['leaflet.json', existing],
    ['run.json', recorded],
    ['the cover', asked],
  ];
  const pick = (field, from = sources) => {
    for (const [name, bag] of from) {
      const value = bag?.[field];
      if (value !== null && value !== undefined && value !== '') {
        return [value, name];
      }
    }
    return [null, null];
  };
  const [from, fromOrigin] = pick('from');
  const [until, untilOrigin] = pick('until');
  // The printed wording is only ever read, off the cover or by a person.
  const [rawText, rawOrigin] = pick('raw_text', [sources[1], sources[3]]);
  return {
    validity: { from, until, raw_text: rawText },
    origins: { from: fromOrigin, until: untilOrigin, raw_text: rawOrigin },
  };
}

/** Whether the window is known without asking the cover. */
export const windowKnown = ({
  stated = {},
  existing = null,
  recorded = null,
}) =>
  ['from', 'until'].every((field) =>
    [stated, existing, recorded].some(
      (bag) => bag?.[field] !== null && bag?.[field] !== undefined
    )
  );

/** `leaflet.json` as it stands in `importDir`, or null. */
export function readLeafletJson(
  importDir,
  { exists = existsSync, readFile = readFileSync } = {}
) {
  const path = join(importDir, 'leaflet.json');
  if (!exists(path)) {
    return null;
  }
  try {
    return JSON.parse(readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * A fresh `leaflet.json` over the one already there, keeping what a person
 * filled.
 *
 * `validity` is resolved before this is called, with `leaflet.json` as one of
 * its sources, so it is taken from `fresh`. `campaign`, `notes` and
 * `fixed_sections` are the other fields the README tells a person to fill, and a
 * resume used to write the file whole and lose them. `pdf`, `page_count` and
 * `extraction` describe this run and are the run's to write.
 */
export function mergeLeafletJson(fresh, existing) {
  if (!isObject(existing)) {
    return fresh;
  }
  return {
    ...fresh,
    fixed_sections: isObject(existing.fixed_sections)
      ? existing.fixed_sections
      : fresh.fixed_sections,
    campaign: existing.campaign ?? fresh.campaign,
    notes:
      Array.isArray(existing.notes) && existing.notes.length > 0
        ? existing.notes
        : fresh.notes,
  };
}

/** Every validity field that was filled, for the operator to confirm. */
export function formatValidity(leaflet, origins = {}) {
  const lines = ['Validity. Confirm it before you upload:'];
  for (const field of ['from', 'until', 'raw_text']) {
    const value = leaflet.validity[field];
    const origin = origins[field] ? `, from ${origins[field]}` : '';
    lines.push(
      `  ${field}: ${value === null ? 'null (the page printed none)' : `${value}${origin}`}`
    );
  }
  if (leaflet.validity.from === null || leaflet.validity.until === null) {
    lines.push(
      '  A window needs both bounds or it is not stated, so this document will carry no validity and will say so in its warnings.'
    );
  }
  return lines.join('\n');
}

/** Where the three scripts write. */
export function outputPaths(outDir, slug) {
  const document = join(outDir, `${slug}.harvest-document.json`);
  return { document, report: document.replace(/\.json$/, '.report.json') };
}

/**
 * The three existing scripts, in order, as child processes.
 *
 * The drift check is skipped, and says so, for a chain with no `baseline.json`.
 * Dia and LIDL both have none: a first reading has nothing to be compared
 * against, and the baseline is created by hand once a person has accepted the
 * document. Skipping is not passing, so the report says which it was.
 */
export async function runScripts({
  slug,
  importDir,
  outDir,
  chain,
  stream = runStreamed,
  node = process.execPath,
  exists = existsSync,
  stdout = process.stdout,
}) {
  const { document, report } = outputPaths(outDir, slug);

  stdout.write('\nBuilding the document.\n');
  const built = await stream(node, [
    scriptPath('build-document.mjs'),
    '--readings',
    importDir,
    '--leaflet',
    join(importDir, 'leaflet.json'),
    '--chain',
    slug,
    '--out',
    document,
  ]);
  if (built.code !== 0) {
    return {
      built: false,
      drift: 'not run',
      validated: 'not run',
      document,
      report,
    };
  }

  let drift = 'skipped';
  if (!exists(chain.baselinePath)) {
    stdout.write(
      `\nNo baseline for ${slug} yet, so there is nothing to drift check against. ` +
        'Once you have accepted this reading, create one with:\n' +
        `  ${updateBaselineCommand({ importDir, leafletPath: join(importDir, 'leaflet.json'), document, slug })}\n`
    );
  } else {
    stdout.write('\nDrift check.\n');
    const checked = await stream(node, [
      scriptPath('drift-check.mjs'),
      '--report',
      report,
      '--chain',
      slug,
    ]);
    if (checked.code !== 0) {
      // A refused reading stops here. It is not proof the reading is wrong, it
      // is a signal that a person should look before it reaches an upload.
      return {
        built: true,
        drift: 'refused',
        validated: 'not run',
        document,
        report,
      };
    }
    drift = 'within the baseline';
  }

  stdout.write('\nValidate.\n');
  const validated = await stream(node, [
    '--experimental-strip-types',
    scriptPath('validate.mjs'),
    document,
  ]);
  return {
    built: true,
    drift,
    validated: validated.code === 0 ? 'valid' : 'invalid',
    document,
    report,
  };
}

/**
 * The run's own last words: what was read, what to look at, and the call to
 * make. It never makes that call.
 */
export function formatReport({
  slug,
  pagesRead,
  skipped = [],
  warnings = [],
  outcome,
  readFile = readFileSync,
  exists = existsSync,
  notice = null,
  importDir = null,
  resume = null,
}) {
  const baseline = importDir
    ? updateBaselineCommand({
        importDir,
        leafletPath: join(importDir, 'leaflet.json'),
        document: outcome.document,
        slug,
      })
    : null;
  const lines = ['', 'Report'];
  lines.push(
    `  pages read: ${pagesRead}${skipped.length > 0 ? `, ${skipped.length} kept by --resume` : ''}`
  );

  if (outcome.built && exists(outcome.report)) {
    const report = JSON.parse(readFile(outcome.report, 'utf8'));
    lines.push(`  offers: ${report.products}`);
    lines.push(`    with a price: ${report.withPrice}`);
    lines.push(`    with a unit price only: ${report.withUnitPriceOnly}`);
    lines.push(`    with neither: ${report.withNeither}`);
    lines.push(
      `  the document's own warnings: ${(report.warnings ?? []).length}`
    );
  }

  lines.push(
    `  build: ${outcome.built ? 'done' : 'failed, see the lines above'}`
  );
  lines.push(`  drift check: ${outcome.drift}`);
  lines.push(`  validate: ${outcome.validated}`);

  if (warnings.length === 0) {
    lines.push('  sanity pass and page loop: nothing to look at');
  } else {
    lines.push(
      `  sanity pass and page loop: ${warnings.length} row(s) to look at`
    );
    for (const entry of warnings) {
      lines.push(formatWarning(entry));
    }
  }

  if (notice) {
    lines.push('', notice);
  }

  if (outcome.drift === 'refused') {
    lines.push(
      '',
      'The drift check refused this reading, so it was not validated and it is not ready.',
      'Read every statistic it named above before you do anything else with it.'
    );
    if (baseline) {
      lines.push(
        'If every one of them is the leaflet and not the reading, accept it as the',
        `new baseline, then run ${resume ? 'the resume below' : 'the same command'} again:`,
        `  ${baseline}`
      );
    }
    if (resume) {
      lines.push('', 'Pick the run back up with:', `  ${resume}`);
    }
    return lines.join('\n');
  }

  // No upload call for a reading that is not ready. A path printed under an
  // upload sentence reads as an invitation, and the one review this pipeline
  // has is the person who reads that sentence.
  if (!outcome.built || outcome.validated !== 'valid') {
    lines.push(
      '',
      resume
        ? `This reading is not ready, so there is nothing to upload yet. Fix what the lines above name and pick the run back up with:\n  ${resume}`
        : 'This reading is not ready, so there is nothing to upload yet. Fix what the lines above name and run the same command again with --resume.'
    );
    return lines.join('\n');
  }

  lines.push(
    '',
    `The document is at ${outcome.document}`,
    'Nothing was uploaded. Upload it yourself through the back office, at',
    `  harvest/imports/upload, with the chain ${slug}, the price scope, and the source kind OFFICIAL_LEAFLET.`,
    baseline
      ? 'Once the reading is accepted, make it the baseline the next leaflet is checked against:'
      : 'Once the reading is accepted, run build-document.mjs again with --update-baseline',
    baseline
      ? `  ${baseline}`
      : 'so the next leaflet is checked against this one.'
  );
  return lines.join('\n');
}

/**
 * The bytes a leaflet that arrived as images is digested from.
 *
 * `build-document.mjs` reads `leaflet.json`'s `pdf` field and takes its sha256,
 * which is what the run level dedupe keys on. `--pdf <directory>` has no one
 * file to take it of, so the run writes one: a manifest naming every page image
 * and its own digest. It changes when any page changes, which is the whole
 * property the digest is there for, and no existing script had to learn about
 * it. LIDL is read this way, because its flyer endpoint serves every page as an
 * image and no PDF is ever fetched.
 */
export function writePagesManifest({
  importDir,
  imageDir,
  pages,
  pageFile,
  readFile = readFileSync,
  writeFile = writeFileSync,
}) {
  const lines = pages.map((page) => {
    const path = pageFile(imageDir, page);
    const digest = createHash('sha256').update(readFile(path)).digest('hex');
    return `${String(page).padStart(2, '0')} ${digest}`;
  });
  const path = join(importDir, 'pages.manifest.txt');
  writeFile(path, `${lines.join('\n')}\n`, 'utf8');
  return path;
}

/** `leaflet.json` written where `build-document.mjs` is told to read it. */
export function writeLeafletJson(
  importDir,
  leaflet,
  writeFile = writeFileSync
) {
  const path = join(importDir, 'leaflet.json');
  writeFile(path, `${JSON.stringify(leaflet, null, 2)}\n`, 'utf8');
  return path;
}

/** A warning about the validity, when the model filled neither bound. */
export function validityWarning(leaflet) {
  if (leaflet.validity.from !== null && leaflet.validity.until !== null) {
    return null;
  }
  return warning(
    'validity',
    1,
    "the cover did not yield both bounds, so the document carries no validity window. A half open window is the admin's override to supply at the spawn."
  );
}
