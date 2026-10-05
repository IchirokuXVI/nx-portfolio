import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * **The arrow of a select is the arrow of a typeahead** (admin plan 0050,
 * target 10).
 *
 * A select cannot hold a child, so the global control rule draws its arrow as
 * a background image. A data URI reads no custom property and imports no file,
 * which leaves two values written out by hand: the path of the chevron and its
 * colour. The typeahead draws the shared icon in the token's colour, so either
 * hand written value can drift from it and nothing would look wrong in a diff.
 * This spec reads the three files and starts nothing.
 */

const ROOT = join(__dirname, '..', '..', '..', '..');

const STYLES = readFileSync(
  join(ROOT, 'apps', 'luna-shopper-admin', 'src', 'styles.scss'),
  'utf8'
);
const TOKENS = readFileSync(
  join(
    ROOT,
    'libs',
    'luna-shopper-admin',
    'ui',
    'src',
    'lib',
    'styles',
    '_tokens.scss'
  ),
  'utf8'
);
const CHEVRON = readFileSync(
  join(
    ROOT,
    'libs',
    'shared',
    'ui',
    'src',
    'lib',
    'chevron-left-icon',
    'chevron-left-icon.svg'
  ),
  'utf8'
);
const PICKER = readFileSync(
  join(
    ROOT,
    'libs',
    'luna-shopper-admin',
    'ui',
    'src',
    'lib',
    'resource',
    'reference-picker.ts'
  ),
  'utf8'
);

/** The data URI of the select rule, decoded back to markup. */
function arrowOfTheSelect(): string {
  const found = /select\s*\{[^}]*background-image:\s*url\("([^"]+)"\)/.exec(
    STYLES
  );
  if (found === null) {
    throw new Error('styles.scss draws no arrow on a select');
  }
  return decodeURIComponent(found[1]);
}

describe('the arrow of a select', () => {
  it('is the path of the shared chevron', () => {
    const path = / d="([^"]+)"/.exec(CHEVRON)?.[1];

    expect(path).toBeDefined();
    expect(arrowOfTheSelect()).toContain(`d='${path}'`);
  });

  it('is drawn in the muted ink', () => {
    const ink = /--admin-ink-muted:\s*(#[0-9a-f]{6})/i.exec(TOKENS)?.[1];

    expect(ink).toBeDefined();
    expect(arrowOfTheSelect()).toContain(`fill='${ink}'`);
  });

  /**
   * Both arrows are `--admin-caret` wide and `--admin-space-3` from the edge,
   * and the text of both controls stops at the same sum.
   */
  it('sits where the arrow of the typeahead sits', () => {
    const room =
      /padding-inline-end:\s*calc\(\s*var\(--admin-space-3\) \+ var\(--admin-caret\) \+ var\(--admin-space-2\)\s*\)/;

    expect(STYLES).toMatch(room);
    expect(PICKER).toMatch(room);
    expect(STYLES).toMatch(
      /background-position:\s*right var\(--admin-space-3\) center/
    );
    expect(STYLES).toMatch(/background-origin:\s*border-box/);
    expect(PICKER).toContain(
      'inline-size: calc(var(--admin-caret) + 2 * var(--admin-space-3))'
    );
  });
});
