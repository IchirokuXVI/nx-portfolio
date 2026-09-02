import { ALL_POSTAL_CODE_CENTROIDS } from '@portfolio/luna-shopper/postal-codes/dataset';
import type { QueryRunner } from 'typeorm';
import {
  loadPostalCodePoints,
  POSTAL_CODE_BATCH_SIZE,
  PostalCodePoints1756400000000,
} from './1756400000000-PostalCodePoints';

/** A runner that records every statement and its parameters. */
function fakeRunner() {
  const calls: { sql: string; parameters: unknown[] | undefined }[] = [];
  const runner = {
    query: jest.fn(async (sql: string, parameters?: unknown[]) => {
      calls.push({ sql, parameters });
      return [];
    }),
  } as unknown as QueryRunner;
  return { runner, calls };
}

/**
 * The load, without a database (plan 0060, section 4). What a fake runner can
 * prove: the table is emptied before it is filled, no statement carries more
 * than a batch, every row reaches a statement, and the placeholders line up
 * with the parameters. That the SQL runs is the integration spec's job.
 */
describe('loadPostalCodePoints', () => {
  it('truncates first, then inserts in batches with every row accounted for', async () => {
    const { runner, calls } = fakeRunner();
    const rows = Array.from(
      { length: POSTAL_CODE_BATCH_SIZE * 2 + 7 },
      (_, i) => ({
        country: 'es',
        postalCode: String(10000 + i),
        latitude: 40 + i / 1000,
        longitude: -3 - i / 1000,
      })
    );

    await loadPostalCodePoints(runner, rows);

    expect(calls[0].sql).toMatch(/^TRUNCATE TABLE "postal_code_points"$/);
    const inserts = calls.slice(1);
    expect(inserts).toHaveLength(3);
    expect(inserts.map((c) => (c.parameters?.length ?? 0) / 4)).toEqual([
      POSTAL_CODE_BATCH_SIZE,
      POSTAL_CODE_BATCH_SIZE,
      7,
    ]);

    // Placeholders count up across the whole statement, one tuple per row.
    const last = inserts[2];
    expect(last.sql).toContain('($1, $2, $3, $4)');
    expect(last.sql).toContain('($25, $26, $27, $28)');
    expect(last.sql).not.toContain('$29');
    expect(last.parameters?.slice(0, 4)).toEqual([
      'es',
      '11000',
      rows[1000].latitude,
      rows[1000].longitude,
    ]);
  });

  it('inserts nothing for an empty dataset, and still truncates', async () => {
    const { runner, calls } = fakeRunner();

    await loadPostalCodePoints(runner, []);

    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toMatch(/TRUNCATE/);
  });
});

describe('PostalCodePoints1756400000000', () => {
  it('creates the table and its index, then loads the whole shipped dataset', async () => {
    const { runner, calls } = fakeRunner();

    await new PostalCodePoints1756400000000().up(runner);

    const sql = calls.map((c) => c.sql);
    expect(sql[0]).toMatch(/CREATE TABLE "postal_code_points"/);
    expect(sql[0]).toMatch(/PRIMARY KEY \("country", "postalCode"\)/);
    expect(sql[1]).toMatch(/CREATE INDEX "ix_postal_code_points_geo"/);

    const inserted = calls
      .filter((c) => c.sql.startsWith('INSERT'))
      .reduce((n, c) => n + (c.parameters?.length ?? 0) / 4, 0);
    expect(inserted).toBe(ALL_POSTAL_CODE_CENTROIDS.length);
    expect(inserted).toBeGreaterThan(10_000);
  });

  it('drops the table on the way down', async () => {
    const { runner, calls } = fakeRunner();

    await new PostalCodePoints1756400000000().down(runner);

    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toMatch(/DROP TABLE "postal_code_points"/);
  });
});
