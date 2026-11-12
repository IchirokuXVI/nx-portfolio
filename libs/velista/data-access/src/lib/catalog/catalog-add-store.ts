import { computed, inject, Injectable, signal } from '@angular/core';
import {
  addAmount,
  addedToLine,
  defaultQuantity,
  firstAddTarget,
  isCatalogUrl,
  isMeasured,
  isUnsavedLine,
  legacyLineUnit,
  sameLineName,
  shownLineUnit,
  unsavedLineId,
  visitAddition,
  visitAfterAdd,
  visitAfterStep,
  visitFloor,
  visitTakeBack,
  visitWithout,
  type AddTargetList,
  type AddUnitRefusal,
  type CatalogVisit,
  type HeldLine,
  type ItemList,
  type Line,
  type LineUnit,
  type MyZone,
  type QuantityStep,
  type ShoppingListSummary,
  type VisitList,
  type VisitProduct,
} from '@portfolio/velista/models';
import {
  BrowserFacade,
  quantityRuns,
  StorageKeys,
  type QuantityRun,
} from '@portfolio/velista/platform';
import { SessionStore } from '../auth/session-store';
import { LINE_SERVICE, type LineServiceI } from '../lines/line-service';
import { LIST_SERVICE, type ListServiceI } from '../lists/list-service';
import { toAddUnitRefusal } from '../mapping/add-choice-mappers';
import { ZONE_SERVICE, type ZoneServiceI } from '../zones/zone-service';
import { ItemNames } from './item-names';

/** A product, as the row that offers the plus knows it. */
export interface CatalogAddProduct {
  readonly itemId: string;
  /** The product's name in the reader's language, which becomes the line's name. */
  readonly name: string;
  /** What the sheet of the visit says under the name. */
  readonly detail: string | null;
  /** The photo of the row, which the sheet of the visit draws, or null. */
  readonly imageUrl: string | null;
  /**
   * What a line of this product counts in (velista `0182`):
   * `lineUnitOf(soldAsOf(offer, product))`. Absent is a count. An add starts at
   * `addAmount` of it, one piece, 25 g or 25 ml (velista `0185`).
   */
  readonly unit?: LineUnit;
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
  /**
   * The products' records, to read a held line the migration left in `UNIT`
   * the way `LineStore` reads it (backend `0246` M2). Optional, like there.
   */
  private readonly _items = inject(ItemNames, { optional: true });

  private readonly _status = signal<CatalogAddStatus>('idle');
  private readonly _lists = signal<readonly AddTargetList[]>([]);
  private readonly _targetId = signal<string | null>(null);
  private readonly _visit = signal<CatalogVisit>([]);
  private readonly _failures = signal(0);
  private readonly _refusal = signal<AddUnitRefusal | null>(null);
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

  /**
   * The open run of each line a stepper moves (velista `0188`, decision G): the
   * presses gather here, drawn at once, and after `QUANTITY_STEP_QUIET_MS` with no
   * step the run is written as one change. Every open run is written when the app
   * is destroyed or hidden, because a number the person watched move is saved.
   */
  private readonly _runs = quantityRuns<string>((lineId, run) =>
    this._sendRun(lineId, run)
  );

  /** The product of each open run, and the drawn amount it started from. */
  private readonly _runOf = new Map<
    string,
    { readonly product: VisitProduct; readonly from: number }
  >();

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

  /**
   * Every line the store knows to hold a product, over every list, in the unit
   * a list page draws it in: a legacy line at nothing in its product's unit
   * (backend `0246` M2, {@link shownLineUnit}).
   */
  readonly held = computed<readonly HeldLine[]>(() => {
    const held = this._held();
    const items = this._items;
    if (items === null) {
      return held;
    }
    let changed = false;
    const shown = held.map((line) => {
      const unit = shownLineUnit(line, (itemId) => items.nameOf(itemId));
      if (unit === line.unit) {
        return line;
      }
      changed = true;
      return { ...line, unit };
    });
    return changed ? shown : held;
  });

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
   * Why the last failed write failed, when it was an add of a product the list
   * counts in another unit (velista `0185`, section 4): the page says that sentence
   * in place of the generic one. Null after any other failure.
   */
  readonly refusal = this._refusal.asReadonly();

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
    // A stepper's open run on a line of this product is sent first, as a take
    // back does, so the add lands on top of it and the run does not later write
    // an amount that left the add out.
    for (const line of this._held()) {
      if (line.listId === to && line.itemIds.includes(product.itemId)) {
        this._flush(line.lineId);
      }
    }
    const drawnOn = this._drawAdd(to, product);
    this._adding.set(key, (this._adding.get(key) ?? 0) + 1);
    return this._queued(key, (generation) =>
      this._add(to, product, drawnOn, generation)
    );
  }

  /**
   * One step of the stepper of one line, as the stepper drew it (velista `0188`,
   * section 5.5).
   *
   * The step is drawn at once and joins the line's run, which is written as one
   * change when the presses stop. A press down that brings a line the visit made
   * to nothing, or a weight line the visit made down from its kilo, takes it back
   * instead, which deletes it where the person may; the open run is sent first. A
   * repeat that would do so is dropped, so a hold never takes a product back. A
   * line that was there before goes to zero and stays, which is what a list calls
   * stocked.
   */
  step(product: VisitProduct, lineId: string, step: QuantityStep): void {
    const line = this._held().find((held) => held.lineId === lineId);
    if (line === undefined || isUnsavedLine(lineId) || step.to === step.from) {
      return;
    }
    const key = keyOf(product.listId, product.itemId);
    const open = this._runs.pending().has(lineId);
    const down = step.to < step.from;
    if (!open && this._legacyUnit(line) !== null) {
      // A legacy line is corrected before any run starts on it (backend `0246`
      // section 3.2). The correction reads the line in its turn, so a second
      // press that comes while it waits corrects nothing twice.
      void this._queued(key, (generation) =>
        this._correctLegacy(product, lineId, down ? -1 : 1, generation)
      );
      return;
    }
    const entry = visitAddition(this._visit(), lineId);
    // The minus at the floor takes a product the visit added back: at nothing,
    // as a count always did, or exactly at the kilo a weight line the visit made
    // started at (velista `0182`). A weight line lowered under its kilo
    // elsewhere steps down like any other.
    if (
      down &&
      entry !== null &&
      entry.created &&
      (step.to === 0 ||
        (isMeasured(line.unit) && step.from === visitFloor(entry, line.unit)))
    ) {
      if (step.repeat) {
        return;
      }
      this._flush(lineId);
      void this._queued(key, () => this._takeBack(lineId));
      return;
    }
    if (!open) {
      this._runOf.set(lineId, { product, from: line.quantity });
    }
    this._move(lineId, step.to - line.quantity);
    // The run starts from what was drawn, so the change it writes is exactly how
    // far the drawn amount moved.
    this._runs.step(lineId, {
      ...step,
      from: this._runOf.get(lineId)?.from ?? line.quantity,
    });
  }

  /** Take one line back: undo what the visit did to it, and no more. */
  takeBack(lineId: string): Promise<void> {
    // What the steppers moved is written first, so the undo reads it.
    this._flush(lineId);
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
    // The steps the person made are written; the record that follows them is
    // the visit's, which ends here.
    for (const lineId of [...this._runs.pending().keys()]) {
      this._flush(lineId);
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
    const unit = product.unit ?? 'UNIT';
    if (own !== null) {
      this._move(own.lineId, addAmount(own.unit));
      return own.lineId;
    }
    const lineId = unsavedLineId(listId, product.itemId);
    this._held.update((held) => [
      ...held,
      {
        lineId,
        listId,
        name: product.name,
        quantity: addAmount(unit),
        unit,
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
    // One step of the product's unit, 25 g, 25 ml or one piece (velista `0185`).
    const unit = product.unit ?? 'UNIT';
    const amount = addAmount(unit);
    try {
      // Not named: the words are the product's (velista `0144`, section 3), and
      // they are still sent, because the server needs them and `sameLineName`
      // reads them.
      const result = await this._lines.addLineResult(
        listId,
        product.name,
        amount,
        [product.itemId],
        false,
        undefined,
        unit
      );
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
        this._move(drawnOn, -amount);
      }
      const answered = heldOf(result.line, elsewhere ? 0 : ahead);
      // A stepper's run still open on the line stays drawn on top of the answer.
      // Every other line the add met is read as the server holds it.
      const met = result.alreadyOnList.filter(
        (line) => line.id !== result.line.id
      );
      this._held.update((held) =>
        met.reduce(
          (all, line) => upsert(all, heldOf(line, 0)),
          upsert(
            held.filter((line) => line.lineId !== unsaved),
            {
              ...answered,
              quantity: answered.quantity + this._openOffset(answered.lineId),
            }
          )
        )
      );
      if (result.outcome === 'alreadyOnList') {
        // The list already asked for it, so nothing was added (backend `0260`,
        // A1): what was drawn came off with the server's quantity above, and the
        // visit records nothing to take back.
        return;
      }
      this._visit.update((visit) =>
        visitAfterAdd(
          visit,
          {
            listId,
            itemId: product.itemId,
            detail: product.detail,
            imageUrl: product.imageUrl,
          },
          stateOf(result.line),
          result.merged,
          amount
        )
      );
    } catch (error) {
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
        if (isUnsavedLine(drawn.lineId) && drawn.quantity <= amount) {
          this._drop(drawn.lineId);
        } else {
          this._move(drawn.lineId, -amount);
        }
      }
      this._refusal.set(toAddUnitRefusal(error, product.name));
      this._failures.update((count) => count + 1);
    }
  }

  /** A run closed: write it after the writes already on their way for its product. */
  private _sendRun(lineId: string, run: QuantityRun): void {
    const meta = this._runOf.get(lineId);
    this._runOf.delete(lineId);
    if (meta === undefined) {
      return;
    }
    const { product } = meta;
    void this._queued(keyOf(product.listId, product.itemId), (generation) =>
      this._writeRun(product, lineId, run, generation)
    );
  }

  /**
   * One run as one signed change (velista `0188`, section 5.5). The record of the
   * visit says the line held what the run started from. A refused run moves the
   * drawn amount back by what the run moved it.
   */
  private async _writeRun(
    product: VisitProduct,
    lineId: string,
    run: QuantityRun,
    generation: number
  ): Promise<void> {
    const delta = run.to - run.from;
    const line = this._held().find((held) => held.lineId === lineId);
    try {
      const answer = await this._lines.addQuantity(
        lineId,
        delta,
        line?.unit ?? 'UNIT'
      );
      if (generation !== this._generation) {
        return;
      }
      const ahead = this._adding.get(keyOf(product.listId, product.itemId));
      const held = heldOf(answer, ahead ?? 0);
      // A run opened on the line since this one closed is drawn on top.
      this._held.update((all) =>
        upsert(all, {
          ...held,
          quantity: held.quantity + this._openOffset(lineId),
        })
      );
      this._visit.update((visit) =>
        visitAfterStep(visit, product, stateOf(answer), run.from)
      );
    } catch {
      if (generation === this._generation) {
        this._move(lineId, -delta);
        this._refusal.set(null);
        this._failures.update((count) => count + 1);
      }
    }
  }

  /** Send a line's open run now. A run back to its start sends nothing, and leaves nothing. */
  private _flush(lineId: string): void {
    this._runs.flush(lineId);
    this._runOf.delete(lineId);
  }

  /** How far an open run on a line has moved its drawn amount, or nothing. */
  private _openOffset(lineId: string): number {
    const to = this._runs.pending().get(lineId);
    const from = this._runOf.get(lineId)?.from;
    return to === undefined || from === undefined ? 0 : to - from;
  }

  /** A legacy line, read in its turn of the queue, corrected once. */
  private async _correctLegacy(
    product: VisitProduct,
    lineId: string,
    by: 1 | -1,
    generation: number
  ): Promise<void> {
    const line = this._held().find((held) => held.lineId === lineId);
    const legacy = line === undefined ? null : this._legacyUnit(line);
    if (line === undefined || legacy === null) {
      return;
    }
    await this._correctUnit(product, line, legacy, by, generation);
  }

  /**
   * A step on a legacy line, as `LineStore` corrects one on the list page
   * (backend `0246` section 3.2): an absolute update to the default amount in
   * the product's unit, whatever the step, and nothing for a minus at nothing.
   * The next press waits for it in {@link _queued}, so it reads the corrected
   * line and is a delta again.
   */
  private async _correctUnit(
    product: VisitProduct,
    line: HeldLine,
    unit: LineUnit,
    by: 1 | -1,
    generation: number
  ): Promise<void> {
    if (by === -1 && line.quantity === 0) {
      return;
    }
    const quantity = defaultQuantity(unit);
    const replace = (to: HeldLine) =>
      this._held.update((held) =>
        held.map((one) => (one.lineId === line.lineId ? to : one))
      );
    replace({ ...line, quantity, unit });
    try {
      const answer = await this._lines.updateLine(line.lineId, {
        quantity,
        unit,
      });
      if (generation !== this._generation) {
        return;
      }
      const ahead = this._adding.get(keyOf(product.listId, product.itemId));
      this._held.update((held) =>
        upsert(held, heldOf(answer.line, ahead ?? 0))
      );
      // From nothing the visit added the kilo, which taking back lowers again.
      // Over pieces there is no amount in the new unit to go back to, so the
      // correction joins no record.
      this._visit.update((visit) =>
        visitAfterStep(
          visit,
          product,
          stateOf(answer.line),
          line.quantity === 0 ? 0 : answer.line.quantity
        )
      );
    } catch {
      if (generation === this._generation) {
        replace(line);
        this._refusal.set(null);
        this._failures.update((count) => count + 1);
      }
    }
  }

  /** {@link legacyLineUnit} of a held line, over the products this session read. */
  private _legacyUnit(line: HeldLine): LineUnit | null {
    const items = this._items;
    return items === null
      ? null
      : legacyLineUnit(line, (itemId) => items.nameOf(itemId));
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
    const unit = before.find((line) => line.lineId === lineId)?.unit ?? 'UNIT';
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
        const answer = await this._lines.addQuantity(
          undo.lineId,
          -undo.by,
          unit
        );
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
        this._refusal.set(null);
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
    return (
      visitAddition(this._visit(), lineId) !== null ||
      this._runs.pending().has(lineId)
    );
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
    // Each add on its way is one step of the line's unit (velista `0185`).
    quantity: line.quantity + ahead * addAmount(line.unit),
    unit: line.unit,
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
