import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * **Every control that raises a line reports the extra, and only the question
 * counts it** (velista `0208`, stage 2, spec 13; it replaces the stage 1 spec that
 * named the zone list alone).
 *
 * "Count the extra" is the one answer that writes, so the store's `countExtra` is
 * called only from the `count` an `ExtraAskHost` request carries: written inline in
 * that property, or in a private `_countExtra` that only such a property calls. And
 * each control the plan's target states 11 to 14 and 16 name passes `reportExtra`
 * (stage 3 adds the zone list's "Add or find" field and its cards). A text
 * scan rather than a spec per page, because the rule is about every screen that
 * exists and every one added later.
 */

/** The velista scope, from this spec's own location: `src/lib` up to `libs/velista`. */
const SCOPE = join(__dirname, '..', '..', '..');
const WORKSPACE = join(SCOPE, '..', '..');

/** The data layer, which carries the calls and may name them freely. */
const DATA_LAYER = [
  'libs/velista/data-access/src/lib/catalog/catalog-add-store.ts',
  'libs/velista/data-access/src/lib/lines/line-api.ts',
  'libs/velista/data-access/src/lib/lines/line-memory.ts',
  'libs/velista/data-access/src/lib/lines/line-service.ts',
  'libs/velista/data-access/src/lib/lines/line-store.ts',
  'libs/velista/data-access/src/lib/testing/store-doubles.ts',
  'libs/velista/feature-catalog/src/lib/catalog-adds.testing.ts',
  // The shared piece, which names the call its hosts pass in and calls none.
  'libs/velista/ui/src/lib/list/extra-ask-host.ts',
];

/** The hosts that ask, through `ExtraAskHost` (target states 10 to 14). */
const HOSTS = [
  'libs/velista/feature-catalog/src/lib/catalog-extra-ask.ts',
  'libs/velista/feature-lists/src/lib/line-detail-sheet/line-detail-sheet.ts',
  'libs/velista/feature-lists/src/lib/line-page/line-page.ts',
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

const read = (file: string) =>
  readFileSync(join(WORKSPACE, file), 'utf8').split(/\r?\n/);

describe('every raise reports the extra, and only the question counts it', () => {
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

  it('names the count only in the data layer and the hosts', () => {
    expect(
      named(/\bcountExtra\b/).filter(
        (file) => !DATA_LAYER.includes(file) && !HOSTS.includes(file)
      )
    ).toEqual([]);
  });

  it.each(HOSTS)("%s calls the store only from a request's count", (file) => {
    const lines = read(file);
    const opens = (at: number) =>
      lines
        .slice(Math.max(0, at - 12), at + 1)
        .some((line) =>
          /\bcount: (async )?\(\) =>|private (async )?_countExtra\(/.test(line)
        );
    const calls = lines
      .map((line, at) => ({ line, at }))
      .filter(({ line }) => /\b(this\._lines|adds)\.countExtra\(/.test(line));
    expect(calls.length).toBeGreaterThan(0);
    for (const { at } of calls) {
      expect({ at: at + 1, inCount: opens(at) }).toEqual({
        at: at + 1,
        inCount: true,
      });
    }
    // A private `_countExtra` is reached from a request's `count` and nowhere else.
    for (const [at, line] of lines.entries()) {
      if (/this\._countExtra\(/.test(line)) {
        expect({ at: at + 1, line: line.trim() }).toEqual({
          at: at + 1,
          line: expect.stringMatching(/^count: \(\) => this\._countExtra\(/),
        });
      }
    }
  });

  it.each([
    [
      'the line sheet (target state 11)',
      'libs/velista/feature-lists/src/lib/line-detail-sheet/line-detail-sheet.ts',
      /reportExtra: true/,
      1,
    ],
    [
      'the line page (target state 12)',
      'libs/velista/feature-lists/src/lib/line-page/line-page.ts',
      /\.raiseReportingExtra\(/,
      1,
    ],
    [
      'the catalog cards, stepper and plus (target state 13)',
      'libs/velista/feature-catalog/src/lib/catalog-page/catalog-page.ts',
      /this\._extra\.options\(/,
      2,
    ],
    [
      'the product page, its table and its cards (target state 14)',
      'libs/velista/feature-catalog/src/lib/product-page/product-page.ts',
      /this\._extra\.options\(/,
      4,
    ],
    [
      'the zone list\'s "Add or find", its add and a chosen line (target state 16)',
      'libs/velista/feature-lists/src/lib/list-page/list-page.ts',
      /reportExtra: true/,
      2,
    ],
    [
      'the catalog cards in the results of "Add or find" (target state 16)',
      'libs/velista/feature-lists/src/lib/list-page/list-page.ts',
      /this\._runControls\.set\(lineId, \{ card: change\.cardKey \}\)/,
      1,
    ],
    [
      'the options every catalog raise passes',
      'libs/velista/feature-catalog/src/lib/catalog-extra-ask.ts',
      /reportExtra: true/,
      1,
    ],
  ])('%s passes reportExtra', (_what, file, pattern, times) => {
    expect(read(file).filter((line) => pattern.test(line)).length).toBe(times);
  });

  // Velista `0208`, spec 9: "Still need" sends nothing, so nothing remembers it.
  it('keeps nothing of the memory of "Still need" nor of the counting raise', () => {
    expect(
      named(/\b(_stillNeeded|stillNeedExtra|raiseCountingExtra|CountedExtra)\b/)
    ).toEqual([]);
  });
});
