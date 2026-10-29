import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Landing has no page header and no tab bar, so the page clears both system bars
 * itself, and the bottom inset is on `.page` rather than on any child: the version
 * line is the last thing on the page, under the ways in, and an inset on the ways in
 * left it under the system navigation bar on Android.
 */
function pageDeclarations(): string {
  const css = readFileSync(join(__dirname, 'landing-page.scss'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  // The declarations of `.page` before its first nested rule.
  return /(?:^|\n)\.page\s*\{([^{}]*)/.exec(css)?.[1] ?? '';
}

describe('LandingPage insets', () => {
  it('pads the page with both safe area insets', () => {
    expect(pageDeclarations()).toMatch(
      /padding-block-start:\s*var\(--app-safe-top\)\s*;/
    );
    expect(pageDeclarations()).toMatch(
      /padding-block-end:\s*var\(--app-safe-bottom\)\s*;/
    );
  });

  it('draws the version line last, which is why the page carries the inset', () => {
    const html = readFileSync(join(__dirname, 'landing-page.html'), 'utf8');

    // The version line is followed by nothing but the end of `.page`.
    expect(html.slice(html.indexOf('<lib-app-version'))).toMatch(
      /^<lib-app-version\s*\/>\s*<\/div>/
    );
  });
});
