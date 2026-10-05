import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

/**
 * **Every key of `en.json` is read by some source file** (admin plan 0047,
 * target 8).
 *
 * A test and not a sentence, because a key nobody reads is invisible. The
 * screen that drew it is deleted, the file still holds the words, and nothing
 * fails: the catalogue only ever grows. The remodel of plans 0041 to 0046
 * left nineteen of them behind, and 0047 found them with the search below.
 *
 * `translations.spec.ts` in the ui library checks the other direction, that a
 * key a template pipes has words written at it. This one reads the source
 * tree in the same way and starts nothing.
 *
 * ## What counts as a read
 *
 * - **The whole key, in quotes.** `'harvest.tab.review'` in a template, a
 *   descriptor or a constant. Quoted, so that `core.zones.total` in code is
 *   not taken for a key of the same spelling.
 * - **A key built from a value.** `'harvest.status.' + run.status` and
 *   `` `people.users.roles.${role}.name` `` each read every key of that shape.
 *   The value stands for one segment, so the first does not read
 *   `harvest.status.help.title`.
 * - **A plural.** `count_one` and `count_other` are read as `count`, which is
 *   the name the translator is asked for.
 *
 * Comments are stripped first, so a key that is named only in prose about a
 * deleted screen is still unread. Specs do not count: a key only a spec names
 * is drawn on no screen.
 */

/** The app, from this spec's own location. */
const APP = join(__dirname, '..');

/** Every admin library beside it. */
const LIBS = join(APP, '..', '..', '..', 'libs', 'luna-shopper-admin');

/** The one catalogue the app ships. */
const CATALOGUE = join(LIBS, 'ui', 'assets', 'i18n', 'en.json');

/**
 * Keys that only a spec names, each one a decision somebody made.
 *
 * `harvest.sources.field.lastRunAt` is listed by `translations.spec.ts` as
 * one of the twelve the chain sources screen needs, and the screen draws
 * eleven of them. Admin plan 0047 may not delete a thing a spec reads, so it
 * is named here and in that plan's pull request.
 *
 * The list can only shrink: an entry that is read again, or that left the
 * catalogue, fails the last test of this file.
 */
const NAMED_BY_A_SPEC_ONLY: readonly string[] = [
  'harvest.sources.field.lastRunAt',
];

/** The plural forms i18next adds to a key, which the source never writes. */
const PLURAL = /_(zero|one|two|few|many|other)$/;

function sourceFiles(root: string): readonly string[] {
  const found: string[] = [];

  for (const entry of readdirSync(root)) {
    const path = join(root, entry);

    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
      continue;
    }

    const isSource = ['.ts', '.html'].includes(extname(entry));
    const isSpec =
      entry.endsWith('.spec.ts') ||
      entry.endsWith('.testing.ts') ||
      entry === 'test-setup.ts';
    // Generated from the gateway's document, and it names no key.
    const isGenerated = entry === 'wire-types.ts';

    if (isSource && !isSpec && !isGenerated) {
      found.push(path);
    }
  }

  return found;
}

/** The code, without the prose about it. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

/** Every leaf of the catalogue, as the dotted key a template writes. */
function leafKeys(node: unknown, prefix = ''): string[] {
  if (node === null || typeof node !== 'object') {
    return [prefix];
  }

  return Object.entries(node).flatMap(([name, value]) =>
    leafKeys(value, prefix === '' ? name : `${prefix}.${name}`)
  );
}

function escaped(text: string): string {
  return text.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

const catalogue: unknown = JSON.parse(readFileSync(CATALOGUE, 'utf8'));
const KEYS = leafKeys(catalogue);

/** The first segment of every key: `harvest`, `catalog`, `shell`. */
const NAMESPACES = Object.keys(catalogue as Record<string, unknown>)
  .map(escaped)
  .join('|');

const SOURCE = [...sourceFiles(APP), ...sourceFiles(LIBS)].map(code).join('\n');

/** One segment of a key, which is what a value in a built key stands for. */
const SEGMENT = '[\\w-]+';

/** Every key written whole, between quotes. */
const WRITTEN = new Set(
  SOURCE.match(
    new RegExp(`(?<=['"\`])(?:${NAMESPACES})\\.[\\w.-]*[\\w-](?=['"\`])`, 'g')
  ) ?? []
);

/**
 * Every shape a key is built in, as a pattern over whole keys.
 *
 * Two spellings. A template string with a hole, where each hole is one
 * segment; and a quoted prefix ending in a dot with a `+` after it, which is
 * how an Angular template builds one.
 */
const BUILT: readonly RegExp[] = [
  ...[
    ...SOURCE.matchAll(
      new RegExp(`\`((?:${NAMESPACES})\\.[\\w.-]*\\$\\{[^\`]*)\``, 'g')
    ),
  ].map(([, body]) => {
    const parts = body
      // A hole, with at most one pair of braces inside it.
      .replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, '\u0000')
      .split('\u0000');

    return new RegExp(`^${parts.map(escaped).join(SEGMENT)}$`);
  }),
  ...[
    ...SOURCE.matchAll(
      new RegExp(`['"]((?:${NAMESPACES})\\.[\\w.-]*\\.)['"]\\s*\\+`, 'g')
    ),
  ].map(([, prefix]) => new RegExp(`^${escaped(prefix)}${SEGMENT}$`)),
];

/** Whether some source file reads this key, by either spelling. */
function isRead(key: string): boolean {
  return [key, key.replace(PLURAL, '')].some(
    (name) => WRITTEN.has(name) || BUILT.some((shape) => shape.test(name))
  );
}

describe('every translation key is read by some source file', () => {
  it('reads the catalogue and the source it is checked against', () => {
    // A scan that found nothing would pass every test below.
    expect(KEYS.length).toBeGreaterThan(1000);
    expect(WRITTEN.size).toBeGreaterThan(500);
    expect(BUILT.length).toBeGreaterThan(20);
  });

  it('reads a key written whole, a built key and a plural', () => {
    expect(isRead('shell.sections.overview')).toBe(true);
    expect(isRead('harvest.status.RUNNING')).toBe(true);
    expect(isRead('people.users.roles.ADMIN.name')).toBe(true);
    expect(isRead('dashboard.harvest.inWindow_other')).toBe(true);
  });

  it('does not read a key no file names', () => {
    expect(isRead('shell.sections.nowhere')).toBe(false);
    // A value stands for one segment, never for two.
    expect(isRead('harvest.status.RUNNING.nowhere')).toBe(false);
  });

  it('holds no key that no source file reads', () => {
    // Named in the failure, because the fix is per key: delete it from
    // `en.json`, or draw it.
    expect(
      KEYS.filter(
        (key) => !isRead(key) && !NAMED_BY_A_SPEC_ONLY.includes(key)
      ).sort()
    ).toEqual([]);
  });

  it('excuses only a key that is still in the catalogue and still unread', () => {
    expect(
      NAMED_BY_A_SPEC_ONLY.filter((key) => !KEYS.includes(key) || isRead(key))
    ).toEqual([]);
  });
});
