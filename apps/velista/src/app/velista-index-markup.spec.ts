import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * The two tags that velista's nginx rewrites under the portfolio prefix (plan 0165
 * D2) are matched by literal `sub_filter` strings. If the built document spells
 * either tag differently, nginx silently passes it through, and the portfolio path
 * loads the shell's files. This holds the literals to the document.
 *
 * Angular re-serialises both tags without the self closing slash that prettier
 * writes in the source, so the filters match the built spelling. The source half
 * runs everywhere; the built half needs `nx build velista` and is skipped without
 * it, which is the case in the PR workflow. The velista-luna gate's curls
 * (k8s/e2e/velista-luna/gate.sh) check the rewritten document from outside the image.
 */
describe('velista index markup and the nginx sub filters', () => {
  /** Walk up to the directory holding nx.json, so this works under any cwd. */
  function workspaceRoot(): string {
    let dir = __dirname;
    while (!existsSync(join(dir, 'nx.json'))) {
      const parent = dirname(dir);
      if (parent === dir)
        throw new Error('could not locate the workspace root');
      dir = parent;
    }
    return dir;
  }

  const root = workspaceRoot();
  const read = (relative: string) =>
    readFileSync(resolve(root, relative), 'utf8');

  const BASE = '<base href="/">';
  const MANIFEST = '<link href="manifest.webmanifest" rel="manifest">';

  const occurrences = (haystack: string, needle: string) =>
    haystack.toLowerCase().split(needle.toLowerCase()).length - 1;

  /** The source spelling of a built tag: prettier adds ` /` before the `>`. */
  const sourceSpelling = (tag: string) => tag.replace(/>$/, ' />');

  const nginx = read('apps/velista/src/nginx.conf');

  /** The search strings of the `sub_filter` directives, in file order. */
  const subFilterSources = [
    ...nginx.matchAll(/^\s*sub_filter\s+'([^']*)'\s+'[^']*';/gm),
  ].map((match) => match[1]);

  it('filters exactly the base tag and the manifest link', () => {
    expect(subFilterSources).toEqual([BASE, MANIFEST]);
  });

  it('puts the manifest link back on the own origin in the same spelling', () => {
    expect(nginx).toContain(`"/" '${MANIFEST}';`);
  });

  it('carries each tag exactly once in the source document', () => {
    const source = read('apps/velista/src/index.html');

    expect(occurrences(source, sourceSpelling(BASE))).toBe(1);
    expect(occurrences(source, sourceSpelling(MANIFEST))).toBe(1);
    expect(source).not.toMatch(/<script/i);
  });

  const built = resolve(root, 'dist/apps/velista/index.html');
  const itWhenBuilt = existsSync(built) ? it : it.skip;

  itWhenBuilt('carries each filtered literal exactly once in the build', () => {
    const document = readFileSync(built, 'utf8');

    expect(occurrences(document, BASE)).toBe(1);
    expect(occurrences(document, MANIFEST)).toBe(1);
  });
});
