import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { ADMIN_SECTIONS } from './sections';

/**
 * **Nothing in this app builds a router link out of a resource's segment.**
 * Where a screen lives is `ResourceRegistry.pathOf`'s answer, because the
 * registry is built from the same sections that declare the routes.
 *
 * A test rather than a sentence, because the rule is invisible at the call site.
 * Writing `['/', 'items', id]` in a new screen is one short line, it reads
 * exactly like the URL it opens, and it works right up until the day a section
 * moves. Admin plan 0022 moved fourteen screens at once and there were seven
 * such places; without this, the next screen written adds an eighth by hand and
 * nobody notices until a section moves again.
 *
 * ## What it checks
 *
 * A path **beginning** with a resource's segment, in either of the two shapes a
 * router link takes: the array, `['/', 'items'`, and the string, `'/items'` or
 * `'/items/…'`. And a path interpolating one, `` `/${ITEMS.segment}` ``, which
 * is what the two people screens used to do.
 *
 * A gateway URL is not one of these. `'/v1/admin/catalog/items'` does not begin
 * with a resource segment, and a segment appearing anywhere but at the front of
 * a path is not a route this rule has anything to say about.
 *
 * Comments are stripped first. This file describes in prose exactly what it must
 * not be written by hand, and a rule that forbade saying so would be a rule
 * against explaining itself.
 *
 * Specs are exempt: they assert literal URLs, which is how the mount is proved.
 */

/** The app, from this spec's own location. */
const APP = join(__dirname, '..');

/** Every admin library beside it, which is where the screens are. */
const LIBS = join(APP, '..', '..', '..', 'libs', 'luna-shopper-admin');

/** What a failure's path is relative to, so it reads as a repository path. */
const WORKSPACE = join(APP, '..', '..', '..');

/**
 * The three files that are allowed to build a resource path, and there is no
 * fourth.
 *
 * `routes.ts` declares the mounting, `admin-section.ts` composes a section's
 * segment with a descriptor's for the navigation, and `resource-registry.ts` is
 * what answers `pathOf`. All three live in `feature-resource` and all three have
 * that composition as their subject rather than as an assumption. Adding a file
 * here means writing it a fourth time, which is the thing this test exists to
 * prevent.
 */
const MAY_BUILD = ['routes.ts', 'admin-section.ts', 'resource-registry.ts'];

/** Every resource this app mounts, by the segment it calls itself. */
const SEGMENTS = ADMIN_SECTIONS.flatMap((section) =>
  (section.resources ?? []).map((descriptor) => descriptor.segment)
);

/** A path that opens with one of them, quoted or as the head of a link array. */
function literalPath(segment: string): RegExp {
  const escaped = segment.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');

  return new RegExp(
    // `'/items'`, `'/items/new'`, `"/items"`.
    `['"\\\`]/${escaped}(?:['"\\\`/])` +
      // `['/', 'items'`, with any spacing or line breaks between.
      `|\\[\\s*['"]/['"]\\s*,\\s*['"]${escaped}['"]`
  );
}

/** A path built by interpolating a descriptor's segment. */
const INTERPOLATED = /\/\$\{[^}]*\.segment\}/;

function sourceFiles(root: string): readonly string[] {
  const found: string[] = [];

  for (const entry of readdirSync(root)) {
    const path = join(root, entry);

    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
      continue;
    }

    const isSource = ['.ts', '.html'].includes(extname(entry));
    const isSpec = entry.endsWith('.spec.ts') || entry.endsWith('.testing.ts');

    if (isSource && !isSpec && !MAY_BUILD.includes(entry)) {
      found.push(path);
    }
  }

  return found;
}

/** The code, without the prose about it. */
function code(path: string): string {
  const text = readFileSync(path, 'utf8');

  return extname(path) === '.html'
    ? text.replace(/<!--[\s\S]*?-->/g, '')
    : text
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')
        .replace(/<!--[\s\S]*?-->/g, '');
}

function offenders(test: (text: string) => boolean): string[] {
  return [...sourceFiles(APP), ...sourceFiles(LIBS)]
    .filter((path) => test(code(path)))
    .map((path) => relative(WORKSPACE, path).split(sep).join('/'));
}

describe('a resource path is never written by hand', () => {
  it('has every file that is allowed to build one', () => {
    // The allow list is names, so a rename would silently turn into a licence
    // for the old name and an exemption for a file that no longer exists.
    for (const name of MAY_BUILD) {
      const path = join(LIBS, 'feature-resource', 'src', 'lib', name);
      expect(() => statSync(path)).not.toThrow();
    }
  });

  it('knows which segments to look for', () => {
    expect(SEGMENTS.length).toBeGreaterThan(10);
  });

  it.each(SEGMENTS)('builds no link out of the %s segment', (segment) => {
    // Named in the failure, because the fix is per file: ask
    // `ResourceRegistry.pathOf` for the resource by name, and draw whatever it
    // answers, including nothing where the app did not mount that screen.
    expect(offenders((text) => literalPath(segment).test(text))).toEqual([]);
  });

  it('interpolates no descriptor segment into a path', () => {
    expect(offenders((text) => INTERPOLATED.test(text))).toEqual([]);
  });
});
