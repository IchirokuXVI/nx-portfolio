import type {
  Line,
  LineAction,
  LineRowVm,
  LineWriteState,
  ListAbilitiesVm,
  ListHeaderVm,
  ListPageState,
  ListViewerVm,
  ShoppingListSummary,
} from '@portfolio/velista/models';

/** What a caller is, as far as the zone is concerned. */
export interface CallerFacts {
  readonly userId: string;
  /** OWNER or ADMIN of the zone this list is in. */
  readonly isStaff: boolean;
  /** Whether a write has already been refused, which makes read only certain. */
  readonly knownReader: boolean;
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

  const abilities = selectAbilities(input);
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
    // the middle of somebody reading a long list.
    canReorder: abilities.canWrite && input.linesComplete && lines.length > 1,
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
    readyCount: counted
      ? lines.filter((line) => line.status === 'READY').length
      : (list?.readyCount ?? 0),
    lineCount: counted ? lines.length : (list?.lineCount ?? 0),
    viewers: input.viewers,
    live: input.live,
  };
}

/**
 * What the caller may do.
 *
 * The write answer is **optimistic where it is unknown**, and that needs saying
 * plainly. `ListView` carries no role for the caller and there is no
 * `GET /v1/lists/:id/access`, so the only person the client can know is a writer is the
 * one who created the list: creating one inserts a WRITER row in the same transaction.
 *
 * Everybody else is offered the composer until a write is actually refused, at which
 * point `knownReader` is set and the page switches to read only in place with the copy
 * section 5.7 gives it. The alternative, hiding the composer from everybody unproven,
 * would take the screen away from the people who use it in order to spare a rare reader
 * one refused request.
 *
 * Managing is a **different rule** and is knowable: `requireManage` is the creator, a
 * zone admin, or the owner, and all three are facts the client already holds.
 */
function selectAbilities(input: ListStateInput): ListAbilitiesVm {
  const { list, caller } = input;
  const isCreator = list?.createdByUserId === caller.userId;

  return {
    canWrite: !caller.knownReader,
    knownReader: caller.knownReader,
    canManage: isCreator || caller.isStaff,
    canDecide: caller.isStaff,
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
  const unavailable = line.status === 'NOT_AVAILABLE';

  return {
    id: line.id,
    content: line.content,
    quantity: line.quantity,
    status: line.status,
    approvalStatus: line.approvalStatus,
    // Three unrelated things strike a row through, and only one of them is a tick.
    struck: line.status === 'READY' || unavailable || rejected,
    captionKey: captionKeyFor(awaiting, rejected, unavailable),
    write,
    overwrittenBy:
      note?.byUserId === null || note?.byUserId === undefined
        ? null
        : input.nameOf(note.byUserId),
    commentCount: input.commentCounts.get(line.id),
    // In reorder mode nothing is a checkbox, and a reader's rows are never tappable.
    interactive: abilities.canWrite && !input.reordering,
    actions: actionsFor(line, abilities, input.reordering),
    decidable: abilities.canDecide && awaiting && !input.reordering,
    restorable: abilities.canDecide && rejected && !input.reordering,
    // Nobody is shown as editing while the list is being reordered: the sheet cannot be
    // opened from a row in that mode, so an indicator there would be about a screen the
    // reader cannot see. Advisory either way, and it locks nothing (section 3).
    editor: input.reordering ? null : input.editorOf(line.id),
  };
}

/**
 * The caption, or null.
 *
 * Exactly three things produce one and an ordinary row never grows a second line
 * (section 4.7). Approval is checked before item status because a line nobody has
 * agreed to is a more urgent thing to say than a shop not having it.
 */
function captionKeyFor(
  awaiting: boolean,
  rejected: boolean,
  unavailable: boolean
): string | null {
  if (awaiting) {
    return 'list.line.awaitingApproval';
  }
  if (rejected) {
    return 'list.line.rejected';
  }
  if (unavailable) {
    return 'list.line.notAvailable';
  }

  return null;
}

/**
 * What the overflow holds for this row.
 *
 * Empty means no overflow button at all, not a disabled one. A reader gets exactly one
 * entry, comments, because commenting requires only an approved membership on the zone
 * and is the one thing they can actually do (section 3.2).
 */
function actionsFor(
  line: Line,
  abilities: ListAbilitiesVm,
  reordering: boolean
): readonly LineAction[] {
  if (reordering) {
    return [];
  }

  if (!abilities.canWrite) {
    return ['comments'];
  }

  return [
    'edit',
    // The two are one control with two directions: a line that is already marked as
    // missing offers putting it back, and one that is not offers marking it.
    line.status === 'NOT_AVAILABLE' ? 'markPending' : 'markNotAvailable',
    'comments',
    'delete',
  ];
}
