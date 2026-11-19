import type { CategoryPathsMode } from './run-report';

/**
 * The category paths of one entry, as the drain writes them (plan 0268,
 * section 2). Pure, so the sink and the ingest read one rule.
 */

/**
 * The paths of one product with every repeat and every prefix of a longer
 * path left out, in the order they came.
 *
 * A path is a list of the chain's own names, root first, kept verbatim: no
 * name is trimmed, translated or cased. Only a value that is not a string is
 * dropped, and a path left with no name, because neither says anything.
 */
export function distinctCategoryPaths(paths: readonly unknown[]): string[][] {
  const read: string[][] = [];
  for (const path of paths) {
    if (!Array.isArray(path)) {
      continue;
    }
    const names = path.filter(
      (name): name is string => typeof name === 'string' && name !== ''
    );
    if (names.length > 0) {
      read.push(names);
    }
  }
  const kept: string[][] = [];
  for (const path of read) {
    const repeated = kept.some((other) => sameNames(other, path));
    const coveredByLonger = read.some(
      (other) => other.length > path.length && startsWith(other, path)
    );
    if (!repeated && !coveredByLonger) {
      kept.push(path);
    }
  }
  return kept;
}

/**
 * What an entry holds after a call (section 2): `REPLACE` writes the run's
 * paths in place of the stored ones, and `ADD` writes the stored paths
 * followed by each run path that is not stored yet. A stored path the run's
 * longer path now covers is left out of the answer, as a run path would be.
 */
export function mergeCategoryPaths(
  stored: unknown,
  run: readonly (readonly string[])[],
  mode: CategoryPathsMode
): string[][] {
  if (mode === 'REPLACE') {
    return distinctCategoryPaths(run);
  }
  const before = Array.isArray(stored) ? stored : [];
  return distinctCategoryPaths([...before, ...run]);
}

function sameNames(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((name, i) => name === b[i]);
}

function startsWith(path: readonly string[], prefix: readonly string[]) {
  return prefix.every((name, i) => path[i] === name);
}
