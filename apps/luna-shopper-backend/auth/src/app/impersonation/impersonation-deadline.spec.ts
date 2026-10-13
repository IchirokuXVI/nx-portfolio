import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { getMetadataArgsStorage } from 'typeorm';
import { ImpersonationSession } from '../entities';

/**
 * The deadline of a support session is written one time (plan 0194,
 * constraints).
 *
 * A deadline that a second code path can move is not a deadline. Two things
 * could move it, and each has an assertion here:
 *
 * - **TypeORM**, through a `save` or an `update` of a loaded row. The column
 *   is declared `update: false`, so it is left out of every `UPDATE` that
 *   TypeORM builds.
 * - **Raw SQL or an assignment**, which no column option reaches. So this
 *   reads every source file of auth for one.
 */

const APP_ROOT = join(__dirname, '..');

/** Every non spec source file of the auth service, with its text. */
function sources(dir = APP_ROOT): Array<{ file: string; text: string }> {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return sources(path);
    }
    if (!name.endsWith('.ts') || name.endsWith('.spec.ts')) {
      return [];
    }
    return [{ file: path, text: readFileSync(path, 'utf8') }];
  });
}

describe('the deadline of a support session', () => {
  it('is a column TypeORM never updates', () => {
    const column = getMetadataArgsStorage().columns.find(
      (candidate) =>
        candidate.target === ImpersonationSession &&
        candidate.propertyName === 'expiresAt'
    );

    expect(column?.options.update).toBe(false);
  });

  it('is set by no raw UPDATE of the table', () => {
    const offenders = sources()
      // The migration creates the table. It is the one file that may name the
      // column in SQL, and it has no UPDATE.
      .filter(({ text }) => /UPDATE\s+"?impersonation_sessions"?/i.test(text))
      .filter(({ text }) => {
        const statements = text.match(
          /UPDATE\s+"?impersonation_sessions"?[\s\S]*?(?:RETURNING|`)/gi
        );
        return (statements ?? []).some((sql) => /"?expiresAt"?\s*=/.test(sql));
      })
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it('is assigned in one place, the insert of the start', () => {
    // An assignment to a loaded row (`session.expiresAt = ...`) is the write
    // `update: false` would silently drop, which is a bug that looks like a
    // feature. No source file has one.
    const assigned = sources()
      .filter(({ file }) => file.includes('impersonation'))
      .flatMap(({ file, text }) =>
        (text.match(/\.expiresAt\s*=[^=]/g) ?? []).map(() => file)
      );
    expect(assigned).toEqual([]);

    // And the service names the column as a written key exactly one time.
    const service = readFileSync(
      join(__dirname, 'impersonation.service.ts'),
      'utf8'
    );
    expect(service.match(/expiresAt: new Date\(/g) ?? []).toHaveLength(1);
  });
});
