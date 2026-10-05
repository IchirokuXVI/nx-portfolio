import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';

/**
 * **The heading of the question a named action asks holds no placeholder.**
 *
 * The page that asks translates the body with the title of the row as `name`,
 * and the heading with nothing (`ActionConfirmation` in `models`). A heading
 * written as "Stop fetching {{name}}?" is thus drawn with the braces in it.
 * i18next does not fail on a value it was not given, so nothing said so until
 * somebody opened the question: three headings shipped that way, and one of
 * them was over the question that permits a crawl.
 *
 * The body names the row. The heading reads well alone.
 *
 * ## What it can see
 *
 * A `confirm` of a descriptor is written as an object whose first property is
 * `heading`, with a literal key. This scan reads every one of that shape in
 * the admin libraries and the app. A heading key that is built from a value
 * is not seen, and no descriptor builds one today.
 */

/** The `ui` scope, from this spec's own location: `src/lib` up to the lib. */
const UI = join(__dirname, '..', '..');

/** Every admin library, `ui` included, and the app beside them. */
const ROOTS = [
  join(UI, '..'),
  join(UI, '..', '..', '..', 'apps', 'luna-shopper-admin', 'src'),
];

/** What a failure's path is relative to, so it reads as a repository path. */
const WORKSPACE = join(UI, '..', '..', '..');

/** The heading key of one `confirm: { heading: '…', … }`. */
const QUESTION = /\bconfirm:\s*\{\s*heading:\s*'([^']+)'/g;

const CATALOGUE = JSON.parse(
  readFileSync(join(UI, 'assets', 'i18n', 'en.json'), 'utf8')
) as Record<string, unknown>;

function sourceFiles(root: string): readonly string[] {
  const found: string[] = [];

  for (const entry of readdirSync(root)) {
    if (entry === 'node_modules') {
      continue;
    }

    const path = join(root, entry);

    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
      continue;
    }

    if (extname(entry) === '.ts' && !entry.endsWith('.spec.ts')) {
      found.push(path);
    }
  }

  return found;
}

/** What the catalogue holds at a dotted key, or `undefined`. */
function sentence(key: string): unknown {
  let node: unknown = CATALOGUE;

  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) {
      return undefined;
    }
    node = (node as Record<string, unknown>)[part];
  }

  return node;
}

interface Question {
  readonly file: string;
  readonly key: string;
}

const QUESTIONS: readonly Question[] = ROOTS.flatMap(sourceFiles).flatMap(
  (path) =>
    Array.from(readFileSync(path, 'utf8').matchAll(QUESTION), (match) => ({
      file: relative(WORKSPACE, path).split(sep).join('/'),
      key: match[1],
    }))
);

describe('the question a named action asks', () => {
  /** A scan that finds nothing proves nothing. */
  it('is found in the descriptors, the three that were wrong among them', () => {
    const keys = QUESTIONS.map((question) => question.key);

    expect(keys.length).toBeGreaterThanOrEqual(16);
    expect(keys).toEqual(
      expect.arrayContaining([
        'harvest.sources.confirm.stop.heading',
        'harvest.sources.confirm.allow.heading',
        'harvest.postalCodes.confirm.discoverAgain.heading',
      ])
    );
  });

  it('has a heading in the catalogue', () => {
    const absent = QUESTIONS.filter(
      (question) => typeof sentence(question.key) !== 'string'
    );

    expect(absent).toEqual([]);
  });

  it('has a heading with no placeholder, because nothing fills one', () => {
    const templated = QUESTIONS.filter((question) =>
      String(sentence(question.key)).includes('{{')
    ).map((question) => `${question.file}: ${question.key}`);

    expect(templated).toEqual([]);
  });
});
