import type {
  HomeState,
  Identity,
  ListRowVm,
  MyZone,
  ResumeListVm,
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
  resumeListId: string | null;
  /**
   * Who else is looking at the resume list right now, already named and already
   * without the reader (plan 0017, section 7).
   *
   * Names rather than ids, and resolved by the container: a presence payload carries a
   * user id and nothing else, and the only place the API pairs an id with a name is a
   * membership, which makes a name a fact about a **zone** rather than about a person.
   * Resolving it here would need this function to know about `MemberNames`, and it is
   * pure precisely so it does not know about anything.
   */
  resumeShoppers: readonly string[];
  /**
   * Who is online in a zone, already named and already without the reader.
   *
   * A function rather than a map, as `selectListState` takes `nameOf`: the container
   * resolves it, for `resumeShoppers`' reason exactly, and this function stays pure and
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
  const { identity, zones, loadState, correlationId, resumeListId } = input;

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
    resume: selectResume(zones, resumeListId, input.resumeShoppers),
    zones: zones.map((zone) =>
      toZoneCard(zone, input.zoneOnline, input.listViewers)
    ),
    guest,
  };
}

/**
 * The resume card, resolved from a list id the **device** remembered.
 *
 * Plan 0003 section 5.2 chose this over server-side "most recent" state: it works
 * without a round trip, and it is per device, which is arguably more correct than a
 * server value that would fight between somebody's phone and their tablet.
 *
 * Returns null when the remembered list is not in any zone the caller still belongs
 * to, which happens after being removed from a group. Offering a card that leads to a
 * 403 is worse than offering none.
 */
function selectResume(
  zones: readonly MyZone[],
  resumeListId: string | null,
  shoppers: readonly string[]
): ResumeListVm | null {
  if (resumeListId === null) {
    return null;
  }

  // `zoneId/listId` since plan 0012, because the list route needs both and there is no
  // `GET /v1/lists/:id` to resolve an id on its own (section 4.1). A value with no
  // separator was written by a build before that change: it is a list id with no zone,
  // and rather than guessing one, the card simply does not render. That is a missing
  // card once, on one device, and it is replaced the next time a list is opened.
  const separator = resumeListId.indexOf('/');
  if (separator < 0) {
    return null;
  }

  const zoneId = resumeListId.slice(0, separator);
  const listId = resumeListId.slice(separator + 1);

  for (const zone of zones) {
    if (zone.id !== zoneId) {
      continue;
    }

    const list = zone.lists.find((entry) => entry.id === listId);
    if (list !== undefined) {
      return {
        listId: list.id,
        zoneId: zone.id,
        listName: list.name,
        zoneName: zone.name,
        lineCount: list.lineCount,
        wantedCount: list.wantedCount,
        // Advisory, and it may be empty for two different reasons that render the
        // same: nobody else is there, or nobody's name resolved (plan 0004, section
        // 6.7). The card simply omits the row, which is the right answer to both.
        shoppers,
      };
    }
  }

  return null;
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
