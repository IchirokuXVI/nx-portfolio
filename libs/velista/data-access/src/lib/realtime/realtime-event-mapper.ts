import {
  toComment,
  toGeneratedListFromView,
  toLine,
  toLineSettlement,
  toListPermissions,
  toListPresence,
  toMembership,
  toShoppingList,
  toShoppingProfile,
  toZone,
  toZonePresence,
} from '../mapping/mappers';
import {
  isRecord,
  mapArray,
  nullableStr,
  numOr,
  str,
} from '../mapping/primitives';
import type { RealtimeEvent } from './realtime-events';

/**
 * Maps a raw `(name, payload)` off the wire into an event this app owns.
 *
 * Rule D4 applied to realtime (plan 0004, section 6.5). Returns `null` for anything
 * unrecognised or unmappable, and the caller **drops and counts** it rather than
 * writing a half formed record into a store. Nothing here throws: an exception raised
 * inside a socket handler takes down the subscription for every other event too, so
 * one bad payload would cost the user the whole live connection.
 */
export function toRealtimeEvent(
  name: unknown,
  payload: unknown
): RealtimeEvent | null {
  if (typeof name !== 'string') {
    return null;
  }

  switch (name) {
    case 'zone.created': {
      // The same `ZoneView` its three siblings below carry, mapped the same way. It is
      // a separate branch because the event means something else entirely: those patch
      // a zone the store holds, and this one announces a zone it does not.
      const zone = toZone(payload);
      return zone === null ? null : { type: name, zone };
    }

    case 'zone.updated':
    case 'zone.ownershipChanged':
    case 'zone.markedForDeletion': {
      const zone = toZone(payload);
      return zone === null ? null : { type: name, zone };
    }

    case 'zone.deleted': {
      const zoneId = idOf(payload);
      return zoneId === null ? null : { type: name, zoneId };
    }

    case 'zone.countsUpdated': {
      if (!isRecord(payload)) {
        return null;
      }

      const zoneId = str(payload['zoneId']);
      const counts = payload['counts'];
      if (zoneId === null || !isRecord(counts)) {
        return null;
      }

      const pending = counts['pendingRequestCount'];

      return {
        type: name,
        zoneId,
        memberCount: numOr(counts['memberCount'], 0),
        // Null means "you may not see this", not "there are none", so it is carried
        // through rather than collapsed to zero.
        pendingRequestCount:
          typeof pending === 'number' && Number.isFinite(pending)
            ? pending
            : null,
        firstPendingRequesterName: nullableStr(
          counts['firstPendingRequesterName']
        ),
      };
    }

    case 'member.joined':
    case 'member.approved':
    case 'member.kicked':
    case 'member.banned':
    case 'member.roleChanged':
    case 'member.usernameChanged': {
      const membership = toMembership(payload);
      return membership === null ? null : { type: name, membership };
    }

    case 'member.rejected': {
      // Deliberately not a MembershipView, unlike every sibling event.
      if (!isRecord(payload)) {
        return null;
      }
      const membershipId = str(payload['id']);
      const userId = str(payload['userId']);
      return membershipId === null || userId === null
        ? null
        : { type: name, membershipId, userId };
    }

    case 'user.usernameChanged': {
      // Two required strings and nothing else. Not a profile: see the union's own
      // comment for why one must not be invented from this.
      if (!isRecord(payload)) {
        return null;
      }
      const userId = str(payload['userId']);
      const username = str(payload['username']);
      return userId === null || username === null
        ? null
        : { type: name, userId, username };
    }

    case 'list.created':
    case 'list.updated': {
      const list = toShoppingList(payload);
      return list === null ? null : { type: name, list };
    }

    case 'list.deleted': {
      const listId = idOf(payload);
      return listId === null ? null : { type: name, listId };
    }

    case 'list.accessChanged': {
      if (!isRecord(payload)) {
        return null;
      }
      const listId = str(payload['listId']);
      return listId === null ? null : { type: name, listId };
    }

    case 'list.myAccessChanged': {
      if (!isRecord(payload)) {
        return null;
      }

      // Both ids are required, and `zoneId` is required for the same reason `listId` is
      // rather than for tidiness: without it a list this client has never loaded cannot
      // be placed anywhere, and there is no route that would resolve it afterwards.
      const listId = str(payload['listId']);
      const zoneId = str(payload['zoneId']);
      if (listId === null || zoneId === null) {
        return null;
      }

      // An empty set is the payload that says the caller was removed, so it is mapped
      // and delivered rather than treated as a missing field. `toListPermissions` gives
      // the same empty set for an absent or unreadable array, which lands on the same
      // safe answer: no permissions, no controls.
      return {
        type: name,
        listId,
        zoneId,
        permissions: toListPermissions(payload['permissions']),
      };
    }

    case 'line.added':
    case 'line.updated': {
      const line = toLine(payload);
      return line === null ? null : { type: name, line };
    }

    case 'line.settled': {
      if (!isRecord(payload)) {
        return null;
      }
      // Both halves or neither. Half a settle is not something any consumer can act
      // on: a line with no settlement leaves a history stale, and a settlement with
      // no line leaves the row showing a quantity that has moved.
      const line = toLine(payload['line']);
      const settlement = toLineSettlement(payload['settlement']);
      return line === null || settlement === null
        ? null
        : { type: name, line, settlement };
    }

    case 'line.claimChanged': {
      if (!isRecord(payload)) {
        return null;
      }
      const lineId = str(payload['lineId']);
      const claimListId = str(payload['listId']);
      if (lineId === null || claimListId === null) {
        return null;
      }
      // Null is a **release** rather than a missing value, which is what lets one
      // event serve both directions. An absent field reads the same way, and that is
      // the safe direction: an indicator that says somebody is shopping when nobody
      // is would be read as the line having been dealt with.
      return {
        type: name,
        lineId,
        listId: claimListId,
        claimedByUserId: nullableStr(payload['claimedByUserId']),
      };
    }

    case 'line.reordered': {
      if (!isRecord(payload)) {
        return null;
      }
      const listId = str(payload['listId']);
      if (listId === null) {
        return null;
      }
      // A permutation, not a set of rows. An empty one is meaningless and is
      // rejected rather than applied as "the list is now empty".
      const orderedLineIds = mapArray(payload['orderedLineIds'], (id) =>
        str(id)
      );
      return orderedLineIds.length === 0
        ? null
        : { type: name, listId, orderedLineIds };
    }

    case 'line.deleted': {
      if (!isRecord(payload)) {
        return null;
      }
      const lineId = str(payload['id']);
      const listId = str(payload['listId']);
      return lineId === null || listId === null
        ? null
        : { type: name, lineId, listId };
    }

    case 'comment.added':
    case 'comment.updated': {
      const comment = toComment(payload);
      return comment === null ? null : { type: name, comment };
    }

    case 'merge.requested':
    case 'merge.approved':
    case 'merge.rejected': {
      if (!isRecord(payload)) {
        return null;
      }
      const mergeId = str(payload['id']);
      const zoneId = str(payload['zoneId']);
      return mergeId === null || zoneId === null
        ? null
        : { type: name, mergeId, zoneId };
    }

    case 'profiles.changed': {
      if (!isRecord(payload)) {
        return null;
      }

      // `mapArray` drops a profile this build cannot read, which is right here for the
      // reason it is right everywhere: one malformed row must not cost the user the
      // whole list. A payload whose `profiles` is missing altogether yields an empty
      // array, and that is dropped rather than applied: the server never sends one, and
      // applying it would delete every profile on screen on the strength of a body this
      // build could not read.
      const profiles = mapArray(payload['profiles'], toShoppingProfile);
      return profiles.length === 0 ? null : { type: name, profiles };
    }

    case 'generatedList.created':
    case 'generatedList.updated': {
      // The payload is the whole basket and only its summary is kept. A body this
      // build cannot read is dropped and counted rather than applied, which for these
      // two means the card keeps whatever the last read said instead of losing its
      // counts to an unreadable event.
      const list = toGeneratedListFromView(payload);
      return list === null ? null : { type: name, list };
    }

    case 'generatedList.lineSettled': {
      // `generatedListId` and not the line's own id: the line is redacted and the
      // counts cannot be recomputed from it anyway, so what a listener needs is which
      // basket moved.
      if (!isRecord(payload)) {
        return null;
      }
      const settledIn = str(payload['generatedListId']);
      return settledIn === null
        ? null
        : { type: name, generatedListId: settledIn };
    }

    case 'generatedList.deleted': {
      if (!isRecord(payload)) {
        return null;
      }
      const generatedListId = str(payload['id']);
      return generatedListId === null ? null : { type: name, generatedListId };
    }

    case 'presence.zoneUpdated': {
      const presence = toZonePresence(payload);
      return presence === null ? null : { type: name, presence };
    }

    case 'presence.listUpdated': {
      const presence = toListPresence(payload);
      return presence === null ? null : { type: name, presence };
    }

    default:
      // An event a newer backend added. Ignoring it is correct: this build has no
      // handling for it, and guessing at its meaning is worse than missing it.
      return null;
  }
}

function idOf(payload: unknown): string | null {
  return isRecord(payload) ? str(payload['id']) : null;
}
