import { inject, Injectable, signal } from '@angular/core';
import type {
  MemberOrder,
  Membership,
  MembershipStatus,
  MyZone,
  Page,
  Zone,
  ZoneRole,
} from '@portfolio/velista/models';
import { TokenStore } from '../auth/token-store';
import { GatewayError } from '../errors';
import { SEED_MEMBERSHIPS } from '../zones/static-group-data';
import { SEED_USER_ID } from '../zones/static-zone-data';
import { ZoneMemory } from '../zones/zone-memory';
import type { AssignableRole, MembershipServiceI } from './membership-service';

/**
 * The gateway's own `usernameChange` bucket: five an hour.
 *
 * Mirrored rather than invented, so the refusal a spec drives here is the refusal
 * production produces. The window is not simulated, because a fake that forgot its
 * count after an hour would make the state unreachable in a test that runs in
 * milliseconds; the count resets when the service does.
 */
const RENAME_BUDGET = 5;

/**
 * Memberships, in memory. Asked for by name, never a default.
 *
 * It enforces **core's real permission table** (plan 0010, section 5.4) rather than
 * succeeding at everything, and that is the whole reason it is worth writing. Rule G2
 * says the client hides a control it may not use and the server decides anyway; a fake
 * that never refused would leave the second half of that rule untested until
 * production, and the row that matters most, an admin who may not promote, would be
 * indistinguishable from an owner who may.
 *
 * It resolves the caller's role from `ZoneMemory`, which is the same source the real
 * gateway uses in spirit: `ZoneAuthzService` reads the caller's membership on every
 * call, so a role that changed a moment ago is honoured rather than remembered.
 */
@Injectable()
export class MembershipMemory implements MembershipServiceI {
  private readonly _zones = inject(ZoneMemory);
  private readonly _tokens = inject(TokenStore);

  private readonly _byZone = signal<ReadonlyMap<string, readonly Membership[]>>(
    new Map(Object.entries(SEED_MEMBERSHIPS))
  );

  /** Renames left before the bucket refuses. See {@link RENAME_BUDGET}. */
  private _renamesLeft = RENAME_BUDGET;

  async listMembers(
    zoneId: string,
    options?: {
      statuses?: readonly MembershipStatus[];
      cursor?: string;
      limit?: number;
      order?: MemberOrder;
    }
  ): Promise<Page<Membership>> {
    const zone = this._approvedZone(zoneId);
    const statuses = options?.statuses ?? ['APPROVED'];

    // Any status other than APPROVED is governance data, and asking for it as an
    // ordinary member is a `forbidden` rather than an empty page. The screen is
    // expected to know that from `myRole` before it asks (rule G3 and section 5.4).
    if (
      statuses.some((status) => status !== 'APPROVED') &&
      zone.myRole === 'MEMBER'
    ) {
      throw memoryFailure('forbidden', 403);
    }

    const all = this._members(zoneId).filter((member) =>
      statuses.includes(member.status)
    );
    const ordered = order(all, options?.order ?? 'joined');

    const limit = options?.limit ?? 20;
    const start =
      options?.cursor === undefined ? 0 : Number(options.cursor) || 0;
    const slice = ordered.slice(start, start + limit);
    const end = start + slice.length;

    return {
      items: slice,
      nextCursor: end < ordered.length ? String(end) : null,
    };
  }

  /**
   * Let somebody in.
   *
   * The `validation_failed` is the row worth having a fake for: a membership that is
   * no longer PENDING is one somebody else already answered, and calling this twice is
   * how a spec reaches the state without a second admin and a stopwatch (section 5.6).
   */
  async approve(zoneId: string, membershipId: string): Promise<Membership> {
    this._staffZone(zoneId);
    const membership = this._requireMember(zoneId, membershipId);

    if (membership.status !== 'PENDING') {
      throw memoryFailure('validation_failed', 400);
    }

    return this._patch(zoneId, membershipId, { status: 'APPROVED' });
  }

  async reject(zoneId: string, membershipId: string): Promise<string> {
    this._staffZone(zoneId);
    const membership = this._requireMember(zoneId, membershipId);

    if (membership.status !== 'PENDING') {
      throw memoryFailure('validation_failed', 400);
    }

    this._replace(zoneId, (members) =>
      members.filter((member) => member.id !== membershipId)
    );
    return membershipId;
  }

  async kick(zoneId: string, membershipId: string): Promise<Membership> {
    return this._remove(zoneId, membershipId, 'KICKED');
  }

  async ban(zoneId: string, membershipId: string): Promise<Membership> {
    return this._remove(zoneId, membershipId, 'BANNED');
  }

  /** **Owner only**, and never the owner's own row. An admin gets a `forbidden`. */
  async setRole(
    zoneId: string,
    membershipId: string,
    role: AssignableRole
  ): Promise<Membership> {
    const zone = this._approvedZone(zoneId);
    const membership = this._requireMember(zoneId, membershipId);

    if (zone.myRole !== 'OWNER' || membership.role === 'OWNER') {
      throw memoryFailure('forbidden', 403);
    }

    return this._patch(zoneId, membershipId, { role });
  }

  /**
   * Hand the group over, which demotes the caller in the same call.
   *
   * Both halves are applied, because a fake that promoted the target and left the
   * caller an owner would let a screen look correct while being wrong about the one
   * thing this action is for.
   */
  async transferOwnership(zoneId: string, membershipId: string): Promise<Zone> {
    const zone = this._approvedZone(zoneId);
    const membership = this._requireMember(zoneId, membershipId);

    if (zone.myRole !== 'OWNER' || membership.status !== 'APPROVED') {
      throw memoryFailure('forbidden', 403);
    }

    this._replace(zoneId, (members) =>
      members.map((member) => {
        if (member.id === membershipId) {
          return { ...member, role: 'OWNER' as ZoneRole };
        }
        return member.role === 'OWNER'
          ? { ...member, role: 'ADMIN' as ZoneRole }
          : member;
      })
    );

    this._zones.setZones(
      this._zones.zones().map((candidate) =>
        candidate.id === zoneId
          ? {
              ...candidate,
              ownerUserId: membership.userId,
              myRole: 'ADMIN' as ZoneRole,
            }
          : candidate
      )
    );

    return stripMine(this._requireZone(zoneId));
  }

  /**
   * Rename somebody inside this zone.
   *
   * Two refusals, both real: an admin may not rename the owner, and the bucket runs
   * out after five. The second is what section 5.6's `rate_limited` row is written
   * for, and it is otherwise reachable only by doing it six times to a live server.
   */
  async setUsername(
    zoneId: string,
    membershipId: string,
    username: string
  ): Promise<Membership> {
    const zone = this._requireZone(zoneId);
    const membership = this._requireMember(zoneId, membershipId);
    const renamingSelf = membership.userId === this._myUserId();

    // Renaming yourself is allowed while still PENDING, which is the one governance
    // route that does not require an approved membership (section 5.4).
    if (!renamingSelf) {
      this._staffZone(zoneId);
    }
    if (
      !renamingSelf &&
      membership.role === 'OWNER' &&
      zone.myRole !== 'OWNER'
    ) {
      // An admin may not rename the owner (section 5.4).
      throw memoryFailure('forbidden', 403);
    }

    if (this._renamesLeft <= 0) {
      throw memoryFailure('rate_limited', 429);
    }
    this._renamesLeft -= 1;

    return this._patch(zoneId, membershipId, { username });
  }

  /** Test and development seam: replace one zone's memberships outright. */
  setMembers(zoneId: string, members: readonly Membership[]): void {
    this._replace(zoneId, () => members);
  }

  /** What the fake currently holds, so a spec can assert on it without a request. */
  members(zoneId: string): readonly Membership[] {
    return this._members(zoneId);
  }

  private _members(zoneId: string): readonly Membership[] {
    return this._byZone().get(zoneId) ?? [];
  }

  private _remove(
    zoneId: string,
    membershipId: string,
    status: 'KICKED' | 'BANNED'
  ): Membership {
    this._staffZone(zoneId);
    const membership = this._requireMember(zoneId, membershipId);

    // The owner can be neither kicked nor banned, by anybody, ever (section 5.4).
    if (membership.role === 'OWNER') {
      throw memoryFailure('forbidden', 403);
    }

    return this._patch(zoneId, membershipId, { status });
  }

  private _requireZone(zoneId: string): MyZone {
    const zone = this._zones
      .zones()
      .find((candidate) => candidate.id === zoneId);
    if (zone === undefined) {
      throw memoryFailure('not_found', 404);
    }

    return zone;
  }

  /** A zone the caller is an approved member of. PENDING reads nothing here. */
  private _approvedZone(zoneId: string): MyZone {
    const zone = this._requireZone(zoneId);
    if (zone.myStatus !== 'APPROVED') {
      throw memoryFailure('forbidden', 403);
    }

    return zone;
  }

  private _staffZone(zoneId: string): MyZone {
    const zone = this._approvedZone(zoneId);
    if (zone.myRole === 'MEMBER') {
      throw memoryFailure('forbidden', 403);
    }

    return zone;
  }

  private _requireMember(zoneId: string, membershipId: string): Membership {
    const membership = this._members(zoneId).find(
      (candidate) => candidate.id === membershipId
    );
    if (membership === undefined) {
      throw memoryFailure('not_found', 404);
    }

    return membership;
  }

  /**
   * Who the caller is, the same way the real gateway knows: from the token.
   *
   * Falls back to the seeded user so that a backend-less run with no session still
   * recognises the caller's own row, which is what the seed data was built around.
   */
  private _myUserId(): string {
    return this._tokens.tokens()?.userId ?? SEED_USER_ID;
  }

  private _patch(
    zoneId: string,
    membershipId: string,
    changes: Partial<Membership>
  ): Membership {
    let updated: Membership | null = null;

    this._replace(zoneId, (members) =>
      members.map((member) => {
        if (member.id !== membershipId) {
          return member;
        }

        updated = { ...member, ...changes };
        return updated;
      })
    );

    return updated ?? this._requireMember(zoneId, membershipId);
  }

  private _replace(
    zoneId: string,
    update: (members: readonly Membership[]) => readonly Membership[]
  ): void {
    this._byZone.update((current) => {
      const next = new Map(current);
      next.set(zoneId, update(current.get(zoneId) ?? []));
      return next;
    });
  }
}

function order(
  members: readonly Membership[],
  by: MemberOrder
): readonly Membership[] {
  if (by === 'name') {
    return [...members].sort((a, b) => a.username.localeCompare(b.username));
  }
  if (by === 'role') {
    const rank: Record<ZoneRole, number> = { OWNER: 0, ADMIN: 1, MEMBER: 2 };
    return [...members].sort((a, b) => rank[a.role] - rank[b.role]);
  }

  // `joined` needs a per membership timestamp the client's model does not carry, so
  // the seeded order stands in for it. Sorting by something arbitrary would look
  // correct and be wrong.
  return members;
}

function stripMine(zone: MyZone): Zone {
  return {
    id: zone.id,
    name: zone.name,
    joinCode: zone.joinCode,
    status: zone.status,
    ownerUserId: zone.ownerUserId,
  };
}

/**
 * A failure shaped like one the interceptor would have built.
 *
 * The correlation id is real in structure and local in origin, which is honest: there
 * was no request, so there is no server reference to quote.
 */
function memoryFailure(
  code: GatewayError['code'],
  status: number
): GatewayError {
  return new GatewayError({
    code,
    status,
    correlationId: `memory-${Math.random().toString(36).slice(2, 10)}`,
    detail: 'produced by MembershipMemory, no request was sent',
  });
}
