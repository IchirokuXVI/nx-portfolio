/**
 * `--engine manual`, which hands the reading to any model at all.
 *
 * The most accurate reader this repo measured is Sonnet 5, and the awkward way
 * to reach it is `--engine claude`, which has to put the Read tool back into a
 * call that was cut to 2,546 tokens on purpose. Manual mode reaches it by not
 * being clever: a Claude Code session already reads a PNG with its Read tool and
 * the tokens are already paid for. So this is not a lesser fallback. It is how a
 * person gets the best reading available without the CLI holding a credential.
 *
 * **It is an engine that is a person**, which is why it is spelled as an
 * `--engine` value and why it is not a `shared/model-engines` registry entry:
 * everything in that registry builds an object with an `ask` method, and this
 * one has no `ask` to build. It never calls a model, it pauses, and it holds a
 * terminal and a person. The CLI branches on it before it asks the registry.
 *
 * Two rules:
 *
 * - **Manual mode never edits a reading.** It refuses one, names the page and
 *   stops. A tool that repaired a model's JSON would be deciding what the page
 *   said.
 * - **`PROMPT.md` is generated, never committed and never hand written.** It is
 *   the chain's prompt plus this run's paths. A second copy of a chain's rules
 *   that drifts from `chains/<slug>/prompt.txt` is the failure the chains
 *   project is arranged to prevent.
 *
 * Zero npm dependencies, Node built ins only. Not browser reachable.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseReading, readingPath } from './read-pages.mjs';
import { pageImagePath } from './render.mjs';

/** What `--out` remembers about a run, so the pick up needs no flags. */
export const RUN_FILE = 'run.json';

/**
 * The first pass writes this, the pick up reads it.
 *
 * `--out <out> --resume --engine manual` states neither the PDF nor the chain,
 * and both are needed to build. Nothing else records them, so the run records
 * them itself rather than asking the operator to type them twice and get one
 * of them wrong.
 */
export function writeRunFile(outDir, run, writeFile = writeFileSync) {
  const path = join(outDir, RUN_FILE);
  writeFile(path, `${JSON.stringify(run, null, 2)}\n`, 'utf8');
  return path;
}

/** What the first pass recorded, or null when there is nothing to pick up. */
export function readRunFile(
  outDir,
  { exists = existsSync, readFile = readFileSync } = {}
) {
  const path = join(outDir, RUN_FILE);
  if (!exists(path)) {
    return null;
  }
  try {
    return JSON.parse(readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * The whole of what a person pastes.
 *
 * The paths are **absolute** and listed one per page rather than globbed,
 * because a chat window with no file access gets the same list and the person
 * attaches the files.
 */
export function promptFile({
  slug,
  prompt,
  layout,
  census,
  pages,
  pagesDir,
  importDir,
  outDir,
}) {
  const list = pages
    .map(
      (page) =>
        `${page}. ${resolve(pageImagePath(pagesDir, page))}\n   write the answer to ${resolve(readingPath(importDir, page))}`
    )
    .join('\n');

  return `# Read the ${slug} leaflet, one page at a time

Read every page image listed below and write one JSON array per page. Follow the
prompt in this file exactly. It is the chain's own contract with a model and
nothing here may paraphrase it.

## What this document is

\`\`\`text
${census}
\`\`\`

## What one page of this chain looks like

Check the first three pages against this before you read any further page. If
they do not match, stop and say what differs rather than reading on.

${layout}

## The prompt

\`\`\`text
${prompt}\`\`\`

## The pages, and where each answer goes

${list}

One JSON array per page, and an empty array for a page with no priced product.
Write nothing else into those files.

## The three fields that matter most

The prompt already names them, and they are the three \`to-harvest-document.mjs\`
reads to decide what a shopper actually pays for one unit:

- \`loyalty\`. True means the tile states no price at all.
- \`promotion.type\` with \`promotion.single_unit_price\`. For a second unit, a
  multibuy or a buy N get one free, the big number is not what one unit costs.
- \`basis\`. A \`kg\` or \`l\` basis prices a weight, so it becomes a unit price and
  the product gets no till price.

A wrong price is worse than a missing one. Never divide one printed number by
another, and never write a number the page does not print.

## When every page is written

\`\`\`sh
npx nx run luna-shopper/leaflet-cli:read -- --out ${outDir} --resume --engine manual
\`\`\`
`;
}

/** `PROMPT.md`, written where the run can be picked up from. */
export function writePromptFile(outDir, text, writeFile = writeFileSync) {
  const path = join(outDir, 'PROMPT.md');
  writeFile(path, text, 'utf8');
  return path;
}

/**
 * What a person wrote, refused rather than repaired.
 *
 * A model that answered with prose inside a code fence is the common case, and
 * a run that quietly treated it as an empty page would report a leaflet with
 * missing products and no reason why. A page with no file at all is named too,
 * unless `--pages` said that page was not wanted: thirty nine pages out of forty
 * is a partial reading, and the operator decides whether it is worth building.
 */
export function collectManualReadings({
  pages,
  importDir,
  stripFence,
  exists = existsSync,
  readFile = readFileSync,
}) {
  const readings = new Map();
  const missing = [];
  const unreadable = [];
  for (const page of pages) {
    const path = readingPath(importDir, page);
    if (!exists(path)) {
      missing.push(page);
      continue;
    }
    const rows = parseReading(readFile(path, 'utf8'), stripFence);
    if (rows === null) {
      unreadable.push(page);
      continue;
    }
    readings.set(page, rows);
  }

  if (unreadable.length > 0) {
    throw new Error(
      `page ${unreadable.join(', ')}: the reading is not a JSON array. Manual mode never edits a reading, so fix the file and run the same command again. ` +
        `The files are under ${importDir}.`
    );
  }
  if (missing.length > 0) {
    throw new Error(
      `page ${missing.join(', ')}: there is no reading at all. Write it, or name the pages you did read with --pages, and run the same command again.`
    );
  }
  return readings;
}
