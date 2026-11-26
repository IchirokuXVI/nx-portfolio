import { FindOperator } from 'typeorm';
import type { SourceCatalogEntry } from '../entities';

/**
 * The reads and writes the ingest makes on known rows (plan 0269), for specs
 * whose repository of entries is an array.
 *
 * - `update(criteria, values)` changes the row whose `id` the criteria name,
 *   or every row of an `In([...])` of ids (reported to `onWrite` as not
 *   plain), only when every other key of the criteria holds for it, and answers
 *   `affected` as Postgres does. A guard is thus evaluated against the row as
 *   the array holds it, which is the row before the decision, because the
 *   ingest no longer mutates a row before its guarded write. A value that is
 *   a function is an SQL expression (`"timesSeen" + 1`) and is skipped: the
 *   ingest already moved the cached row.
 * - `find` with an `id` or an `externalId` in its `where` is a read of the
 *   decided columns, answered from the same array. Any other `find` goes to
 *   the spec's own fake, so the read at `open` is what the spec says.
 *
 * Only `IsNull()`, `In([...])` and plain values are understood, which is
 * every guard the ingest writes. A spec that records the rows it saved names
 * `onWrite`, called after every write that changed a row, with `plain` true
 * for a write by `id` alone: one of those per known row a chunk observes, as
 * `save` was.
 *
 * Not a spec file, so it names no `jest` and is compiled with the app.
 */
export function withEntryWrites<T extends object>(
  entries: T,
  rowsOf: () => Iterable<SourceCatalogEntry>,
  onWrite: (row: SourceCatalogEntry, plain: boolean) => void = () => undefined
): T {
  const target = entries as T & {
    find?: (options: unknown) => Promise<unknown>;
  };
  const original = target.find?.bind(entries);
  const writes = {
    update: async (
      criteria: Record<string, unknown>,
      values: Record<string, unknown>
    ) => {
      // A write of many rows by `In([...])` ids: the column the write of
      // the category paths names on the rows a run replaced whole (164a).
      if (criteria['id'] instanceof FindOperator) {
        const rows = [...new Set(rowsOf())].filter((each) =>
          matches(each, criteria)
        );
        for (const each of rows) {
          for (const [column, value] of Object.entries(values)) {
            if (typeof value !== 'function') {
              (each as unknown as Record<string, unknown>)[column] = value;
            }
          }
          onWrite(each, false);
        }
        return { affected: rows.length, raw: [], generatedMaps: [] };
      }
      const row = [...rowsOf()].find((each) => each.id === criteria['id']);
      if (!row || !matches(row, criteria)) {
        return { affected: 0, raw: [], generatedMaps: [] };
      }
      for (const [column, value] of Object.entries(values)) {
        if (typeof value !== 'function') {
          (row as unknown as Record<string, unknown>)[column] = value;
        }
      }
      onWrite(row, Object.keys(criteria).length === 1);
      return { affected: 1, raw: [], generatedMaps: [] };
    },
    find: async (options: { where?: Record<string, unknown> } = {}) => {
      const where = options.where ?? {};
      if ('id' in where || 'externalId' in where) {
        const unique = new Set(rowsOf());
        return [...unique].filter((row) => matches(row, where));
      }
      return original ? original(options) : [];
    },
  };
  return Object.assign(entries, writes);
}

function matches(
  row: SourceCatalogEntry,
  criteria: Record<string, unknown>
): boolean {
  const held = row as unknown as Record<string, unknown>;
  return Object.entries(criteria).every(([column, expected]) => {
    const value = held[column];
    if (expected instanceof FindOperator) {
      if (expected.type === 'isNull') {
        return value === null || value === undefined;
      }
      if (expected.type === 'in') {
        return (expected.value as unknown as unknown[]).includes(value);
      }
      throw new Error(`The fake does not understand ${expected.type}.`);
    }
    return value === expected;
  });
}
