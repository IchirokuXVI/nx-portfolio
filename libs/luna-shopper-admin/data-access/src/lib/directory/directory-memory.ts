import { inject, Injectable } from '@angular/core';
import {
  compositeId,
  type ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import { ResourceMemoryGateways } from '../resource/resource-memory';
import {
  ADMIN_LIST_LINES_PATH,
  ADMIN_LISTS_PATH,
  ADMIN_USERS_PATH,
  ADMIN_ZONE_MEMBERS_PATH,
  ADMIN_ZONES_PATH,
  LIST_LINE_KEY,
  MEMBERSHIP_KEY,
} from './directory-paths';
import type { DirectoryServiceI, LineApproval } from './directory-service';

/** A join code, in the shape the real one has. */
const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const JOIN_CODE_LENGTH = 8;

/**
 * The named actions, with nothing listening (plan 0007, section 1).
 *
 * Every data domain in this workspace ships an in-memory implementation so the
 * app runs and every spec passes with no backend, and this is that one. It acts
 * on the same tables {@link ResourceMemoryGateways} serves the listings from, so
 * deleting a user in this mode really does take the row off the list. That is
 * the whole reason it mutates anything: a demo where the confirmation succeeds
 * and the row stays is a demo of the wrong thing.
 *
 * What it deliberately does **not** imitate is the cascade. Deleting an account
 * really runs `account-deletion.service` across three databases, and a memory
 * copy of that would be a second implementation of the rule, with its own bugs,
 * asserted by nothing.
 *
 * **A membership lives in two tables here and one row on the server.** The
 * gateway answers a zone's whole membership inside the zone's detail read *and*
 * serves `/zones/{id}/members` as a collection, and in this mode those are two
 * tables. So a status change writes both, and the mirror is written with
 * {@link _mirror}, which lets a missing row pass: the zone's own array is the
 * authoritative one, and an action must not fail because a spec seeded only it.
 */
@Injectable({ providedIn: 'root' })
export class DirectoryMemory implements DirectoryServiceI {
  private readonly _gateways = inject(ResourceMemoryGateways);

  async deleteUser(userId: string): Promise<void> {
    await this._users().remove(userId);
  }

  async resendVerification(): Promise<void> {
    // Nothing to imitate. The effect is an email, and an email is not a row.
  }

  async deleteZone(zoneId: string): Promise<void> {
    await this._zones().remove(zoneId);
  }

  async regenerateJoinCode(zoneId: string): Promise<string> {
    const joinCode = randomJoinCode();
    await this._zones().update(zoneId, { joinCode });
    return joinCode;
  }

  async transferOwnership(zoneId: string, membershipId: string): Promise<void> {
    await this._eachMember(zoneId, (member) => ({
      ...member,
      role:
        member['membershipId'] === membershipId
          ? 'OWNER'
          : member['role'] === 'OWNER'
            ? 'ADMIN'
            : member['role'],
    }));
  }

  kickMember(zoneId: string, membershipId: string): Promise<void> {
    return this._setStatus(zoneId, membershipId, 'KICKED');
  }

  banMember(zoneId: string, membershipId: string): Promise<void> {
    return this._setStatus(zoneId, membershipId, 'BANNED');
  }

  approveMember(zoneId: string, membershipId: string): Promise<void> {
    return this._setStatus(zoneId, membershipId, 'APPROVED');
  }

  /** Rejecting removes the pending row, which is what the service does. */
  async rejectMember(zoneId: string, membershipId: string): Promise<void> {
    const gateway = this._zones();
    const zone = await gateway.read(zoneId);
    await gateway.update(zoneId, {
      members: membersOf(zone).filter(
        (member) => member['membershipId'] !== membershipId
      ),
    });

    await this._mirror(() =>
      this._memberships().remove(compositeId([zoneId, membershipId]))
    );
  }

  /**
   * Both columns together, because that is the whole point of the act.
   *
   * A memory copy that wrote one of them would demonstrate exactly the broken
   * state the backend added a service method to make unreachable (backend plan
   * 0077, section 4.2).
   */
  async setZoneDeletionMark(zoneId: string, marked: boolean): Promise<void> {
    await this._zones().update(zoneId, {
      status: marked ? 'MARKED_FOR_DELETION' : 'ACTIVE',
      markedForDeletionAt: marked ? new Date().toISOString() : null,
    });
  }

  async setLineApproval(
    listId: string,
    lineId: string,
    status: LineApproval
  ): Promise<void> {
    const gateway = this._lists();
    const list = await gateway.read(listId);
    await gateway.update(listId, {
      lines: linesOf(list).map((line) =>
        line['id'] === lineId ? { ...line, approvalStatus: status } : line
      ),
    });

    await this._mirror(() =>
      this._lines().update(compositeId([listId, lineId]), {
        approvalStatus: status,
      })
    );
  }

  private _users() {
    return this._gateways.for({ path: ADMIN_USERS_PATH, idField: 'userId' });
  }

  private _zones() {
    return this._gateways.for({ path: ADMIN_ZONES_PATH });
  }

  private _lists() {
    return this._gateways.for({ path: ADMIN_LISTS_PATH });
  }

  private _memberships() {
    return this._gateways.for({
      path: ADMIN_ZONE_MEMBERS_PATH,
      key: [...MEMBERSHIP_KEY],
      idField: 'membershipId',
    });
  }

  private _lines() {
    return this._gateways.for({
      path: ADMIN_LIST_LINES_PATH,
      key: [...LIST_LINE_KEY],
    });
  }

  private _setStatus(
    zoneId: string,
    membershipId: string,
    status: string
  ): Promise<void> {
    return this._eachMember(zoneId, (member) =>
      member['membershipId'] === membershipId ? { ...member, status } : member
    );
  }

  /**
   * Rewrite a zone's membership, one member at a time, in both tables.
   *
   * The zone row is read back before it is written, rather than patched
   * blindly, so an action against a zone this table does not hold fails the way
   * the gateway's would instead of quietly creating one.
   */
  private async _eachMember(
    zoneId: string,
    change: (member: ResourceRow) => ResourceRow
  ): Promise<void> {
    const gateway = this._zones();
    const zone = await gateway.read(zoneId);
    const members = membersOf(zone).map(change);
    await gateway.update(zoneId, { members });

    for (const member of members) {
      const membershipId = member['membershipId'];
      if (typeof membershipId !== 'string') {
        continue;
      }
      await this._mirror(() =>
        this._memberships().update(compositeId([zoneId, membershipId]), member)
      );
    }
  }

  /**
   * A write to the mirror table, which a spec is allowed not to have seeded.
   *
   * The zone's own array is the authoritative copy in this mode, and the
   * membership collection exists beside it so the standalone screen has
   * something to list. An action must not fail because only one of the two was
   * seeded, so a missing row here is nothing rather than an error.
   */
  private async _mirror(work: () => Promise<unknown>): Promise<void> {
    try {
      await work();
    } catch {
      // The mirror does not hold this row. Nothing to keep in step.
    }
  }
}

/** A zone's membership array, as rows. */
function membersOf(zone: ResourceRow): ResourceRow[] {
  const members = zone['members'];
  return Array.isArray(members) ? (members as ResourceRow[]) : [];
}

/** A list's lines, as rows. */
function linesOf(list: ResourceRow): ResourceRow[] {
  const lines = list['lines'];
  return Array.isArray(lines) ? (lines as ResourceRow[]) : [];
}

/** A code in the shipped alphabet, which excludes the letters that read as digits. */
function randomJoinCode(): string {
  let code = '';
  for (let index = 0; index < JOIN_CODE_LENGTH; index += 1) {
    const at = Math.floor(Math.random() * JOIN_CODE_ALPHABET.length);
    code += JOIN_CODE_ALPHABET[at];
  }
  return code;
}
