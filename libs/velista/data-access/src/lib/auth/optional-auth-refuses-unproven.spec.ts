import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';

/**
 * **Every optional-auth call refuses a session it could not prove** (plan 0067,
 * section 4).
 *
 * `authorizeOptionalAuthCall` answers four states, and the one that costs an account is
 * the pair `anonymous` and `unavailable`. They look alike at a call site and they mean
 * opposite things: nobody is signed in, against somebody is signed in and auth was not
 * answering just then. The routes behind this gate mint a guest account when they see
 * no identity, so reading the second as the first hands a user a second, empty account
 * while their groups sit on the first one, with no password to go back and find it.
 *
 * A test rather than a sentence, because the mistake is an omission. A new call site
 * that switches on `guest-account-lost` and lets everything else through reads like
 * every other one in the file, compiles, and passes every test written against a
 * backend that was up.
 *
 * ## What it checks
 *
 * Any file that calls `authorizeOptionalAuthCall` also calls `refuseUnprovenSession`,
 * which is the one helper that turns `unavailable` into a refusal. It is a coarse
 * check on purpose: it cannot tell which call guards which, and it does not try. It
 * catches the case that actually happens, which is a new call site with no gate at all.
 *
 * Comments are stripped first, so a file may explain the rule without satisfying it.
 */

/** The velista data-access lib, from this spec's own location: `src/lib/auth`. */
const LIB = join(__dirname, '..', '..');

/** The workspace root, for naming an offender the way a developer would open it. */
const ROOT = join(LIB, '..', '..', '..', '..');

const GATE = 'authorizeOptionalAuthCall';
const REFUSAL = 'refuseUnprovenSession';

/**
 * The gate's own two files: the store that answers it and the helper that refuses.
 *
 * Exempt because they define the rule rather than follow it. Named individually, so a
 * third file cannot join them by sitting in the same folder.
 */
const DEFINES_THE_RULE = ['token-store.ts', 'unproven-session.ts'];

function sourceFiles(root: string): readonly string[] {
  const found: string[] = [];

  for (const entry of readdirSync(root)) {
    const path = join(root, entry);

    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
      continue;
    }

    const isSource =
      extname(entry) === '.ts' &&
      !entry.endsWith('.spec.ts') &&
      !DEFINES_THE_RULE.includes(entry);

    if (isSource) {
      found.push(path);
    }
  }

  return found;
}

/** The code, without the prose about it. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('an unproven session is never treated as anonymous', () => {
  it('has both of the files that define the gate', () => {
    // The exemption is by name, so a rename would leave a licence for a file that no
    // longer exists and an unguarded new one in its place.
    for (const name of DEFINES_THE_RULE) {
      expect(() => statSync(join(__dirname, name))).not.toThrow();
    }
  });

  it('guards every call site', () => {
    const offenders = sourceFiles(LIB)
      .filter((path) => {
        const source = code(path);
        return source.includes(GATE) && !source.includes(REFUSAL);
      })
      .map((path) => relative(ROOT, path).split(sep).join('/'));

    // Named in the failure, because the fix is one line per call site: pass the result
    // through `refuseUnprovenSession` before reading `state` for anything else.
    expect(offenders).toEqual([]);
  });

  it('finds the call sites it is meant to be guarding', () => {
    // Without this, deleting `authorizeOptionalAuthCall` entirely, or renaming it,
    // would leave the test above passing over nothing at all.
    const callSites = sourceFiles(LIB).filter((path) =>
      code(path).includes(GATE)
    );

    expect(callSites.length).toBeGreaterThanOrEqual(2);
  });
});
