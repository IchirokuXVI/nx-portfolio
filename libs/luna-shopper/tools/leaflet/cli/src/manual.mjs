/**
 * `--engine manual`, which hands the reading to any model at all.
 *
 * The most accurate reader this repo measured is Sonnet 5, and since plan 0003
 * the default engine, `--engine claude --model sonnet`, reaches it directly.
 * Manual mode reaches it, or any other model, by not being clever: a Claude Code
 * session already reads a PNG with its Read tool, and a chat window takes the
 * files as attachments. So this is not a lesser fallback. It is how a person
 * reads with a model this command cannot call, or checks the reading as it goes.
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
import { checkPageCommand, finishCommand } from './commands.mjs';
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

/**
 * A resume's `run.json`: what this pass knows, over what the first pass wrote.
 *
 * A resume used to write the file whole, so a resume that was not given
 * `--pages` recorded every page, and the next resume read every page back
 * (plan 0003). `startedAt` stays the first pass's, and a field this pass has no
 * value for keeps the one already there. `validity` is merged bound by bound,
 * because a resume that states only `--valid-until` has not unsaid the start.
 */
export function mergeRunFile(
  outDir,
  run,
  {
    writeFile = writeFileSync,
    exists = existsSync,
    readFile = readFileSync,
  } = {}
) {
  const before = readRunFile(outDir, { exists, readFile }) ?? {};
  const merged = { ...before };
  for (const [key, value] of Object.entries(run)) {
    if (value !== null && value !== undefined) {
      merged[key] = value;
    }
  }
  if (before.startedAt) {
    merged.startedAt = before.startedAt;
  }
  if (before.validity || run.validity) {
    merged.validity = {
      from: run.validity?.from ?? before.validity?.from ?? null,
      until: run.validity?.until ?? before.validity?.until ?? null,
    };
  }
  return writeRunFile(outDir, merged, writeFile);
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
 * attaches the files. Every command in it is whole and can be pasted as is:
 * `--check-page` after each page and `--finish` at the end, and both read the
 * rest of what they need from `run.json`.
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

## Check each page as you write it

The check reads the file back, compares every row with the shape the prompt
asks for, runs the sanity pass, and names the line of the file for each thing
that is wrong. It changes nothing.

\`\`\`sh
${pages.map((page) => checkPageCommand({ outDir, page })).join('\n')}
\`\`\`

## The three fields that matter most

The prompt already names them, and they are what \`to-harvest-document.mjs\`
reads to decide what a shopper actually pays for one unit:

- \`leaflet.loyalty\`. True means the tile states no price at all.
- \`leaflet.promotion.type\` with \`leaflet.promotion.singleUnitPrice\`. For a
  second unit, a multibuy or a buy N get one free, the big number is not what
  one unit costs, and \`singleUnitPrice\` is. The builder forwards it, with
  \`totalPrice\` and \`requiredQuantity\`, to the script that decides.
- \`leaflet.basis\`. A \`kg\` or \`l\` basis prices a weight, so it becomes a unit
  price and the product gets no till price.

A wrong price is worse than a missing one. Never divide one printed number by
another, and never write a number the page does not print.

## When every page is written

This builds the document, runs the drift check and validates it, in that order,
and stops at the first one that fails. It reads the chain, the pages, the dpi
and the dates from \`run.json\`.

\`\`\`sh
${finishCommand({ outDir })}
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
