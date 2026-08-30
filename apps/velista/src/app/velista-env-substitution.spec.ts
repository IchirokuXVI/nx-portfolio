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
      if (parent === dir)
        throw new Error('could not locate the workspace root');
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
    for (const match of source.matchAll(/'process\.env\.([A-Z0-9_]+)'\s*:/g)) {
      names.add(match[1]);
    }
    return [...names].sort();
  }

  const environment = read('apps/velista/src/environments/environment.prod.ts');
  const webpack = read('apps/velista/webpack.prod.config.ts');
  const devEnvironment = read('apps/velista/src/environments/environment.ts');
  const devWebpack = read('apps/velista/webpack.config.ts');

  it('substitutes every variable the production environment reads', () => {
    expect(envReads(environment)).toEqual(definedNames(webpack));
  });

  it('reads the two backend URLs, the app’s own and the build version', () => {
    // If this list grows, the DefinePlugin has to grow with it, which is what
    // the assertion above enforces. This one is here so the intent is legible.
    //
    // The third is the app's own origin (plan 0033 D10), which the mounted copy under
    // the portfolio's shell points at because it cannot install anything itself. It is
    // a separate variable rather than a field on the api config, which describes where
    // the backend is and would be a lie about this value.
    expect(envReads(environment)).toEqual([
      'LUNA_GATEWAY_URL',
      'LUNA_REALTIME_URL',
      'VELISTA_APP_URL',
      'VELISTA_APP_VERSION',
    ]);
  });

  /**
   * The development build used to be asserted the other way round: it had no
   * DefinePlugin, so any `process.env` read there would have reached a browser
   * intact and `nx serve velista` would break.
   *
   * It has one now, and for a reason the old rule could not have anticipated. The
   * dev slots (`tools/dev/ng-slot.sh`) serve this app from several worktrees at
   * once, each against its own backend on its own ports, so the two URLs cannot be
   * literals in `environment.ts` any more than they can in the production one.
   *
   * The invariant is therefore unchanged and now stated symmetrically: every
   * `process.env` read has a matching substitution in the config that builds it.
   */
  it('substitutes every variable the development environment reads', () => {
    expect(envReads(devEnvironment)).toEqual(definedNames(devWebpack));
  });

  it('reads the same four variables in development', () => {
    expect(envReads(devEnvironment)).toEqual([
      'LUNA_GATEWAY_URL',
      'LUNA_REALTIME_URL',
      'VELISTA_APP_URL',
      'VELISTA_APP_VERSION',
    ]);
  });
});
