import {
  toComment,
  toLine,
  toListPresence,
  toMembership,
  toShoppingList,
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
    case 'member.roleChanged': {
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

    case 'line.added':
    case 'line.updated': {
      const line = toLine(payload);
      return line === null ? null : { type: name, line };
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

    case 'comment.added': {
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
