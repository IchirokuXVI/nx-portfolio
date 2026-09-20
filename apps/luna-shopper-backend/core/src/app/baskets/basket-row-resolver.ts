import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  BasketKind,
  PURCHASE_SESSION_GAP_MS,
  SettlementOutcome,
} from '@portfolio/luna-shopper/contracts';
import { NotFoundException } from '@portfolio/luna-shopper/platform';
import { Repository, type EntityManager } from 'typeorm';
import type { CoreConfig } from '../config/app-config';
import { GeneratedList, ListLine } from '../entities';
import { toEntries } from './basket-read.service';
import { type BasketEntry } from './basket-rows';
import {
  BASKET_SESSION_LOOKBACK_MS,
  BASKET_SESSION_SQL,
  BASKET_SETTLEMENTS_SQL,
  COVERED_LINE_ITEMS_SQL,
  coveredLinesSql,
  type BasketSessionRow,
  type BasketSettlementRow,
  type CoveredLineItemRow,
  type CoveredLineRow,
} from './basket.sql';
import { mergeKey, normalizeContent } from './line-dedup';

/**
 * Turning a `rowKey` back into the list lines a write acts on (plan 0136,
 * section 5).
 *
 * A row has no identity of its own, because it is recomputed on every read. Its
 * anchor's line id is the closest thing to a stable name, and every write
 * addresses the row by one.
 *
 * ## Any entry's id names the row
 *
 * The read always serves the anchor, and an anchor that was bought to zero and
 * left the view a moment ago must not turn the next tap on the same row into an
 * error. So a key is accepted when it names **any** entry, and the row is then
 * rebuilt around whichever line it named.
 *
 * ## It agrees with the read by construction
 *
 * It narrows the same query the read runs, with the same four parameters and the
 * same scope, so a line the read left out of a row is a line this cannot find
 * either. The fold for a free text row is `normalizeContent` in TypeScript,
 * never a second definition in SQL, for the reason `ORDER_HISTORY_SQL` gives
 * about its own key: a fold written twice is free to drift, and the two
 * definitions would disagree exactly on the rows that are hardest to reason
 * about.
 */
@Injectable()
export class BasketRowResolver {
  /** Passed to {@link BASKET_SETTLEMENTS_SQL}, which computes `fresh` with it. */
  private readonly skipWindowMs: number;

  constructor(
    @InjectRepository(GeneratedList)
    private readonly baskets: Repository<GeneratedList>,
    @Inject(ConfigService) configService: ConfigService
  ) {
    this.skipWindowMs =
      configService.getOrThrow<CoreConfig>('core').basket.skipWindowMs;
  }

  /**
   * The entries of the row `rowKey` names, oldest first.
   *
   * Every refusal is a `NotFoundException`, including a line in a list outside
   * the coverage: the client reads the basket again, and the route cannot be
   * used to probe which lists an owner covers.
   */
  async resolve(
    basket: GeneratedList,
    coveredListIds: readonly string[],
    rowKey: string
  ): Promise<BasketRow> {
    const named = await this.baskets.manager
      .getRepository(ListLine)
      .findOne({ where: { id: rowKey } });
    if (
      !named ||
      named.deletedAt !== null ||
      !coveredListIds.includes(named.listId)
    ) {
      throw new NotFoundException('Row not found');
    }

    const scope = await this.scopeOf(basket);
    const key = mergeKey(named);
    const parameters: unknown[] = [
      [...coveredListIds],
      basket.id,
      scope.startedAt,
      scope.enabled,
    ];
    let lines: CoveredLineRow[];
    if (named.itemSetHash) {
      lines = await this.baskets.query<CoveredLineRow[]>(
        coveredLinesSql('SET'),
        [...parameters, named.itemSetHash]
      );
    } else {
      const folded = normalizeContent(named.content);
      lines = (
        await this.baskets.query<CoveredLineRow[]>(
          coveredLinesSql('TEXT'),
          parameters
        )
      ).filter((row) => normalizeContent(row.content) === folded);
    }

    if (lines.length === 0) {
      // The line exists and is covered, so it was filtered out by the read's own
      // rules: rejected, or at zero with nothing bought in scope. Either way
      // there is no row to write on.
      throw new NotFoundException('Row not found');
    }

    const lineIds = lines.map((line) => line.id);
    const [items, settlements] = await Promise.all([
      this.baskets.query<CoveredLineItemRow[]>(COVERED_LINE_ITEMS_SQL, [
        lineIds,
      ]),
      scope.enabled
        ? this.baskets.query<BasketSettlementRow[]>(BASKET_SETTLEMENTS_SQL, [
            basket.id,
            lineIds,
            scope.startedAt,
            this.skipWindowMs,
          ])
        : Promise.resolve([]),
    ]);

    const entries = toEntries(lines, items, settlements);
    return {
      key,
      /** The anchor is the oldest, which is what `coveredLinesSql` orders by. */
      anchor: entries[0],
      entries,
      scope,
    };
  }

  /** Which of this basket's purchases count. {@link BasketReadService.scopeOf}'s twin. */
  private async scopeOf(basket: GeneratedList): Promise<BasketScope> {
    if (basket.kind !== BasketKind.LIVE) {
      return { startedAt: null, enabled: true };
    }
    const [session] = await this.baskets.query<BasketSessionRow[]>(
      BASKET_SESSION_SQL,
      [basket.id, BASKET_SESSION_LOOKBACK_MS, PURCHASE_SESSION_GAP_MS]
    );
    return session
      ? { startedAt: session.startedAt, enabled: true }
      : { startedAt: null, enabled: false };
  }
}

/** Which purchases of a basket a read or a write counts. */
export interface BasketScope {
  startedAt: Date | null;
  enabled: boolean;
}

/** One row, resolved back to the list lines behind it. */
export interface BasketRow {
  key: string;
  anchor: BasketEntry;
  /** Oldest first, the anchor at index 0. */
  entries: BasketEntry[];
  scope: BasketScope;
}

/** What the row's entries are still asking for, summed. */
export function leftOf(row: BasketRow): number {
  return row.entries.reduce((sum, entry) => sum + entry.quantity, 0);
}

/** What this basket has bought of the row, in scope. */
export function boughtOfRow(row: BasketRow): number {
  return row.entries.reduce(
    (sum, entry) =>
      sum +
      entry.settlements
        .filter((fact) => fact.outcome === SettlementOutcome.BOUGHT)
        .reduce((units, fact) => units + fact.quantity, 0),
    0
  );
}

/**
 * Lock the row's list lines for writing, in **ascending id order**.
 *
 * One order for every caller, so two settles on two rows that share a line wait
 * for each other instead of deadlocking. `lockListsForRename` does the same for
 * lists and for the same reason, and the order is the id rather than anything
 * meaningful precisely because it has to be an order two callers agree on
 * without knowing what the other is doing.
 *
 * It answers the locked rows by id, so the caller compares `from` against what
 * the lock read and never against what it read before the transaction opened.
 */
export async function lockEntries(
  manager: EntityManager,
  row: BasketRow
): Promise<Map<string, ListLine>> {
  const repo = manager.getRepository(ListLine);
  const ids = row.entries.map((entry) => entry.lineId).sort();
  const locked = new Map<string, ListLine>();
  for (const id of ids) {
    const line = await repo.findOne({
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (line && line.deletedAt === null) {
      locked.set(id, line);
    }
  }
  if (locked.size === 0) {
    // Every entry was deleted between the resolve and the lock, which is a row
    // that no longer exists rather than a failure to write one.
    throw new NotFoundException('Row not found');
  }
  return locked;
}
