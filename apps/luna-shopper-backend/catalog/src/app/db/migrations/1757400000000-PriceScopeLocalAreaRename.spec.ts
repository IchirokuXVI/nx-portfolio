import type { QueryRunner } from 'typeorm';
import { PriceScopeLocalAreaRename1757400000000 } from './1757400000000-PriceScopeLocalAreaRename';

/**
 * The rename in both directions (plan 0116, section 9).
 *
 * A runner that holds the enum's labels in order and applies a `RENAME VALUE` to
 * them the way Postgres does: the label changes and its position does not. The
 * real type is asserted by `migrations.integration.spec.ts`.
 */
function fakeRunner(labels: string[]) {
  return {
    query: jest.fn(async (sql: string) => {
      const match =
        /ALTER TYPE "price_scope_kind" RENAME VALUE '(\w+)' TO '(\w+)'/.exec(
          sql
        );
      if (!match) {
        throw new Error(`unexpected statement: ${sql}`);
      }
      const index = labels.indexOf(match[1]);
      if (index < 0) {
        throw new Error(`invalid input value for enum: "${match[1]}"`);
      }
      labels[index] = match[2];
    }),
  } as unknown as QueryRunner;
}

describe('PriceScopeLocalAreaRename1757400000000', () => {
  it('renames POSTAL_CODE to LOCAL_AREA in place', async () => {
    const labels = ['NATIONAL', 'REGION', 'POSTAL_CODE', 'STORE'];

    await new PriceScopeLocalAreaRename1757400000000().up(fakeRunner(labels));

    expect(labels).toEqual(['NATIONAL', 'REGION', 'LOCAL_AREA', 'STORE']);
  });

  it('renames it back on down', async () => {
    const labels = ['NATIONAL', 'REGION', 'LOCAL_AREA', 'STORE'];

    await new PriceScopeLocalAreaRename1757400000000().down(fakeRunner(labels));

    expect(labels).toEqual(['NATIONAL', 'REGION', 'POSTAL_CODE', 'STORE']);
  });
});
