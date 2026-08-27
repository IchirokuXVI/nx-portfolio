import {
  computed,
  DestroyRef,
  inject,
  Injectable,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type {
  Line,
  LineApprovalStatus,
  LineStatus,
} from '@portfolio/velista/models';
import { LINES_PAGE_SIZE } from '@portfolio/velista/models';
import { GatewayError } from '../errors';
import { Mutations, overlayKey, type Overlay } from '../mutations';
import {
  REALTIME_CLIENT,
  type RealtimeClientI,
} from '../realtime/realtime-client';
import type { RealtimeEvent } from '../realtime/realtime-events';
import { LINE_SERVICE, type LineServiceI } from './line-service';

/** How one list's lines are loading. Per list, since two can be open in a session. */
export type LineLoadState = 'idle' | 'loading' | 'loaded' | 'failed';

/** How a pending write on one line is going. Mirrors `LineWriteState` in `models`. */
export type LineWriteOutcome = 'pending' | 'failed' | 'overwritten';

/** A write the store is holding a visible state for, keyed by line. */
export interface LineWriteNote {
  readonly outcome: LineWriteOutcome;
  /** Who overwrote it, when the store could resolve them. Null otherwise. */
  readonly byUserId: string | null;
}

/**
 * The lines of each list: the cache, the realtime events, and **the optimistic overlay**.
 *
 * ## Why it is here and not in `feature-lists`
 *
 * `ListStore`'s reason, one level down and with more force. A store owned by a feature
 * library is destroyed on navigation, and the comment sheet is a **route** over this
 * page: opening one would leave the list room, throw every line away and refetch, on a
 * screen whose whole design is about being usable on bad signal.
 *
 * ## The overlay, finally used
 *
 * Plan 0004 section 7.2 designed the overlay and the version reconciliation and no
 * screen had needed either. Every write here is optimistic: the row changes on the
 * frame the thumb lifts and the request goes out behind it. Three endings, and the
 * reconciliation happens **once, here**, rather than in every component that draws a
 * row. That is the entire argument for a store rather than component state.
 *
 * ## Identity on an optimistic add
 *
 * A row created locally has no server id, so the `line.added` event that echoes it back
 * cannot be matched by id and would draw a second row. The add is therefore keyed by a
 * **client key** until the response returns, the response's id is recorded against that
 * key, and an event naming an id the store has already claimed is dropped rather than
 * inserted. An event for an id it has never seen, in a list it has loaded, is somebody
 * else's line and is inserted (section 5.2).
 */
// Provided by the app layer, never root: rule D5, plan 0004 section 9. It resolves
// `LINE_SERVICE` in the injector where the app binds it, and at the root it would
// silently get the token's own default instead.
@Injectable()
export class LineStore {
  private readonly _lines = inject<LineServiceI>(LINE_SERVICE);
  private readonly _realtime = inject<RealtimeClientI>(REALTIME_CLIENT);
  private readonly _mutations = inject(Mutations);
  private readonly _destroyRef = inject(DestroyRef);

  private readonly _byList = signal<ReadonlyMap<string, readonly Line[]>>(
    new Map()
  );
  private readonly _state = signal<ReadonlyMap<string, LineLoadState>>(
    new Map()
  );
  private readonly _error = signal<ReadonlyMap<string, unknown>>(new Map());
  private readonly _cursor = signal<ReadonlyMap<string, string | null>>(
    new Map()
  );

  /** Visible write state per line id: pending, failed, or overwritten. */
  private readonly _writes = signal<ReadonlyMap<string, LineWriteNote>>(
    new Map()
  );

  /** How many comments the client has actually observed, per line. */
  private readonly _commentCounts = signal<ReadonlyMap<string, number>>(
    new Map()
  );

  /**
   * Server ids this store minted itself, so their own echo is not drawn twice.
   *
   * A plain `Set` rather than a signal: nothing renders from it, and it exists purely
   * to answer "did I already insert this row" during event handling.
   */
  private readonly _mine = new Set<string>();

  constructor() {
    this._realtime.events
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((event) => this._apply(event));
  }

  /** One list's lines, in `position` order with rejected ones last. */
  linesIn(listId: string): readonly Line[] {
    return this._byList().get(listId) ?? [];
  }

  stateOf(listId: string): LineLoadState {
    return this._state().get(listId) ?? 'idle';
  }

  errorOf(listId: string): unknown {
    return this._error().get(listId) ?? null;
  }

  /**
   * Whether every page has arrived.
   *
   * Rule L4 turns dragging on from exactly this: `line.reorder` renumbers only the
   * lines it names, so reordering a list the client has not finished reading leaves
   * two lines on the same position and the order becomes whatever the id tie break
   * says (section 4.5).
   */
  isComplete(listId: string): boolean {
    return (this._cursor().get(listId) ?? null) === null;
  }

  writeNoteOf(lineId: string): LineWriteNote | null {
    return this._writes().get(lineId) ?? null;
  }

  commentCountOf(lineId: string): number | undefined {
    return this._commentCounts().get(lineId);
  }

  /** A signal view of one list, for a container that reads it in a computed. */
  forList(listId: string) {
    return computed(() => ({
      lines: this._byList().get(listId) ?? [],
      state: this._state().get(listId) ?? ('idle' as LineLoadState),
      error: this._error().get(listId) ?? null,
      complete: (this._cursor().get(listId) ?? null) === null,
      writes: this._writes(),
      commentCounts: this._commentCounts(),
    }));
  }

  /**
   * Load one list's lines.
   *
   * Issued from the list id alone and **never sequenced behind the request that names
   * the list** (rule L2). They are two independent calls, and making the lines wait on
   * a title means somebody in an aisle waits for a name before they see what to buy.
   *
   * Every page is asked for, up to the gateway's maximum, because that is what makes
   * reordering available on the first frame for every list this product is for.
   */
  async load(listId: string): Promise<void> {
    this._setState(listId, 'loading');
    this._setError(listId, null);

    try {
      const page = await this._lines.listLines(listId, {
        limit: LINES_PAGE_SIZE,
        order: 'position',
      });

      this._setLines(listId, page.items);
      this._setCursor(listId, page.nextCursor);
      this._setState(listId, 'loaded');

      // The rest arrives behind the first screenful. A long list keeps every other
      // function and loses only drag until this finishes, which is rule L4's cost and
      // it is paid in the background rather than in front of the reader.
      if (page.nextCursor !== null) {
        void this._loadRest(listId, page.nextCursor);
      }
    } catch (error) {
      this._setError(listId, error);
      this._setState(listId, 'failed');
    }
  }

  /**
   * Reread without dropping the page back to a skeleton.
   *
   * `ListStore.refresh`'s reason exactly, and this screen has one more: a
   * `validation_failed` on a reorder means somebody deleted a line mid drag, and the
   * answer to that is a silent reread rather than a message about somebody else's
   * perfectly ordinary action (section 5.7).
   */
  async refresh(listId: string): Promise<void> {
    try {
      const page = await this._lines.listLines(listId, {
        limit: LINES_PAGE_SIZE,
        order: 'position',
      });

      this._setLines(listId, page.items);
      this._setCursor(listId, page.nextCursor);
      this._setState(listId, 'loaded');

      if (page.nextCursor !== null) {
        void this._loadRest(listId, page.nextCursor);
      }
    } catch {
      // Deliberately quiet. What is on screen is not made worse by a reread that did
      // not arrive.
    }
  }

  /**
   * Put something on the list, and show it before the server confirms it.
   *
   * The row appears at once under a **client key**, because there is no server id yet
   * and `trackBy` needs something stable: keying on the index would rebuild every row
   * below it, and keying on nothing would lose the field's focus between two adds,
   * which is the one thing section 4.8 will not allow.
   *
   * Rule L3 lives in the caller rather than here. This method reports the line it
   * created and the page decides whether to follow it with an approval, because
   * whether the caller is staff is a fact about the zone and this store holds lines.
   */
  async addLine(
    listId: string,
    content: string,
    quantity: number,
    createdByUserId: string
  ): Promise<
    | { readonly state: 'added'; readonly line: Line }
    | { readonly state: 'failed'; readonly error: unknown }
  > {
    const clientKey = `pending-${Math.random().toString(36).slice(2, 10)}`;
    const optimistic: Line = {
      id: clientKey,
      listId,
      content,
      quantity,
      itemId: null,
      position: this._nextPosition(listId),
      // PENDING because core starts every line there, whoever added it. Drawing it as
      // approved and correcting a frame later would be a lie the staff path then has
      // to undo in front of the person who made it.
      approvalStatus: 'PENDING',
      status: 'PENDING',
      createdByUserId,
      approvedByUserId: null,
      version: 0,
    };

    this._insert(listId, optimistic);
    this._note(clientKey, { outcome: 'pending', byUserId: null });

    const outcome = await this._mutations.run(null, () =>
      this._lines.addLine(listId, content, quantity)
    );

    this._clearNote(clientKey);

    if (outcome.state === 'failed') {
      // The row leaves rather than staying as a ghost. Unlike an edit there is nothing
      // to snap back to: the line never existed anywhere, so leaving it on screen would
      // be an item somebody believes is on a shared list and which nobody else can see.
      this._removeLine(clientKey);
      return { state: 'failed', error: outcome.error };
    }

    // The server's row replaces the local one in place, keeping its position in the
    // rendered order, so nothing jumps at the moment the response lands.
    this._mine.add(outcome.value.id);
    this._replace(listId, clientKey, outcome.value);
    return { state: 'added', line: outcome.value };
  }

  /** Change what a line says, or how many. Optimistic, per field. */
  async updateLine(
    lineId: string,
    changes: { content?: string; quantity?: number }
  ): Promise<'succeeded' | 'failed' | 'overwritten'> {
    const before = this._lineById(lineId);
    if (before === null) {
      return 'failed';
    }

    const fields = Object.keys(changes).filter(
      (field) => changes[field as 'content' | 'quantity'] !== undefined
    );

    return this._write(
      lineId,
      before,
      fields,
      (line) => ({ ...line, ...changes }),
      () => this._lines.updateLine(lineId, changes)
    );
  }

  /**
   * Tick it off, or put it back, or mark it as not in the shop.
   *
   * The gesture this whole screen is built around, so it is optimistic without
   * qualification: the row changes on the frame the thumb lifts. A row with a write
   * already in flight stays tappable and the second tap simply supersedes the first,
   * because blocking it would make the app feel slow on exactly the connection it was
   * designed for (section 3.3).
   */
  async setStatus(
    lineId: string,
    status: LineStatus
  ): Promise<'succeeded' | 'failed' | 'overwritten'> {
    const before = this._lineById(lineId);
    if (before === null) {
      return 'failed';
    }

    return this._write(
      lineId,
      before,
      ['status'],
      (line) => ({ ...line, status }),
      () => this._lines.setStatus(lineId, status)
    );
  }

  /** Approve a suggested line, turn it down, or put a turned down one back. */
  async setApproval(
    lineId: string,
    approvalStatus: LineApprovalStatus
  ): Promise<'succeeded' | 'failed' | 'overwritten'> {
    const before = this._lineById(lineId);
    if (before === null) {
      return 'failed';
    }

    return this._write(
      lineId,
      before,
      ['approvalStatus'],
      (line) => ({ ...line, approvalStatus }),
      () => this._lines.setApproval(lineId, approvalStatus)
    );
  }

  /**
   * Take a line off the list.
   *
   * Optimistic like the rest, and the snap back on failure puts the row back where it
   * was rather than at the end, which is why the whole list is rewritten rather than
   * the row appended.
   */
  async deleteLine(
    lineId: string
  ): Promise<{ readonly state: 'deleted' | 'failed'; readonly error?: unknown }> {
    const listId = this._listOf(lineId);
    const before = this._byList().get(listId ?? '') ?? [];
    if (listId === null) {
      return { state: 'failed' };
    }

    this._removeLine(lineId);

    const outcome = await this._mutations.run(null, () =>
      this._lines.deleteLine(lineId)
    );

    if (outcome.state === 'failed') {
      this._setLines(listId, before);
      return { state: 'failed', error: outcome.error };
    }

    return { state: 'deleted' };
  }

  /**
   * Rewrite the whole order.
   *
   * The caller is responsible for having checked {@link isComplete} first: this method
   * sends what it is given, and rule L4 is a rule about when the control is offered
   * rather than a check buried here where a reader of the page cannot see it.
   *
   * A `validation_failed` is **silent** and rereads. It means the order named a line
   * the server no longer has, which is somebody deleting one mid drag, and the person
   * who dragged has done nothing wrong (section 5.7).
   */
  async reorder(
    listId: string,
    orderedLineIds: readonly string[]
  ): Promise<'succeeded' | 'failed'> {
    const before = this._byList().get(listId) ?? [];
    const byId = new Map(before.map((line) => [line.id, line]));

    this._setLines(
      listId,
      orderedLineIds
        .map((id, index) => {
          const line = byId.get(id);
          return line === undefined ? null : { ...line, position: index + 1 };
        })
        .filter((line): line is Line => line !== null)
    );

    const outcome = await this._mutations.run(null, () =>
      this._lines.reorder(listId, orderedLineIds)
    );

    if (outcome.state === 'failed') {
      this._setLines(listId, before);
      void this.refresh(listId);
      return 'failed';
    }

    return 'succeeded';
  }

  /**
   * Record how many comments a line has, from a page the caller actually loaded.
   *
   * The only honest source there is. `LineView` carries no count and nothing on the
   * wire does, so the row shows a number exactly when the client has seen the
   * comments and nothing at all otherwise.
   */
  recordCommentCount(lineId: string, count: number): void {
    this._commentCounts.update((current) =>
      new Map(current).set(lineId, count)
    );
  }

  /** Clear a failed or overwritten notice, which the caller dismisses. */
  dismissNote(lineId: string): void {
    this._clearNote(lineId);
  }

  /** Drop one list's cache, so the next visit is a cold load rather than stale rows. */
  forget(listId: string): void {
    this._byList.update((current) => {
      const next = new Map(current);
      next.delete(listId);
      return next;
    });
    this._setState(listId, 'idle');
  }

  /**
   * One write, with its overlay, its snap back and its version check.
   *
   * Everything section 3.3 describes is here and nowhere else. The three endings are
   * `Mutations.run`'s three outcomes, and the mapping is deliberately literal:
   *
   * - **succeeded**: the overlay is dropped and the server's row replaces the local
   *   one. No success feedback anywhere, because the feedback was the change itself.
   * - **failed**: the row snaps back to what it was and a note is left for the row to
   *   render inline. Not a toast: a toast about a row is read after the row has
   *   scrolled away.
   * - **overwritten**: the write landed on top of somebody else's. The server's row
   *   wins, because it is the truth, and the note says whose change is being shown.
   */
  private async _write(
    lineId: string,
    before: Line,
    fields: readonly string[],
    apply: (line: Line) => Line,
    send: () => Promise<Line>
  ): Promise<'succeeded' | 'failed' | 'overwritten'> {
    const listId = before.listId;

    // One overlay per field, so a realtime event for a field this write does not claim
    // still wins while the request is in flight (plan 0004, section 7.2, case 3).
    const overlay: Overlay<unknown> = {
      key: overlayKey(lineId, fields.join('+')),
      apply: (current) => apply(current as Line) as unknown,
      fields,
    };

    this._patch(listId, lineId, apply);
    this._note(lineId, { outcome: 'pending', byUserId: null });

    const outcome = await this._mutations.run(
      overlay,
      send,
      (line) => line.version,
      before.version
    );

    if (outcome.state === 'failed') {
      this._patch(listId, lineId, () => before);
      this._note(lineId, { outcome: 'failed', byUserId: null });
      return 'failed';
    }

    this._patch(listId, lineId, () => outcome.value);

    if (outcome.state === 'overwritten') {
      this._note(lineId, {
        outcome: 'overwritten',
        // The server's row does not say who last touched it, only who approved it, so
        // this is null on an ordinary edit. The copy falls back to a neutral phrase
        // rather than naming the wrong person.
        byUserId: outcome.value.approvedByUserId,
      });
      return 'overwritten';
    }

    this._clearNote(lineId);
    return 'succeeded';
  }

  private async _loadRest(listId: string, from: string): Promise<void> {
    let cursor: string | null = from;
    // Cursors already followed. A server that answered with the cursor it was handed
    // would otherwise put this loop into a request per turn, forever, on a phone. It
    // should never happen and the cost of being sure is a `Set`.
    const seen = new Set<string>();

    try {
      while (cursor !== null && !seen.has(cursor)) {
        seen.add(cursor);

        const page = await this._lines.listLines(listId, {
          cursor,
          limit: LINES_PAGE_SIZE,
          order: 'position',
        });

        this._setLines(listId, [
          ...(this._byList().get(listId) ?? []),
          ...page.items,
        ]);
        cursor = page.nextCursor;
        this._setCursor(listId, cursor);
      }
    } catch {
      // The first page is on screen and usable. A failure here costs the drag control
      // and nothing else, which is not worth an error panel over a working list.
    }
  }

  /**
   * Apply one realtime event.
   *
   * Every case here is section 3.5, and two of them are worth reading twice.
   *
   * `line.added` for a line this client created arrives **after** the response that
   * created it, so the id is already known and the event is dropped. Without that the
   * person who typed the item sees it twice.
   *
   * `line.updated` loses to an overlay for the fields that overlay claims and wins for
   * every other field, which is what stops an echo of the state somebody is editing
   * from overwriting their half finished change.
   */
  private _apply(event: RealtimeEvent): void {
    switch (event.type) {
      case 'line.added': {
        const { line } = event;
        if (!this._byList().has(line.listId) || this._mine.has(line.id)) {
          break;
        }

        if (this._lineById(line.id) === null) {
          this._insert(line.listId, line);
        }
        break;
      }

      case 'line.updated': {
        const { line } = event;
        const existing = this._lineById(line.id);
        if (existing === null) {
          break;
        }

        this._patch(line.listId, line.id, (current) =>
          this._reconcile(current, line)
        );
        break;
      }

      case 'line.deleted': {
        this._removeLine(event.lineId);
        break;
      }

      case 'line.reordered': {
        // Rewritten wholesale and **never animated**, because animating somebody
        // else's reorder while a thumb is over the list moves the target under the
        // thumb (section 3.5). The store simply states the new order and the page
        // draws it; nothing here knows about a transition.
        const lines = this._byList().get(event.listId);
        if (lines === undefined) {
          break;
        }

        const positions = new Map(
          event.orderedLineIds.map((id, index) => [id, index + 1])
        );
        this._setLines(
          event.listId,
          lines.map((line) => {
            const position = positions.get(line.id);
            return position === undefined ? line : { ...line, position };
          })
        );
        break;
      }

      case 'comment.added': {
        const { comment } = event;
        const known = this._commentCounts().get(comment.lineId);
        // Incremented only where a count is already known. Starting one at 1 from an
        // event would claim a line with nine comments has one, which is worse than
        // claiming nothing.
        if (known !== undefined) {
          this.recordCommentCount(comment.lineId, known + 1);
        }
        break;
      }

      default:
        // Zone, member, list, merge and presence traffic. `ZoneStore` and `ListStore`
        // own all of it, and `list.deleted` and `list.accessChanged` in particular are
        // the page's business rather than this store's: what they mean is that the
        // page has to leave, which is not a fact about lines.
        break;
    }
  }

  /**
   * One incoming line against the local one, field by field.
   *
   * Plan 0004 section 7.2 case 3, applied literally: a field with a pending overlay
   * keeps the local value until that overlay's own request resolves, and every other
   * field takes the server's. The alternative, taking the whole record, overwrites
   * the change somebody is in the middle of making with an echo of what they are
   * changing away from.
   */
  private _reconcile(local: Line, incoming: Line): Line {
    const claims = (field: string): boolean =>
      this._mutations.claims(overlayKey(local.id, field)) ||
      this._mutations.claims(overlayKey(local.id, 'content+quantity'));

    return {
      ...incoming,
      content: claims('content') ? local.content : incoming.content,
      quantity: claims('quantity') ? local.quantity : incoming.quantity,
      status: claims('status') ? local.status : incoming.status,
      approvalStatus: claims('approvalStatus')
        ? local.approvalStatus
        : incoming.approvalStatus,
    };
  }

  private _nextPosition(listId: string): number {
    return (
      (this._byList().get(listId) ?? []).reduce(
        (top, line) => Math.max(top, line.position),
        0
      ) + 1
    );
  }

  private _lineById(lineId: string): Line | null {
    for (const lines of this._byList().values()) {
      const found = lines.find((line) => line.id === lineId);
      if (found !== undefined) {
        return found;
      }
    }

    return null;
  }

  private _listOf(lineId: string): string | null {
    for (const [listId, lines] of this._byList()) {
      if (lines.some((line) => line.id === lineId)) {
        return listId;
      }
    }

    return null;
  }

  private _insert(listId: string, line: Line): void {
    this._byList.update((current) =>
      new Map(current).set(listId, [...(current.get(listId) ?? []), line])
    );
  }

  private _replace(listId: string, fromId: string, line: Line): void {
    this._byList.update((current) => {
      const lines = current.get(listId) ?? [];
      return new Map(current).set(
        listId,
        lines.map((existing) => (existing.id === fromId ? line : existing))
      );
    });
  }

  private _patch(
    listId: string,
    lineId: string,
    change: (line: Line) => Line
  ): void {
    this._byList.update((current) => {
      const lines = current.get(listId) ?? [];
      return new Map(current).set(
        listId,
        lines.map((line) => (line.id === lineId ? change(line) : line))
      );
    });
  }

  private _removeLine(lineId: string): void {
    this._byList.update((current) => {
      const next = new Map(current);
      for (const [listId, lines] of current) {
        if (lines.some((line) => line.id === lineId)) {
          next.set(
            listId,
            lines.filter((line) => line.id !== lineId)
          );
        }
      }
      return next;
    });

    this._clearNote(lineId);
  }

  private _note(lineId: string, note: LineWriteNote): void {
    this._writes.update((current) => new Map(current).set(lineId, note));
  }

  private _clearNote(lineId: string): void {
    this._writes.update((current) => {
      if (!current.has(lineId)) {
        return current;
      }

      const next = new Map(current);
      next.delete(lineId);
      return next;
    });
  }

  private _setLines(listId: string, lines: readonly Line[]): void {
    this._byList.update((current) => new Map(current).set(listId, lines));
  }

  private _setState(listId: string, state: LineLoadState): void {
    this._state.update((current) => new Map(current).set(listId, state));
  }

  private _setError(listId: string, error: unknown): void {
    this._error.update((current) => new Map(current).set(listId, error));
  }

  private _setCursor(listId: string, cursor: string | null): void {
    this._cursor.update((current) => new Map(current).set(listId, cursor));
  }
}

/** Whether a failure is the gateway refusing a write for lack of access. */
export function isForbidden(error: unknown): boolean {
  return error instanceof GatewayError && error.code === 'forbidden';
}
