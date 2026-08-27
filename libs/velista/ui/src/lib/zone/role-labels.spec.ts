import { readFileSync } from 'fs';
import { join, resolve } from 'path';

/**
 * Plan 0010 section 6: `zone.role.*` stops being a placeholder.
 *
 * `0003` had nowhere to render a role properly, so these three were the backend's enum
 * values shouted in both locales ("OWNER", "ADMIN", "MEMBER"). This is that screen, so
 * they become words a person would say, and the zone card on the dashboard picks the
 * change up for free.
 *
 * Asserted against the JSON rather than through a rendered component because the
 * translator returns **keys** in tests: a component spec can prove which key was
 * chosen and can say nothing at all about what the value is. This is the only place
 * the values themselves are checkable.
 */
const I18N = resolve(__dirname, '../../../assets/i18n');

function locale(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(I18N, `${name}.json`), 'utf8'));
}

function roles(name: string): Record<string, string> {
  const zone = locale(name)['zone'] as Record<string, unknown>;
  return zone['role'] as Record<string, string>;
}

describe('the role labels', () => {
  it('reads as words in English', () => {
    expect(roles('en')).toEqual({
      owner: 'Owner',
      admin: 'Admin',
      member: 'Member',
    });
  });

  it('reads as words in Spanish', () => {
    expect(roles('es')).toEqual({
      owner: 'Dueño',
      admin: 'Administrador',
      member: 'Miembro',
    });
  });

  it('shouts in neither, which is what a placeholder looked like', () => {
    // The specific failure this guards: an enum value pasted in as copy. It reads as
    // a bug on a members list, where the role sits beside somebody's name.
    for (const name of ['en', 'es']) {
      for (const value of Object.values(roles(name))) {
        expect(value).not.toBe(value.toLocaleUpperCase());
      }
    }
  });

  it('keeps the two locales in step, key for key', () => {
    // A key present in one language and missing in the other renders as the raw key
    // to half the users, which is the failure mode a spec is cheapest at catching.
    expect(Object.keys(roles('es'))).toEqual(Object.keys(roles('en')));
  });
});
