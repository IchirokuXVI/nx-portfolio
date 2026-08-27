import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve, sep } from 'path';

/**
 * **Rule D1 (plan 0004, section 2), as a test.**
 *
 * A `ui` component takes values and emits events. It does not inject a store, a service
 * token, or anything that knows what a backend is. The container above it holds every
 * one of those and passes plain data down.
 *
 * `0010` makes this worth enforcing rather than merely stating. It adds seven
 * components to this library, and three of them are about **governance**: a row menu
 * that removes people, a panel that takes over a group, a sheet that deletes one. Each
 * is one `inject(ZoneStore)` away from being much easier to write and impossible to
 * reason about, and the acceptance criterion asks for the rule to hold rather than for
 * it to have held on the day it was written.
 *
 * A spec rather than a lint rule for `token-hygiene.spec.ts`'s reason: the workspace
 * runs no custom ESLint plugin, `@nx/enforce-module-boundaries` is configured
 * permissively (`onlyDependOnLibsWithTags: ['*']`, per CLAUDE.md) and so will not catch
 * this, and a spec can explain itself where a rule code cannot.
 */

/** Modules a `ui` component may not import at all. */
const FORBIDDEN_IMPORTS = [
  // The whole data layer: stores, service tokens, the transport, the mappers.
  '@portfolio/velista/data-access',
  // The shared portfolio equivalent, which is the same mistake through another door.
  '@portfolio/shared/data-access',
  '@angular/common/http',
];

/**
 * Things a `ui` component may not **inject**, which is not the same as may not import.
 *
 * `AppLayout` imports `RouterOutlet`, and should: it is the component the parent route
 * renders, so hosting an outlet is its job, and a `routerLink` in a presentational
 * component is a link rather than a decision. What none of them may do is reach for the
 * `Router` itself, because navigating is choosing where the app goes, and that is the
 * container's call (rule D1).
 */
const FORBIDDEN_INJECTIONS = ['Router', 'ActivatedRoute'];

const UI_SRC = resolve(__dirname, '..');

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return filesUnder(full);
    }
    return full.endsWith('.ts') && !full.endsWith('.spec.ts') ? [full] : [];
  });
}

describe('layering', () => {
  const files = filesUnder(UI_SRC);

  it('finds the library to scan', () => {
    // A path that stopped resolving would make every assertion below vacuously true,
    // which is the one way a test like this fails silently.
    expect(files.length).toBeGreaterThan(20);
  });

  it('imports no data layer and no transport (rule D1)', () => {
    const offences = files.flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      const path = relative(UI_SRC, file).split(sep).join('/');

      return FORBIDDEN_IMPORTS.filter((banned) =>
        new RegExp(`from '${banned}'`).test(source)
      ).map((banned) => `${path} imports ${banned}`);
    });

    expect(offences).toEqual([]);
  });

  it('injects nothing that decides where the app goes', () => {
    const offences = files.flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      const path = relative(UI_SRC, file).split(sep).join('/');

      return FORBIDDEN_INJECTIONS.filter((banned) =>
        new RegExp(`inject\\(\\s*${banned}\\s*\\)`).test(source)
      ).map((banned) => `${path} injects ${banned}`);
    });

    expect(offences).toEqual([]);
  });

  it('reaches models for types, which is the layering working', () => {
    // The positive half. `models -> {ui, data-access} -> feature-*`: a view model is
    // exactly what a `ui` component should be taking, so finding these imports is
    // evidence the rule is being followed rather than merely not broken.
    const usesModels = files.filter((file) =>
      /from '@portfolio\/velista\/models'/.test(readFileSync(file, 'utf8'))
    );

    expect(usesModels.length).toBeGreaterThan(0);
  });
});
