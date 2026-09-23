import { Injectable } from '@angular/core';
import {
  purchaseEntryKey,
  type Page,
  type PurchaseEntry,
  type PurchaseEntryPage,
  type PurchaseEntryRow,
} from '@portfolio/velista/models';
import { GatewayError } from '../errors';
import type { PurchaseServiceI } from './purchase-service';

/** Small on purpose, so the fake pages and the paging loop is exercised. */
const PAGE_SIZE = 2;

/**
 * The reader's history, in memory. Asked for by name, never a default.
 *
 * Seeded with the three cases the "Bought" tab draws differently (velista `0095`,
 * section 3): every purchase priced, some priced, none priced. Plus a named basket,
 * because a finished basket and a dated session sit in one list.
 */
@Injectable()
export class PurchaseMemory implements PurchaseServiceI {
  entries: PurchaseEntry[] = [
    {
      id: 's-today',
      kind: 'SESSION',
      name: null,
      startedAt: hoursAgo(2),
      purchaseCount: 3,
      spend: { cents: 1240, currency: 'EUR', unpricedCount: 1 },
      unpricedCount: 1,
    },
    {
      id: 'b-saturday',
      kind: 'BASKET',
      name: 'Saturday shop',
      startedAt: hoursAgo(80),
      purchaseCount: 2,
      spend: { cents: 385, currency: 'EUR', unpricedCount: 0 },
      unpricedCount: 0,
    },
    {
      id: 's-last-week',
      kind: 'SESSION',
      name: null,
      startedAt: hoursAgo(190),
      purchaseCount: 1,
      spend: null,
      unpricedCount: 1,
    },
  ];

  rowsByEntry = new Map<string, PurchaseEntryRow[]>([
    [
      'SESSION:s-today',
      [
        row('r-1', 'Milk', 3, 115, 'Home'),
        row('r-2', 'Bread', 1, 895, 'Home'),
        row('r-3', null, 2, null, null),
      ],
    ],
    [
      'BASKET:b-saturday',
      [row('r-4', 'Eggs', 1, 245, 'Flat'), row('r-5', 'Rice', 1, 140, 'Flat')],
    ],
    ['SESSION:s-last-week', [row('r-6', 'Apples', 4, null, 'Home')]],
  ]);

  async sessions(cursor?: string): Promise<PurchaseEntryPage> {
    return slice(this.entries, cursor);
  }

  async rows(
    entry: Pick<PurchaseEntry, 'kind' | 'id'>,
    cursor?: string
  ): Promise<Page<PurchaseEntryRow>> {
    const rows = this.rowsByEntry.get(purchaseEntryKey(entry));
    if (rows === undefined) {
      throw new GatewayError({
        status: 404,
        code: 'not_found',
        correlationId: 'memory',
        detail: 'No such entry',
      });
    }
    return slice(rows, cursor);
  }
}

function slice<T>(items: readonly T[], cursor?: string): Page<T> {
  const from = cursor === undefined ? 0 : Number.parseInt(cursor, 10);
  const start = Number.isNaN(from) ? 0 : from;
  const next = start + PAGE_SIZE;
  return {
    items: items.slice(start, next),
    nextCursor: next < items.length ? String(next) : null,
  };
}

function row(
  id: string,
  content: string | null,
  quantity: number,
  unitPriceCents: number | null,
  listName: string | null
): PurchaseEntryRow {
  return {
    id,
    content,
    itemId: null,
    quantity,
    unitPriceCents,
    currency: unitPriceCents === null ? null : 'EUR',
    listName,
  };
}

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 3_600_000);
}
