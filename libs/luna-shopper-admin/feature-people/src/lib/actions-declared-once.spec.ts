import { TestBed } from '@angular/core/testing';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SHOPPER_RESOURCES } from './shoppers-routes';

/**
 * One place declares an action (admin plan 0045, constraints).
 *
 * The page of a person and the page of a zone each wrote their actions a
 * second time: a button, a confirmation with its own keys, and a call to the
 * directory service, beside the named action the descriptor already declared.
 * Kick and ban had two sets of translation keys, and the two had begun to say
 * different things.
 *
 * This reads the library's own sources, because "declared once" is a claim
 * about where code is and not about what it does. Three things are checked:
 *
 * - every write the directory service offers is called from exactly one file;
 * - that file is the descriptor of the resource the write is about, or the one
 *   tab that sets an account's roles, which no descriptor declares;
 * - no page names the label or the confirmation of a named action.
 */

const LIB = __dirname;

/** The code, without the prose about it. Prose may name anything. */
function code(file: string): string {
  return readFileSync(join(LIB, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

/** Every source of the library that is not a spec or a spec's helper. */
const SOURCES = readdirSync(LIB).filter(
  (file) =>
    file.endsWith('.ts') &&
    !file.endsWith('.spec.ts') &&
    !file.endsWith('.testing.ts')
);

/** Each write of the directory service, and the one file that may call it. */
const WRITES: Readonly<Record<string, string>> = {
  deleteUser: 'users.ts',
  resendVerification: 'users.ts',
  deleteZone: 'zones.ts',
  regenerateJoinCode: 'zones.ts',
  setZoneDeletionMark: 'zones.ts',
  approveMember: 'memberships.ts',
  rejectMember: 'memberships.ts',
  transferOwnership: 'memberships.ts',
  kickMember: 'memberships.ts',
  banMember: 'memberships.ts',
  setLineApproval: 'list-lines.ts',
  // Not a named action: a role is one switch of the Details tab of a person,
  // with a confirmation that names the role (admin plan 0038).
  setUserRoles: 'person-tabs.ts',
};

function namedActionsOf(resource: (typeof SHOPPER_RESOURCES)[number]) {
  return TestBed.runInInjectionContext(() => resource.actions?.named?.() ?? []);
}

describe('where an action of the shoppers screens is declared', () => {
  it('reads the sources this spec is about', () => {
    expect(SOURCES).toEqual(
      expect.arrayContaining([
        'users.ts',
        'zones.ts',
        'memberships.ts',
        'list-lines.ts',
        'person-page.ts',
        'zone-page.ts',
        'zone-members-tab.ts',
        'list-page.ts',
      ])
    );
  });

  it.each(Object.entries(WRITES))(
    'calls %s from %s and from nowhere else',
    (method, owner) => {
      const callers = SOURCES.filter((file) =>
        new RegExp(`\\.${method}\\(`).test(code(file))
      );

      expect(callers).toEqual([owner]);
    }
  );

  it('names every write the directory service has', () => {
    // A write added to the service and called from a page would pass the
    // check above by not being in it. So the list is held against the calls
    // the sources make on anything called a directory.
    const called = new Set<string>();
    for (const file of SOURCES) {
      for (const match of code(file).matchAll(/[dD]irectory\.(\w+)\(/g)) {
        called.add(match[1]);
      }
    }

    expect([...called].sort()).toEqual(Object.keys(WRITES).sort());
  });

  it('gives every named action a name of its own', () => {
    const names = SHOPPER_RESOURCES.flatMap((resource) =>
      namedActionsOf(resource).map((action) => action.name)
    );

    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(
      expect.arrayContaining([
        'resend-verification',
        'delete-account',
        'regenerate-join-code',
        'mark-for-deletion',
        'restore-zone',
        'delete-zone',
        'approve-member',
        'reject-member',
        'transfer-ownership',
        'kick-member',
        'ban-member',
        'approve-line',
        'reject-line',
      ])
    );
  });

  it('writes the label and the confirmation of an action in its descriptor alone', () => {
    const keys = SHOPPER_RESOURCES.flatMap((resource) =>
      namedActionsOf(resource).flatMap((action) => [
        action.label,
        ...(action.confirm === undefined
          ? []
          : [
              action.confirm.heading,
              action.confirm.body,
              action.confirm.confirm,
            ]),
      ])
    );
    const descriptors = new Set(Object.values(WRITES));
    const pages = SOURCES.filter((file) => !descriptors.has(file));

    const copies = pages.flatMap((file) => {
      const text = code(file);
      return [...new Set(keys)]
        .filter((key) => text.includes(`'${key}'`))
        .map((key) => `${file}: ${key}`);
    });

    expect(copies).toEqual([]);
  });

  /** The second set of kick and ban keys is gone from the catalogue too. */
  it('keeps one set of words for removing and banning a member', () => {
    const catalogue = JSON.parse(
      readFileSync(
        join(LIB, '..', '..', '..', 'ui', 'assets', 'i18n', 'en.json'),
        'utf8'
      )
    ) as { people: { zones: { confirm: Record<string, unknown> } } };

    expect(Object.keys(catalogue.people.zones.confirm).sort()).toEqual([
      'deleteZone',
      'markForDeletion',
      'regenerateJoinCode',
    ]);
  });
});
