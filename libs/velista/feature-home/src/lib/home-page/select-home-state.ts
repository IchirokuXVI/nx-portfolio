import type {
  GeneratedListSummary,
  HomeState,
  Identity,
  ListRowVm,
  MyZone,
  ShoppingListCardVm,
  ZoneCardVm,
} from '@portfolio/velista/models';

/**
 * Chooses which of the home page's states to render.
 *
 * A **pure function**, not a method, because `0003`'s acceptance criteria require unit
 * tests over the state selection logic and a pure function is the cheapest thing in
 * the world to test exhaustively. The container calls it from one `computed` and the
 * template renders whatever comes back (plan 0004, section 2.3).
 *
 * A discriminated union rather than a set of booleans, so the page cannot render two
 * states at once. Independent flags always eventually do.
 */
/**
 * Who the dashboard is for.
 *
 * Narrowed from `Identity` deliberately: `authenticatedGuard` establishes before this
 * page is created that somebody is signed in, so an anonymous caller is not a case to
 * handle here, it is a call that should not have been made. The type is what says so.
 */
type AuthenticatedIdentity = Exclude<Identity, { kind: 'anonymous' }>;

export function selectHomeState(input: {
  identity: AuthenticatedIdentity;
  zones: readonly MyZone[];
  loadState: 'idle' | 'loading' | 'loaded' | 'failed';
  correlationId: string | null;
  /**
   * The caller's `ACTIVE` baskets, newest first (plan 0045, section 3.2).
   *
   * Already filtered to `ACTIVE` by the container, because "which of the four statuses
   * belongs on the dashboard" is a question about the data and this function's job is
   * choosing what to draw. Empty is the ordinary answer and the section is absent.
   */
  activeShoppingLists: readonly GeneratedListSummary[];
  /**
   * The display name per basket id, from `displayNames`.
   *
   * Resolved by the container and handed down, for `zoneOnline`'s reason exactly: an
   * unnamed basket shows its **localized** generation date, so naming one needs a
   * locale and a formatter, and this function is pure precisely so it needs neither.
   * It also cannot be done per row, since a second unnamed basket on the same day is
   * numbered against the first.
   */
  shoppingListNames: ReadonlyMap<string, string>;
  /**
   * Who is online in a zone, already named and already without the reader.
   *
   * A function rather than a map, as `selectListState` takes `nameOf`: the container
   * resolves it, for `shoppingListNames`' reason exactly, and this function stays pure and
   * stays testable without a fixture.
   *
   * Zone presence costs nothing to have. The server computes it from who holds the zone
   * room and `ZoneStore` already holds one per zone, so it has been arriving for every
   * card on this page since `0017` with nothing reading it (plan 0022, section 3.1).
   */
  zoneOnline: (zoneId: string) => readonly string[];
  /**
   * Who is shopping a list, already named and already without the reader.
   *
   * Filled for a list this client has never opened, now that backend `0032` broadcasts
   * a group's list presence to the group's members. Nothing here was conditional on
   * that: the rows simply started having somebody to draw (plan 0022, section 3.3).
   *
   * What it did need was the container asking for the names, since a viewer whose name
   * will not resolve is dropped rather than drawn. See the `MemberNames.ensure` effect
   * in `HomePage`, which now counts a list viewer as somebody being here.
   */
  listViewers: (listId: string) => readonly string[];
  /** Whether the guest has dismissed the banner in this session. */
  guestBannerDismissed: boolean;
}): HomeState {
  const { identity, zones, loadState, correlationId } = input;

  // There used to be an anonymous branch here, checked first so that a stale load state
  // from a previous session could never show a signed-in shape to somebody who is not
  // signed in. `authenticatedGuard` does that job now, and does it strictly better: it
  // runs before the page is created, so it also stops the container's constructor from
  // firing a request on behalf of a user who is not there (plan 0007, section 4.3).
  if (loadState === 'failed') {
    return { kind: 'error', correlationId };
  }

  // `idle` counts as loading: the container starts the load in its constructor, so
  // idle is the instant before that happens and rendering "no groups yet" in it would
  // flash an empty state at every returning user.
  if (loadState === 'idle' || loadState === 'loading') {
    return { kind: 'loading' };
  }

  const guest = identity.kind === 'TEMPORARY' && !input.guestBannerDismissed;

  if (zones.length === 0) {
    return { kind: 'empty', guest };
  }

  return {
    kind: 'populated',
    shoppingList: selectShoppingList(
      input.activeShoppingLists,
      input.shoppingListNames
    ),
    zones: zones.map((zone) =>
      toZoneCard(zone, input.zoneOnline, input.listViewers)
    ),
    guest,
  };
}

/**
 * The basket on the dashboard, which is the most recently generated `ACTIVE` one.
 *
 * Plan 0045 section 3.2. Several can be `ACTIVE` at once, which happens when somebody
 * generates a second run before finishing the first, and the card shows the newest with
 * a quiet count of the others. It does not try to guess which one the person means: the
 * "and N more" line goes to the history, where all of them are, and picking is a tap
 * rather than a heuristic that would be wrong for somebody.
 *
 * Returns null for an empty list, and null is drawn as **nothing at all** rather than
 * as an empty card. That is the difference this card has over the resume card it
 * replaced: there is no stale case to defend against, so there is no card to suppress.
 *
 * The names arrive resolved. See {@link displayNames} for why they cannot be built here
 * one at a time.
 */
function selectShoppingList(
  active: readonly GeneratedListSummary[],
  names: ReadonlyMap<string, string>
): ShoppingListCardVm | null {
  const newest = active[0];
  if (newest === undefined) {
    return null;
  }

  return {
    id: newest.id,
    // The map is built from the same listing, so a miss means the container filtered
    // and named two different sets. The id is a poor name and a visible one, which is
    // the right failure: silently drawing an empty title would hide it.
    name: names.get(newest.id) ?? newest.id,
    generatedAt: newest.generatedAt,
    lineCount: newest.lineCount,
    settledLineCount: newest.settledLineCount,
    otherActiveCount: active.length - 1,
  };
}

function toZoneCard(
  zone: MyZone,
  zoneOnline: (zoneId: string) => readonly string[],
  listViewers: (listId: string) => readonly string[]
): ZoneCardVm {
  const pending = zone.myStatus === 'PENDING';
  const active = zone.status === 'ACTIVE';
  const { counts } = zone;

  return {
    id: zone.id,
    name: zone.name,
    initial: initialOf(zone.name),
    role: zone.myRole,
    membership: zone.myStatus,
    memberCount: counts.memberCount,
    listCount: counts.listCount,
    lists: pending
      ? []
      : zone.lists.map((list) => toListRow(list, listViewers(list.id))),

    // Drawn only when somebody **else** is there, and never as a zero: presence under
    // reports, so a zero is the one number it must not assert (plan 0022, section 5).
    // A pending membership sees nobody, for the reason its lists are empty: it is
    // waiting outside the group rather than looking into it.
    online: pending ? [] : zoneOnline(zone.id),

    // `pendingRequestCount` is non-null only for a caller the backend considers
    // staff, so **the value is the permission** and nothing here re-derives it from
    // a role. That also means the two can never disagree, which they could while the
    // frontend was deciding for itself.
    ...(counts.pendingRequestCount !== null && counts.pendingRequestCount > 0
      ? {
          joinRequests: {
            firstName: counts.firstPendingRequesterName ?? '',
            // Excludes the person already named (plan 0003, section 4.1).
            othersCount: Math.max(0, counts.pendingRequestCount - 1),
          },
        }
      : {}),

    // Not tappable while the membership is pending, and not tappable for a zone that
    // is being torn down or carries a status this build does not recognise. Plan 0003
    // open question 2 asks only that the page not break on the latter.
    tappable: !pending && active,

    ...(pending ? { waitingOn: '' } : {}),
  };
}

function toListRow(
  list: {
    id: string;
    name: string;
    lineCount?: number;
    wantedCount?: number;
  },
  viewers: readonly string[]
): ListRowVm {
  return {
    id: list.id,
    name: list.name,
    lineCount: list.lineCount,
    wantedCount: list.wantedCount,
    viewers,
  };
}

/**
 * The letter in the tile.
 *
 * Iterated as code points rather than `slice(0, 1)`, because slicing a string cuts a
 * surrogate pair in half: a group named with an emoji would render the replacement
 * character. `Array.from` splits on code points, which is right for every script the
 * app ships and for an emoji that is a single code point.
 *
 * Not `Intl.Segmenter`, which would also handle a multi-code-point emoji correctly but
 * is not in this project's TypeScript lib target.
 */
function initialOf(name: string): string {
  const trimmed = name.trim();
  if (trimmed === '') {
    return '';
  }

  return (Array.from(trimmed)[0] ?? '').toLocaleUpperCase();
}
