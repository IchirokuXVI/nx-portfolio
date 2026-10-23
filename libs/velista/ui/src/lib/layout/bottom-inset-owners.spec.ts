import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * **Who carries the bottom safe area inset.** Read from the stylesheets, because the
 * rules are about which element pads and a rendered test in jsdom resolves no
 * `env()` and no custom property.
 *
 * While the bar's room is reserved, `AppLayout` sets `--app-safe-bottom` to zero for
 * everything under it, which is right for what ends at the top of the bar. A sheet is
 * fixed to the foot of the screen and covers the bar's room, so it puts the token back
 * from `--app-nav-safe-bottom`, the value nothing redefines. Without that, a sheet over
 * a page with the bar drew its footer under a three button navigation bar on Android.
 */

/** The library's `src/lib`, from this spec's own location. */
const LIB = join(__dirname, '..');

/** The code, without the prose about it. */
function code(path: string): string {
  return readFileSync(join(LIB, path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

/** The declarations of a rule that come before its first nested rule. */
function ownDeclarations(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^{}]*)`).exec(css);
  return match?.[1] ?? '';
}

describe('the bottom safe area inset', () => {
  it('is put back on the sheet, which covers the bar', () => {
    expect(ownDeclarations(code('entry/sheet-shell.scss'), ':host')).toMatch(
      /--app-safe-bottom:\s*var\(--app-nav-safe-bottom\)\s*;/
    );
  });

  it('is zeroed for the page column while the bar is up', () => {
    // The rule the sheet answers. If this goes, the line above has nothing to undo.
    expect(
      ownDeclarations(code('layout/app-layout.scss'), ':host(.nav-up)')
    ).toMatch(/--app-safe-bottom:\s*0px\s*;/);
  });

  it('is not on the ways in, which are not the last thing on landing', () => {
    // Landing draws its version line under these, so the page carries the inset.
    expect(code('home/auth-actions.scss')).not.toMatch(/--app-safe-bottom/);
  });

  it('is not on the version line, which pages that already pad also draw', () => {
    expect(code('brand/app-version.scss')).not.toMatch(/safe/);
  });
});
