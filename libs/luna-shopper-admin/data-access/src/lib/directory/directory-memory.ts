import { inject, Injectable } from '@angular/core';
import type { ResourceRow } from '@portfolio/luna-shopper-admin/models';
import { ResourceMemoryGateways } from '../resource/resource-memory';
import { ADMIN_USERS_PATH, ADMIN_ZONES_PATH } from './directory-paths';
import type { DirectoryServiceI } from './directory-service';

/** A join code, in the shape the real one has. */
const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const JOIN_CODE_LENGTH = 8;

/**
 * The seven named actions, with nothing listening (plan 0007, section 1).
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

  transferOwnership(zoneId: string, membershipId: string): Promise<void> {
    return this._eachMember(zoneId, (member) => ({
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

  private _users() {
    return this._gateways.for({ path: ADMIN_USERS_PATH, idField: 'userId' });
  }

  private _zones() {
    return this._gateways.for({ path: ADMIN_ZONES_PATH });
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
   * Rewrite a zone's membership, one member at a time.
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
    const members = Array.isArray(zone['members']) ? zone['members'] : [];
    await gateway.update(zoneId, {
      members: members.map((member) => change(member as ResourceRow)),
    });
  }
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
