/**
 * Where a chain's own four files live, and which slugs there are.
 *
 * The line between the two projects is what is the same for every chain
 * against what one chain prints. `luna-shopper/leaflet-chains` holds the
 * second, one folder per chain, and this module is the only place that names
 * the path to it. `build-document.mjs`, `drift-check.mjs` and the reader all
 * ask here.
 *
 * `--chain` is required and never guessed, so an unknown slug is refused with
 * the slugs there are rather than with a missing file error.
 *
 * Zero npm dependencies, Node built ins only. Not browser reachable.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The workspace root. `src`, `cli`, `leaflet`, `tools`, `luna-shopper`, `libs`. */
export const REPO_ROOT = fileURLToPath(
  new URL('../../../../../../', import.meta.url)
);

/** The chains project's source directory, one folder per chain inside it. */
export const CHAINS_DIR = fileURLToPath(
  new URL('../../chains/src/', import.meta.url)
);

/** The dpi a chain is rendered at when neither the chain nor `--dpi` says. */
export const FALLBACK_DPI = 160;

/** Every slug that has a folder, in the order a refusal lists them. */
export function listChains(dir = CHAINS_DIR) {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((slug) => existsSync(join(dir, slug, 'prompt.txt')))
    .sort();
}

/**
 * The paths of one chain's four files.
 *
 * A slug with no folder is refused with the sentence that a new chain is
 * written by hand first, because generating a `prompt.txt` nobody checked is
 * how a wrong baseline gets built.
 */
export function resolveChain(slug, dir = CHAINS_DIR) {
  const slugs = listChains(dir);
  if (typeof slug !== 'string' || slug === '') {
    throw new Error(
      `--chain is required and is never guessed. The chains with a folder are: ${slugs.join(', ')}.`
    );
  }
  if (!slugs.includes(slug)) {
    throw new Error(
      `Unknown chain ${slug}. The chains with a folder are: ${slugs.join(', ')}. ` +
        'A new chain is written by hand first, which is procedure (b) of the README.'
    );
  }
  const chainDir = join(dir, slug);
  return {
    slug,
    dir: chainDir,
    promptPath: join(chainDir, 'prompt.txt'),
    layoutPath: join(chainDir, 'layout.md'),
    headingsPath: join(chainDir, 'headings.mjs'),
    baselinePath: join(chainDir, 'baseline.json'),
  };
}

/** The chain's prompt, byte for byte. Nothing here paraphrases it. */
export function readPrompt(chain) {
  return readFileSync(chain.promptPath, 'utf8');
}

/** The chain's page description, for a person and for the layout check. */
export function readLayout(chain) {
  return readFileSync(chain.layoutPath, 'utf8');
}

/** `headings.mjs`, which carries the chain's own defaults including its dpi. */
export async function loadChainDefaults(chain) {
  const module = await import(pathToFileURL(chain.headingsPath).href);
  return {
    sections: module.SECTIONS ?? {},
    fixedSections: module.FIXED_SECTIONS ?? {},
    toolName: module.TOOL_NAME ?? null,
    dpi: typeof module.DPI === 'number' ? module.DPI : FALLBACK_DPI,
  };
}
