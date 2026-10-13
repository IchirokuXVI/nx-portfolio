import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  BASKET_LIMITS,
  LineApprovalStatus,
  SettlementOutcome,
} from '@portfolio/luna-shopper/contracts';
import {
  NotFoundException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { Repository, type EntityManager } from 'typeorm';
import type { CoreConfig } from '../config/app-config';
import { Basket, ListLine } from '../entities';
import { basketScopeOf, type BasketScope } from './basket-line-facts';
import { elsewhereGapOf, toEntries } from './basket-read.service';
import {
  BASKET_SETTLEMENTS_SQL,
  COVERED_LINE_ITEMS_SQL,
  COVERED_LINES_BY_ID_SQL,
  type BasketSettlementRow,
  type CoveredLineItemRow,
  type CoveredLineRow,
} from './basket-read.sql';
import { type BasketEntry } from './basket-rows';

/**
 * Loading the lines a write names (plan 0201, section 4).
 *
 * A row has no identity of its own, because it is recomputed on every read,
 * and since plan 0201 two reads at two shops can group the same lines
 * differently. So a write no longer says "this row" and leaves the server to
 * work out which lines that is. **It names the lines, and this loads them.**
 * Nothing here rebuilds a row from a key.
 *
 * ## It agrees with the read by construction
 *
 * It narrows the same query the read runs, with the same five parameters and
 * the same scope, to the ids the request named. A line the read does not draw
 * is a line this cannot find. That includes the line somebody else bought to
 * zero (plan 0188): the read draws it, so a write on it has to find it.
 *
 * ## One refusal for every line it does not find
 *
 * A line that does not exist, a line on a list outside the coverage, a deleted
 * or rejected line, and a line at zero with no buy that keeps it a row all
 * answer "Row not found". The client reads the basket again, and the route
 * cannot be used to probe which lists an owner covers.
 */
@Injectable()
export class BasketRowResolver {
  /** Passed to {@link BASKET_SETTLEMENTS_SQL}, which computes `fresh` with it. */
  private readonly skipWindowMs: number;

  constructor(
    @InjectRepository(Basket)
    private readonly baskets: Repository<Basket>,
    @Inject(ConfigService) configService: ConfigService
  ) {
    this.skipWindowMs =
      configService.getOrThrow<CoreConfig>('core').basket.skipWindowMs;
  }

  /**
   * The named lines as entries, oldest first.
   *
   * `rowKey` is the address the route was called on, and it must be one of the
   * named lines: a request whose path and body disagree is malformed, and it
   * is refused before anything is read.
   */
  async resolve(
    basket: Basket,
    coveredListIds: readonly string[],
    rowKey: string,
    lineIds: readonly string[]
  ): Promise<BasketRow> {
    const named = namedLinesOf(rowKey, lineIds);
    if (coveredListIds.length === 0) {
      throw new NotFoundException('Row not found');
    }

    const scope = await this.scopeOf(basket);
    const lines = await this.baskets.query<CoveredLineRow[]>(
      COVERED_LINES_BY_ID_SQL,
      [
        [...coveredListIds],
        basket.id,
        scope.startedAt,
        scope.enabled,
        elsewhereGapOf(basket),
        named,
      ]
    );
    if (lines.length !== named.length) {
      // At least one named line is not a row of this basket. The whole write is
      // refused rather than applied to the lines that were found: the client
      // drew something that is no longer true.
      throw new NotFoundException('Row not found');
    }

    const [items, settlements] = await Promise.all([
      this.baskets.query<CoveredLineItemRow[]>(COVERED_LINE_ITEMS_SQL, [named]),
      scope.enabled
        ? this.baskets.query<BasketSettlementRow[]>(BASKET_SETTLEMENTS_SQL, [
            basket.id,
            named,
            scope.startedAt,
            this.skipWindowMs,
          ])
        : Promise.resolve([]),
    ]);

    const entries = toEntries(lines, items, settlements);
    return {
      /** The oldest, which is what `coveredLinesSql` orders by. */
      anchor: entries[0],
      entries,
      scope,
    };
  }

  /**
   * One line of a covered list, **at zero or not** (plan 0201, review point 2).
   *
   * The change of demand is the one write that must reach a line the basket
   * does not draw: a list that holds a product at zero asks for it again by
   * raising that line. So this does not ask that the line has a quantity or a
   * buy. It asks everything else the read asks of a covered line: it exists,
   * it is not deleted, it is on a covered list, and it is not `REJECTED`. A
   * rejected line is a decision, and no basket may raise it.
   */
  async resolveLine(
    coveredListIds: readonly string[],
    rowKey: string,
    lineId: string
  ): Promise<ListLine> {
    if (rowKey !== lineId) {
      throw new ValidationException('the row key must be the named line', {
        messageArgs: { field: 'lineId' },
      });
    }
    const line = await this.baskets.manager
      .getRepository(ListLine)
      .findOne({ where: { id: lineId } });
    if (
      !line ||
      line.deletedAt !== null ||
      line.approvalStatus === LineApprovalStatus.REJECTED ||
      !coveredListIds.includes(line.listId)
    ) {
      throw new NotFoundException('Row not found');
    }
    return line;
  }

  /** Which of this basket's purchases count. {@link BasketReadService.scopeOf}'s twin. */
  private async scopeOf(basket: Basket): Promise<BasketScope> {
    return basketScopeOf(this.baskets, basket);
  }
}

export type { BasketScope };

/**
 * The ids a write names, deduplicated, with the checks every write shares.
 *
 * A message from the gateway was already validated by a DTO. This is asked
 * again because core is also called by its own services and specs, and a write
 * that named no line would otherwise lock nothing and answer success.
 */
export function namedLinesOf(
  rowKey: string,
  lineIds: readonly string[] | undefined
): string[] {
  const named = [...new Set(lineIds ?? [])];
  if (named.length === 0 || named.length > BASKET_LIMITS.maxWriteLines) {
    throw new ValidationException(
      `lineIds must name 1 to ${BASKET_LIMITS.maxWriteLines} lines`,
      { messageArgs: { field: 'lineIds' } }
    );
  }
  if (!named.includes(rowKey)) {
    throw new ValidationException(
      'the row key must be one of the named lines',
      { messageArgs: { field: 'lineIds' } }
    );
  }
  return named;
}

/** The lines a write named, loaded. */
export interface BasketRow {
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
