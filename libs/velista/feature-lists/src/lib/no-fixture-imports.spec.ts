import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * **A `*Memory` module is imported by its own token binding and by specs, never by a
 * feature library** (velista plan 0047, section 1.2).
 *
 * A test rather than a sentence, because this is a rule with one past violation and no
 * natural enforcement. `line-detail-sheet.ts` and `line-page.ts` resolved product names
 * through `catalogItemById`, a hand written fixture of a few Spanish products living in
 * `catalog-memory.ts`, and it read as working software for one reason: the in memory
 * development fixtures use exactly those ids, so every screenshot and every manual pass
 * was a pass. Against a real catalog every id missed and both screens told the reader
 * their line had no products when it demonstrably had some.
 *
 * `@nx/enforce-module-boundaries` cannot catch it. The fixture is exported from the
 * data-access barrel, like every other `*Memory`, because the app binds them by name for
 * a backend-less run; a feature library importing one is therefore an ordinary,
 * well-formed import that lint has no reason to object to.
 *
 * ## What it checks, and why it is a text scan
 *
 * The **source with its comments stripped**, for the fixture's module path and for the
 * names it exports, across every velista feature library rather than only this one. A
 * type level check would catch neither: the offending import was type correct, and the
 * whole failure was that the values were wrong.
 *
 * Comments are stripped because the two screens this plan fixed say in prose what they
 * no longer do, and a rule that forbade saying so would be a rule against writing down
 * why the code looks the way it does.
 */

/** The velista scope, from this spec's own location: `src/lib` up to `libs/velista`. */
const SCOPE = join(__dirname, '..', '..', '..');

/**
 * The fixture's module and the values it exports.
 *
 * The module path catches a direct import; the names catch one through the barrel,
 * which is how the original violation was written and is the form that looks most
 * innocent.
 */
const FORBIDDEN = [
  'catalog-memory',
  'catalogItemById',
  'membersOfGroup',
  'CatalogMemory',
];

/**
 * A feature library is a place a screen lives. `data-access` is exempt because the
 * fixture is its own, and `ui` and `models` cannot reach it at all.
 */
function featureLibraries(): readonly string[] {
  return readdirSync(SCOPE)
    .filter((name) => name.startsWith('feature-'))
    .map((name) => join(SCOPE, name, 'src'))
    .filter((path) => {
      try {
        return statSync(path).isDirectory();
      } catch {
        return false;
      }
    });
}

/**
 * The file with its comments removed.
 *
 * The rule is about **code**, and the prose in this repository explains at length why
 * things are the way they are: the two screens this plan fixed carry comments naming
 * `catalog-memory` and `catalogItemById` precisely to say what they no longer do. A
 * scan that could not tell an explanation from an import would have exactly one
 * remedy, which is deleting the explanation, and that is the wrong way round.
 *
 * Crude on purpose. It does not understand a `//` inside a string literal, which is
 * fine here: the worst it can do is stop scanning something that is not an import.
 */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/** Every `.ts` under a directory that is not itself a spec. */
function sourcesIn(directory: string): readonly string[] {
  const found: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourcesIn(path));
      continue;
    }
    // Specs are exactly who is allowed to reach a fixture, this one included: it names
    // all four symbols and would otherwise fail on itself.
    if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      found.push(path);
    }
  }

  return found;
}

describe('the fixture rule', () => {
  it('finds the feature libraries it is meant to be checking', () => {
    // Guards the guard. A scan that silently found nothing would pass forever, which
    // is the failure mode of every test that walks a directory.
    expect(featureLibraries().length).toBeGreaterThan(3);
  });

  it('has no feature library importing anything from catalog-memory', () => {
    const offenders: string[] = [];

    for (const library of featureLibraries()) {
      for (const source of sourcesIn(library)) {
        const text = withoutComments(readFileSync(source, 'utf8'));
        for (const name of FORBIDDEN) {
          if (text.includes(name)) {
            offenders.push(`${source} references ${name}`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
