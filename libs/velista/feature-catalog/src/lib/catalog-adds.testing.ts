import { signal, type Provider } from '@angular/core';
import {
  CatalogAddStore,
  GatewayError,
  LINE_SERVICE,
  LIST_SERVICE,
  SessionStore,
  ZONE_SERVICE,
} from '@portfolio/velista/data-access';
import type {
  AbsorbedExtra,
  LineUnit,
  ListPermission,
} from '@portfolio/velista/models';
import { provideFakeBrowserFacade } from '@portfolio/velista/platform';

/** One list as the store reads it from the list service. */
export interface FakeList {
  readonly id: string;
  readonly zoneId: string;
  readonly zoneName: string;
  readonly name: string;
  readonly wantedCount: number;
  readonly myPermissions: readonly ListPermission[];
  /** Whether the list approves lines by itself. It does unless a test says. */
  readonly autoApproveLines?: boolean;
}

/** One line a list holds before the visit, or after a write of it. */
export interface FakeLine {
  readonly id: string;
  readonly listId: string;
  readonly content: string;
  readonly quantity: number;
  readonly itemIds: readonly string[];
  readonly approvalStatus?: 'APPROVED' | 'PENDING' | 'REJECTED';
  /** How the line counts. A count unless a test says. */
  readonly unit?: LineUnit;
}

export const WEEKLY: FakeList = {
  id: 'list-weekly',
  zoneId: 'zone-home',
  zoneName: 'Home',
  name: 'Weekly shop',
  wantedCount: 14,
  myPermissions: ['READ', 'WRITE', 'MANAGE'],
};

export interface FakeAddsOptions {
  /** The lists of the person. One list they can write to unless a test says. */
  readonly lists?: readonly FakeList[];
  /** The lines those lists hold before the visit. None unless a test says. */
  readonly lines?: readonly FakeLine[];
  /** A guest, who is never asked for lists. */
  readonly guest?: boolean;
  /** What the browser's storage holds on arrival. */
  readonly storage?: Map<string, string>;
  /** The products whose add makes a line that waits for approval. */
  readonly pendingItemIds?: readonly string[];
  /**
   * Called with the doubles before anything reads them, so a test can make the
   * first read fail or never answer. The page reads while it is created, which is
   * before a test gets its harness back.
   */
  readonly arm?: (doubles: FakeAddDoubles) => void;
}

/** The doubles the store reads and writes through. Each method is a jest mock. */
export interface FakeAddDoubles {
  readonly zones: { listMyZones: jest.Mock };
  readonly listService: { listLists: jest.Mock };
  readonly lines: {
    listLines: jest.Mock;
    linesHoldingItem: jest.Mock;
    addLineResult: jest.Mock;
    addQuantity: jest.Mock;
    raiseReportingExtra: jest.Mock;
    countExtra: jest.Mock;
    deleteLine: jest.Mock;
  };
}

export interface FakeAdds extends FakeAddDoubles {
  readonly providers: Provider[];
  /** The lines the lists hold now, as the server would answer them. */
  readonly held: () => readonly FakeLine[];
  /** Stage what the next raise that reports the extra answers (velista `0208`). */
  readonly reportNext: (extra: AbsorbedExtra) => void;
}

/** The id the double gives the line an add makes. */
export function madeLineId(listId: string, itemId: string): string {
  return `line-${listId}-${itemId}`;
}

function sameName(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
}

/**
 * The real `CatalogAddStore` over doubles of what it reads and writes.
 *
 * The line double keeps the lines of each list and resolves an add as backend
 * `0260` section 1 does. An add meets the lines of the list that hold every
 * product of the add, or that hold the product under the same name, in the add's
 * own unit. Any of them with an amount answers `alreadyOnList` and writes nothing;
 * else the first one, kept at zero, is raised by the add's amount (R2). Only lines
 * of another unit refuse the add with `line_unit_differs`. Nothing met makes a
 * line at the add's amount. A change of quantity and a delete move the same lines, so
 * every read after a write agrees with it.
 */
export function fakeAdds(options: FakeAddsOptions = {}): FakeAdds {
  const lists = options.lists ?? [WEEKLY];
  const zoneRows = [
    ...new Map(
      lists.map((list) => [
        list.zoneId,
        { id: list.zoneId, name: list.zoneName, myStatus: 'APPROVED' },
      ])
    ).values(),
  ];
  let held: FakeLine[] = (options.lines ?? []).map((line) => ({
    approvalStatus: 'APPROVED',
    ...line,
  }));
  /** The reports the next raises answer, in order (velista `0208`). */
  const reports: AbsorbedExtra[] = [];
  const put = (line: FakeLine): FakeLine => {
    held = held.some((one) => one.id === line.id)
      ? held.map((one) => (one.id === line.id ? line : one))
      : [...held, line];
    return line;
  };

  const zones = {
    listMyZones: jest.fn(async () => ({ items: zoneRows, nextCursor: null })),
  };
  const listService = {
    listLists: jest.fn(async (zoneId: string) => ({
      items: lists
        .filter((list) => list.zoneId === zoneId)
        .map((list) => ({ autoApproveLines: true, ...list })),
      nextCursor: null,
    })),
  };
  const lines = {
    listLines: jest.fn(async (listId: string) => ({
      items: held.filter((line) => line.listId === listId),
      nextCursor: null,
    })),
    linesHoldingItem: jest.fn(async (itemId: string) => ({
      lists: lists
        .filter((list) => list.myPermissions.includes('READ'))
        .map((list) => ({
          listId: list.id,
          zoneId: list.zoneId,
          name: list.name,
          zoneName: list.zoneName,
          autoApproveLines: list.autoApproveLines ?? true,
          permissions: list.myPermissions,
        })),
      lines: held
        .filter(
          (line) =>
            line.itemIds.includes(itemId) && line.approvalStatus !== 'REJECTED'
        )
        .map((line) => ({
          lineId: line.id,
          listId: line.listId,
          name: line.content,
          quantity: line.quantity,
          unit: line.unit ?? 'UNIT',
          pending: line.approvalStatus === 'PENDING',
          itemIds: line.itemIds,
        })),
      hasMore: false,
    })),
    addLineResult: jest.fn(
      async (
        listId: string,
        content: string,
        quantity = 1,
        itemIds: readonly string[] = [],
        _named?: false,
        _options?: unknown,
        unit: LineUnit = 'UNIT'
      ) => {
        const itemId = itemIds[0] ?? '';
        const holding = held.filter(
          (line) =>
            line.listId === listId &&
            line.approvalStatus !== 'REJECTED' &&
            ((itemIds.length > 0 &&
              itemIds.every((id) => line.itemIds.includes(id))) ||
              (line.itemIds.includes(itemId) &&
                sameName(line.content, content)))
        );
        // A line in the add's own unit takes it, wherever a line of another unit
        // stands; only when none does is the add refused (backend `0260`, U2).
        const met = holding.filter((line) => (line.unit ?? 'UNIT') === unit);
        const other = holding[0];
        if (met.length === 0 && other !== undefined) {
          throw new GatewayError({
            code: 'line_unit_differs',
            status: 409,
            correlationId: 'fake-adds',
            detail: 'produced by fakeAdds, no request was sent',
            details: {
              line: {
                lineId: other.id,
                content: other.content,
                unit: other.unit ?? 'UNIT',
                quantity: other.quantity,
              },
              unit,
              index: null,
            },
          });
        }
        const wanted = met.filter((line) => line.quantity > 0);
        if (wanted.length > 0) {
          // Nothing is written (backend `0260`, A1).
          return {
            line: wanted[0],
            merged: true,
            outcome: 'alreadyOnList' as const,
            alreadyOnList: wanted,
          };
        }
        const kept = met[0];
        if (kept !== undefined) {
          return {
            line: put({ ...kept, quantity: kept.quantity + quantity }),
            merged: true,
            outcome: 'raised' as const,
            alreadyOnList: [],
            // The report, when the add asked for one (velista `0208`).
            ...((_options as { reportExtra?: true } | undefined)
              ?.reportExtra === true
              ? { extra: reports.shift() ?? NOTHING_ABOVE }
              : {}),
          };
        }
        return {
          line: put({
            id: madeLineId(listId, itemId),
            listId,
            content,
            quantity,
            itemIds,
            ...(unit === 'UNIT' ? {} : { unit }),
            approvalStatus:
              options.pendingItemIds?.includes(itemId) === true
                ? 'PENDING'
                : 'APPROVED',
          }),
          merged: false,
          outcome: 'created' as const,
          alreadyOnList: [],
        };
      }
    ),
    addQuantity: jest.fn(async (lineId: string, delta: number) => {
      const line = held.find((one) => one.id === lineId);
      if (line === undefined) {
        throw new Error(`no line ${lineId}`);
      }
      return put({ ...line, quantity: Math.max(0, line.quantity + delta) });
    }),
    /**
     * A raise that reports the extra (velista `0208`): the same write as
     * `addQuantity`, which records it, and the report staged by `reportNext`, or
     * one with nothing taken in.
     */
    raiseReportingExtra: jest.fn(
      async (lineId: string, delta: number, unit: LineUnit) => {
        const line = await lines.addQuantity(lineId, delta, unit);
        return { line, extra: reports.shift() ?? NOTHING_ABOVE };
      }
    ),
    /** "Count the extra": refused as stale when the line no longer holds `expect`. */
    countExtra: jest.fn(
      async (lineId: string, amount: number, expect: number) => {
        const line = held.find((one) => one.id === lineId);
        if (line === undefined || line.quantity !== expect) {
          throw new GatewayError({
            code: 'stale_quantity',
            status: 409,
            correlationId: 'fake-adds',
          });
        }
        return {
          line: put({ ...line, quantity: line.quantity - amount }),
          counted: amount,
        };
      }
    ),
    deleteLine: jest.fn(async (lineId: string) => {
      held = held.filter((line) => line.id !== lineId);
      return lineId;
    }),
  };

  const doubles: FakeAddDoubles = { zones, listService, lines };
  options.arm?.(doubles);

  const providers: Provider[] = [
    CatalogAddStore,
    provideFakeBrowserFacade(options.storage ?? new Map()),
    {
      provide: SessionStore,
      // The reader, whom the question about the extra names "You" (velista `0208`).
      useValue: {
        isGuest: signal(options.guest === true),
        userId: signal<string | null>(null),
      },
    },
    { provide: ZONE_SERVICE, useValue: zones },
    { provide: LIST_SERVICE, useValue: listService },
    { provide: LINE_SERVICE, useValue: lines },
  ];

  return {
    ...doubles,
    providers,
    held: () => held,
    reportNext: (extra: AbsorbedExtra) => {
      reports.push(extra);
    },
  };
}

/** A report that took nothing in, which asks nothing. */
const NOTHING_ABOVE: AbsorbedExtra = { above: 0, countable: 0, buyers: [] };
