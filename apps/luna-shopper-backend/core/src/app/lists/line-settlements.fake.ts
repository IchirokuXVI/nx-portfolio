import { SettlementOutcome } from '@portfolio/luna-shopper/contracts';
import type { LineSettlement } from '../entities';

/**
 * An in memory stand in for the `line_settlements` repository (plan 0047).
 *
 * It exists for the same reason {@link fakeLineItems} does, one table over. Two
 * services now read this table on paths that are not about settling at all:
 * `LineService` reads it because every line it answers with carries the two
 * indicators derived from it (section 5), and `SettlementService` reads it back
 * after an insert to count what it has just written. Neither read is what those
 * specs are testing, and both have to work or the call throws.
 *
 * Rows are held in an array and the three calls the services make are answered
 * over it. `settledAt` decides the order, with the insertion order breaking a
 * tie, which is what the real index does.
 */
export interface FakeLineSettlements {
  /** Everything written, oldest first. Assertions read this. */
  rows: Partial<LineSettlement>[];
  repo: {
    create(data: Partial<LineSettlement>): Partial<LineSettlement>;
    save(row: Partial<LineSettlement>): Promise<Partial<LineSettlement>>;
    count(options: {
      where: { lineId: string; outcome?: SettlementOutcome };
    }): Promise<number>;
    findOne(options: {
      where: { lineId: string };
    }): Promise<Partial<LineSettlement> | null>;
  };
}

export function fakeLineSettlements(
  initial: Partial<LineSettlement>[] = []
): FakeLineSettlements {
  const rows: Partial<LineSettlement>[] = [...initial];

  /** Newest first, exactly as `ix_settlements_line` is read. */
  const newestFirst = (lineId: string): Partial<LineSettlement>[] =>
    rows
      .map((row, index) => ({ row, index }))
      .filter((entry) => entry.row.lineId === lineId)
      .sort((a, b) => {
        const at = a.row.settledAt?.getTime() ?? 0;
        const bt = b.row.settledAt?.getTime() ?? 0;
        return bt - at || b.index - a.index;
      })
      .map((entry) => entry.row);

  return {
    rows,
    repo: {
      create: (data) => ({ ...data }),
      async save(row) {
        const stored = {
          ...row,
          id: row.id ?? `s${rows.length + 1}`,
          createdAt: new Date('2026-01-02T00:00:00.000Z'),
        };
        rows.push(stored);
        return stored;
      },
      async count({ where }) {
        return rows.filter(
          (row) =>
            row.lineId === where.lineId &&
            (where.outcome === undefined || row.outcome === where.outcome)
        ).length;
      },
      async findOne({ where }) {
        return newestFirst(where.lineId)[0] ?? null;
      },
    },
  };
}
