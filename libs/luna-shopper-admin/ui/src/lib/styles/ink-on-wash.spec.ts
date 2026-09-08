import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';

/**
 * **An `-ink` colour goes on the matching solid colour and nowhere else.**
 * `-on-wash` goes on the matching wash and nowhere else (plan 0018, section 1.1).
 *
 * A test rather than a sentence, because the defect is invisible at the call
 * site and one paste away at every one of them. `--admin-accent-ink` reads like
 * the accent's foreground, so a tinted badge written as
 *
 * ```scss
 * background: var(--admin-accent-wash);
 * color: var(--admin-accent-ink);
 * ```
 *
 * looks right, names two tokens from the same family, and draws white on a pale
 * box at a contrast ratio of 1.14 to 1. That is not hard to read. It is not
 * visible at all, and it happened seventeen times before anybody opened the
 * screen it happened on worst.
 *
 * ## What it checks
 *
 * Every `color: var(--admin-X-ink)` in a component, where `--admin-X` is itself
 * a token. The same rule block must set `background` to that solid token. A
 * block that sets the wash instead, or sets no background at all, is named with
 * its file and its selector.
 *
 * `--admin-ink` and `--admin-chart-ink` are not caught by that, and should not
 * be: there is no `--admin` or `--admin-chart` colour for them to be the ink of.
 * They are the app's plain foreground and a chart's axis colour, and both are
 * meant to go on whatever they land on.
 *
 * A source scan rather than a rendered check. The defect is a pair of token
 * names sitting next to each other, which is a thing a reader can see in the
 * file; rendering it would need a browser and would still only catch the
 * components some test happened to mount.
 */

/** The `ui` scope, from this spec's own location: `src/lib/styles` up to the lib. */
const UI = join(__dirname, '..', '..', '..');

/** Every admin library, `ui` included, and the app beside them. */
const ROOTS = [
  join(UI, '..'),
  join(UI, '..', '..', '..', 'apps', 'luna-shopper-admin', 'src'),
];

/** What a failure's path is relative to, so it reads as a repository path. */
const WORKSPACE = join(UI, '..', '..', '..');

/** The token block both halves of the rule are read out of. */
const TOKENS = readFileSync(join(__dirname, '_tokens.scss'), 'utf8');

/** `color: var(--admin-something-ink)`, with the family captured. */
const INK = /color:\s*var\(\s*--admin-([a-z0-9-]+)-ink\s*\)/g;

/** `background: var(--admin-whatever)`, with the token captured. */
const BACKGROUND = /background:\s*var\(\s*(--admin-[a-z0-9-]+)\s*\)/;

/**
 * The families that have both a solid colour and an ink for it.
 *
 * Read out of the stylesheet rather than listed here, so a family added later
 * is covered on the day its tokens land instead of on the day somebody
 * remembers this file.
 */
function inkedFamilies(): readonly string[] {
  // A set, because the accent declares its ink four times: once resting and
  // once inside each of the three deployment blocks.
  const families = new Set(
    [...TOKENS.matchAll(/--admin-([a-z0-9-]+)-ink:/g)].map((found) => found[1])
  );

  return [...families].filter((family) =>
    new RegExp(`--admin-${family}:`).test(TOKENS)
  );
}

function sourceFiles(root: string): readonly string[] {
  const found: string[] = [];

  for (const entry of readdirSync(root)) {
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

/**
 * The rule block a declaration sits in: back to the `{` that opened it, and the
 * selector in front of that.
 *
 * Crude, and enough. These are component `styles` templates, so the CSS is flat:
 * no nesting, no media queries around a colour, and every block that sets a
 * colour is a handful of lines long.
 */
function block(text: string, at: number): { selector: string; body: string } {
  const opened = text.lastIndexOf('{', at);
  const closed = text.indexOf('}', at);
  const before = text.slice(0, opened);
  const start = Math.max(
    before.lastIndexOf('}'),
    before.lastIndexOf('{'),
    before.lastIndexOf('`')
  );

  return {
    selector: before
      .slice(start + 1)
      .trim()
      .replace(/\s+/g, ' '),
    body: text.slice(opened, closed === -1 ? text.length : closed),
  };
}

/** Every place an ink is used on something that is not its own solid colour. */
function offenders(): readonly string[] {
  const families = inkedFamilies();
  const found: string[] = [];

  for (const root of ROOTS) {
    for (const path of sourceFiles(root)) {
      const text = readFileSync(path, 'utf8');

      for (const use of text.matchAll(INK)) {
        const family = use[1];

        if (!families.includes(family)) {
          continue;
        }

        const rule = block(text, use.index ?? 0);
        const background = BACKGROUND.exec(rule.body)?.[1] ?? null;

        if (background === `--admin-${family}`) {
          continue;
        }

        const file = relative(WORKSPACE, path).split(sep).join('/');

        found.push(
          `${file}: \`${rule.selector}\` puts --admin-${family}-ink on ` +
            `${background ?? 'no background of its own'}`
        );
      }
    }
  }

  return found;
}

describe('an ink goes on its own colour', () => {
  it('finds the tokens the rule is about', () => {
    // The families are read out of the stylesheet, so a rename there would
    // quietly leave this spec checking nothing at all.
    expect([...inkedFamilies()].sort()).toEqual(['accent', 'danger']);
  });

  it('is followed everywhere in the app', () => {
    // Named in the failure, because the fix is per rule and it is one word: a
    // tinted box takes `-on-wash`, a filled control takes the solid colour and
    // keeps `-ink`.
    expect(offenders()).toEqual([]);
  });

  /**
   * The scan proved against the shape it exists to catch, since a scan that
   * silently matched nothing would pass this file forever.
   */
  it('names a wash under an ink, and leaves a solid under one alone', () => {
    const wrong = `
      .badge {
        background: var(--admin-accent-wash);
        color: var(--admin-accent-ink);
      }
    `;
    const right = `
      .badge {
        background: var(--admin-accent);
        color: var(--admin-accent-ink);
      }
    `;

    const at = (text: string) => {
      INK.lastIndex = 0;
      const use = INK.exec(text);
      const rule = block(text, use?.index ?? 0);
      return BACKGROUND.exec(rule.body)?.[1];
    };

    expect(at(wrong)).toBe('--admin-accent-wash');
    expect(at(right)).toBe('--admin-accent');
  });
});
