import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve, sep } from 'path';

/**
 * Plan 0002, acceptance criterion 5: *a lint rule or a documented review check
 * catches literal colours and raw pixel values in component styles.*
 *
 * This is that check, as a test rather than as a lint rule. The workspace runs no
 * stylelint, and adding it for one library would mean a new tool, a new config and
 * a new CI step to enforce three rules. A spec runs in the pipeline that already
 * exists, fails with the offending file and line, and can explain itself, which a
 * `stylelint` error code cannot.
 *
 * What it enforces:
 *
 * - **Rule T1.** A component may only reference semantic or component tokens.
 *   Reaching for a primitive is a bug because it will not follow a theme change,
 *   and a hand written colour will not follow anything at all.
 * - **No raw pixels.** The space, radius and type scales exist so that a phone
 *   layout stays consistent; a `13px` in one component is how a system stops being
 *   one. `1px` is exempt, because a hairline is one device pixel by definition and
 *   tokenising it would be noise.
 *
 * Adding a token file to `TOKEN_FILES` is the only way to be exempt, and that is
 * deliberate: the exemption list is the design system, and it should be short
 * enough to read.
 */

/** Everything under here is scanned, recursively, for `.scss`. */
const ROOTS = ['libs/velista', 'apps/velista/src'];

/**
 * The three token files, plus their entry point. These are the design system, so
 * they are the one place a literal may appear. Criterion 5's other half, that
 * "_primitives.scss, _semantic.scss and _themes.scss are the only files containing
 * literal colour values", is what this list says out loud.
 */
const TOKEN_FILES = [
  '_primitives.scss',
  '_semantic.scss',
  '_themes.scss',
  '_tokens.scss',
];

/** The layer 1 ramps. A component naming one of these is naming a raw colour. */
const PRIMITIVE_RAMPS =
  /var\(\s*--app-(ink|neutral|white|amber|mint|coral|violet|sky)\b/;

const HEX = /#[0-9a-fA-F]{3,8}\b/;
const COLOUR_FUNCTION = /\b(rgba?|hsla?|color-mix|lab|lch|oklch)\s*\(/;
/**
 * A short list rather than all 148 CSS names. These are the ones somebody
 * actually types by accident; the rest would be a deliberate act, and the hex and
 * function rules above catch every realistic route to one.
 */
const NAMED_COLOUR =
  /(?<![\w-])(white|black|red|green|blue|grey|gray|orange|yellow|purple|silver)(?![\w-])\s*(?:;|\)|,|$)/;
/** Any px length except `0px` and the `1px` hairline exemption. */
const RAW_PIXELS = /(?<![\w.-])(?!0px|1px)\d*\.?\d+px\b/;

interface Offence {
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly rule: string;
}

function scssFilesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...scssFilesUnder(full));
    } else if (entry.endsWith('.scss')) {
      found.push(full);
    }
  }
  return found;
}

function offencesIn(file: string, workspaceRoot: string): Offence[] {
  const found: Offence[] = [];
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);

  lines.forEach((raw, index) => {
    // Comments carry the reasoning, and the reasoning names colours and sizes.
    const line = raw.replace(/\/\/.*$/, '').trim();
    if (!line) {
      return;
    }

    const checks: [RegExp, string][] = [
      [HEX, 'a literal colour'],
      [COLOUR_FUNCTION, 'a colour function'],
      [NAMED_COLOUR, 'a named colour'],
      [PRIMITIVE_RAMPS, 'a layer 1 primitive (rule T1)'],
      [RAW_PIXELS, 'a raw pixel value'],
    ];

    for (const [pattern, rule] of checks) {
      if (pattern.test(line)) {
        found.push({
          file: relative(workspaceRoot, file).split(sep).join('/'),
          line: index + 1,
          text: line,
          rule,
        });
      }
    }
  });

  return found;
}

describe('token hygiene', () => {
  // From `libs/velista/ui/src/lib/styles` up to the workspace root.
  const workspaceRoot = resolve(__dirname, '../../../../../..');

  const stylesheets = ROOTS.flatMap((root) =>
    scssFilesUnder(join(workspaceRoot, root))
  );

  it('finds the stylesheets it is supposed to be guarding', () => {
    // A scan that silently matches nothing passes forever. This is the canary.
    expect(stylesheets.length).toBeGreaterThan(4);
    expect(stylesheets.some((file) => file.endsWith('app-layout.scss'))).toBe(
      true
    );
  });

  it('keeps literal colours and raw pixels out of component styles', () => {
    const offences = stylesheets
      .filter((file) => !TOKEN_FILES.some((token) => file.endsWith(token)))
      .flatMap((file) => offencesIn(file, workspaceRoot));

    const report = offences
      .map((o) => `${o.file}:${o.line} uses ${o.rule}\n    ${o.text}`)
      .join('\n');

    expect(report).toBe('');
  });

  it('is capable of catching one, so the patterns are not dead', () => {
    // The check above passes when the codebase is clean and when the patterns are
    // broken. This tells the two apart.
    const samples = [
      'color: #ff0000;',
      'background: rgba(0, 0, 0, 0.5);',
      'color: white;',
      'color: var(--app-amber-500);',
      'padding: 13px;',
    ];

    for (const sample of samples) {
      const matched = [
        HEX,
        COLOUR_FUNCTION,
        NAMED_COLOUR,
        PRIMITIVE_RAMPS,
        RAW_PIXELS,
      ].some((pattern) => pattern.test(sample));
      expect([sample, matched]).toEqual([sample, true]);
    }

    // And does not fire on the things it is meant to allow.
    for (const sample of [
      'border: 1px solid var(--app-border-subtle);',
      'gap: var(--app-space-3);',
      'font-size: var(--app-text-lg);',
      'width: 100%;',
    ]) {
      const matched = [
        HEX,
        COLOUR_FUNCTION,
        NAMED_COLOUR,
        PRIMITIVE_RAMPS,
        RAW_PIXELS,
      ].some((pattern) => pattern.test(sample));
      expect([sample, matched]).toEqual([sample, false]);
    }
  });
});
