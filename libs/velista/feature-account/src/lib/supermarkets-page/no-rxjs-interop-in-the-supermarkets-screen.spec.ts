import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * **Nothing the supermarkets screen is made of imports `@angular/core/rxjs-interop`**
 * (plan 0059, section 6).
 *
 * It is a secondary entry point, and module federation does not dedupe it: each remote
 * that pulls it in bundles its own copy, carrying its own copy of core's internal module
 * state. `toSignal` and `takeUntilDestroyed` call `assertInInjectionContext`, which reads
 * that state, so the check runs against whichever remote loaded the entry point first
 * while the injector was set by the shell's core. The result is a hard `NG0203` raised
 * against a perfectly correct DI graph, in a browser, on a screen that worked in every
 * spec.
 *
 * `ShopStore` is exactly the category that breaks: a service, provided per app, on a page
 * reachable through the shell and through velista's own origin both. So it writes its
 * signals by hand, and the page debounces its search with a `setTimeout` inside an
 * `effect` rather than with a `toSignal` over a `Subject`, which is the shorter version
 * that would look like an improvement.
 *
 * ## Why a list of files rather than the whole scope
 *
 * `no-rxjs-interop-in-the-live-basket.spec.ts`'s reasoning, which this follows: the claim
 * is about these files. What the wider velista scope should do about the entry point is a
 * separate question with its own history, and answering it here would make this test fail
 * for reasons that have nothing to do with this screen.
 */

/** `src/lib/supermarkets-page` up to `libs/`. */
const LIBS = join(__dirname, '..', '..', '..', '..', '..');

/**
 * Everything plan 0059 added, across the three libraries it touched.
 *
 * Named rather than globbed: a directory scan would quietly stop covering a file that
 * moved, and would quietly start covering one that has nothing to do with this screen.
 * Each of these is asserted to exist, so a rename fails here rather than silently
 * exempting the file it renamed.
 */
const THE_SUPERMARKETS_SCREEN: readonly string[] = [
  'velista/data-access/src/lib/shops/shop-api.ts',
  'velista/data-access/src/lib/shops/shop-memory.ts',
  'velista/data-access/src/lib/shops/shop-service.ts',
  'velista/data-access/src/lib/shops/shop-store.ts',
  'velista/data-access/src/lib/mapping/shop-mappers.ts',
  'velista/feature-account/src/lib/supermarkets-page/supermarkets-page.ts',
  'velista/feature-account/src/lib/franchise-buttons/franchise-buttons.ts',
  'velista/feature-account/src/lib/shop-list/shop-list.ts',
  'velista/feature-account/src/lib/attribution-note/attribution-note.ts',
];

/** An import of the entry point, however it is written. */
const INTEROP =
  /from\s+['"]@angular\/core\/rxjs-interop['"]|import\s*\(\s*['"]@angular\/core\/rxjs-interop['"]/;

/**
 * The code, without the prose about it.
 *
 * The files explain in comments what they must not import, and a rule that forbade saying
 * so would be a rule against explaining itself.
 */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('the supermarkets screen writes its signals by hand', () => {
  it('has every file it claims to check', () => {
    const missing = THE_SUPERMARKETS_SCREEN.filter((path) => {
      try {
        return !statSync(join(LIBS, path)).isFile();
      } catch {
        return true;
      }
    });

    expect(missing).toEqual([]);
  });

  it('imports rxjs-interop in none of them', () => {
    const offenders = THE_SUPERMARKETS_SCREEN.filter((path) =>
      INTEROP.test(code(join(LIBS, path)))
    );

    // Named in the failure, because the fix is per file: write the signal by hand, and
    // take any subscription down through `DestroyRef.onDestroy`.
    expect(offenders).toEqual([]);
  });
});
