import { signal, type Provider } from '@angular/core';
import {
  CatalogAddStore,
  LINE_SERVICE,
  LIST_SERVICE,
  SessionStore,
  ZONE_SERVICE,
} from '@portfolio/velista/data-access';
import type { ListPermission } from '@portfolio/velista/models';
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
    deleteLine: jest.Mock;
  };
}

export interface FakeAdds extends FakeAddDoubles {
  readonly providers: Provider[];
  /** The lines the lists hold now, as the server would answer them. */
  readonly held: () => readonly FakeLine[];
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
 * The line double keeps the lines of each list and answers the way the server
 * does. An add onto a line that has the product under the same name raises that
 * line and says `merged`. Any other add makes a line. A change of quantity and a
 * delete move the same lines, so every read after a write agrees with it.
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
        itemIds: readonly string[] = []
      ) => {
        const itemId = itemIds[0] ?? '';
        const own = held.find(
          (line) =>
            line.listId === listId &&
            line.itemIds.includes(itemId) &&
            sameName(line.content, content)
        );
        if (own !== undefined) {
          return {
            line: put({ ...own, quantity: own.quantity + quantity }),
            merged: true,
          };
        }
        return {
          line: put({
            id: madeLineId(listId, itemId),
            listId,
            content,
            quantity,
            itemIds,
            approvalStatus:
              options.pendingItemIds?.includes(itemId) === true
                ? 'PENDING'
                : 'APPROVED',
          }),
          merged: false,
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
      useValue: { isGuest: signal(options.guest === true) },
    },
    { provide: ZONE_SERVICE, useValue: zones },
    { provide: LIST_SERVICE, useValue: listService },
    { provide: LINE_SERVICE, useValue: lines },
  ];

  return { ...doubles, providers, held: () => held };
}
