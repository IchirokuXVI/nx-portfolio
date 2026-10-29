import { EXISTING_USER_IDS_MAX } from '@portfolio/luna-shopper/contracts';
import {
  parseReconcileArgs,
  reconcileDeletions,
  type ReconcileDeps,
} from './reconcile-deletions';

/**
 * The one off command of plan 0232, section 7: what it asks auth, what it
 * refuses, and what it deletes. The ids it collects are proven on real
 * Postgres in `account-deletion.integration.spec.ts`.
 */
function deps(candidates: string[], known: (ids: string[]) => string[]) {
  const asked: string[][] = [];
  const deleted: string[] = [];
  const lines: string[] = [];
  const value: ReconcileDeps = {
    candidates: async () => candidates,
    existing: async (userIds) => {
      asked.push(userIds);
      return { userIds: known(userIds) };
    },
    delete: async (userId) => {
      deleted.push(userId);
      return true;
    },
    log: (line) => lines.push(line),
  };
  return { value, asked, deleted, lines };
}

const ids = (n: number) =>
  Array.from({ length: n }, (_, i) => `id-${String(i).padStart(4, '0')}`);

describe('reconcileDeletions', () => {
  it('asks auth in batches of the contract’s maximum', async () => {
    const d = deps(ids(EXISTING_USER_IDS_MAX + 3), (batch) => batch);

    await expect(
      reconcileDeletions(d.value, { countOnly: false, max: null })
    ).resolves.toBe(0);

    expect(d.asked.map((batch) => batch.length)).toEqual([
      EXISTING_USER_IDS_MAX,
      3,
    ]);
    expect(d.deleted).toEqual([]);
  });

  it('deletes each id auth does not know, and only those', async () => {
    const d = deps(['a', 'b', 'c'], () => ['b']);

    await expect(
      reconcileDeletions(d.value, { countOnly: false, max: 5 })
    ).resolves.toBe(2);

    expect(d.deleted).toEqual(['a', 'c']);
    expect(d.lines).toEqual(['candidates 3', 'unknown 2', 'applied 2']);
  });

  it('counts and changes nothing with --count', async () => {
    const d = deps(['a', 'b'], () => []);

    await expect(
      reconcileDeletions(d.value, { countOnly: true, max: null })
    ).resolves.toBe(2);

    expect(d.deleted).toEqual([]);
  });

  it('refuses above the ceiling before it deletes anything', async () => {
    const d = deps(['a', 'b', 'c'], () => []);

    await expect(
      reconcileDeletions(d.value, { countOnly: false, max: 2 })
    ).rejects.toThrow('above the ceiling of 2');
    expect(d.deleted).toEqual([]);
  });

  it('refuses an answer that names an id it was not asked about', async () => {
    const d = deps(['a'], () => ['a', 'z']);

    await expect(
      reconcileDeletions(d.value, { countOnly: false, max: null })
    ).rejects.toThrow('not asked about');
    expect(d.deleted).toEqual([]);
  });
});

describe('parseReconcileArgs', () => {
  it('reads --count and --max', () => {
    expect(parseReconcileArgs([])).toEqual({ countOnly: false, max: null });
    expect(parseReconcileArgs(['--count'])).toEqual({
      countOnly: true,
      max: null,
    });
    expect(parseReconcileArgs(['--max', '2000'])).toEqual({
      countOnly: false,
      max: 2000,
    });
  });

  it('refuses what it does not know', () => {
    expect(() => parseReconcileArgs(['--max'])).toThrow('whole number');
    expect(() => parseReconcileArgs(['--max', '-1'])).toThrow('whole number');
    expect(() => parseReconcileArgs(['--all'])).toThrow('unknown argument');
  });
});
