import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * **Only the zone list's rows report and count the extra already bought** (velista
 * `0207`, target 1; velista `0208`, stage 1).
 *
 * The report is one call, `raiseReportingExtra`, and the count another,
 * `countExtra`, on the line store and the line service. Until velista `0208` stage 2
 * gives the other controls their question, the line page, the line sheet, the
 * catalog, the product page and the basket keep their calls as they are, so outside
 * the data layer that carries them the one caller is the list page. A text scan
 * rather than a spec per page, because the rule is about every screen that exists
 * and every one added later: a new caller is a new place that asks, and that is a
 * decision, not an accident. Stage 2 replaces this spec (its spec 13).
 */

/** The velista scope, from this spec's own location: `src/lib` up to `libs/velista`. */
const SCOPE = join(__dirname, '..', '..', '..');
const WORKSPACE = join(SCOPE, '..', '..');

/** The files that may name the calls: the data layer that carries them, and their one caller. */
const ALLOWED = [
  'libs/velista/data-access/src/lib/lines/line-api.ts',
  'libs/velista/data-access/src/lib/lines/line-memory.ts',
  'libs/velista/data-access/src/lib/lines/line-service.ts',
  'libs/velista/data-access/src/lib/lines/line-store.ts',
  'libs/velista/data-access/src/lib/testing/store-doubles.ts',
  'libs/velista/feature-lists/src/lib/list-page/list-page.ts',
];

function sources(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== 'node_modules') {
        found.push(...sources(full));
      }
    } else if (
      (entry.endsWith('.ts') || entry.endsWith('.html')) &&
      !entry.endsWith('.spec.ts')
    ) {
      found.push(full);
    }
  }
  return found;
}

describe('the extra already bought is reported and counted from the zone list alone', () => {
  const files = [
    ...sources(SCOPE),
    ...sources(join(WORKSPACE, 'apps', 'velista', 'src')),
  ];
  const named = (pattern: RegExp) =>
    files
      .filter((file) => pattern.test(readFileSync(file, 'utf8')))
      .map((file) => relative(WORKSPACE, file).split(sep).join('/'))
      .sort();

  it('reads the sources it guards', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it.each([
    ['the report', /\braiseReportingExtra\b/],
    ['the count', /\bcountExtra\b/],
  ])(
    '%s is named by the data layer and the list page, and by nothing else',
    (_what, pattern) => {
      const callers = named(pattern);
      expect(callers.filter((file) => !ALLOWED.includes(file))).toEqual([]);
      expect(callers).toContain(
        'libs/velista/feature-lists/src/lib/list-page/list-page.ts'
      );
    }
  );

  // Velista `0208`, spec 9: "Still need" sends nothing, so nothing remembers it.
  it('keeps nothing of the memory of "Still need" nor of the counting raise', () => {
    expect(
      named(/\b(_stillNeeded|stillNeedExtra|raiseCountingExtra|CountedExtra)\b/)
    ).toEqual([]);
  });
});
