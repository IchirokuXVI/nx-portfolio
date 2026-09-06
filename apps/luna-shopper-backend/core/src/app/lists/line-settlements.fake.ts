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
      where: {
        lineId: string;
        outcome?: SettlementOutcome;
        revertedAt?: unknown;
      };
    }): Promise<number>;
    findOne(options: {
      where: { lineId: string; revertedAt?: unknown };
    }): Promise<Partial<LineSettlement> | null>;
    find(options: {
      where: {
        generatedListLineId?: string;
        lineId?: string;
        revertedAt?: unknown;
      };
    }): Promise<Partial<LineSettlement>[]>;
  };
}

/**
 * The one `FindOperator` this table is read with is `IsNull()`, on `revertedAt`
 * (plan 0054, section 3.3), so the fake reads the key's presence rather than
 * interpreting the operator: a query that mentions it wants the rows that still
 * stand. A second operator would need real handling, and this returns the wrong
 * rows rather than pretending otherwise, which is what would make the spec that
 * introduced it fail.
 */
function standing(
  row: Partial<LineSettlement>,
  where: { revertedAt?: unknown }
): boolean {
  return where.revertedAt === undefined || !row.revertedAt;
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
        // An update in place when the row is already here, which is what
        // TypeORM's `save` does and what a reopen relies on: marking a
        // settlement reverted must not append a second copy of it (plan 0054,
        // section 3.3).
        const existing = rows.findIndex(
          (candidate) => row.id !== undefined && candidate.id === row.id
        );
        if (existing >= 0) {
          rows[existing] = { ...rows[existing], ...row };
          return rows[existing];
        }
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
            (where.outcome === undefined || row.outcome === where.outcome) &&
            standing(row, where)
        ).length;
      },
      async findOne({ where }) {
        return (
          newestFirst(where.lineId).find((row) => standing(row, where)) ?? null
        );
      },
      async find({ where }) {
        return (
          rows
            .map((row, index) => ({ row, index }))
            .filter(
              (entry) =>
                (where.lineId === undefined ||
                  entry.row.lineId === where.lineId) &&
                (where.generatedListLineId === undefined ||
                  entry.row.generatedListLineId ===
                    where.generatedListLineId) &&
                standing(entry.row, where)
            )
            // Oldest first, with the insertion order breaking a tie, which is
            // what both callers ask for and what the real index answers. It
            // matters to re-homing (plan 0093, section 3), where the order of two
            // purchases decides which list gets which units.
            .sort((a, b) => {
              const at = a.row.settledAt?.getTime() ?? 0;
              const bt = b.row.settledAt?.getTime() ?? 0;
              return at - bt || a.index - b.index;
            })
            .map((entry) => entry.row)
        );
      },
    },
  };
}
