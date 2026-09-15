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
 * **A drift refusal stops the run before validate**, and `--update-baseline` is
 * never passed. A baseline is accepted by a person, by hand, after looking at
 * the document.
 *
 * **The command never uploads.** The report ends by printing the document's
 * path and the call to make with it. A leaflet reading is accepted by a person
 * looking at it, and a tool that posted its own output would remove the only
 * review the pipeline has.
 *
 * Zero npm dependencies, Node built ins only. Not browser reachable.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runStreamed } from './child.mjs';
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

/** Every validity field that was filled, for the operator to confirm. */
export function formatValidity(leaflet) {
  const lines = [
    'Validity, as read from the cover. Confirm it before you upload:',
  ];
  for (const field of ['from', 'until', 'raw_text']) {
    const value = leaflet.validity[field];
    lines.push(
      `  ${field}: ${value === null ? 'null (the page printed none)' : value}`
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
        'Create one by hand with build-document.mjs --update-baseline once you have accepted this reading.\n'
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
}) {
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
    return lines.join('\n');
  }

  lines.push(
    '',
    `The document is at ${outcome.document}`,
    'Nothing was uploaded. Upload it yourself through the back office, at',
    `  harvest/imports/upload, with the chain ${slug}, the price scope, and the source kind OFFICIAL_LEAFLET.`,
    'Once the reading is accepted, run build-document.mjs again with --update-baseline',
    'so the next leaflet is checked against this one.'
  );
  return lines.join('\n');
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
