import { computed, inject, Injectable, signal } from '@angular/core';
import {
  firstAddTarget,
  isCatalogUrl,
  visitAddition,
  visitAfterAdd,
  visitAfterQuantity,
  visitFloor,
  visitTakeBack,
  visitWithout,
  type AddTargetList,
  type CatalogVisit,
  type Line,
  type MyZone,
  type ShoppingListSummary,
  type VisitAddition,
} from '@portfolio/velista/models';
import { BrowserFacade, StorageKeys } from '@portfolio/velista/platform';
import { SessionStore } from '../auth/session-store';
import { LINE_SERVICE, type LineServiceI } from '../lines/line-service';
import { LIST_SERVICE, type ListServiceI } from '../lists/list-service';
import { ZONE_SERVICE, type ZoneServiceI } from '../zones/zone-service';

/** A product, as the row that offers the plus knows it. */
export interface CatalogAddProduct {
  readonly itemId: string;
  /** The product's name in the reader's language, which becomes the line's name. */
  readonly name: string;
  /** What the sheet of the visit says under the name. */
  readonly detail: string | null;
}

type ListsStatus = 'idle' | 'loading' | 'ready' | 'failed';

/** The pages of groups and of lists are read whole, a hundred at a time. */
const PAGE_LIMIT = 100;

/**
 * Which list the plus on a product adds to, and what this visit to the catalog has
 * added so far (velista `0134`, section 4).
 *
 * ## One store for the app, not for the route
 *
 * The catalog page, the product page and both sheets read it. The pickers are
 * pages of their own, so the catalog page is destroyed while one is open, and a
 * record held by that page would be gone on the way back. A route provider is
 * never destroyed either, so a record held by the route would never be erased.
 * So it is provided once, and it is told where the app is by {@link visited}.
 *
 * ## It does not use `LineStore`
 *
 * `LineStore` patches only the lines of the one list a list page has loaded.
 * Outside that page it answers `failed`. The catalog writes to any list of any
 * group with none of them loaded, so it calls the line service itself and keeps
 * only what it needs to undo an add.
 *
 * ## The record is about the visit, not about the list
 *
 * It starts empty when the person comes to the catalog and it is erased when a
 * navigation ends outside it. The lines stay on their lists. Only the record goes.
 */
// Provided by the app layer, never root: rule D5, like `GroupMembers` beside it.
@Injectable()
export class CatalogAddStore {
  private readonly _zones = inject<ZoneServiceI>(ZONE_SERVICE);
  private readonly _listService = inject<ListServiceI>(LIST_SERVICE);
  private readonly _lines = inject<LineServiceI>(LINE_SERVICE);
  private readonly _session = inject(SessionStore);
  private readonly _browser = inject(BrowserFacade);

  private readonly _status = signal<ListsStatus>('idle');
  private readonly _lists = signal<readonly AddTargetList[]>([]);
  private readonly _targetId = signal<string | null>(null);
  private readonly _visit = signal<CatalogVisit>([]);
  private readonly _failures = signal(0);

  /**
   * The writes for each product on each list, by `listId/itemId`, one after the
   * other. Two quick presses are two writes in the order they were pressed, and
   * the second reads what the first answered.
   */
  private readonly _queues = new Map<string, Promise<void>>();

  /** Bumped by every erase, so an answer from the visit before is dropped. */
  private _generation = 0;
  private _loading: Promise<void> | null = null;

  /** Every list the person can write to, group by group. */
  readonly lists = this._lists.asReadonly();

  /** Whether the lists have been read for this visit. */
  readonly ready = computed(() => this._status() === 'ready');

  /** The list the plus adds to, or null for a person with none to write to. */
  readonly target = computed<AddTargetList | null>(() => {
    const id = this._targetId();
    return this._lists().find((list) => list.listId === id) ?? null;
  });

  /** What this visit added, in the order it was added. */
  readonly visit = this._visit.asReadonly();

  /** How many products this visit added, over every list. */
  readonly count = computed(() => this._visit().length);

  /**
   * How many writes have failed in this visit. A page says so once for each, in
   * its live region, by watching this number move.
   */
  readonly failures = this._failures.asReadonly();

  /**
   * Read the lists the person can write to, once for the visit (section 4.3):
   * the groups, then the lists of each. A guest has none, and is not asked.
   */
  ensure(): Promise<void> {
    if (this._status() === 'ready') {
      return Promise.resolve();
    }
    this._loading ??= this._load().finally(() => {
      this._loading = null;
    });
    return this._loading;
  }

  /** Choose the list the plus adds to. It becomes the last used list. */
  choose(listId: string): void {
    const list = this._lists().find((held) => held.listId === listId);
    if (list === undefined) {
      return;
    }
    this._targetId.set(listId);
    this._browser.writeStorage(
      StorageKeys.lastList,
      `${list.zoneId}/${list.listId}`
    );
  }

  /** What this visit added of one product to the chosen list, or null. */
  additionOf(itemId: string): VisitAddition | null {
    const target = this._targetId();
    return target === null
      ? null
      : visitAddition(this._visit(), target, itemId);
  }

  /**
   * The plus: one of the product on the chosen list (section 4.1).
   *
   * The count is drawn before the answer, and put back if the write fails.
   */
  add(product: CatalogAddProduct): Promise<void> {
    const target = this.target();
    if (target === null) {
      return Promise.resolve();
    }
    return this._queued(keyOf(target.listId, product.itemId), (generation) =>
      visitAddition(this._visit(), target.listId, product.itemId) === null
        ? this._add(target, product, generation)
        : this._step(target.listId, product.itemId, 1)
    );
  }

  /**
   * A press on the stepper: one more or one fewer of a product the visit added.
   *
   * A minus at the floor takes the product back, because under the floor is what
   * the list held before the visit, and that is not the visit's to change.
   */
  step(listId: string, itemId: string, by: 1 | -1): Promise<void> {
    return this._queued(keyOf(listId, itemId), () =>
      this._step(listId, itemId, by)
    );
  }

  /** Take one product back: undo what the visit did to its line, and no more. */
  takeBack(listId: string, itemId: string): Promise<void> {
    return this._queued(keyOf(listId, itemId), () =>
      this._takeBack(listId, itemId)
    );
  }

  /** Take back everything the visit added to one list. */
  async takeAllBack(listId: string): Promise<void> {
    const entries = this._visit().filter((entry) => entry.listId === listId);
    await Promise.all(
      entries.map((entry) => this.takeBack(entry.listId, entry.itemId))
    );
  }

  /**
   * Where the app is now, told by the app's own providers on every navigation.
   *
   * A navigation that ends outside the catalog erases the record and forgets the
   * lists, so the next visit starts empty and reads them again (section 4.5).
   */
  visited(url: string): void {
    if (isCatalogUrl(url)) {
      return;
    }
    if (
      this._status() === 'idle' &&
      this._visit().length === 0 &&
      this._targetId() === null
    ) {
      return;
    }
    this._generation++;
    this._loading = null;
    this._status.set('idle');
    this._lists.set([]);
    this._targetId.set(null);
    this._visit.set([]);
  }

  /**
   * `generation` is the visit the plus was pressed in. The write goes out either
   * way, because the person asked for it. The record is touched only while that
   * visit is still the current one, so an add that starts or answers after the
   * person left the catalog is not counted in the next visit.
   */
  private async _add(
    target: AddTargetList,
    product: CatalogAddProduct,
    generation: number
  ): Promise<void> {
    const identity = { ...product, listId: target.listId };
    // Drawn at once as a new line of one. The answer corrects it when the list
    // already held the product.
    if (generation === this._generation) {
      this._visit.update((visit) =>
        visitAfterAdd(
          visit,
          identity,
          { lineId: '', quantity: 1, pending: false },
          false
        )
      );
    }

    try {
      const result = await this._lines.addLineResult(
        target.listId,
        product.name,
        1,
        [product.itemId]
      );
      if (generation !== this._generation) {
        return;
      }
      this._visit.update((visit) =>
        visit.map((entry) =>
          entry.listId === target.listId && entry.itemId === product.itemId
            ? visitAfterAdd(
                [],
                identity,
                stateOf(result.line),
                result.merged
              )[0]
            : entry
        )
      );
    } catch {
      if (generation === this._generation) {
        this._visit.update((visit) =>
          visitWithout(visit, target.listId, product.itemId)
        );
        this._failures.update((count) => count + 1);
      }
    }
  }

  private async _step(
    listId: string,
    itemId: string,
    by: 1 | -1
  ): Promise<void> {
    const entry = visitAddition(this._visit(), listId, itemId);
    if (entry === null) {
      return;
    }
    if (by === -1 && entry.quantity <= visitFloor(entry)) {
      await this._takeBack(listId, itemId);
      return;
    }

    const generation = this._generation;
    this._visit.update((visit) =>
      visitAfterQuantity(visit, listId, itemId, {
        lineId: entry.lineId,
        quantity: entry.quantity + by,
        pending: entry.pending,
      })
    );

    try {
      const line = await this._lines.addQuantity(entry.lineId, by);
      if (generation === this._generation) {
        this._visit.update((visit) =>
          visitAfterQuantity(visit, listId, itemId, stateOf(line))
        );
      }
    } catch {
      if (generation === this._generation) {
        this._visit.update((visit) =>
          visitAfterQuantity(visit, listId, itemId, entry)
        );
        this._failures.update((count) => count + 1);
      }
    }
  }

  private async _takeBack(listId: string, itemId: string): Promise<void> {
    const entry = visitAddition(this._visit(), listId, itemId);
    if (entry === null) {
      return;
    }
    const generation = this._generation;
    const permissions =
      this._lists().find((list) => list.listId === listId)?.permissions ?? [];
    const undo = visitTakeBack(entry, permissions);
    const at = this._visit().indexOf(entry);
    this._visit.update((visit) => visitWithout(visit, listId, itemId));

    try {
      if (undo.kind === 'delete') {
        await this._lines.deleteLine(undo.lineId);
      } else {
        await this._lines.addQuantity(undo.lineId, -undo.by);
      }
    } catch {
      if (generation === this._generation) {
        // Back where it was in the record, so the sheet still offers the undo.
        this._visit.update((visit) => [
          ...visit.slice(0, at),
          entry,
          ...visit.slice(at),
        ]);
        this._failures.update((count) => count + 1);
      }
    }
  }

  private async _load(): Promise<void> {
    const generation = this._generation;
    if (this._session.isGuest()) {
      this._status.set('ready');
      return;
    }
    this._status.set('loading');

    try {
      const zones = (await this._allZones()).filter(
        (zone) => zone.myStatus === 'APPROVED'
      );
      const perZone = await Promise.all(
        zones.map(async (zone) => ({
          zone,
          lists: await this._allLists(zone.id),
        }))
      );
      if (generation !== this._generation) {
        return;
      }

      const lists = perZone.flatMap(({ zone, lists: held }) =>
        held
          .filter((list) => list.myPermissions.includes('WRITE'))
          .map((list) => targetOf(zone, list))
      );
      this._lists.set(lists);
      this._targetId.set(
        firstAddTarget(lists, this._browser.readStorage(StorageKeys.lastList))
          ?.listId ?? null
      );
      this._status.set('ready');
    } catch {
      if (generation === this._generation) {
        this._status.set('failed');
      }
    }
  }

  private async _allZones(): Promise<readonly MyZone[]> {
    const zones: MyZone[] = [];
    let cursor: string | undefined;
    do {
      const page = await this._zones.listMyZones({ cursor, limit: PAGE_LIMIT });
      zones.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
    return zones;
  }

  private async _allLists(
    zoneId: string
  ): Promise<readonly ShoppingListSummary[]> {
    const lists: ShoppingListSummary[] = [];
    let cursor: string | undefined;
    do {
      const page = await this._listService.listLists(zoneId, {
        cursor,
        limit: PAGE_LIMIT,
      });
      lists.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
    return lists;
  }

  /**
   * Run a write after the ones already on their way for the same product. With
   * none on its way it starts at once, in the same turn as the press, so the count
   * is drawn before anything is awaited.
   */
  private _queued(
    key: string,
    write: (generation: number) => Promise<void>
  ): Promise<void> {
    const generation = this._generation;
    const ahead = this._queues.get(key);
    const next =
      ahead === undefined
        ? write(generation)
        : ahead.then(() => write(generation));
    this._queues.set(key, next);
    void next.finally(() => {
      if (this._queues.get(key) === next) {
        this._queues.delete(key);
      }
    });
    return next;
  }
}

function keyOf(listId: string, itemId: string): string {
  return `${listId}/${itemId}`;
}

function stateOf(line: Line) {
  return {
    lineId: line.id,
    quantity: line.quantity,
    pending: line.approvalStatus === 'PENDING',
  };
}

function targetOf(zone: MyZone, list: ShoppingListSummary): AddTargetList {
  return {
    listId: list.id,
    zoneId: zone.id,
    name: list.name,
    zoneName: zone.name,
    wanted: list.wantedCount,
    permissions: list.myPermissions,
  };
}
