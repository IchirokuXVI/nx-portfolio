import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';

/**
 * **Every scroll container in velista is positioned.**
 *
 * A scroller clips and scrolls only the absolutely positioned boxes whose containing
 * block it is, and an unpositioned scroller is nobody's containing block. A box with
 * `position: absolute` and no positioned ancestor is laid out against the document
 * instead: it does not move when the scroller moves, it is not clipped by it, and it
 * adds its own static position to the height of the document.
 *
 * Every page in velista has such boxes. The visually hidden pattern (a live region, an
 * `sr-only` label, the count on a tab) is `position: absolute`, and it is written into
 * rows, lists and sections all over the app. On a long list the live region of the list
 * of lines below the suggestions sat about three thousand pixels down, so the document
 * was three thousand pixels tall inside a frame that is meant never to scroll
 * (velista 0106). A drag that started on the composer or on the bar, which are outside
 * the list's own scroller, then scrolled the document: the header went off the top, the
 * field and the bar rode up the screen, and empty ground showed below them. Once the
 * document had moved, later drags on the lines could latch onto it too.
 *
 * A `position` on the scroller makes it the containing block of everything absolutely
 * positioned inside it that has no nearer one, which is where those boxes belong anyway.
 *
 * ## What it checks
 *
 * Every rule in a velista stylesheet that declares `overflow` or `overflow-y` as `auto`
 * or `scroll` also declares `position` in the same block. Any value passes: a sheet's
 * fixed panel is already a containing block. Comments are stripped first.
 */

/** The velista scope, from this spec's own location: `src/lib/layout` up to `libs/velista`. */
const SCOPE = join(__dirname, '..', '..', '..', '..');

/** The app, which owns the standalone document's global stylesheet. */
const APP = join(SCOPE, '..', '..', 'apps', 'velista', 'src');

const SCROLLS = /^\s*overflow(?:-y)?\s*:\s*(?:auto|scroll)\s*;/m;
const POSITIONED = /^\s*position\s*:/m;

function stylesheets(root: string): readonly string[] {
  const found: string[] = [];

  for (const entry of readdirSync(root)) {
    const path = join(root, entry);

    if (statSync(path).isDirectory()) {
      if (entry !== 'node_modules' && entry !== 'plans') {
        found.push(...stylesheets(path));
      }
      continue;
    }

    if (['.scss', '.css'].includes(extname(entry))) {
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

/**
 * The declarations that belong to each block itself, nested blocks removed, so a
 * `position` on a child rule does not count for its parent.
 */
function ownDeclarations(source: string): readonly string[] {
  const blocks: string[] = [];
  const open: string[] = [];

  for (const char of source) {
    if (char === '{') {
      open.push('');
    } else if (char === '}') {
      const body = open.pop();

      if (body !== undefined) {
        blocks.push(body);
      }
    } else if (open.length > 0) {
      open[open.length - 1] += char;
    }
  }

  return blocks;
}

describe('every velista scroll container is positioned', () => {
  it('declares a position beside every overflow that scrolls', () => {
    const offenders = [...stylesheets(SCOPE), ...stylesheets(APP)]
      .filter((path) =>
        ownDeclarations(code(path)).some(
          (block) => SCROLLS.test(block) && !POSITIONED.test(block)
        )
      )
      .map((path) =>
        relative(join(SCOPE, '..', '..'), path)
          .split(sep)
          .join('/')
      );

    // Named in the failure, because the fix is one line per file:
    // `position: relative` beside the overflow.
    expect(offenders).toEqual([]);
  });
});
