import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Two facts about the installable document that nothing else would notice losing
 * (velista `0166`, target 9, from the PWA audit of 2026-10-23).
 *
 * Both fail silently. Without `viewport-fit=cover`, iOS standalone and an edge to edge
 * WebView report every `env(safe-area-inset-*)` as 0, so the header sits under the
 * status bar while every spec passes. Without the `.woff2` glob, the worker never
 * caches the hashed fonts and an offline cold start draws the fallback face.
 */
describe('the installable document', () => {
  /** `src/app` up to the project root, which holds `ngsw-config.json`. */
  const project = join(__dirname, '..', '..');

  it('lets the page draw under the system bars, so the safe area insets are real', () => {
    const html = readFileSync(join(project, 'src', 'index.html'), 'utf8');
    const tag = /<meta\b[^>]*\bname="viewport"[^>]*>/.exec(html)?.[0] ?? '';
    const content = /\bcontent="([^"]*)"/.exec(tag)?.[1] ?? '';

    expect(content.split(',').map((part) => part.trim())).toContain(
      'viewport-fit=cover'
    );
  });

  it('prefetches the hashed fonts with the rest of the app', () => {
    const config = JSON.parse(
      readFileSync(join(project, 'ngsw-config.json'), 'utf8')
    ) as {
      assetGroups: { name: string; resources: { files?: string[] } }[];
    };
    const app = config.assetGroups.find((group) => group.name === 'app');

    expect(app?.resources.files).toContain('/*.woff2');
  });
});
