import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';

/**
 * **velista is sized in the small viewport, `svh`, and never in the dynamic one.**
 *
 * A test rather than a sentence, because `100dvh` is the unit every article recommends
 * for exactly this job, it is what the portfolio shell's own root uses, and it is
 * correct on every screen a developer builds a page on. It is wrong in one place, and
 * that place is the installed app on the phone this whole product is for.
 *
 * Chrome on Android draws a strip at the foot of the screen that the system navigation
 * bar sits over, and retracts it while the page is scrolled. The dynamic viewport
 * follows the strip, so `100dvh` grows by the height of the navigation bar the moment
 * it retracts. In a browser tab the platform reports the retracted strip through
 * `env(safe-area-inset-bottom)`, so a page can pad itself out of it. In an installed
 * app it does not: the inset stays at zero while the viewport grows. Every box sized in
 * `dvh` is then exactly one navigation bar taller than the screen, with nothing telling
 * the app to reserve the difference.
 *
 * What that looked like from the outside: the app opened correctly, one pull to refresh
 * made every page scroll by the height of the navigation bar with nothing to scroll to,
 * and a bottom action bar sat half under the bar. Anything that forced Chrome to re
 * establish the viewport put it right, so locking the phone, switching away and back,
 * and opening a sheet all looked like fixes.
 *
 * `svh` is the same number wherever there is nothing to retract, which is every other
 * platform this app runs on, so the rule costs those nothing.
 *
 * ## What it checks
 *
 * A `dvh` or `lvh` length in any stylesheet or inline component style under the velista
 * scope or the velista app. Comments are stripped first, because `app-layout.scss`
 * explains at length what it must not do and a rule that forbade saying so would be a
 * rule against explaining itself.
 *
 * `dvw` is not checked. The horizontal axis has no retracting chrome, and the shell
 * already documents its own reason for avoiding it.
 */

/** The velista scope, from this spec's own location: `src/lib/layout` up to `libs/velista`. */
const SCOPE = join(__dirname, '..', '..', '..', '..');

/** The app, which owns the standalone document's global stylesheet and the root component. */
const APP = join(SCOPE, '..', '..', 'apps', 'velista', 'src');

/** A length in the dynamic or the large viewport: `100dvh`, `calc(100dvh - 1px)`, `50lvh`. */
const DYNAMIC_HEIGHT = /\d\s*(?:dvh|lvh)\b/;

function sourceFiles(root: string): readonly string[] {
  const found: string[] = [];

  for (const entry of readdirSync(root)) {
    const path = join(root, entry);

    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
      continue;
    }

    // `.ts` is here for the inline `styles` of a component such as `AppRoot`, which is
    // where the standalone build's root height is stated.
    if (
      ['.scss', '.css', '.ts'].includes(extname(entry)) &&
      !entry.endsWith('.spec.ts')
    ) {
      found.push(path);
    }
  }

  return found;
}

/** The code, without the prose about it. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('velista is sized in the small viewport', () => {
  it('uses no dynamic or large viewport height anywhere', () => {
    const offenders = [...sourceFiles(SCOPE), ...sourceFiles(APP)]
      .filter((path) => DYNAMIC_HEIGHT.test(code(path)))
      .map((path) =>
        relative(join(SCOPE, '..', '..'), path)
          .split(sep)
          .join('/')
      );

    // Named in the failure, because the fix is one character per file: write the same
    // length in `svh`.
    expect(offenders).toEqual([]);
  });
});
