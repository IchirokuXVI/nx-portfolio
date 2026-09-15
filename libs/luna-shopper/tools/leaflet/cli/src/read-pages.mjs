/**
 * One model call per page, in order, writing the reading as it goes.
 *
 * Forty pages must not be lost to page thirty seven, so nothing here throws on
 * a bad page. A page that answers nothing parseable is asked once more and then
 * recorded as an empty array with a named warning, and a page that does not
 * answer inside `--page-timeout` is recorded the same way. The run carries on to
 * page thirty eight.
 *
 * **The chain's prompt is sent as the user prompt, verbatim, with no system
 * half.** That is not the split the curator uses, which puts its standing rules
 * in `system` and the row in the user half, and the reason to differ is manual
 * mode. `PROMPT.md` hands a person the same `prompt.txt` to paste into a chat as
 * one message, so sending it as one message here keeps the two modes asking the
 * same question. If they diverged, a manual reading would stop being a
 * comparison for an automatic one, which is the whole use of having both.
 *
 * **The timeout ends the waiting and not the generation.** A local server keeps
 * producing tokens for a request nobody is reading any more, and what ends that
 * is the adapter's own `num_predict` cap (model engines plan 0004). A longer
 * timeout collects nothing either: three minutes and five minutes on the same
 * looping page both produced zero rows. So a page that times out is not asked
 * again, and an unparseable one is, because that one can differ on a second
 * reading.
 *
 * Zero npm dependencies, Node built ins only. Not browser reachable.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pageImagePath } from './render.mjs';

/** How long one page may take before the run stops waiting for it. */
export const DEFAULT_PAGE_TIMEOUT_S = 120;

/** One page's reading, as `build-document.mjs` reads it. */
export const readingPath = (dir, page) =>
  join(dir, `page_${String(page).padStart(2, '0')}.json`);

/** A named warning. Every one of them names the page it is about. */
export const warning = (name, page, message, product = null) => ({
  name,
  page,
  product,
  message,
});

/** A warning as the operator reads it. */
export function formatWarning(entry) {
  const where = entry.product
    ? `page ${entry.page}, ${entry.product}`
    : `page ${entry.page}`;
  return `  [${entry.name}] ${where}: ${entry.message}`;
}

/** The rows of one answer, or null when the answer is not a JSON array. */
export function parseReading(text, stripFence) {
  if (typeof text !== 'string' || text.trim() === '') {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(stripFence(text));
  } catch {
    return null;
  }
  return Array.isArray(parsed) ? parsed : null;
}

/** The answer, or the string `timeout`, whichever happens first. */
async function askWithTimeout(
  ask,
  timeoutMs,
  setTimer = setTimeout,
  clearTimer = clearTimeout
) {
  if (!timeoutMs) {
    return ask();
  }
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimer(() => resolve('timeout'), timeoutMs);
  });
  try {
    return await Promise.race([ask(), timeout]);
  } finally {
    clearTimer(timer);
  }
}

/**
 * Every wanted page, read and written.
 *
 * `imagesFor` is injected so a test never touches a file, and the default reads
 * the PNG the renderer wrote and hands it over as base64, which is the only
 * form the contract takes (model engines plan 0004).
 */
export async function readPages({
  engine,
  prompt,
  pages,
  pagesDir,
  importDir,
  resume = false,
  timeoutMs = DEFAULT_PAGE_TIMEOUT_S * 1000,
  stripFence,
  readFile = readFileSync,
  writeFile = writeFileSync,
  exists = existsSync,
  imagesFor = null,
  stderr = process.stderr,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  const images =
    imagesFor ??
    ((page) => [
      {
        mediaType: 'image/png',
        data: readFile(pageImagePath(pagesDir, page)).toString('base64'),
      },
    ]);

  const warnings = [];
  const readings = new Map();
  const skipped = [];

  for (const page of pages) {
    const out = readingPath(importDir, page);
    if (resume && exists(out)) {
      skipped.push(page);
      const kept = parseReading(readFile(out, 'utf8'), stripFence);
      readings.set(page, kept ?? []);
      continue;
    }

    let rows = null;
    let timedOut = false;
    for (
      let attempt = 1;
      attempt <= 2 && rows === null && !timedOut;
      attempt++
    ) {
      const answer = await askWithTimeout(
        () => engine.ask(prompt, { images: images(page) }),
        timeoutMs,
        setTimer,
        clearTimer
      );
      if (answer === 'timeout') {
        timedOut = true;
        break;
      }
      rows = parseReading(answer?.text, stripFence);
    }

    if (timedOut) {
      warnings.push(
        warning(
          'page timeout',
          page,
          `no answer within ${Math.round(timeoutMs / 1000)} s, so the page is recorded as empty. A longer timeout collects nothing: see the leaflet plan's section 7.`
        )
      );
      rows = [];
    } else if (rows === null) {
      warnings.push(
        warning(
          'unparseable answer',
          page,
          'the model answered twice with something that is not a JSON array, so the page is recorded as empty'
        )
      );
      rows = [];
    }

    writeFile(out, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
    readings.set(page, rows);
    stderr.write(`page ${page}: ${rows.length} offer(s)\n`);
  }

  return { readings, warnings, skipped };
}
