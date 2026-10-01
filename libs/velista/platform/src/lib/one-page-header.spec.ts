import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, relative, sep } from 'node:path';

/**
 * **Every page inside `AppLayout` draws `PageHeader`, and no page draws a header of
 * its own** (velista `0130`, rules H1 to H6).
 *
 * A test rather than a sentence, because the rule is invisible at the call site. A
 * new page needs a title, and `<h1 class="title">` under a back button is one short
 * line that looks right on the page it was written for. That is how the app came to
 * have a brand bar on seven pages, six copies of one back button, a title that was
 * `2xl` here and `xl` there, and a list page whose header changed height when the
 * list arrived. Each of those was one reasonable line.
 *
 * ## What it checks
 *
 * - **No `h1` outside `PageHeader`.** The header's title is the page's `h1` (H2), so
 *   a second one is a page stating its title twice, or a component stating a title
 *   the page already has. Templates and inline templates both.
 * - **No `<header>` in a page's template.** The header element is `PageHeader`'s. A
 *   component inside a page may still mark up a header of its own content, a comment
 *   or a card, which is what the element is for.
 * - **Every page template has `lib-page-header`.** A page is a `*-page.html` file, plus
 *   the ones named in `ALSO_PAGES` that are routed and not named that way.
 * - **`lib-app-bar` is the landing page's.** It is the brand bar of the signed out
 *   front door and nothing inside the app's chrome draws it.
 *
 * ## What is outside
 *
 * The pages drawn before a person is inside the app, or outside its chrome: the
 * landing page, `auth/*`, `setup/*`, `join/:code`, `s/:secret` and `lab/walk/*`
 * (section 8 of the plan). They have no bottom bar, and most of them draw the wordmark
 * and put their title in the body. Making them match is a different decision, and a
 * second plan.
 *
 * Comments are stripped first, so a file can say in prose what it must not write.
 * Specs are exempt, because a spec builds host templates of its own.
 */

/** The velista scope, from this spec's own location: `src/lib` up to `libs/velista`. */
const SCOPE = join(__dirname, '..', '..', '..');

/** The app, which owns the route tables and the providers and is scanned the same way. */
const APP = join(SCOPE, '..', '..', 'apps', 'velista', 'src');

/** The workspace root, which the offenders are named from. */
const ROOT = join(SCOPE, '..', '..');

/** The one template that is allowed an `h1` and a `<header>`. */
const PAGE_HEADER = 'ui/src/lib/layout/page-header.html';

/**
 * Outside the plan (its section 8), as paths under `libs/velista`. A directory ends
 * with a slash.
 *
 * Adding a path here says that a screen is not inside the app's chrome. A page that is
 * inside it and merely wants a different header does not belong here: that is the
 * decision this test exists to keep in one place.
 */
const OUTSIDE = [
  'feature-auth/',
  // `join/:code` only. The two sheets beside it draw over home, so they are inside.
  'feature-entry/src/lib/join-link-page/',
  'feature-landing/',
  'feature-setup/',
  'feature-walk-lab/',
  // `s/:secret`: the page a share link opens, before the reader is anybody.
  'feature-shopping-lists/src/lib/join-page/',
  // What the screens above are built from.
  'ui/src/lib/auth/',
  'ui/src/lib/home/app-bar.html',
  'ui/src/lib/home/app-bar.ts',
  'ui/src/lib/home/home-hero.ts',
];

/** Routed pages inside `AppLayout` whose template is not named `*-page.html`. */
const ALSO_PAGES = [
  'feature-shopping-lists/src/lib/basket-current/basket-current.html',
];

function sourceFiles(root: string): readonly string[] {
  const found: string[] = [];

  for (const entry of readdirSync(root)) {
    const path = join(root, entry);

    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
      continue;
    }

    const isSource = ['.ts', '.html'].includes(extname(entry));

    if (isSource && !entry.endsWith('.spec.ts')) {
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
    : text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/** A path as it is written in this file: under `libs/velista`, forward slashes. */
function scoped(path: string): string {
  return relative(SCOPE, path).split(sep).join('/');
}

/** A path as a failure names it: from the workspace root. */
function named(path: string): string {
  return relative(ROOT, path).split(sep).join('/');
}

function isOutside(path: string): boolean {
  const at = scoped(path);

  return OUTSIDE.some((entry) =>
    entry.endsWith('/') ? at.startsWith(entry) : at === entry
  );
}

function isPage(path: string): boolean {
  return (
    basename(path).endsWith('-page.html') || ALSO_PAGES.includes(scoped(path))
  );
}

/** Everything the rules apply to: the scope and the app, less what is outside. */
function inside(): readonly string[] {
  return [...sourceFiles(SCOPE), ...sourceFiles(APP)].filter(
    (path) => !isOutside(path)
  );
}

describe('one header for every page', () => {
  it('still names real files in its lists', () => {
    // The lists are paths, so a rename would silently turn an exemption into one for
    // a file that no longer exists, and a page into one nobody checks.
    for (const entry of [...OUTSIDE, ...ALSO_PAGES, PAGE_HEADER]) {
      expect(() => statSync(join(SCOPE, entry))).not.toThrow();
    }
  });

  it('finds the pages it is about', () => {
    // A canary: a move of the libraries would leave every rule below passing over
    // nothing at all.
    const pages = inside().filter(isPage).map(scoped);

    expect(pages.length).toBeGreaterThan(20);
    expect(pages).toContain('feature-home/src/lib/home-page/home-page.html');
  });

  it('has no h1 outside PageHeader', () => {
    const offenders = inside()
      .filter((path) => scoped(path) !== PAGE_HEADER)
      .filter((path) => /<h1[\s>]/.test(code(path)))
      .map(named);

    // Named in the failure, because the fix is per file: the page's title goes in
    // `lib-page-header`'s `title`, and a heading inside the content is an `h2`.
    expect(offenders).toEqual([]);
  });

  it('has no header element in a page template', () => {
    const offenders = inside()
      .filter(isPage)
      .filter((path) => /<header[\s>]/.test(code(path)))
      .map(named);

    expect(offenders).toEqual([]);
  });

  it('draws PageHeader on every page', () => {
    const offenders = inside()
      .filter(isPage)
      .filter((path) => !/<lib-page-header[\s>]/.test(code(path)))
      .map(named);

    // A page with no header is a page that scrolls its title away or has none. If the
    // file is not a routed page inside `AppLayout`, it is misnamed or belongs in
    // `OUTSIDE`.
    expect(offenders).toEqual([]);
  });

  it('draws the brand bar on the landing page only', () => {
    const offenders = [...sourceFiles(SCOPE), ...sourceFiles(APP)]
      .filter((path) => !scoped(path).startsWith('feature-landing/'))
      .filter((path) => !scoped(path).startsWith('ui/src/lib/home/app-bar.'))
      .filter((path) => /<lib-app-bar[\s>]/.test(code(path)))
      .map(named);

    expect(offenders).toEqual([]);
  });
});
