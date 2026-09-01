import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';

/**
 * **Nothing in velista pops the history on its own.** Every control that goes back does
 * it through `PageNavigation.back` or `SheetNavigation.dismiss`, and both of those take
 * a fallback URL that is not optional.
 *
 * A test rather than a sentence, because the rule is invisible at the call site. Writing
 * `this._location.back()` in a new screen is one short line, it reads exactly like what
 * the button is for, and it works on every arrival a developer makes while building the
 * screen: they navigated in, so there is something to go back to. It fails only on the
 * arrivals nobody clicks through by hand.
 *
 * Two of them, and neither is a corner:
 *
 * - **A link somebody shared.** The entry behind the one the tab loaded on belongs to
 *   whatever app the link was sent in. A raw pop leaves velista and lands the reader
 *   back in their messages, from a chevron that promises one screen up.
 * - **A reload.** Same stack, same result.
 *
 * The two services answer both by asking `AppHistory` whether the entry behind is one
 * this document pushed, and walking to the fallback when it is not. That is the whole
 * reason they exist, and a screen that calls `Location.back()` itself is a screen that
 * has quietly opted out of it.
 *
 * ## What it checks
 *
 * A `.back()` call with **no arguments**, which is the shape of a raw history pop
 * (`Location.back()`, `history.back()`); the helpers that are allowed to do it all take
 * the fallback as an argument, so their calls do not match. `history.go(-1)` is the
 * same thing written differently, so it is here too.
 *
 * Comments are stripped first. This file and the two services describe in prose exactly
 * what they must not be written by hand, and a rule that forbade saying so would be a
 * rule against explaining itself.
 *
 * Specs are exempt: `create-group-sheet-back-button.spec.ts` presses the browser's own
 * back button over a real history stack, which is how the behaviour is proved.
 */

/** The velista scope, from this spec's own location: `src/lib` up to `libs/velista`. */
const SCOPE = join(__dirname, '..', '..', '..');

/** The app, which owns the route tables and the providers and is scanned the same way. */
const APP = join(SCOPE, '..', '..', 'apps', 'velista', 'src');

/**
 * The two files that are allowed to pop, and there is no third.
 *
 * Both take a fallback URL and use it whenever the entry behind is not one this
 * document pushed. Adding a file here means writing that decision a second time, which
 * is the thing this test exists to prevent.
 */
const MAY_POP = ['page-navigation.ts', 'sheet-navigation.ts'];

/** A pop with nothing to fall back on: `.back()`, `.go(-1)`, `.historyGo(-1)`. */
const RAW_POP = /\.(?:back\s*\(\s*\)|(?:history)?[Gg]o\s*\(\s*-\s*\d)/;

function sourceFiles(root: string): readonly string[] {
  const found: string[] = [];

  for (const entry of readdirSync(root)) {
    const path = join(root, entry);

    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
      continue;
    }

    const isSource = ['.ts', '.html'].includes(extname(entry));

    if (isSource && !entry.endsWith('.spec.ts') && !MAY_POP.includes(entry)) {
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

describe('going back is never written by hand', () => {
  it('has both of the files that are allowed to pop', () => {
    // The allow list is names, so a rename would silently turn into a licence for the
    // old name and an exemption for a file that no longer exists.
    for (const name of MAY_POP) {
      expect(() => statSync(join(__dirname, name))).not.toThrow();
    }
  });

  it('pops nowhere else in velista', () => {
    const offenders = [...sourceFiles(SCOPE), ...sourceFiles(APP)]
      .filter((path) => RAW_POP.test(code(path)))
      .map((path) =>
        relative(join(SCOPE, '..', '..'), path)
          .split(sep)
          .join('/')
      );

    // Named in the failure, because the fix is per file: take the fallback URL the
    // screen would navigate to if it had never been able to pop, and hand it to
    // `PageNavigation.back` or `SheetNavigation.dismiss`.
    expect(offenders).toEqual([]);
  });
});
