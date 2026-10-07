import { computed, inject, Injectable, signal } from '@angular/core';
import {
  addedToLine,
  firstAddTarget,
  isCatalogUrl,
  isUnsavedLine,
  sameLineName,
  unsavedLineId,
  visitAddition,
  visitAfterAdd,
  visitAfterStep,
  visitTakeBack,
  visitWithout,
  type AddTargetList,
  type CatalogVisit,
  type HeldLine,
  type ItemList,
  type Line,
  type MyZone,
  type ShoppingListSummary,
  type VisitList,
  type VisitProduct,
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

/** Where a read is: not asked for, on its way, answered, or not answered. */
export type CatalogAddStatus = 'idle' | 'loading' | 'ready' | 'failed';

/** The pages of groups, of lists and of lines are read whole, a hundred at a time. */
const PAGE_LIMIT = 100;

/**
 * How many pages of one list's lines are read at most. A list of two thousand
 * lines is no shopping list, and a server that answered the cursor it was handed
 * would otherwise keep the catalog asking forever.
 */
const MAX_LINE_PAGES = 20;

const NO_RIGHTS: VisitList = { permissions: [], autoApproveLines: false };

/**
 * Which list the plus on a product adds to, which lines of the person's lists
 * hold a product, and what this visit to the catalog has added so far (velista
 * `0134`, sections 4 and 7).
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
 * group with none of them loaded, so it calls the line service itself.
 *
 * ## The lines it holds
 *
 * A list can hold one product on several lines, each with its own quantity, and
 * a row shows every one of them with a stepper (the owner's decision after the
 * walk of stage 1). So the store keeps the lines that hold a product, from two
 * reads: every line of the chosen list, for the rows of the catalog, and the
 * lines that hold one product on every list, for the product page. Both land in
 * {@link held}, and every write lands there too, so the two screens never
 * disagree about a quantity.
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

  private readonly _status = signal<CatalogAddStatus>('idle');
  private readonly _lists = signal<readonly AddTargetList[]>([]);
  private readonly _targetId = signal<string | null>(null);
  private readonly _visit = signal<CatalogVisit>([]);
  private readonly _failures = signal(0);
  private readonly _held = signal<readonly HeldLine[]>([]);
  private readonly _lineReads = signal<ReadonlyMap<string, CatalogAddStatus>>(
    new Map()
  );

  /** What the person may do on each list either read named. */
  private readonly _rights = new Map<string, VisitList>();

  /**
   * The writes for each product on each list, by `listId/itemId`, one after the
   * other. Two quick presses are two writes in the order they were pressed, and
   * the second reads what the first answered.
   */
  private readonly _queues = new Map<string, Promise<void>>();

  /**
   * The adds that were pressed and have not answered, by `listId/itemId`. An
   * answer says what the line holds after **its** add, so the quantity drawn is
   * that plus the adds still on their way. Without it a second quick plus would
   * show two, then one, then two.
   */
  private readonly _adding = new Map<string, number>();

  /** Bumped by every erase, so an answer from the visit before is dropped. */
  private _generation = 0;
  private _loading: Promise<void> | null = null;

  /** Where the read of the lists is. `failed` offers a second try. */
  readonly status = this._status.asReadonly();

  /** Every list the person can write to, group by group. */
  readonly lists = this._lists.asReadonly();

  /** Whether the lists have been read for this visit. */
  readonly ready = computed(() => this._status() === 'ready');

  /** The list the plus adds to, or null for a person with none to write to. */
  readonly target = computed<AddTargetList | null>(() => {
    const id = this._targetId();
    return this._lists().find((list) => list.listId === id) ?? null;
  });

  /**
   * Where the read of the chosen list's lines is. Until it is `ready` a row
   * cannot say whether the list already holds its product.
   */
  readonly linesStatus = computed<CatalogAddStatus>(() => {
    const id = this._targetId();
    return id === null ? 'idle' : (this._lineReads().get(id) ?? 'idle');
  });

  /** Every line the store knows to hold a product, over every list. */
  readonly held = this._held.asReadonly();

  /** What this visit added, in the order it was added. */
  readonly visit = this._visit.asReadonly();

  /** How many lines this visit added to, over every list. */
  readonly count = computed(() => this._visit().length);

  /**
   * How many writes have failed in this visit. A page says so once for each, in
   * its live region, by watching this number move.
   */
  readonly failures = this._failures.asReadonly();

  /**
   * Read the lists the person can write to, once for the visit (section 4.3):
   * the groups, then the lists of each, then the lines of the chosen one. A guest
   * has none, and is not asked.
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

  /** Try again after a read failed: the lists, or the lines of the chosen list. */
  retry(): Promise<void> {
    if (this._status() !== 'ready') {
      return this.ensure();
    }
    const target = this._targetId();
    return target === null || this.linesStatus() === 'ready'
      ? Promise.resolve()
      : this._readLines(target);
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
    const read = this._lineReads().get(listId);
    if (read !== 'ready' && read !== 'loading') {
      void this._readLines(listId);
    }
  }

  /**
   * Every list the person can read and the lines of them that hold one product
   * (section 7). The lines join {@link held}, and the lists are answered for the
   * page to keep. Null when the read failed.
   */
  async readItem(itemId: string): Promise<readonly ItemList[] | null> {
    const generation = this._generation;
    try {
      const answer = await this._lines.linesHoldingItem(itemId);
      if (generation !== this._generation) {
        return answer.lists;
      }
      const read = new Set(answer.lists.map((list) => list.listId));
      for (const list of answer.lists) {
        this._rights.set(list.listId, list);
      }
      this._held.update((held) => {
        const known = new Map(held.map((line) => [line.lineId, line]));
        // A line of these lists that held the product and is not in the answer
        // was deleted or rejected since. Drawing it would offer a stepper for a
        // line nobody can move.
        const kept = held.filter(
          (line) =>
            isUnsavedLine(line.lineId) ||
            this._written(line.lineId) ||
            !read.has(line.listId) ||
            !line.itemIds.includes(itemId) ||
            answer.lines.some((fresh) => fresh.lineId === line.lineId)
        );
        const merged = kept.map((line) => {
          const fresh = answer.lines.find(
            (entry) => entry.lineId === line.lineId
          );
          // A line this visit wrote keeps its own quantity, which is newer
          // than a read that may have been sent before the write.
          return fresh === undefined
            ? line
            : this._written(line.lineId)
              ? { ...line, itemIds: union(line.itemIds, fresh.itemIds) }
              : { ...fresh, itemIds: union(line.itemIds, fresh.itemIds) };
        });
        return [
          ...merged,
          ...answer.lines.filter((fresh) => !known.has(fresh.lineId)),
        ];
      });
      return answer.lists;
    } catch {
      return null;
    }
  }

  /**
   * The plus: one of the product on a list, the chosen one unless another is
   * named (sections 4.1 and 7).
   *
   * The server puts it on the line that has the product under this name, or makes
   * that line. The quantity is drawn before the answer, and put back if the write
   * fails.
   */
  add(product: CatalogAddProduct, listId?: string): Promise<void> {
    const to = listId ?? this._targetId();
    if (to === null) {
      return Promise.resolve();
    }
    const key = keyOf(to, product.itemId);
    const drawnOn = this._drawAdd(to, product);
    this._adding.set(key, (this._adding.get(key) ?? 0) + 1);
    return this._queued(key, (generation) =>
      this._add(to, product, drawnOn, generation)
    );
  }

  /**
   * A press on the stepper of one line: one more or one fewer.
   *
   * A minus that brings a line the visit made to nothing takes it back, which
   * deletes it where the person may. A line that was there before goes to zero
   * and stays, which is what a list calls stocked.
   */
  step(product: VisitProduct, lineId: string, by: 1 | -1): Promise<void> {
    return this._queued(keyOf(product.listId, product.itemId), (generation) =>
      this._step(product, lineId, by, generation)
    );
  }

  /** Take one line back: undo what the visit did to it, and no more. */
  takeBack(lineId: string): Promise<void> {
    const entry = visitAddition(this._visit(), lineId);
    if (entry === null) {
      return Promise.resolve();
    }
    return this._queued(keyOf(entry.listId, entry.itemId), () =>
      this._takeBack(lineId)
    );
  }

  /** Take back everything the visit added to one list. */
  async takeAllBack(listId: string): Promise<void> {
    const entries = this._visit().filter((entry) => entry.listId === listId);
    await Promise.all(entries.map((entry) => this.takeBack(entry.lineId)));
  }

  /**
   * Where the app is now, told by the app's own providers on every navigation.
   *
   * A navigation that ends outside the catalog erases the record and forgets the
   * lists and their lines, so the next visit starts empty and reads them again
   * (section 4.5).
   */
  visited(url: string): void {
    if (isCatalogUrl(url)) {
      return;
    }
    if (
      this._status() === 'idle' &&
      this._visit().length === 0 &&
      this._targetId() === null &&
      this._held().length === 0
    ) {
      return;
    }
    this._generation++;
    this._loading = null;
    this._status.set('idle');
    this._lists.set([]);
    this._targetId.set(null);
    this._visit.set([]);
    this._held.set([]);
    this._lineReads.set(new Map());
    this._rights.clear();
    this._adding.clear();
  }

  /**
   * Draw one more before anything is awaited, and answer the line it was drawn
   * on: the line that has the product under this name, or a line of its own that
   * stands in until the add answers.
   */
  private _drawAdd(listId: string, product: CatalogAddProduct): string {
    const own = addedToLine(
      this._held().filter(
        (line) =>
          line.listId === listId && line.itemIds.includes(product.itemId)
      ),
      product.name
    );
    if (own !== null) {
      this._move(own.lineId, 1);
      return own.lineId;
    }
    const lineId = unsavedLineId(listId, product.itemId);
    this._held.update((held) => [
      ...held,
      {
        lineId,
        listId,
        name: product.name,
        quantity: 1,
        pending: false,
        itemIds: [product.itemId],
      },
    ]);
    return lineId;
  }

  /**
   * `generation` is the visit the plus was pressed in. The write goes out either
   * way, because the person asked for it. The record is touched only while that
   * visit is still the current one, so an add that answers after the person left
   * the catalog is not counted in the next visit.
   */
  private async _add(
    listId: string,
    product: CatalogAddProduct,
    drawnOn: string,
    generation: number
  ): Promise<void> {
    const key = keyOf(listId, product.itemId);
    try {
      const result = await this._lines.addLineResult(listId, product.name, 1, [
        product.itemId,
      ]);
      if (generation !== this._generation) {
        return;
      }
      const ahead = this._settled(key);
      const unsaved = unsavedLineId(listId, product.itemId);
      // The server chose another line than the one the add was drawn on: it
      // made a line, or raised a different one. What was drawn there comes off,
      // and each add still on its way corrects itself the same way.
      const elsewhere = drawnOn !== result.line.id && !isUnsavedLine(drawnOn);
      if (elsewhere) {
        this._move(drawnOn, -1);
      }
      this._held.update((held) =>
        upsert(
          held.filter((line) => line.lineId !== unsaved),
          heldOf(result.line, elsewhere ? 0 : ahead)
        )
      );
      this._visit.update((visit) =>
        visitAfterAdd(
          visit,
          { listId, itemId: product.itemId, detail: product.detail },
          stateOf(result.line),
          result.merged
        )
      );
    } catch {
      if (generation !== this._generation) {
        return;
      }
      this._settled(key);
      // The line it was drawn on, or the saved line that took its place when an
      // add pressed before this one answered.
      const drawn =
        this._held().find((line) => line.lineId === drawnOn) ??
        this._held().find(
          (line) =>
            line.listId === listId &&
            line.itemIds.includes(product.itemId) &&
            sameLineName(line.name, product.name)
        );
      if (drawn !== undefined) {
        if (isUnsavedLine(drawn.lineId) && drawn.quantity <= 1) {
          this._drop(drawn.lineId);
        } else {
          this._move(drawn.lineId, -1);
        }
      }
      this._failures.update((count) => count + 1);
    }
  }

  private async _step(
    product: VisitProduct,
    lineId: string,
    by: 1 | -1,
    generation: number
  ): Promise<void> {
    const line = this._held().find((held) => held.lineId === lineId);
    if (line === undefined || isUnsavedLine(lineId)) {
      return;
    }
    const next = line.quantity + by;
    if (next < 0) {
      return;
    }
    const entry = visitAddition(this._visit(), lineId);
    if (by === -1 && next === 0 && entry !== null && entry.created) {
      await this._takeBack(lineId);
      return;
    }

    this._move(lineId, by);
    try {
      const answer = await this._lines.addQuantity(lineId, by);
      if (generation !== this._generation) {
        return;
      }
      const ahead = this._adding.get(keyOf(product.listId, product.itemId));
      this._held.update((held) => upsert(held, heldOf(answer, ahead ?? 0)));
      this._visit.update((visit) =>
        visitAfterStep(visit, product, stateOf(answer), answer.quantity - by)
      );
    } catch {
      if (generation === this._generation) {
        this._move(lineId, by === 1 ? -1 : 1);
        this._failures.update((count) => count + 1);
      }
    }
  }

  private async _takeBack(lineId: string): Promise<void> {
    const entry = visitAddition(this._visit(), lineId);
    if (entry === null) {
      return;
    }
    const generation = this._generation;
    const undo = visitTakeBack(
      entry,
      this._rights.get(entry.listId) ?? NO_RIGHTS
    );
    const at = this._visit().indexOf(entry);
    const before = this._held();
    this._visit.update((visit) => visitWithout(visit, lineId));
    if (undo.kind === 'delete') {
      this._drop(lineId);
    } else {
      this._move(lineId, -undo.by);
    }

    try {
      if (undo.kind === 'delete') {
        await this._lines.deleteLine(undo.lineId);
      } else {
        const answer = await this._lines.addQuantity(undo.lineId, -undo.by);
        if (generation === this._generation) {
          this._held.update((held) => upsert(held, heldOf(answer, 0)));
        }
      }
    } catch {
      if (generation === this._generation) {
        // Back where it was in the record, so the sheet still offers the undo.
        this._visit.update((visit) => [
          ...visit.slice(0, at),
          entry,
          ...visit.slice(at),
        ]);
        this._held.set(before);
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
      for (const list of lists) {
        this._rights.set(list.listId, list);
      }
      this._lists.set(lists);
      const target =
        firstAddTarget(lists, this._browser.readStorage(StorageKeys.lastList))
          ?.listId ?? null;
      this._targetId.set(target);
      this._status.set('ready');
      if (target !== null) {
        await this._readLines(target);
      }
    } catch {
      if (generation === this._generation) {
        this._status.set('failed');
      }
    }
  }

  /**
   * Every line of one list that holds a product. A rejected line is left out: an
   * add does not raise it, so it is not a line a stepper should move.
   */
  private async _readLines(listId: string): Promise<void> {
    const generation = this._generation;
    this._markLines(listId, 'loading');

    try {
      const lines: HeldLine[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_LINE_PAGES; page++) {
        const answer = await this._lines.listLines(listId, {
          cursor,
          limit: PAGE_LIMIT,
        });
        for (const line of answer.items) {
          if (line.itemIds.length > 0 && line.approvalStatus !== 'REJECTED') {
            lines.push(heldOf(line, 0));
          }
        }
        cursor = answer.nextCursor ?? undefined;
        if (cursor === undefined) {
          break;
        }
      }
      if (generation !== this._generation) {
        return;
      }
      // What this visit wrote is newer than a read that may have been sent
      // before the write. The held copy of such a line stays, and the read's
      // copy of it is left out.
      this._held.update((held) => [
        ...held.filter(
          (line) =>
            line.listId !== listId ||
            isUnsavedLine(line.lineId) ||
            this._written(line.lineId)
        ),
        ...lines.filter((line) => !this._written(line.lineId)),
      ]);
      this._markLines(listId, 'ready');
    } catch {
      if (generation === this._generation) {
        this._markLines(listId, 'failed');
      }
    }
  }

  /**
   * Whether this visit wrote to a line. A read that was sent before an add and
   * answers after it does not know what the add did. It must neither take the
   * line off the screen nor put its older quantity back: the record still counts
   * what the visit added.
   */
  private _written(lineId: string): boolean {
    return visitAddition(this._visit(), lineId) !== null;
  }

  private _markLines(listId: string, status: CatalogAddStatus): void {
    this._lineReads.update((reads) => new Map(reads).set(listId, status));
  }

  /** One add of this product answered or failed. Answers how many are still on their way. */
  private _settled(key: string): number {
    const ahead = Math.max(0, (this._adding.get(key) ?? 1) - 1);
    if (ahead === 0) {
      this._adding.delete(key);
    } else {
      this._adding.set(key, ahead);
    }
    return ahead;
  }

  private _move(lineId: string, by: number): void {
    this._held.update((held) =>
      held.map((line) =>
        line.lineId === lineId
          ? { ...line, quantity: Math.max(0, line.quantity + by) }
          : line
      )
    );
  }

  private _drop(lineId: string): void {
    this._held.update((held) => held.filter((line) => line.lineId !== lineId));
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
   * none on its way it starts at once, in the same turn as the press.
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
    name: line.content,
    quantity: line.quantity,
    pending: line.approvalStatus === 'PENDING',
  };
}

/** A line as the store holds it, with the adds still on their way drawn in. */
function heldOf(line: Line, ahead: number): HeldLine {
  return {
    lineId: line.id,
    listId: line.listId,
    name: line.content,
    quantity: line.quantity + ahead,
    pending: line.approvalStatus === 'PENDING',
    itemIds: line.itemIds,
  };
}

/** Replace the line where it stands, or put it last. What it was known to hold stays known. */
function upsert(
  held: readonly HeldLine[],
  line: HeldLine
): readonly HeldLine[] {
  const at = held.findIndex((entry) => entry.lineId === line.lineId);
  if (at === -1) {
    return [...held, line];
  }
  const next = [...held];
  next[at] = { ...line, itemIds: union(held[at].itemIds, line.itemIds) };
  return next;
}

function union(
  left: readonly string[],
  right: readonly string[]
): readonly string[] {
  return [...new Set([...left, ...right])];
}

function targetOf(zone: MyZone, list: ShoppingListSummary): AddTargetList {
  return {
    listId: list.id,
    zoneId: zone.id,
    name: list.name,
    zoneName: zone.name,
    wanted: list.wantedCount,
    permissions: list.myPermissions,
    autoApproveLines: list.autoApproveLines,
  };
}
