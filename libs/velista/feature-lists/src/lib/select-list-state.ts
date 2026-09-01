import type {
  Line,
  LineAction,
  LineEditScope,
  LineIndicator,
  LineRowVm,
  LineWriteState,
  ListAbilitiesVm,
  ListHeaderVm,
  ListPageState,
  ListPermission,
  ListViewerVm,
  ShoppingListSummary,
} from '@portfolio/velista/models';

/**
 * What the caller may do on this list, as the server answered it.
 *
 * One field, and that is the whole of plan 0030 section 3. It used to carry a zone role
 * and a flag recording that a write had already been refused, and both were the client
 * re-deriving an authorization answer it had never been given. `myPermissions` rides on
 * every `ListView` now, so the caller is the set they hold and nothing else.
 *
 * `userId` left with them. Nothing in this function asks who the caller is any more: the
 * creator was the one person the client could prove was a writer, and the creator's power
 * became an ordinary access row in backend plan 0036 section 2.5, so their id decides
 * nothing here. The struct survives rather than collapsing into a bare array, because it
 * is the caller half of the input and the next fact about the caller has a place to go.
 */
export interface CallerFacts {
  /**
   * Empty means read only, an absent or unreadable `myPermissions` included.
   *
   * The deliberate inversion of the old optimism (plan 0030, section 3.2). With four
   * permissions there are eight controls to be wrong about, and guessing all of them and
   * correcting each from its own refusal would be a screen that rearranges itself while
   * somebody is using it.
   */
  readonly permissions: readonly ListPermission[];
}

/** Everything `selectListState` needs, and nothing that is not a fact. */
export interface ListStateInput {
  /** The list itself, from `ListStore`'s cache. Undefined on a cold arrival. */
  readonly list: ShoppingListSummary | undefined;
  readonly zoneName: string | null;
  readonly lines: readonly Line[];
  readonly linesState: 'idle' | 'loading' | 'loaded' | 'failed';
  readonly linesComplete: boolean;
  readonly writes: ReadonlyMap<
    string,
    {
      readonly outcome: 'pending' | 'failed' | 'overwritten';
      readonly byUserId: string | null;
    }
  >;
  readonly commentCounts: ReadonlyMap<string, number>;
  /**
   * Which lines are in somebody's active basket, by line id, valued by who.
   *
   * Presence rather than state (section 3.3), and it arrives on a zone event rather
   * than on any read, which is why it is a separate map instead of a field on the line:
   * it appears and disappears while the page is open and nothing derived from it is
   * ever written back.
   */
  readonly claims: ReadonlyMap<string, string>;
  readonly caller: CallerFacts;
  /** Resolves a user id to a name in this zone, or null. */
  readonly nameOf: (userId: string) => string | null;
  readonly reordering: boolean;
  /**
   * Who else has this list open, already resolved and already without the reader.
   *
   * Resolved by the container, as `selectHomeState`'s presence is: the filtering of the
   * caller is a rendering decision, and the name, the role and the arrival time each
   * need a store, while this function is pure so that none of that happens here.
   */
  readonly viewers: readonly ListViewerVm[];
  /**
   * Whoever is editing one line, by line id, or null. Never the reader themselves.
   *
   * `PresenceStore.editorOfLine` is the shape this is: it has existed since `0017` with
   * this comment on it, *"the shape a line row wants"*, and until now no line row called
   * it. Advisory throughout: it changes nothing about what the row does.
   */
  readonly editorOf: (lineId: string) => string | null;
  readonly live: boolean;
  readonly errorKey: string | null;
  readonly correlationId: string | null;
  readonly gone: 'deleted' | 'unshared' | null;
}

/**
 * The whole page, as one value, from facts alone.
 *
 * Pure and exported so the acceptance criteria can be tested without a component, a
 * fixture or a fake clock. Every branch in section 3 is a return from this function,
 * which is what lets a spec assert "a turned down line sorts last" in one line instead
 * of by rendering a page and querying the DOM.
 *
 * `selectGroupState` set this pattern for `0010` and this follows it, with one
 * addition: this one also resolves the **two state machines** of section 3.4 into the
 * handful of things a row actually varies by. That resolution has to happen exactly
 * once, and here is the only place that can be true of.
 */
export function selectListState(input: ListStateInput): ListPageState {
  if (input.gone !== null) {
    return { kind: 'gone', reason: input.gone };
  }

  if (input.errorKey !== null) {
    return {
      kind: 'error',
      messageKey: input.errorKey,
      correlationId: input.correlationId,
    };
  }

  const header = selectHeader(input);

  // The header draws from the cache the moment the caller arrives from the group page,
  // so the common path shows a named list immediately and skeletons only the lines. A
  // cold arrival skeletons the title too and the lines still load (rule L2).
  if (input.linesState === 'idle' || input.linesState === 'loading') {
    return { kind: 'loading', header };
  }

  const abilities = selectAbilities(input.caller.permissions);
  const lines = sortLines(input.lines).map((line) =>
    toRow(line, input, abilities)
  );

  return {
    kind: 'loaded',
    header,
    lines,
    abilities,
    empty: lines.length === 0,
    // Rule L4: dragging is available only once every page has arrived, and never in
    // the middle of somebody reading a long list. Still `canWrite`, because reordering
    // rewrites what the list asks for rather than what the shop had (section 4).
    canReorder: abilities.canWrite && input.linesComplete && lines.length > 1,
    // A list fact rather than an ability, so it is read from the summary and not from
    // the permission set. False while the list itself is still a cold cache miss, which
    // is the safe direction: an optimistic row drawn PENDING and corrected to APPROVED
    // is a row settling down, and the reverse is an approve button flashing (section 5).
    autoApproveLines: input.list?.autoApproveLines ?? false,
  };
}

function selectHeader(input: ListStateInput): ListHeaderVm {
  const { list, lines, linesState } = input;

  // Counted from the lines the page is holding once they are here, because those are
  // optimistic and the counter has to move with the thumb. Before they arrive the
  // cached summary's counts stand in, which is what makes the header useful on the
  // first frame rather than a pair of zeroes.
  const counted = linesState === 'loaded';

  return {
    listName: list?.name ?? null,
    zoneName: input.zoneName,
    // Lines the household still wants, which is `quantity > 0` (backend plan 0047,
    // section 2.3). It counted lines somebody had ticked, and the rename is a change
    // of subject: "four things needed" is the figure a header should have been
    // showing, and "four things already bought" stopped being computable at all.
    wantedCount: counted
      ? lines.filter((line) => line.quantity > 0).length
      : (list?.wantedCount ?? 0),
    lineCount: counted ? lines.length : (list?.lineCount ?? 0),
    viewers: input.viewers,
    live: input.live,
  };
}

/**
 * What the caller may do, as four membership tests on the set the server sent.
 *
 * Nothing is guessed and nothing is inferred, which is the whole change (plan 0030,
 * section 3). Group staff are not special-cased either: a zone `OWNER` or `ADMIN` holds
 * all four permissions on every list in the zone and the server sends them all four
 * (backend plan 0036, section 2.4), so the last place this screen re-derived an
 * authorization rule the server had already applied is gone.
 *
 * **Each boolean is exactly one permission, and `MANAGE` implies none of the others
 * here.** Backend plan 0036's summary table reads as though it did, but its own call
 * site table (section 4) is what the server actually enforces, and there `line.add` asks
 * for `WRITE`, `line.setStatus` for `DECIDE`, and `comment.add` for `WRITE` or `DECIDE`.
 * Widening these booleans would draw a composer for a `{READ, MANAGE}` row and have the
 * server refuse every use of it, which is precisely the failure rule G2 exists to
 * prevent. What `MANAGE` really buys beyond governance is per row rather than per
 * person, and {@link editScopeFor} and {@link actionsFor} are where it is spent.
 *
 * The `MANAGE` column of section 4's table is not contradicted by that: it describes the
 * ordinary list admin, who was granted the other three in the same sheet, and such a
 * caller does get everything in it.
 *
 * Exported because two sheets that open over this page need the same answer from the
 * same list, and a second copy of these four tests is a second answer waiting to
 * disagree with this one.
 */
export function selectAbilities(
  permissions: readonly ListPermission[]
): ListAbilitiesVm {
  const held = new Set(permissions);
  const canWrite = held.has('WRITE');
  const canDecide = held.has('DECIDE');
  const canManage = held.has('MANAGE');

  return {
    canWrite,
    canDecide,
    // The server's rule for `comment.add`, stated once. `MANAGE` is deliberately not in
    // it: governing a list is not the same as being part of the conversation on it, and
    // a list admin who wants to comment holds one of the other two in every real case.
    canComment: canWrite || canDecide,
    canManage,
    // A summary of the three above rather than a fourth fact, so the banner is decided
    // in one place instead of by every surface asking "and none of the others either?".
    readOnly: !canWrite && !canDecide && !canManage,
  };
}

/**
 * Position order, with turned down lines last.
 *
 * A rejected line **stays on the list**: removing it would make somebody's line vanish
 * with no explanation, and the person who wrote it is the one least likely to be
 * looking at the screen when it happens. So it goes quiet and it sorts last, which is
 * the same argument `0010` made for a rejected membership (section 3.4).
 */
function sortLines(lines: readonly Line[]): readonly Line[] {
  return [...lines].sort((a, b) => {
    const rejected =
      Number(a.approvalStatus === 'REJECTED') -
      Number(b.approvalStatus === 'REJECTED');
    return rejected !== 0 ? rejected : a.position - b.position;
  });
}

function toRow(
  line: Line,
  input: ListStateInput,
  abilities: ListAbilitiesVm
): LineRowVm {
  const note = input.writes.get(line.id) ?? null;
  const write: LineWriteState = note?.outcome ?? 'none';

  const awaiting = line.approvalStatus === 'PENDING';
  const rejected = line.approvalStatus === 'REJECTED';
  const claimedBy = input.claims.get(line.id) ?? null;

  return {
    id: line.id,
    content: line.content,
    quantity: line.quantity,
    approvalStatus: line.approvalStatus,
    settled: isSettled(line),
    indicators: indicatorsFor(line, claimedBy),
    // A name and not an id: the row says nothing rather than naming a stranger.
    claimedBy: claimedBy === null ? null : input.nameOf(claimedBy),
    captionKey: captionKeyFor(awaiting, rejected),
    write,
    overwrittenBy:
      note?.byUserId === null || note?.byUserId === undefined
        ? null
        : input.nameOf(note.byUserId),
    commentCount: input.commentCounts.get(line.id),
    // **Everybody who can see the row can open it**, which is the change (velista plan
    // 0043, section 5.1). The tap used to be the tick, so it followed `DECIDE` and a
    // reader's rows sat there not answering; it opens what the app knows about the
    // thing now, and knowing is not a permission. False only in reorder mode, where
    // every row is a thing being dragged rather than a thing being read.
    interactive: !input.reordering,
    // The reel is the half that still follows `DECIDE`, because moving the number is
    // saying what the household now has. The two came apart here for the first time,
    // and a `WRITE` only caller is why: they get a full composer, a row that opens, and
    // a number that does not move, with one caption at the top of the page saying who
    // does the buying rather than each row refusing in turn (section 7).
    adjustable: abilities.canDecide && !input.reordering,
    actions: actionsFor(line, abilities, input.reordering),
    // Both from the same expression as the `edit` entry above, so the invariant
    // `LineRowVm.editScope` states cannot be broken from one side.
    editScope: input.reordering ? null : editScopeFor(line, abilities),
    decidable: abilities.canDecide && awaiting && !input.reordering,
    restorable: abilities.canDecide && rejected && !input.reordering,
    // Nobody is shown as editing while the list is being reordered: the sheet cannot be
    // opened from a row in that mode, so an indicator there would be about a screen the
    // reader cannot see. Advisory either way, and it locks nothing (section 3).
    editor: input.reordering ? null : input.editorOf(line.id),
  };
}

/**
 * Whether a line is settled: at zero, **with a purchase on record**.
 *
 * The count is the whole of it, and it is why backend plan 0047 section 5 says "at
 * least once" rather than testing the quantity alone. A line somebody typed and has
 * never needed is at zero too, and it has not been bought, it has simply never been
 * wanted yet. The two are drawn differently on purpose (section 3.2) and nothing else
 * on the line can tell them apart.
 */
function isSettled(line: Line): boolean {
  return line.quantity === 0 && line.boughtCount > 0;
}

/**
 * The indicators this row carries, in the order they are drawn (section 3.3).
 *
 * A **list**, because a row can carry more than one at once: a loaf that was missing
 * last week, is wanted again, and is in somebody's basket right now shows two of them.
 * That is the case a single value could not express, and it is the ordinary case rather
 * than a corner.
 *
 * Empty on an ordinary row and empty on the never wanted one, which is the point of
 * {@link isSettled}: there is nothing to report about a thing nobody has needed yet.
 *
 * The order is bought, then missing, then claimed: two facts about the record and then
 * the one live thing, so a row reads as history followed by news rather than the other
 * way round.
 */
function indicatorsFor(
  line: Line,
  claimedByUserId: string | null
): readonly LineIndicator[] {
  const indicators: LineIndicator[] = [];

  if (isSettled(line)) {
    indicators.push('bought');
  }

  // The **most recent** settlement and not a flag, which is why it can be true of a
  // line that is emphatically still wanted: "they did not have it" is a fact about the
  // last trip and it expires the moment somebody does buy it.
  if (line.lastSettlementOutcome === 'NOT_AVAILABLE') {
    indicators.push('notAvailable');
  }

  // The only one that comes from outside the list, and the only one that is presence
  // rather than state. It must never be mistaken for the line having been dealt with,
  // which is why it is last and why it is drawn as a live dot rather than a mark.
  if (claimedByUserId !== null) {
    indicators.push('claimed');
  }

  return indicators;
}

/**
 * The caption, or null.
 *
 * **Two** things produce one now, where `0012` had three. "Not in the shop" left, and
 * it is not a loss: it became an indicator, which is what lets it appear beside
 * "somebody is buying this" on the same row. A caption is one line of text and cannot
 * say two things at once (section 3.3).
 *
 * An ordinary row still never grows a second line.
 */
function captionKeyFor(awaiting: boolean, rejected: boolean): string | null {
  if (awaiting) {
    return 'list.line.awaitingApproval';
  }
  if (rejected) {
    return 'list.line.rejected';
  }

  return null;
}

/**
 * Which fields the edit sheet may make live on this row, or null for no edit at all.
 *
 * A function of the caller's permissions **and** the line's approval together, which is
 * the point of deriving it per row (plan 0030, section 4): a `MANAGE` holder gets the
 * full sheet on every row, while a caller holding only `DECIDE` gets no edit on a
 * pending row and the quantity stepper on an approved one. Writing those two answers
 * down separately is how they end up disagreeing.
 *
 * The three cases mirror backend plan 0036 section 4.1 exactly, in the order the server
 * checks them:
 *
 * - `MANAGE` may edit any field of any line, because a governed thing needs somebody who
 *   can fix a line that was approved with a typo in it;
 * - `WRITE` may edit a `PENDING` or `REJECTED` line and never an `APPROVED` one, so a
 *   writer cannot quietly change what the group agreed to;
 * - `DECIDE` may change the quantity of an `APPROVED` line and nothing else, which is
 *   the single field a person in the aisle learns that the list did not know.
 *
 * A `DECIDE` holder who needs more than the number still has a way through and it is not
 * this sheet: `DECIDE` puts a line back to `PENDING`, so un-approve, edit, approve reads
 * correctly and leaves the approval saying what happened.
 *
 * Exported for the edit sheet, which is a routed child and has to reach the same answer
 * about the same row without the page handing it down.
 */
export function editScopeFor(
  line: Line,
  abilities: ListAbilitiesVm
): LineEditScope | null {
  const approved = line.approvalStatus === 'APPROVED';

  if (abilities.canManage) {
    return 'full';
  }

  if (!approved && abilities.canWrite) {
    return 'full';
  }

  return approved && abilities.canDecide ? 'quantity' : null;
}

/**
 * What the overflow holds for this row.
 *
 * Empty means no overflow button at all, not a disabled one, exactly as
 * `MemberRowVm.actions` decided it: a disabled control says "you could do this, later"
 * about something that will never be permitted.
 *
 * **A read-only caller still gets `['comments']`**, and that is a deliberate reading of
 * plan 0030. Its section 3.1 says the sheet "opens for everybody with `READ` and draws
 * its composer only for `canComment`, with the read-only note in its place", and the
 * overflow is the only way into that sheet, so removing the entry would take away the
 * reading of a conversation the same passage says a reader keeps. Acceptance item 1's
 * "no overflow on any row" cannot hold at the same time as that sentence, and the
 * reasoned passage wins over the checklist line.
 *
 * **`markNotAvailable` and `markPending` are gone**, and that is velista plan 0043
 * section 1.1 rather than an omission. Saying the shop did not have something is a
 * thing you say afterwards, deliberately, from the detail sheet, and there is no
 * pending trip state left to put a line back to. The row has no marking control of any
 * kind, which is the distinction the whole plan draws.
 */
function actionsFor(
  line: Line,
  abilities: ListAbilitiesVm,
  reordering: boolean
): readonly LineAction[] {
  if (reordering) {
    return [];
  }

  const actions: LineAction[] = [];

  if (editScopeFor(line, abilities) !== null) {
    actions.push('edit');
  }

  actions.push('comments');

  // `WRITE` deletes what has not been agreed to yet; `MANAGE` deletes anything at all,
  // including an approved line that should never have existed (backend plan 0036,
  // section 4.1). There is no third case, and `DECIDE` is deliberately not one: a
  // decider drags the number to zero, which keeps the line and everything it knows
  // about itself. Deleting is the only thing that discards a history (section 5.3).
  if (
    abilities.canManage ||
    (abilities.canWrite && line.approvalStatus !== 'APPROVED')
  ) {
    actions.push('delete');
  }

  return actions;
}
