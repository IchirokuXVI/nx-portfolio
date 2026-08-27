import { inject, Injectable, signal } from '@angular/core';
import {
  JOIN_CODE_ALPHABET,
  JOIN_CODE_LENGTH,
  type Membership,
  type MyZone,
  type MyZoneOrder,
  type Page,
  type Zone,
} from '@portfolio/velista/models';
import { TokenStore } from '../auth/token-store';
import { GatewayError } from '../errors';
import {
  SEED_JOIN_CODES,
  SEED_JOINABLE_ZONE,
  SEED_USER_ID,
  SEED_ZONES,
} from './static-zone-data';
import type {
  ZoneCreationResult,
  ZoneJoinResult,
  ZoneServiceI,
} from './zone-service';

/**
 * Zones, in memory. Asked for by name, never a default.
 *
 * `ZONE_SERVICE` defaults to `ZoneApi` instead, deliberately: this used to be the
 * default and the app got it by accident, serving invented data while looking like it
 * was talking to the backend. A caller that wants fixtures now says so, with
 * `{ provide: ZONE_SERVICE, useExisting: ZoneMemory }`.
 *
 * It serves the same shape the gateway does, counts and list previews included, so the
 * app runs and every test passes with no backend at all (plan 0004, section 9.2). That
 * is what let `0003` be built to its approved mock before the counts existed, and it
 * is still what makes every state in section 3 reachable on demand.
 *
 * It also honours rule D3, because the rule is a property of the app's behaviour and
 * not of the transport: if the memory implementation quietly succeeded where the HTTP
 * one reports `guest-account-lost`, the state would only ever be seen in production.
 */
// Provided by the app layer, never root: rule D5, plan 0004 section 9. It reaches
// something only the app can supply, and the app injector is a child of the root one.
@Injectable()
export class ZoneMemory implements ZoneServiceI {
  private readonly _tokens = inject(TokenStore);
  private readonly _zones = signal<readonly MyZone[]>(SEED_ZONES);

  /**
   * What the fake currently holds.
   *
   * Exposed so `MembershipMemory` can resolve the caller's role from the same place
   * the real gateway resolves it, which is the caller's membership rather than a fact
   * either fake remembers separately. Two fakes that could disagree about somebody's
   * role would make the permission table testable and wrong.
   */
  readonly zones = this._zones.asReadonly();

  async listMyZones(options?: {
    cursor?: string;
    limit?: number;
    order?: MyZoneOrder;
  }): Promise<Page<MyZone>> {
    const ordered = order(this._zones(), options?.order ?? 'recent');
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

  async createZone(
    name: string,
    _username?: string
  ): Promise<ZoneCreationResult> {
    const authorized = await this._tokens.authorizeOptionalAuthCall();
    if (authorized.state === 'guest-account-lost') {
      return { state: 'guest-account-lost' };
    }

    const zone: MyZone = {
      id: `zone-${crypto.randomUUID?.() ?? Date.now()}`,
      name,
      joinCode: randomJoinCode(),
      status: 'ACTIVE',
      ownerUserId: this._tokens.tokens()?.userId ?? SEED_USER_ID,
      myRole: 'OWNER',
      myStatus: 'APPROVED',
      counts: {
        memberCount: 1,
        listCount: 0,
        // The creator is the owner, so they are staff and do see this number.
        pendingRequestCount: 0,
        firstPendingRequesterName: null,
      },
      lists: [],
    };

    this._zones.update((current) => [zone, ...current]);
    return { state: 'created', zone: stripMine(zone) };
  }

  /**
   * Ask to join by code, including every way that can fail.
   *
   * The failures are the point. Plan 0008 keys its copy on the error **code plus the
   * operation**, and its acceptance criterion asks that each of those messages be
   * verified here rather than against a live gateway, which a fake that could only
   * succeed would make impossible. The codes that produce each one are named in
   * `SEED_JOIN_CODES`, and each is a real code shape, so the field accepts them and the
   * sheet is driven exactly as it would be by a person typing.
   *
   * The mapping mirrors what core actually does, which is what makes it worth
   * asserting against: only one thing in the backend produces each of these on this
   * route (section 5.4). A KICKED membership is deliberately absent, because it is not
   * a failure there either: core moves it back to PENDING and the ask succeeds.
   */
  async joinZone(joinCode: string, username?: string): Promise<ZoneJoinResult> {
    const authorized = await this._tokens.authorizeOptionalAuthCall();
    if (authorized.state === 'guest-account-lost') {
      return { state: 'guest-account-lost' };
    }

    const code = joinCode.toUpperCase();

    if (code === SEED_JOIN_CODES.rateLimited) {
      throw memoryFailure('rate_limited', 429);
    }
    if (code === SEED_JOIN_CODES.banned) {
      throw memoryFailure('forbidden', 403);
    }

    const mine = this._zones().find((zone) => zone.joinCode === code);
    if (mine !== undefined) {
      // Already APPROVED here, or already waiting. One code, one message, because
      // the person cannot act differently on the two.
      throw memoryFailure('conflict', 409);
    }

    if (code !== SEED_JOINABLE_ZONE.joinCode) {
      throw memoryFailure('not_found', 404);
    }

    const userId = this._tokens.tokens()?.userId ?? SEED_USER_ID;

    // The zone joins the caller's list immediately, still PENDING, because that is
    // what the real `listMine` returns for a membership that is waiting: it selects
    // APPROVED and PENDING alike and inner joins the zone row for both. That is also
    // where the group's name comes from, and the fake would be misleading if the name
    // appeared any earlier than the reload (section 5.6).
    this._zones.update((current) => [
      {
        ...SEED_JOINABLE_ZONE,
        myRole: 'MEMBER',
        myStatus: 'PENDING',
        counts: {
          memberCount: 3,
          // A pending member may read nothing here yet, and zero says exactly that.
          listCount: 0,
          // Not staff, so the backend does not tell them who is waiting.
          pendingRequestCount: null,
          firstPendingRequesterName: null,
        },
        lists: [],
      },
      ...current,
    ]);

    const membership: Membership = {
      id: `membership-${code}`,
      zoneId: SEED_JOINABLE_ZONE.id,
      userId,
      // Absent means "use my global username", which the backend resolves. The
      // fake has no user directory, so it stands in with a placeholder.
      username: username ?? 'You',
      role: 'MEMBER',
      // Joining lands you pending until an owner approves, which is the state the
      // dashed card in `0003` renders.
      status: 'PENDING',
    };

    return { state: 'joined', membership };
  }

  /**
   * One zone, and the two ways it can be refused.
   *
   * `not_found` for a zone the caller is not in, which is what core answers a stranger
   * rather than `forbidden`: the two must stay indistinguishable, or the status code
   * tells somebody whether a zone they cannot see exists. `forbidden` for a PENDING
   * membership, which is the request section 3.3 exists to stop being made at all.
   */
  async getZone(zoneId: string): Promise<MyZone> {
    const zone = this._zones().find((candidate) => candidate.id === zoneId);
    if (zone === undefined) {
      throw memoryFailure('not_found', 404);
    }
    if (zone.myStatus !== 'APPROVED') {
      throw memoryFailure('forbidden', 403);
    }

    return zone;
  }

  async renameZone(zoneId: string, name: string): Promise<Zone> {
    const zone = this._staffZone(zoneId);
    return this._patch(zone.id, { name });
  }

  async regenerateJoinCode(zoneId: string): Promise<Zone> {
    const zone = this._staffZone(zoneId);
    return this._patch(zone.id, { joinCode: randomJoinCode() });
  }

  async deleteZone(zoneId: string): Promise<string> {
    const zone = this._requireZone(zoneId);
    if (zone.myRole !== 'OWNER') {
      // Delete is owner only, and an admin reaching it means the caller's role
      // changed underneath the button they pressed (section 5.6).
      throw memoryFailure('forbidden', 403);
    }

    this._zones.update((current) =>
      current.filter((candidate) => candidate.id !== zoneId)
    );
    return zoneId;
  }

  /**
   * Take on an ownerless zone.
   *
   * Three refusals, and each is a row of section 5.6: `forbidden` for anybody who is
   * not an admin, `conflict` for a zone somebody else already claimed, and
   * `not_found` for one the caller is not in. Claiming twice is what reaches the
   * conflict, which is exactly the race the copy is written for.
   */
  async claimOwnership(zoneId: string): Promise<Zone> {
    const zone = this._requireZone(zoneId);

    if (zone.myRole !== 'ADMIN') {
      throw memoryFailure('forbidden', 403);
    }
    if (zone.ownerUserId !== null) {
      throw memoryFailure('conflict', 409);
    }

    return this._patch(zone.id, {
      ownerUserId: this._tokens.tokens()?.userId ?? SEED_USER_ID,
      status: 'ACTIVE',
      myRole: 'OWNER',
    });
  }

  /** Test and development seam: replace the seeded zones outright. */
  setZones(zones: readonly MyZone[]): void {
    this._zones.set(zones);
  }

  private _requireZone(zoneId: string): MyZone {
    const zone = this._zones().find((candidate) => candidate.id === zoneId);
    if (zone === undefined) {
      throw memoryFailure('not_found', 404);
    }

    return zone;
  }

  /** The zone, if the caller is staff in it. `forbidden` otherwise (rule G2). */
  private _staffZone(zoneId: string): MyZone {
    const zone = this._requireZone(zoneId);
    if (zone.myRole === 'MEMBER') {
      throw memoryFailure('forbidden', 403);
    }

    return zone;
  }

  private _patch(zoneId: string, changes: Partial<MyZone>): Zone {
    let updated: MyZone | null = null;

    this._zones.update((current) =>
      current.map((candidate) => {
        if (candidate.id !== zoneId) {
          return candidate;
        }

        updated = { ...candidate, ...changes };
        return updated;
      })
    );

    // `_requireZone` ran first in every caller, so the zone is there. Falling back
    // rather than asserting keeps the fake from being the only thing in the app that
    // can throw a `TypeError`.
    return stripMine(updated ?? this._requireZone(zoneId));
  }
}

function order(zones: readonly MyZone[], by: MyZoneOrder): readonly MyZone[] {
  if (by === 'name') {
    return [...zones].sort((a, b) => a.name.localeCompare(b.name));
  }

  // `joined` and `recent` both need per-membership timestamps the API does not
  // expose, so the seeded order stands in for both. Sorting by something arbitrary
  // would look correct and be wrong.
  return zones;
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

function randomJoinCode(): string {
  return Array.from(
    { length: JOIN_CODE_LENGTH },
    () =>
      JOIN_CODE_ALPHABET[Math.floor(Math.random() * JOIN_CODE_ALPHABET.length)]
  ).join('');
}

/**
 * A failure shaped like one the interceptor would have built.
 *
 * The correlation id is real in structure and local in origin, which is honest: there
 * was no request, so there is no server reference to quote. Anything rendering one is
 * being exercised with the same type it will see in production.
 */
function memoryFailure(
  code: GatewayError['code'],
  status: number
): GatewayError {
  return new GatewayError({
    code,
    status,
    correlationId: `memory-${Math.random().toString(36).slice(2, 10)}`,
    detail: 'produced by ZoneMemory, no request was sent',
  });
}
