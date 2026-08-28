import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CORE_MIGRATIONS } from './index';

/**
 * The index is hand maintained, so it can drift from the directory (plan 0027,
 * section 2.1). This is the spec that makes the drift fail here instead of in a
 * pre-upgrade hook, where the symptom is a Job that applies nothing and reports
 * success.
 */
describe('CORE_MIGRATIONS', () => {
  /** Every migration file in this directory, excluding the index and this spec. */
  const files = readdirSync(join(__dirname))
    .filter((f) => f.endsWith('.ts'))
    .filter((f) => f !== 'index.ts' && !f.endsWith('.spec.ts'));

  it('lists every migration file in the directory', () => {
    // TypeORM's class name convention is `<Name><timestamp>`, and the file is
    // `<timestamp>-<Name>.ts`, so the class name is what ties the two together.
    const listed = CORE_MIGRATIONS.map((m) => m.name).sort();
    const onDisk = files
      .map((f) => {
        const [timestamp, name] = f.replace(/\.ts$/, '').split('-');
        return `${name}${timestamp}`;
      })
      .sort();

    expect(listed).toEqual(onDisk);
  });

  it('is ordered by timestamp', () => {
    // TypeORM applies migrations in the order given, and the timestamp suffix is
    // the order they were written in. A list that is merely complete but out of
    // order applies a later schema change against an earlier schema.
    const timestamps = CORE_MIGRATIONS.map((m) => {
      const match = /(\d+)$/.exec(m.name);
      expect(match).not.toBeNull();
      return Number(match?.[1]);
    });

    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
  });

  it('is not empty', () => {
    // The failure this whole index exists to prevent is a build that resolves to
    // zero migrations, runs cleanly and creates nothing.
    expect(CORE_MIGRATIONS.length).toBeGreaterThan(0);
  });
});
