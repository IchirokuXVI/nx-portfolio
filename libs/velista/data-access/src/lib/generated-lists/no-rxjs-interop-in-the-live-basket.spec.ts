import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * **Nothing in the live basket imports `@angular/core/rxjs-interop`** (plan 0048,
 * section 2.3).
 *
 * It is a secondary entry point, and module federation does not dedupe it: each
 * remote that pulls it in bundles its own copy, carrying its own copy of core's
 * internal module state. `toSignal` and `takeUntilDestroyed` call
 * `assertInInjectionContext`, which reads that state, so the check runs against
 * whichever remote loaded the entry point first while the injector was set by the
 * shell's core. The result is a hard `NG0203` raised against a perfectly correct
 * DI graph, in a browser, on a screen that worked in every spec.
 *
 * The basket's live layer is exactly the category that breaks: services, provided
 * per app, reachable through the shell and through velista's own origin both. So
 * `BasketSocket` writes its signals by hand and unsubscribes through `DestroyRef`,
 * and `BasketStore` subscribes to it by hand for the same reason, and each of them
 * says so in a comment. A comment is a request; this is the check.
 *
 * ## Why a list of files rather than the whole scope
 *
 * Because the claim is about these files. This plan built the connection, and every
 * file it added is one where the two convenient imports would read as a tidy-up:
 * a `takeUntilDestroyed` on the socket's event subscription is shorter than the
 * teardown that is written there now, and looks like an improvement. What the wider
 * velista scope should do about the entry point is a separate question with its own
 * history, and answering it here would make this test fail for reasons that have
 * nothing to do with the basket.
 */

/** `src/lib/generated-lists` up to `libs/`. */
const LIBS = join(__dirname, '..', '..', '..', '..', '..');

/**
 * Everything plan 0048 added or rewrote, across the two libraries it touched.
 *
 * Named rather than globbed: a directory scan would quietly stop covering a file
 * that moved, and would quietly start covering one that has nothing to do with the
 * basket. Each of these is asserted to exist, so a rename fails here rather than
 * silently exempting the file it renamed.
 */
const THE_LIVE_BASKET: readonly string[] = [
  'velista/data-access/src/lib/generated-lists/basket-socket.ts',
  'velista/data-access/src/lib/generated-lists/basket-store.ts',
  'velista/data-access/src/lib/generated-lists/basket-session-store.ts',
  'velista/data-access/src/lib/realtime/realtime-event-mapper.ts',
  'velista/data-access/src/lib/realtime/realtime-events.ts',
  'velista/data-access/src/lib/mapping/basket-mappers.ts',
  'velista/feature-shopping-lists/src/lib/basket-page/basket-page.ts',
  'velista/feature-shopping-lists/src/lib/basket-labels.ts',
  'velista/feature-shopping-lists/src/lib/people-sheet/people-sheet.ts',
];

/** An import of the entry point, however it is written. */
const INTEROP =
  /from\s+['"]@angular\/core\/rxjs-interop['"]|import\s*\(\s*['"]@angular\/core\/rxjs-interop['"]/;

/**
 * The code, without the prose about it.
 *
 * Every file on the list explains in a comment what it must not import, and a rule
 * that forbade saying so would be a rule against explaining itself.
 */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('the live basket writes its signals by hand', () => {
  it('has every file it claims to check', () => {
    const missing = THE_LIVE_BASKET.filter((path) => {
      try {
        return !statSync(join(LIBS, path)).isFile();
      } catch {
        return true;
      }
    });

    expect(missing).toEqual([]);
  });

  it('imports rxjs-interop in none of them', () => {
    const offenders = THE_LIVE_BASKET.filter((path) =>
      INTEROP.test(code(join(LIBS, path)))
    );

    // Named in the failure, because the fix is per file: write the signal by hand,
    // and take the subscription down through `DestroyRef.onDestroy` the way
    // `BasketSocket` and `BasketStore` already do.
    expect(offenders).toEqual([]);
  });
});
