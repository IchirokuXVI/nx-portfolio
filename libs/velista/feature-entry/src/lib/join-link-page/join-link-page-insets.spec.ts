import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The join page has no page header and no tab bar, so the page clears both system
 * bars itself. The bottom inset is on `.page`, because the version line under the
 * content is the last thing on it, and with no inset anywhere it was drawn under the
 * system navigation bar on Android.
 */
function pageDeclarations(): string {
  const css = readFileSync(join(__dirname, 'join-link-page.scss'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  // The declarations of `.page` before its first nested rule.
  return /(?:^|\n)\.page\s*\{([^{}]*)/.exec(css)?.[1] ?? '';
}

describe('JoinLinkPage insets', () => {
  it('pads the page with both safe area insets', () => {
    expect(pageDeclarations()).toMatch(
      /padding-block-start:\s*var\(--app-safe-top\)\s*;/
    );
    expect(pageDeclarations()).toMatch(
      /padding-block-end:\s*var\(--app-safe-bottom\)\s*;/
    );
  });

  it('draws the version line last, which is why the page carries the inset', () => {
    const html = readFileSync(join(__dirname, 'join-link-page.html'), 'utf8');

    // The version line is followed by nothing but the end of `.page`.
    expect(html.slice(html.indexOf('<lib-app-version'))).toMatch(
      /^<lib-app-version\s*\/>\s*<\/div>/
    );
  });
});
