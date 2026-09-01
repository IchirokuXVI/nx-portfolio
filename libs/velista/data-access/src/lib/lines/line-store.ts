import {
  computed,
  DestroyRef,
  inject,
  Injectable,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  LINE_QUANTITY_MIN,
  LINES_PAGE_SIZE,
  SETTLEMENTS_PAGE_SIZE,
  type Comment,
  type Line,
  type LineApprovalStatus,
  type LineSettlement,
  type Page,
  type SettlementOutcome,
} from '@portfolio/velista/models';
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
 *
 * That claim cannot be made before the response names the id, and on a deployed
 * environment the echo usually arrives first, so **the two orders are settled in
 * `_settleAdd` rather than by the claim alone**. Read it before touching either half:
 * the version that only claimed left the same id in the list twice whenever the socket
 * beat the response, which is the ordinary order everywhere except localhost.
 */
// Provided by the app layer, never root: rule D5, plan 0004 section 9. It resolves
// `LINE_SERVICE` in the injector where the app binds it, and at the root it would
// silently get the token's own default instead.
/**
 * What a claim change says about one line (backend plan 0052, section 2).
 *
 * The pair rather than one nullable field, because `claimed` with no name is a real
 * state: the basket's owner has left the zone, so the line is still being bought and
 * whose it is has stopped being this reader's to know.
 */
export interface LineClaim {
  readonly claimed: boolean;
  readonly claimedByUserId: string | null;
}

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
   * The comments themselves, per line, for the lines whose sheet has been opened
   * (plan 0018, gap 2).
   *
   * They were sheet state, which meant the sheet appended only the comment the reader
   * posted and `comment.added` from anybody else went to the count and nowhere else.
   * Two people commenting on one line is the ordinary case for this product, and the
   * second person's comment did not appear.
   *
   * Keyed by line rather than by list, because that is the unit a sheet opens on and
   * the unit the event names.
   */
  private readonly _comments = signal<ReadonlyMap<string, readonly Comment[]>>(
    new Map()
  );

  /**
   * One line's own settlements, newest first, for the lines whose sheet or page has
   * been opened.
   *
   * Keyed by line, like the comments above it and for the same reason: that is the
   * unit a sheet opens on and the unit an event names. Undefined means nobody has
   * asked, which a section draws as a skeleton; an empty array means the line has no
   * history, which it draws as a sentence. Collapsing the two would make every line
   * look freshly loaded forever.
   */
  private readonly _settlements = signal<
    ReadonlyMap<string, readonly LineSettlement[]>
  >(new Map());

  /**
   * The cross list history, unioned over a line's whole product set and keyed by the
   * **line** rather than by the item.
   *
   * By line because the union is the answer the page draws, and re-merging three
   * products' histories on every render would be a sort per keystroke elsewhere on
   * the screen. A line with no products never gets an entry at all, which is what
   * makes that section absent rather than empty (velista plan 0043, section 5.3).
   */
  private readonly _itemSettlements = signal<
    ReadonlyMap<string, readonly LineSettlement[]>
  >(new Map());

  /**
   * Where the next page of one line's own history starts, or null when there is none.
   *
   * Held so the section can offer "show more" rather than assume there is nothing
   * (velista plan 0047, section 4): `hasMore` was modelled from the start and passed a
   * literal `false`, so the whole control was present except the value that would make
   * it appear.
   */
  private readonly _settlementCursor = signal<
    ReadonlyMap<string, string | null>
  >(new Map());

  /**
   * Where the next page of the cross list history starts, **per product**, per line.
   *
   * A cursor each because the read is per product and they run out at different times:
   * one product with ten pages of history beside one with none is the ordinary case for
   * a line carrying a group, and a single cursor could only ever be right about one of
   * them.
   */
  private readonly _itemCursors = signal<
    ReadonlyMap<string, ReadonlyMap<string, string | null>>
  >(new Map());

  /**
   * Which lines are in somebody's live basket right now, and whose.
   *
   * **Derived from the lines rather than held beside them**, which is where velista
   * plan 0043 section 3.3 put it and where backend plan 0052 section 4 moved it. The
   * argument for presence was that a claim is not a fact about the record; the
   * argument against was decisive, and it is that presence only ever reaches a client
   * that happened to be connected. A shopping trip lasts an hour while a phone sleeps
   * in a pocket, and an indicator that is right for whoever was watching and blank for
   * everybody else is worse than one that is absent.
   *
   * So the server answers it on every line it serves, `line.claimChanged` moves it on
   * the lines already held, and this is the projection the page reads. Nothing derived
   * from it is written back and a claimed line is still not a line that has been dealt
   * with: those halves of section 3.3 are untouched.
   *
   * A line claimed by somebody who has left the zone has no entry here, because there
   * is no name to put in one. It still reads `claimed` on the line itself.
   */
  private readonly _claims = computed<ReadonlyMap<string, string>>(() => {
    const claims = new Map<string, string>();
    for (const lines of this._byList().values()) {
      for (const line of lines) {
        if (line.claimedByUserId !== null) {
          claims.set(line.id, line.claimedByUserId);
        }
      }
    }
    return claims;
  });

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

  /**
   * One line's comments, newest first, or undefined when none have been loaded.
   *
   * Undefined rather than an empty array, and the difference carries the whole of the
   * rule below: a line whose comments have never been read is not a line with no
   * comments, and an event must not turn the first into the second.
   */
  commentsOf(lineId: string): readonly Comment[] | undefined {
    return this._comments().get(lineId);
  }

  /**
   * One line's own history, or undefined when it has never been read.
   *
   * The same undefined-versus-empty rule as {@link commentsOf}, and it decides more
   * here: a settled line with an unread history and a settled line with a history of
   * one look identical to anything testing for length.
   */
  settlementsOf(lineId: string): readonly LineSettlement[] | undefined {
    return this._settlements().get(lineId);
  }

  /** The cross list history for a line's products, or undefined when unread. */
  itemSettlementsOf(lineId: string): readonly LineSettlement[] | undefined {
    return this._itemSettlements().get(lineId);
  }

  /** Who is out buying this line right now, as a user id, or null. */
  claimOf(lineId: string): string | null {
    return this._claims().get(lineId) ?? null;
  }

  /** Every current claim, for a container deriving a whole page of rows at once. */
  claims(): ReadonlyMap<string, string> {
    return this._claims();
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
      claims: this._claims(),
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
   * **The placeholder is drawn with the approval the server is going to give it.** Core
   * decides that from two facts, in order: the adder holds `DECIDE`, or the list
   * auto-approves (backend plan 0037, section 2). Both are known here before the request
   * is sent, so there is no reason to draw `PENDING` and correct it a frame later, and
   * every reason not to: the frame in between is the approve button appearing on the
   * adder's own line, which is the defect plan 0030 section 5 exists to remove.
   *
   * They arrive as an `approval` argument rather than being resolved here, and that is
   * the same division this method already had for rule L3: whether the caller may decide
   * is a fact about a list, and this store holds lines. `ListStore` holds the list, the
   * page holds the abilities derived from it, and passing them down keeps this store from
   * injecting a second store to ask a question its caller had already answered.
   *
   * Required rather than defaulted, because a default of "not approved" is exactly the
   * old behaviour and would reintroduce the defect silently at every call site that
   * forgot it.
   */
  async addLine(
    listId: string,
    content: string,
    quantity: number,
    createdByUserId: string,
    approval: {
      readonly canDecide: boolean;
      readonly autoApproveLines: boolean;
    },
    itemIds?: readonly string[]
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
      itemIds: [...(itemIds ?? [])],
      position: this._nextPosition(listId),
      approvalStatus:
        approval.canDecide || approval.autoApproveLines
          ? 'APPROVED'
          : 'PENDING',
      // The approver is the adder only when they are the one who could have been asked.
      // An auto-approved line has **no** approver, because nobody decided: the list is
      // configured not to ask, and a null here is the honest record of that.
      approvedByUserId: approval.canDecide ? createdByUserId : null,
      // Nothing has ever happened to a line that does not exist yet, so all three
      // indicators start off, and the server's answer cannot disagree.
      boughtCount: 0,
      lastSettlementOutcome: null,
      claimed: false,
      claimedByUserId: null,
      createdByUserId,
      version: 0,
    };

    this._insert(listId, optimistic);
    this._note(clientKey, { outcome: 'pending', byUserId: null });

    const outcome = await this._mutations.run(null, () =>
      this._lines.addLine(listId, content, quantity, itemIds)
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
    this._settleAdd(listId, clientKey, outcome.value);
    return { state: 'added', line: outcome.value };
  }

  /** Change what a line says, or how many. Optimistic, per field. */
  async updateLine(
    lineId: string,
    changes: {
      content?: string;
      quantity?: number;
      itemIds?: readonly string[];
    }
  ): Promise<'succeeded' | 'failed' | 'overwritten'> {
    const before = this._lineById(lineId);
    if (before === null) {
      return 'failed';
    }

    const fields = Object.keys(changes).filter(
      (field) =>
        changes[field as 'content' | 'quantity' | 'itemIds'] !== undefined
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
   * Move a line's quantity by a signed delta (velista plan 0043, section 4.1).
   *
   * The gesture this whole screen is built around, so it is optimistic without
   * qualification: the row shows the snapped number on the frame the thumb lifts. A
   * row with a write already in flight stays live and the next adjustment simply
   * supersedes it, because blocking would make the app feel slow on exactly the
   * connection it was designed for (`0012`, section 3.3).
   *
   * ## Why the overlay applies to `quantity` and the request carries a delta
   *
   * These are two different problems and the split matters. The **overlay** claims
   * `quantity` so a realtime echo of the old number cannot overwrite what the thumb
   * is doing, which is `0004` section 7.2 case 3 unchanged. The **request** is a
   * delta so two people adjusting the same line both land: an absolute write from a
   * moving control races, and the loser silently wins.
   *
   * The snap back on failure therefore restores the number the line held **before**
   * this adjustment, which is what `_write` already does with `before`. It is not the
   * negation of the delta: by the time a failure returns, somebody else's delta may
   * have landed, and subtracting ours from their result would invent a third number
   * nobody asked for.
   */
  async addQuantity(
    lineId: string,
    delta: number
  ): Promise<'succeeded' | 'failed' | 'overwritten'> {
    const before = this._lineById(lineId);
    if (before === null || delta === 0) {
      return 'failed';
    }

    return this._write(
      lineId,
      before,
      ['quantity'],
      (line) => ({
        ...line,
        quantity: Math.max(LINE_QUANTITY_MIN, line.quantity + delta),
      }),
      () => this._lines.addQuantity(lineId, delta)
    );
  }

  /**
   * Say what happened to a line on a trip (velista plan 0043, section 5.2).
   *
   * **Not optimistic, and that is the one deliberate difference from every other
   * write on this screen.** Everything else here is a gesture whose result the person
   * already knows: they dragged a number, so the number moves. This one is two taps
   * behind a deliberate open and its result is a *derivation* the server performs,
   * over history the client does not hold: how far the quantity falls depends on what
   * was outstanding, and whether the bought indicator appears depends on a count only
   * the server can take. Guessing all of that to save one round trip on a gesture
   * somebody makes standing still, once per shop, would be optimism spent in the
   * wrong place.
   *
   * The settlement it answers with is recorded, so a history already on screen gains
   * the row without a refetch.
   */
  async settle(
    lineId: string,
    outcome: SettlementOutcome,
    options?: { quantity?: number; itemId?: string }
  ): Promise<
    | { readonly state: 'settled'; readonly line: Line }
    | { readonly state: 'failed'; readonly error: unknown }
  > {
    const before = this._lineById(lineId);
    if (before === null) {
      return { state: 'failed', error: null };
    }

    this._note(lineId, { outcome: 'pending', byUserId: null });

    const result = await this._mutations.run(null, () =>
      this._lines.settle(lineId, outcome, options)
    );

    if (result.state === 'failed') {
      this._note(lineId, { outcome: 'failed', byUserId: null });
      return { state: 'failed', error: result.error };
    }

    this._clearNote(lineId);
    this.recordSettlement(result.value.settlement);
    this._patch(before.listId, lineId, () => result.value.line);
    return { state: 'settled', line: result.value.line };
  }

  /**
   * One line's history, read once and held.
   *
   * A cache rather than a fetch per open, because the sheet and the page both want it
   * and the second is usually opened from the first. Undefined means nobody has
   * asked, which is what lets a section draw a skeleton rather than an empty state:
   * the same distinction `commentCount` makes, and for the same reason.
   */
  async loadSettlements(lineId: string): Promise<void> {
    if (this._settlements().has(lineId)) {
      return;
    }

    try {
      const page = await this._lines.listSettlements(lineId, {
        limit: SETTLEMENTS_PAGE_SIZE,
      });
      this._settlements.update((current) =>
        new Map(current).set(lineId, page.items)
      );
      this._settlementCursor.update((current) =>
        new Map(current).set(lineId, page.nextCursor)
      );
    } catch {
      // Deliberately quiet, exactly as `refresh` is. The sheet's own numbers came off
      // the line and are already drawn; a history that did not arrive costs a section
      // and not the screen.
    }
  }

  /**
   * The next page of one line's history, **appended** (velista plan 0047, section 4).
   *
   * Appended and never replacing, which is the rule that makes a "show more" on a
   * history correct rather than merely present: a section that redrew from page two
   * would drop the recent rows, and those are the ones somebody opened a history to
   * see.
   *
   * Quiet on failure like the first page, and the cursor is left where it was, so the
   * button stays and pressing it again retries.
   */
  async loadMoreSettlements(lineId: string): Promise<void> {
    const cursor = this._settlementCursor().get(lineId) ?? null;
    const held = this._settlements().get(lineId);
    if (cursor === null || held === undefined) {
      return;
    }

    try {
      const page = await this._lines.listSettlements(lineId, {
        cursor,
        limit: SETTLEMENTS_PAGE_SIZE,
      });
      this._settlements.update((current) =>
        new Map(current).set(lineId, [...held, ...page.items])
      );
      this._settlementCursor.update((current) =>
        new Map(current).set(lineId, page.nextCursor)
      );
    } catch {
      // As above: a page, not the screen.
    }
  }

  /**
   * The cross list history for a line's products, unioned over its whole set.
   *
   * Keyed by **line** rather than by item, even though the read is per item, because
   * the union is the answer the screen wants and recomputing it per render would
   * re-merge and re-sort on every keystroke elsewhere on the page. A line with no
   * products is left absent rather than stored empty, which is what makes the section
   * absent rather than empty (section 5.3).
   */
  async loadItemSettlements(line: Line): Promise<void> {
    if (line.itemIds.length === 0 || this._itemSettlements().has(line.id)) {
      return;
    }

    try {
      const pages = await Promise.all(
        line.itemIds.map((itemId) =>
          this._lines.listItemSettlements(itemId, {
            limit: SETTLEMENTS_PAGE_SIZE,
          })
        )
      );
      // Merged and re-sorted, because each product answered in its own order and a
      // list concatenated from three of them is three histories printed one after
      // another rather than one history.
      const merged = pages
        .flatMap((page) => page.items)
        .sort((a, b) => b.settledAt.getTime() - a.settledAt.getTime());

      this._itemSettlements.update((current) =>
        new Map(current).set(line.id, merged)
      );
      this._itemCursors.update((current) =>
        new Map(current).set(line.id, cursorsFrom(line.itemIds, pages))
      );
    } catch {
      // As above: a section, not the screen.
    }
  }

  /**
   * The next page of the cross list history, **appended** (velista plan 0047, section
   * 4).
   *
   * A cursor **per product**, because the read is per product and they exhaust at
   * different times: a line carrying milk bought weekly and olive oil bought twice a
   * year has one product with ten pages and one with none, and a single cursor could
   * only be right about one of them. Only the products that still have one are asked.
   *
   * **The filter is applied per page, not once.** Backend plan 0047's rule is that the
   * cross list item history is filtered by the caller's read access at request time, so
   * page two is filtered against access as it is when page two is asked for. That falls
   * out of asking again rather than paging a snapshot, which is the reason this is a
   * request and not a slice of something already held.
   *
   * Re-sorted over the whole set after appending, for the reason the first page is
   * merged at all: three products' second pages concatenated onto one list is three
   * histories printed one after another.
   */
  async loadMoreItemSettlements(line: Line): Promise<void> {
    const cursors = this._itemCursors().get(line.id);
    const held = this._itemSettlements().get(line.id);
    if (cursors === undefined || held === undefined) {
      return;
    }

    // Only the products that have more, and only ones still on the line: a product
    // taken off between the two pages has no business contributing a second one.
    const asking = line.itemIds.filter(
      (itemId) => (cursors.get(itemId) ?? null) !== null
    );
    if (asking.length === 0) {
      return;
    }

    try {
      const pages = await Promise.all(
        asking.map((itemId) =>
          this._lines.listItemSettlements(itemId, {
            cursor: cursors.get(itemId) ?? undefined,
            limit: SETTLEMENTS_PAGE_SIZE,
          })
        )
      );

      const merged = [...held, ...pages.flatMap((page) => page.items)].sort(
        (a, b) => b.settledAt.getTime() - a.settledAt.getTime()
      );

      this._itemSettlements.update((current) =>
        new Map(current).set(line.id, merged)
      );
      this._itemCursors.update((current) => {
        const next = new Map(cursors);
        asking.forEach((itemId, index) => {
          next.set(itemId, pages[index].nextCursor);
        });
        return new Map(current).set(line.id, next);
      });
    } catch {
      // As above: a page, not the screen.
    }
  }

  /** Whether one line's own history has a further page. */
  hasMoreSettlements(lineId: string): boolean {
    return (this._settlementCursor().get(lineId) ?? null) !== null;
  }

  /**
   * Whether the cross list history has a further page, from **any** of the products.
   *
   * Any rather than all: the section is one merged history, so it has more to show
   * while a single product does, and a control that waited for every product to be
   * exhausted would hide rows that exist.
   */
  hasMoreItemSettlements(lineId: string): boolean {
    const cursors = this._itemCursors().get(lineId);
    if (cursors === undefined) {
      return false;
    }
    for (const cursor of cursors.values()) {
      if (cursor !== null) {
        return true;
      }
    }
    return false;
  }

  /**
   * Put one settlement at the top of a line's history, once.
   *
   * An upsert like `addComment`, and for the same reason: a settle the reader
   * performs arrives twice, as the response and again as `line.settled` on the
   * socket. A line whose history was never loaded is left alone, because starting one
   * from an event would show a line with nine purchases as having one.
   */
  recordSettlement(settlement: LineSettlement): void {
    const current = this._settlements().get(settlement.lineId);
    if (current === undefined) {
      return;
    }
    if (current.some((row) => row.id === settlement.id)) {
      return;
    }

    this._settlements.update((map) =>
      new Map(map).set(settlement.lineId, [settlement, ...current])
    );
  }

  /**
   * Record that a line is, or is no longer, in somebody's live basket.
   *
   * Written onto the line, because that is where the claim lives (backend plan 0052,
   * section 4): the server answers it on every read, so an event that wrote somewhere
   * else would leave the two disagreeing the moment either one arrived second. The
   * name is resolved by the page, because this store holds lines and not people.
   *
   * Fed by `line.claimChanged` on the zone room, which is the one zone event a
   * generated list emits. A line this client has not loaded is skipped rather than
   * remembered: there is no row to mark, and the read that eventually brings the line
   * in carries the claim with it.
   */
  setClaim(listId: string, lineId: string, claim: LineClaim): void {
    if (this._lineById(lineId) === null) {
      return;
    }
    this._patch(listId, lineId, (line) => ({
      ...line,
      claimed: claim.claimed,
      claimedByUserId: claim.claimedByUserId,
    }));
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
  async deleteLine(lineId: string): Promise<{
    readonly state: 'deleted' | 'failed';
    readonly error?: unknown;
  }> {
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

  /**
   * The page of comments a sheet just read, which also fixes the count.
   *
   * One call for both, because a loaded page is the only honest source of either and
   * setting one without the other is how a row comes to claim a number its own list
   * disagrees with.
   */
  recordComments(lineId: string, comments: readonly Comment[]): void {
    this._comments.update((current) => new Map(current).set(lineId, comments));
    this.recordCommentCount(lineId, comments.length);
  }

  /**
   * Put one comment at the top of a line's list, once.
   *
   * **An upsert, not an append**, and that is the point rather than caution: a comment
   * the reader posts arrives twice, as the response to the POST and again as
   * `comment.added` on the socket, so anything less shows it twice. The reader's own
   * optimistic insert and the event therefore call the same method.
   *
   * A line whose comments were never loaded is left alone, the same rule the count
   * follows: starting a list from an event would show one comment for a line with
   * nine.
   */
  addComment(comment: Comment): void {
    const current = this._comments().get(comment.lineId);
    if (current === undefined) {
      return;
    }

    if (current.some((existing) => existing.id === comment.id)) {
      this._comments.update((map) =>
        new Map(map).set(
          comment.lineId,
          current.map((existing) =>
            existing.id === comment.id ? comment : existing
          )
        )
      );
      return;
    }

    const next = [comment, ...current];
    this._comments.update((map) => new Map(map).set(comment.lineId, next));
    this.recordCommentCount(comment.lineId, next.length);
  }

  /** Clear a failed or overwritten notice, which the caller dismisses. */
  dismissNote(lineId: string): void {
    this._clearNote(lineId);
  }

  /** Drop one list's cache, so the next visit is a cold load rather than stale rows. */
  forget(listId: string): void {
    const lineIds = (this._byList().get(listId) ?? []).map((line) => line.id);

    this._byList.update((current) => {
      const next = new Map(current);
      next.delete(listId);
      return next;
    });
    // The histories go with the lines they belong to. They are keyed by line rather
    // than by list, so nothing else would ever evict them and a session that walked
    // through twenty lists would hold every settlement it had ever read.
    this._settlements.update((current) => without(current, lineIds));
    this._itemSettlements.update((current) => without(current, lineIds));
    // And their cursors, which are the same cache by another name: a cursor kept past
    // the rows it points into would offer a second page of a history that has been
    // dropped, and the append would land on nothing.
    this._settlementCursor.update((current) => without(current, lineIds));
    this._itemCursors.update((current) => without(current, lineIds));
    // The claims need no eviction of their own any more: they are derived from the
    // lines, and the lines have just gone.
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

      case 'line.settled': {
        // Both halves, and both are needed. The line carries its new quantity and
        // its moved indicators, which is what stops a phone in the shop and a phone
        // at home disagreeing without a refetch (backend plan 0047, section 8); the
        // settlement is a row an open history should grow.
        const { line, settlement } = event;
        if (this._lineById(line.id) !== null) {
          this._patch(line.listId, line.id, (current) =>
            this._reconcile(current, line)
          );
        }
        this.recordSettlement(settlement);
        break;
      }

      case 'line.claimChanged': {
        // One event names every line one run took out of this zone (backend plan
        // 0052, section 3.1), so it is a loop rather than a single write.
        for (const ref of event.lines) {
          this.setClaim(ref.listId, ref.lineId, {
            claimed: event.claimed,
            claimedByUserId: event.claimedByUserId,
          });
        }
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

        // Where the sheet has been opened, the comment joins the list and the count
        // follows from its length, so the two cannot disagree. This is the half that
        // was missing before plan 0018: the count moved and an open sheet did not,
        // so somebody watching the conversation saw the number go up and no comment.
        if (this._comments().has(comment.lineId)) {
          this.addComment(comment);
          break;
        }

        const known = this._commentCounts().get(comment.lineId);
        // Incremented only where a count is already known. Starting one at 1 from an
        // event would claim a line with nine comments has one, which is worse than
        // claiming nothing.
        if (known !== undefined) {
          this.recordCommentCount(comment.lineId, known + 1);
        }
        break;
      }

      case 'comment.updated': {
        // A transcript landing on a comment that already exists (backend plan
        // 0045). `addComment` upserts by id, so an open sheet redraws the bubble
        // with its words in it.
        //
        // **No count is touched, in either branch.** The comment was counted when
        // it was added, and a line whose comments were never loaded has nothing to
        // update: incrementing here would make a thread of five voice comments
        // report ten the moment they were transcribed.
        this.addComment(event.comment);
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
      approvalStatus: claims('approvalStatus')
        ? local.approvalStatus
        : incoming.approvalStatus,
      // The two indicators are **never** claimed, and there is nothing to claim them
      // with: no overlay on this screen writes a settlement, so the server's answer
      // is always the newer one. Taking the incoming values by way of the spread is
      // therefore correct, and stating it here is what stops somebody "fixing" it
      // into the pattern above the next time a field is added.
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

  /**
   * Put the server's row where the optimistic one was, whichever arrived first.
   *
   * `_mine` is what stops `line.added` drawing a second row for a line this client
   * added, and it can only be written once the response names an id. On a deployed
   * environment the echo usually gets there **before** that response does: it travels
   * core to NATS to the socket, while the response travels core to the gateway to the
   * proxy to the browser. So the ordinary order in production is the one the claim
   * cannot cover, and the event, finding an id it has never seen, inserts a row beside
   * the pending one. The response then rewrote the client keyed row into that same
   * server row and the list held the id twice, which a `track line.id` renders as two
   * identical items until the next load. Locally the response wins the race, which is
   * why this never showed up in development.
   *
   * So the claim is made order independent here rather than being made earlier:
   * whichever of the two arrives second reconciles the row the first one left, and the
   * list never holds one id twice. The optimistic row's slot is the one kept, so the
   * item does not jump when the response lands.
   */
  private _settleAdd(listId: string, clientKey: string, line: Line): void {
    this._byList.update((current) => {
      const lines = current.get(listId) ?? [];
      const pending = lines.some((existing) => existing.id === clientKey);
      const settled = pending
        ? // Drop the echo where there is one, and let the client keyed row become the
          // server row, so the item stays in the slot the person watched it appear in.
          lines
            .filter((existing) => existing.id !== line.id)
            .map((existing) => (existing.id === clientKey ? line : existing))
        : // No pending row left to settle: either the echo is all there is, and it is
          // refreshed in place, or the list was forgotten while the request was out and
          // nothing is written, which is what `_replace` did here before.
          lines.map((existing) => (existing.id === line.id ? line : existing));

      return new Map(current).set(listId, settled);
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

/**
 * The next cursor of each product's page, keyed by product.
 *
 * Positional, because the pages were fetched with `Promise.all` over the same array
 * and the two therefore line up. Written as its own function so that the pairing is
 * stated once rather than assumed at both call sites.
 */
function cursorsFrom(
  itemIds: readonly string[],
  pages: readonly Page<LineSettlement>[]
): ReadonlyMap<string, string | null> {
  const cursors = new Map<string, string | null>();
  itemIds.forEach((itemId, index) => {
    cursors.set(itemId, pages[index]?.nextCursor ?? null);
  });
  return cursors;
}

/** A copy of `map` with `keys` removed, or `map` itself when it holds none of them. */
function without<T>(
  map: ReadonlyMap<string, T>,
  keys: readonly string[]
): ReadonlyMap<string, T> {
  if (!keys.some((key) => map.has(key))) {
    return map;
  }

  const next = new Map(map);
  for (const key of keys) {
    next.delete(key);
  }
  return next;
}
