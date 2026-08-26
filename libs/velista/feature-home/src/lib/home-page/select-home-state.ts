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
export function selectHomeState(input: {
  identity: Identity;
  zones: readonly MyZone[];
  loadState: 'idle' | 'loading' | 'loaded' | 'failed';
  correlationId: string | null;
  resumeListId: string | null;
  /** Whether the guest has dismissed the banner in this session. */
  guestBannerDismissed: boolean;
}): HomeState {
  const { identity, zones, loadState, correlationId, resumeListId } = input;

  // Anonymous is a designed screen, not a signed-out fallback. It is checked first so
  // a stale load state from a previous session can never show a signed-in shape to
  // somebody who is not signed in.
  if (identity.kind === 'anonymous') {
    return { kind: 'anonymous' };
  }

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
    resume: selectResume(zones, resumeListId),
    zones: zones.map(toZoneCard),
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
  resumeListId: string | null
): ResumeListVm | null {
  if (resumeListId === null) {
    return null;
  }

  for (const zone of zones) {
    const list = zone.summary?.lists.find((entry) => entry.id === resumeListId);
    if (list !== undefined) {
      return {
        listId: list.id,
        listName: list.name,
        zoneName: zone.name,
        lineCount: list.lineCount,
        readyCount: list.readyCount,
        // Presence arrives over realtime and is advisory (plan 0004, section 6.7).
        // Nothing has joined it to a list yet, so the card renders without it.
        shoppers: [],
      };
    }
  }

  return null;
}

function toZoneCard(zone: MyZone): ZoneCardVm {
  const pending = zone.myStatus === 'PENDING';
  const active = zone.status === 'ACTIVE';
  const summary = zone.summary;

  return {
    id: zone.id,
    name: zone.name,
    initial: initialOf(zone.name),
    role: zone.myRole,
    membership: zone.myStatus,
    memberCount: summary?.memberCount,
    listCount: summary?.listCount,
    lists: pending ? [] : (summary?.lists.map(toListRow) ?? []),

    // The attention row is only ever built for somebody who can act on it, so its
    // presence in the view model already implies the permission and the template
    // never has to re-check a role.
    ...(canReview(zone) && summary && summary.pendingRequestCount > 0
      ? {
          joinRequests: {
            firstName: summary.firstPendingRequesterName ?? '',
            // Excludes the person already named (plan 0003, section 4.1).
            othersCount: Math.max(0, summary.pendingRequestCount - 1),
          },
        }
      : {}),

    // Not tappable while the membership is pending, and not tappable for a zone that
    // is being torn down or carries a status this build does not recognise. Plan 0003
    // open question 2 asks only that the page not break on the latter.
    tappable: !pending && active,

    ...(pending ? { waitingOn: ownerNameFor(zone) } : {}),
  };
}

function toListRow(list: {
  id: string;
  name: string;
  lineCount?: number;
  readyCount?: number;
}): ListRowVm {
  return {
    id: list.id,
    name: list.name,
    lineCount: list.lineCount,
    readyCount: list.readyCount,
  };
}

function canReview(zone: MyZone): boolean {
  return (
    zone.myStatus === 'APPROVED' &&
    (zone.myRole === 'OWNER' || zone.myRole === 'ADMIN')
  );
}

/**
 * The name shown in "Waiting for {name} to let you in".
 *
 * There is no endpoint that lists a zone's members and no profile endpoint, so the
 * owner's **name** is not available to a pending member: `ownerUserId` is an id, and
 * printing an id at somebody is worse than being vague. An empty string lets the
 * translation fall back to a phrasing that names nobody.
 */
function ownerNameFor(_zone: MyZone): string {
  return '';
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
