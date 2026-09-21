import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hasEnded } from './live-participant';

/**
 * One definition of a live participant, and a grep that keeps it that way (plan
 * 0140, section 3).
 *
 * Before the plan the predicate was `revokedAt IS NULL`, written out in fourteen
 * places, which was survivable while it was one column. It is two now, and a
 * site left behind is not a tidiness problem: it is an expired person who can
 * still do one thing.
 */

const FOLDERS = ['.', '../baskets'];
const ALLOWED = 'live-participant.ts';

function sourceFiles(): { path: string; body: string }[] {
  const files: { path: string; body: string }[] = [];
  for (const folder of FOLDERS) {
    const dir = join(__dirname, folder);
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      if (!name.isFile() || !name.name.endsWith('.ts')) {
        continue;
      }
      if (name.name.endsWith('.spec.ts') || name.name === ALLOWED) {
        continue;
      }
      files.push({
        path: join(folder, name.name),
        body: readFileSync(join(dir, name.name), 'utf8'),
      });
    }
  }
  return files;
}

describe('one definition of a live participant (section 3)', () => {
  it('is read from live-participant.ts and written nowhere else', () => {
    // `revokedAt: IsNull()` is the shape every read used before the plan, so
    // any hit is a read that still believes a revoked row is the only dead one.
    // A raw statement writing `"revokedAt" IS NULL` is not caught here and is
    // not meant to be: the sweep says exactly that, on purpose, because it is
    // looking for rows to end rather than for rows that are live.
    const offenders = sourceFiles()
      .filter(({ body }) => body.includes('revokedAt: IsNull()'))
      .map(({ path }) => path);

    expect(offenders).toEqual([]);
  });

  it('has no file reaching for IsNull on a participant by another spelling', () => {
    // The obvious way round the grep above, and the one a hurried edit takes.
    const offenders = sourceFiles()
      .filter(({ body }) => /revokedAt:\s*IsNull\s*\(/.test(body))
      .map(({ path }) => path);

    expect(offenders).toEqual([]);
  });
});

describe('a row the caller already holds (section 3)', () => {
  const now = new Date('2026-06-01T12:00:00.000Z');
  const at = (hours: number) =>
    new Date(now.getTime() + hours * 60 * 60 * 1000);

  it('is live when it is neither revoked nor past its expiry', () => {
    expect(hasEnded({ revokedAt: null, expiresAt: at(1) }, now)).toBe(false);
  });

  it('is live for ever when it carries no expiry', () => {
    // The owner, and everybody the owner added by name (section 2).
    expect(hasEnded({ revokedAt: null, expiresAt: null }, now)).toBe(false);
  });

  it('has ended one second past its expiry, and not one second before', () => {
    const second = 1000;
    expect(
      hasEnded(
        { revokedAt: null, expiresAt: new Date(now.getTime() - second) },
        now
      )
    ).toBe(true);
    expect(
      hasEnded(
        { revokedAt: null, expiresAt: new Date(now.getTime() + second) },
        now
      )
    ).toBe(false);
  });

  it('has ended at the instant of its expiry, which belongs to nobody', () => {
    expect(hasEnded({ revokedAt: null, expiresAt: now }, now)).toBe(true);
  });

  it('has ended when it was revoked, whatever its expiry says', () => {
    expect(hasEnded({ revokedAt: at(-1), expiresAt: at(5) }, now)).toBe(true);
  });
});
