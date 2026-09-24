/**
 * Every command the run prints for an operator to type next, in one place
 * (plan 0003).
 *
 * **A printed command is pasted as is**, so each one here is whole: it carries
 * every flag the next step needs and nothing the operator has to remember to
 * add. Backend plan 0150 found three that were not. The resume line dropped
 * `--pages`, so pasting it asked for readings of pages nobody had read. The
 * report said "run the same command again with --resume" and left the command
 * to be reconstructed. The baseline step named a flag and no command at all.
 *
 * Paths are printed with forward slashes, which Node reads on every platform
 * and a POSIX shell does not eat, and a path with a space in it is quoted.
 *
 * Zero npm dependencies, Node built ins only. Not browser reachable.
 */

import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/** What every leaflet command starts with. The `--` is part of it: Nx keeps
 * the flags in front of it for itself. */
export const READ_COMMAND = 'npx nx run luna-shopper/leaflet-cli:read --';

/** `[5, 6, 7, 9]` as `5-7,9`, the spelling `--pages` reads back. */
export function formatPageList(pages) {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const parts = [];
  for (let i = 0; i < sorted.length; i++) {
    const from = sorted[i];
    while (i + 1 < sorted.length && sorted[i + 1] === sorted[i] + 1) {
      i += 1;
    }
    parts.push(from === sorted[i] ? String(from) : `${from}-${sorted[i]}`);
  }
  return parts.join(',');
}

/** A path as a pasteable word: forward slashes, and quoted when it has to be. */
export function shellWord(value) {
  const text = String(value).split('\\').join('/');
  return /^[\w@%+=:,./-]+$/.test(text)
    ? text
    : `'${text.replace(/'/g, `'"'"'`)}'`;
}

/** Whether a run read only some of the leaflet's pages. */
export const isPartial = (pages, pageCount) =>
  Array.isArray(pages) && pages.length > 0 && pages.length < pageCount;

/**
 * The command that picks a run back up.
 *
 * It names `--pages` whenever the run read fewer pages than the leaflet has,
 * because a resume without it used to mean every page. A resume reads the page
 * list back from `run.json` now as well, and the flag stays on the printed line
 * anyway: a person reading the line sees which pages it is about.
 */
export function resumeCommand({ outDir, engineName, model, pages, pageCount }) {
  const words = [READ_COMMAND, '--out', shellWord(outDir), '--resume'];
  words.push('--engine', engineName);
  if (engineName !== 'manual' && model) {
    words.push('--model', shellWord(model));
  }
  if (isPartial(pages, pageCount)) {
    words.push('--pages', formatPageList(pages));
  }
  return words.join(' ');
}

/** The command that checks one hand written page. */
export const checkPageCommand = ({ outDir, page }) =>
  `${READ_COMMAND} --out ${shellWord(outDir)} --check-page ${page}`;

/** The command that builds, drift checks and validates a manual run. */
export const finishCommand = ({ outDir }) =>
  `${READ_COMMAND} --out ${shellWord(outDir)} --finish`;

/** `build-document.mjs`, as a path from where the operator types. */
export const buildScript = (cwd = process.cwd()) =>
  relative(
    cwd,
    fileURLToPath(new URL('./build-document.mjs', import.meta.url))
  );

/**
 * The command that makes this reading the chain's baseline.
 *
 * It is printed and never run. A baseline is accepted by a person, after
 * looking at the document, and this is the line that person pastes.
 */
export function updateBaselineCommand({
  importDir,
  leafletPath,
  document,
  slug,
  cwd = process.cwd(),
}) {
  return [
    'node',
    shellWord(buildScript(cwd)),
    '--readings',
    shellWord(importDir),
    '--leaflet',
    shellWord(leafletPath),
    '--chain',
    slug,
    '--out',
    shellWord(document),
    '--update-baseline',
  ].join(' ');
}
