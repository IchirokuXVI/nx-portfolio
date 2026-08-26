import { inject, Injectable, signal } from '@angular/core';
import type {
  Membership,
  MyZone,
  MyZoneOrder,
  Page,
  Zone,
} from '@portfolio/velista/models';
import { TokenStore } from '../auth/token-store';
import { SEED_USER_ID, SEED_ZONES } from './static-zone-data';
import type {
  ZoneCreationResult,
  ZoneJoinResult,
  ZoneServiceI,
} from './zone-service';

/**
 * Zones, in memory. The default behind `ZONE_SERVICE`.
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

  async joinZone(joinCode: string, username?: string): Promise<ZoneJoinResult> {
    const authorized = await this._tokens.authorizeOptionalAuthCall();
    if (authorized.state === 'guest-account-lost') {
      return { state: 'guest-account-lost' };
    }

    const userId = this._tokens.tokens()?.userId ?? SEED_USER_ID;
    const membership: Membership = {
      id: `membership-${joinCode}`,
      zoneId: `zone-${joinCode.toLowerCase()}`,
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

  /** Test and development seam: replace the seeded zones outright. */
  setZones(zones: readonly MyZone[]): void {
    this._zones.set(zones);
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
  // No I, O, 0 or 1: this is a code people read aloud and type on a phone.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(
    { length: 6 },
    () => alphabet[Math.floor(Math.random() * alphabet.length)]
  ).join('');
}
