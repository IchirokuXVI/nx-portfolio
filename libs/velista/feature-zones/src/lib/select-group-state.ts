import type {
  GroupHeaderVm,
  GroupState,
  ListRowVm,
  MyZone,
  ShoppingListSummary,
} from '@portfolio/velista/models';

/**
 * Chooses which of the group page's states to render.
 *
 * A **pure function**, not a method, for `selectHomeState`'s reason: `0010`'s
 * acceptance criteria turn on which state appears for which combination of role,
 * status, counts and lists, and a pure function is the cheapest thing in the world to
 * test exhaustively. The container calls it from one `computed` and the template
 * renders whatever comes back.
 *
 * A discriminated union rather than a handful of booleans, so the page cannot render
 * two states at once. Independent flags always eventually do.
 */
export function selectGroupState(input: {
  /** The zone from the cache, or undefined when it has not been loaded yet. */
  readonly zone: MyZone | undefined;
  readonly zoneState: 'idle' | 'loading' | 'loaded' | 'failed';
  readonly lists: readonly ShoppingListSummary[];
  readonly listsState: 'idle' | 'loading' | 'loaded' | 'failed';
  readonly correlationId: string | null;
  /** Whether this zone's realtime room was refused, so the page is not live. */
  readonly stale: boolean;
}): GroupState {
  const { zone, zoneState, lists, listsState, correlationId, stale } = input;

  if (zone === undefined) {
    // Nothing to draw yet. `failed` here is a genuine dead end: there is no cached
    // header to fall back on, so the error panel is the whole screen.
    return zoneState === 'failed'
      ? { kind: 'error', correlationId }
      : { kind: 'loading', header: null };
  }

  const header = toHeader(zone, stale);

  // Decided **before** any request is made. Core answers `forbidden` to both the lists
  // and the members for a caller who is not APPROVED, and firing two requests in order
  // to be refused twice is how somebody ends up reading an error panel about a
  // situation that is not an error (section 3.3).
  if (zone.myStatus !== 'APPROVED') {
    return { kind: 'pending', header };
  }

  // The group's owner deleted their account. Only an ADMIN may take it on, and this is
  // the only screen in the product that offers it (section 3.5).
  if (zone.status === 'MARKED_FOR_DELETION') {
    return { kind: 'ownerless', header, canClaim: zone.myRole === 'ADMIN' };
  }

  if (listsState === 'failed') {
    return { kind: 'error', correlationId };
  }

  // The header is already correct, drawn from the cache, so only the rows are missing.
  // `idle` counts as loading: it is the instant before the container starts the load,
  // and rendering "no lists yet" in it would flash an empty state at every visit.
  if (listsState === 'idle' || listsState === 'loading') {
    return { kind: 'loading', header };
  }

  if (lists.length === 0) {
    return { kind: 'empty', header, reason: emptyReason(zone) };
  }

  return { kind: 'loaded', header, lists: lists.map(toListRow) };
}

/**
 * Which kind of empty this is, and the one heuristic in the plan that says so out loud.
 *
 * `counts.listCount` cannot separate the two: it is filtered per caller, so it is zero
 * in both cases. `counts.memberCount` can, roughly. A group with one member and no
 * lists is genuinely empty; a group with several members and no readable lists is far
 * more likely to be one where nothing has been shared with this person yet.
 *
 * It is a heuristic and it is wrong for a group of four who genuinely have no lists,
 * who are told to ask somebody. That is the direction to be wrong in: it errs towards
 * asking, which is harmless, instead of towards telling somebody a populated group is
 * empty, which is false and faintly insulting. Section 5.8 records the `hasLists`
 * boolean that would replace this with a fact.
 */
function emptyReason(zone: MyZone): 'no-lists' | 'no-access' {
  return zone.counts.memberCount > 1 ? 'no-access' : 'no-lists';
}

function toHeader(zone: MyZone, stale: boolean): GroupHeaderVm {
  const staff = zone.myRole === 'OWNER' || zone.myRole === 'ADMIN';

  return {
    id: zone.id,
    name: zone.name,
    initial: initialOf(zone.name),
    role: zone.myRole,
    memberCount: zone.counts.memberCount,
    joinCode: zone.joinCode,
    // **Rule G2.** Both of these come from `myRole` and from nothing else. The
    // count below is kept separately and decides only whether a number is drawn,
    // because the two update from different events and a stale count would leave a
    // control on screen for somebody no longer allowed to press it (section 4.3).
    isStaff: staff,
    isOwner: zone.myRole === 'OWNER',
    pendingRequestCount: zone.counts.pendingRequestCount,
    stale,
  };
}

function toListRow(list: ShoppingListSummary): ListRowVm {
  return {
    id: list.id,
    name: list.name,
    lineCount: list.lineCount,
    readyCount: list.readyCount,
  };
}

/**
 * The letter in the tile.
 *
 * Iterated as code points rather than sliced, because slicing cuts a surrogate pair in
 * half and a group named with an emoji would render the replacement character. The same
 * function `selectHomeState` uses, duplicated rather than shared: it is four lines, and
 * the alternative is a utility library that exists to hold one of them.
 */
function initialOf(name: string): string {
  const trimmed = name.trim();
  if (trimmed === '') {
    return '';
  }

  return (Array.from(trimmed)[0] ?? '').toLocaleUpperCase();
}
