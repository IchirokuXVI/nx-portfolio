import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Every `process.env` read in the app's own code is one the DefinePlugin
 * substitutes (plan 0014, section 3.2).
 *
 * `process` does not exist in a browser, so this is not a tidiness check: an
 * unsubstituted read throws at startup in the deployed app and nowhere else. The
 * failure mode is adding a variable to `environment.prod.ts` and forgetting the
 * matching `DefinePlugin` entry, which no type check and no unit test would
 * otherwise catch.
 *
 * Asserted over the sources rather than over `dist/`, so it holds without a build
 * step. (The emitted bundle was checked by hand when this landed: both reads are
 * replaced by string literals, and the only `process.env` left anywhere in the
 * output belongs to module federation and i18next, both behind
 * `typeof process !== 'undefined'` guards, so neither can throw. A literal "no
 * process.env in the bundle" assertion would fail on their vendored code and say
 * nothing about ours.)
 */
describe('velista environment substitution', () => {
  /** Walk up to the directory holding nx.json, so this works under any cwd. */
  function workspaceRoot(): string {
    let dir = __dirname;
    while (!existsSync(join(dir, 'nx.json'))) {
      const parent = dirname(dir);
      if (parent === dir) throw new Error('could not locate the workspace root');
      dir = parent;
    }
    return dir;
  }

  const read = (relative: string) =>
    readFileSync(resolve(workspaceRoot(), relative), 'utf8');

  /** Variable names read as `process.env['NAME']` or `process.env.NAME`. */
  function envReads(source: string): string[] {
    const names = new Set<string>();
    for (const match of source.matchAll(
      /process\.env(?:\['([A-Z0-9_]+)'\]|\.([A-Z0-9_]+))/g
    )) {
      names.add(match[1] ?? match[2]);
    }
    return [...names].sort();
  }

  /** Variable names the DefinePlugin defines under `process.env.`. */
  function definedNames(source: string): string[] {
    const names = new Set<string>();
    for (const match of source.matchAll(
      /'process\.env\.([A-Z0-9_]+)'\s*:/g
    )) {
      names.add(match[1]);
    }
    return [...names].sort();
  }

  const environment = read('apps/velista/src/environments/environment.prod.ts');
  const webpack = read('apps/velista/webpack.prod.config.ts');

  it('substitutes every variable the production environment reads', () => {
    expect(envReads(environment)).toEqual(definedNames(webpack));
  });

  it('reads the two backend URLs and nothing else', () => {
    // If this list grows, the DefinePlugin has to grow with it — which is what
    // the assertion above enforces. This one is here so the intent is legible.
    expect(envReads(environment)).toEqual([
      'LUNA_GATEWAY_URL',
      'LUNA_REALTIME_URL',
    ]);
  });

  it('leaves the development environment free of process.env', () => {
    // The development build has no DefinePlugin, so a read there would reach a
    // browser intact. `nx serve velista` would break, not the deployed image.
    expect(
      envReads(read('apps/velista/src/environments/environment.ts'))
    ).toEqual([]);
  });
});
