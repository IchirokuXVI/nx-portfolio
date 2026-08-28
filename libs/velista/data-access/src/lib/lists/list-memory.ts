import { inject, Injectable, signal } from '@angular/core';
import {
  LIST_PERMISSIONS,
  type ListAccessEntry,
  type ListOrder,
  type ListPermission,
  type MyZone,
  type Page,
  type ShoppingListSummary,
  type UpdateListRequest,
} from '@portfolio/velista/models';
import { TokenStore } from '../auth/token-store';
import { GatewayError } from '../errors';
import { MembershipMemory } from '../memberships/membership-memory';
import { SEED_LIST_ACCESS, SEED_LISTS } from '../zones/static-group-data';
import { SEED_USER_ID } from '../zones/static-zone-data';
import { ZoneMemory } from '../zones/zone-memory';
import type { ListServiceI } from './list-service';

/**
 * Lists, in memory. Asked for by name, never a default.
 *
 * ## It enforces permissions, it does not only store them
 *
 * Plan 0030 section 9 is emphatic about this and it is the reason the fake earns its
 * keep. The four permission states are exactly what is tedious to reach against a real
 * backend: four accounts, a group and a share sheet. Here they are a seed value, and
 * two of them, a `WRITE`-only caller and a `DECIDE`-only caller, are states nothing had
 * ever rendered. A fake that stored the sets and refused nothing would let the screen be
 * built against a server that does not exist.
 *
 * So every method below asks {@link permissionsFor} first and throws the refusal the
 * gateway would throw, in the shape it arrives in: a `GatewayError` with `forbidden`,
 * `not_found` or `validation_failed`, exactly as `_approvedZone` has always done for a
 * pending membership. Nothing new was invented for it.
 *
 * ## What "the caller's permissions" means here
 *
 * The same two-step the backend does (backend plan 0036, section 4): a zone `OWNER` or
 * `ADMIN` holds all four on every list in the zone, derived and never stored, and
 * everybody else holds whatever their `list_access` row holds, or nothing. That is why
 * the seeded caller's own permissions only vary in `zone-parents`, the one group where
 * they are an ordinary member.
 *
 * The seed is already filtered to what the seeded caller may read, which is what the
 * endpoint returns, so `zone-lab` having five members and no lists here is section
 * 3.2's "nothing shared with you" state rather than an oversight. That state is the one
 * this fake exists for: it cannot be produced against a real backend without two
 * accounts and a list somebody deliberately did not share.
 */
@Injectable()
export class ListMemory implements ListServiceI {
  private readonly _zones = inject(ZoneMemory);
  private readonly _members = inject(MembershipMemory);
  private readonly _tokens = inject(TokenStore);

  private readonly _byZone = signal<
    ReadonlyMap<string, readonly ShoppingListSummary[]>
  >(new Map(Object.entries(SEED_LISTS)));

  async listLists(
    zoneId: string,
    options?: { cursor?: string; limit?: number; order?: ListOrder }
  ): Promise<Page<ShoppingListSummary>> {
    this._approvedZone(zoneId);

    // Filtered by the caller and not by the zone, which is what core does: a list with
    // no `READ` for this person is not theirs to know about. The seed is already
    // filtered this way, so the filter changes nothing until a spec revokes something,
    // which is precisely when it has to be right.
    const readable = this._lists(zoneId).filter((list) =>
      this.permissionsFor(list.id).includes('READ')
    );

    const ordered = order(readable, options?.order ?? 'updated');
    const limit = options?.limit ?? 20;
    const start =
      options?.cursor === undefined ? 0 : Number(options.cursor) || 0;
    const slice = ordered.slice(start, start + limit);
    const end = start + slice.length;

    return {
      items: slice.map((list) => this._served(list)),
      nextCursor: end < ordered.length ? String(end) : null,
    };
  }

  /** What the last {@link createList} was asked to share. See the note inside it. */
  lastShareWithZone = true;

  /**
   * Start a list.
   *
   * Only an approved membership is required, and that is the rule the empty state's
   * primary depends on: a plain member really can make the first list, so a fake that
   * demanded staff would have the screen hiding a button that works (section 5.5).
   */
  async createList(
    zoneId: string,
    name: string,
    shareWithZone: boolean
  ): Promise<ShoppingListSummary> {
    this._approvedZone(zoneId);
    // Still recorded, so a spec can assert what the sheet sent. It is no longer only
    // recorded: this fake now has a whole seeded group of people for a grant to reach,
    // and a share that wrote nothing would make the list it created unreadable to every
    // one of them.
    this.lastShareWithZone = shareWithZone;

    const list: ShoppingListSummary = {
      id: `list-${crypto.randomUUID?.() ?? Date.now()}`,
      zoneId,
      name,
      createdByUserId: this.callerUserId(),
      lineCount: 0,
      readyCount: 0,
      autoApproveLines: false,
      myPermissions: [],
    };

    this._byZone.update((current) => {
      const next = new Map(current);
      next.set(zoneId, [list, ...(current.get(zoneId) ?? [])]);
      return next;
    });

    // The creator's power is an ordinary row rather than a property of having created
    // the list, which is what lets a group admin change it later (backend plan 0036,
    // section 2.5).
    const granted: ListAccessEntry[] = [];
    const mine = this._myMembershipId(zoneId);
    if (mine !== null) {
      granted.push({ membershipId: mine, permissions: [...LIST_PERMISSIONS] });
    }

    if (shareWithZone) {
      // READ, WRITE and DECIDE for everybody else approved: the group can add lines and
      // can tick them off, and governing the list is the thing the creator kept
      // (backend plan 0036, section 2.6). Staff are skipped rather than written, because
      // they hold everything by derivation and a stored row for them would be a second,
      // staler copy of that.
      for (const member of this._membersOf(zoneId)) {
        if (
          member.status !== 'APPROVED' ||
          member.id === mine ||
          isStaff(member.role)
        ) {
          continue;
        }
        granted.push({
          membershipId: member.id,
          permissions: ['READ', 'WRITE', 'DECIDE'],
        });
      }
    }

    this._access.set(list.id, granted);
    return this._served(list);
  }

  /** Rename or reconfigure. `MANAGE`, and nothing less. */
  async updateList(
    listId: string,
    changes: UpdateListRequest
  ): Promise<ShoppingListSummary> {
    this._require(listId, 'MANAGE');

    return this._patch(listId, (list) => ({
      ...list,
      name: changes.name ?? list.name,
      autoApproveLines: changes.autoApproveLines ?? list.autoApproveLines,
    }));
  }

  /** Delete a list and everything on it, for everybody. `MANAGE`. */
  async deleteList(listId: string): Promise<string> {
    this._require(listId, 'MANAGE');
    const zoneId = this._zoneOf(listId);
    if (zoneId === null) {
      throw memoryFailure('not_found', 404);
    }

    this._byZone.update((current) => {
      const next = new Map(current);
      next.set(
        zoneId,
        (current.get(zoneId) ?? []).filter((list) => list.id !== listId)
      );
      return next;
    });

    this._access.delete(listId);
    return listId;
  }

  /**
   * Replace what the named memberships may do on this list.
   *
   * **Not a whole-table replace, and it used to be.** Backend plan 0036 section 5.2
   * settles it: each entry states the whole answer for that membership, memberships the
   * payload does not name are left alone, and an **empty `permissions` array deletes the
   * row**. The old behaviour, dropping everybody the payload omitted, was written when
   * the sheet could not read the current set and revoking by omission was the only
   * revocation there was.
   *
   * The five rules run in the order backend plan 0036 section 5 gives them, and the
   * order is load bearing at one point: clearing a row that holds `MANAGE` is a `MANAGE`
   * change, so rule 3 has to see it before rule 5 turns it into a deletion.
   */
  async setListAccess(
    listId: string,
    entries: readonly ListAccessEntry[]
  ): Promise<ShoppingListSummary> {
    const zoneId = this._zoneOf(listId);
    if (zoneId === null) {
      throw memoryFailure('not_found', 404);
    }

    // Rule 1.
    this._require(listId, 'MANAGE');

    const members = this._membersOf(zoneId);
    const callerIsStaff = isStaff(this._myZone(zoneId)?.myRole);
    const current = this._access.get(listId) ?? [];

    for (const entry of entries) {
      const member = members.find(
        (candidate) => candidate.id === entry.membershipId
      );
      if (member === undefined) {
        throw memoryFailure('validation_failed', 400);
      }

      // Rule 2. Refused rather than quietly dropped, so the caller is told rather than
      // left believing they did something. Refused even for a staff caller, because the
      // row would be meaningless either way.
      if (isStaff(member.role)) {
        throw memoryFailure('validation_failed', 400);
      }

      // Rule 3. Only group staff may move the `MANAGE` bit, in either direction, so a
      // list admin can neither appoint another one nor demote the peer appointed beside
      // them.
      if (!callerIsStaff) {
        const held = current.find(
          (row) => row.membershipId === entry.membershipId
        );
        const has = held?.permissions.includes('MANAGE') === true;
        if (entry.permissions.includes('MANAGE') !== has) {
          throw memoryFailure('forbidden', 403);
        }
      }
    }

    const next = new Map(current.map((row) => [row.membershipId, row]));
    for (const entry of entries) {
      if (entry.permissions.length === 0) {
        // Rule 5.
        next.delete(entry.membershipId);
        continue;
      }

      // Rule 4: a stored set that lacks READ cannot exist.
      next.set(entry.membershipId, {
        membershipId: entry.membershipId,
        permissions: normalizeGrant(entry.permissions),
      });
    }

    this._access.set(listId, [...next.values()]);
    return this._patch(listId, (list) => list);
  }

  /**
   * What each membership may do on this list.
   *
   * `MANAGE` only, because who else can write to a list is governance and not content
   * (backend plan 0036, section 4.3). A caller with `READ` gets `forbidden` here, which
   * is the refusal the share sheet must never be able to provoke and therefore the one
   * worth being able to provoke in a spec.
   *
   * Stored rows only: group staff hold everything by derivation and have no row.
   */
  async getListAccess(listId: string): Promise<readonly ListAccessEntry[]> {
    this._require(listId, 'MANAGE');
    return this._access.get(listId) ?? [];
  }

  /**
   * The caller's effective permissions on one list. Empty means no access at all.
   *
   * The fake's copy of `ListAccessService.permissionsFor`, and the only place in this
   * library that knows group staff are special. `LineMemory` asks it too, so a line
   * write and a list write cannot disagree about who the caller is.
   *
   * Answers the empty set rather than throwing for a list or a zone it does not know,
   * because it is a question and not a check. The checks are {@link _require} and
   * {@link _approvedZone}, which is where `not_found` comes from.
   */
  permissionsFor(listId: string): readonly ListPermission[] {
    const zoneId = this._zoneOf(listId);
    if (zoneId === null) {
      return [];
    }

    const zone = this._myZone(zoneId);
    if (zone === undefined || zone.myStatus !== 'APPROVED') {
      return [];
    }
    if (isStaff(zone.myRole)) {
      return [...LIST_PERMISSIONS];
    }

    const membershipId = this._myMembershipId(zoneId);
    if (membershipId === null) {
      return [];
    }

    return (
      this._access.get(listId)?.find((row) => row.membershipId === membershipId)
        ?.permissions ?? []
    );
  }

  /** Who this fake answers as. The token's user, or the seeded caller. */
  callerUserId(): string {
    return this._tokens.tokens()?.userId ?? SEED_USER_ID;
  }

  /**
   * One list as this fake holds it, or null.
   *
   * `LineMemory` reads `autoApproveLines` from it, which is the one list fact a line
   * write depends on (backend plan 0037, section 2). There is no `GET /v1/lists/:id` on
   * the real API and this is not standing in for one: it is a lookup inside the fake, and
   * nothing outside the fakes may use it.
   */
  listById(listId: string): ShoppingListSummary | null {
    const zoneId = this._zoneOf(listId);
    if (zoneId === null) {
      return null;
    }

    return this._lists(zoneId).find((list) => list.id === listId) ?? null;
  }

  /** Test and development seam: set one list's access without a request. */
  setAccessFixture(listId: string, entries: readonly ListAccessEntry[]): void {
    this._access.set(listId, [...entries]);
  }

  private readonly _access = new Map<string, ListAccessEntry[]>(
    Object.entries(SEED_LIST_ACCESS).map(([listId, entries]) => [
      listId,
      [...entries],
    ])
  );

  /**
   * The check every write goes through: the list exists, and the caller holds this.
   *
   * `not_found` before `forbidden`, matching core, so a list in a zone the caller is not
   * in never leaks its existence through the difference between the two.
   */
  private _require(listId: string, permission: ListPermission): void {
    if (this._zoneOf(listId) === null) {
      throw memoryFailure('not_found', 404);
    }
    if (!this.permissionsFor(listId).includes(permission)) {
      throw memoryFailure('forbidden', 403);
    }
  }

  private _myZone(zoneId: string): MyZone | undefined {
    return this._zones.zones().find((candidate) => candidate.id === zoneId);
  }

  private _membersOf(zoneId: string) {
    return this._members.members(zoneId);
  }

  private _myMembershipId(zoneId: string): string | null {
    const userId = this.callerUserId();
    return (
      this._membersOf(zoneId).find((member) => member.userId === userId)?.id ??
      null
    );
  }

  /** One list with the caller's own permissions stamped on it, as `ListView` arrives. */
  private _served(list: ShoppingListSummary): ShoppingListSummary {
    return { ...list, myPermissions: this.permissionsFor(list.id) };
  }

  private _zoneOf(listId: string): string | null {
    for (const [zoneId, lists] of this._byZone()) {
      if (lists.some((list) => list.id === listId)) {
        return zoneId;
      }
    }

    return null;
  }

  private _patch(
    listId: string,
    change: (list: ShoppingListSummary) => ShoppingListSummary
  ): ShoppingListSummary {
    const zoneId = this._zoneOf(listId);
    if (zoneId === null) {
      throw memoryFailure('not_found', 404);
    }

    const lists = this._byZone().get(zoneId) ?? [];
    const current = lists.find((list) => list.id === listId);
    if (current === undefined) {
      throw memoryFailure('not_found', 404);
    }

    const updated = change(current);
    this._byZone.update((all) => {
      const next = new Map(all);
      next.set(
        zoneId,
        lists.map((list) => (list.id === listId ? updated : list))
      );
      return next;
    });

    return this._served(updated);
  }

  /** Test and development seam: replace one zone's lists outright. */
  setLists(zoneId: string, lists: readonly ShoppingListSummary[]): void {
    this._byZone.update((current) => {
      const next = new Map(current);
      next.set(zoneId, lists);
      return next;
    });
  }

  private _lists(zoneId: string): readonly ShoppingListSummary[] {
    return this._byZone().get(zoneId) ?? [];
  }

  /**
   * A zone the caller is an approved member of.
   *
   * `not_found` for one they are not in and `forbidden` for a PENDING membership,
   * matching what core answers. A pending caller reaching this at all is the request
   * section 3.3 exists to prevent, and the fake refusing it is what lets a spec prove
   * the request was never made.
   */
  private _approvedZone(zoneId: string): MyZone {
    const zone = this._myZone(zoneId);

    if (zone === undefined) {
      throw memoryFailure('not_found', 404);
    }
    if (zone.myStatus !== 'APPROVED') {
      throw memoryFailure('forbidden', 403);
    }

    return zone;
  }
}

function isStaff(role: string | undefined): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

/**
 * The set the server would actually store for one entry (backend plan 0036, rule 4).
 *
 * Two implications, both applied at the write boundary rather than by every later
 * reader of the set, exactly as core's own `normalizeGrant` does it. This function
 * exists so the mock and the real server cannot disagree about what a save means.
 *
 * `READ` joins any non-empty set, and `MANAGE` brings `WRITE` and `DECIDE` with it:
 * section 2's table defines a list admin as everything above it plus governing the
 * list, so a stored `{READ, MANAGE}` would be somebody who may delete any line and
 * decide who else may use the list, yet may not add one.
 */
function normalizeGrant(
  permissions: readonly ListPermission[]
): readonly ListPermission[] {
  if (permissions.length === 0) {
    return [];
  }
  const wanted = new Set<ListPermission>([...permissions, 'READ']);
  if (wanted.has('MANAGE')) {
    wanted.add('WRITE');
    wanted.add('DECIDE');
  }
  return LIST_PERMISSIONS.filter((permission) => wanted.has(permission));
}

function order(
  lists: readonly ShoppingListSummary[],
  by: ListOrder
): readonly ShoppingListSummary[] {
  if (by === 'name') {
    return [...lists].sort((a, b) => a.name.localeCompare(b.name));
  }

  // `created` and `updated` both need timestamps the client's model does not carry,
  // so the seeded order stands in for both. Sorting by something arbitrary would look
  // correct and be wrong.
  return lists;
}

function memoryFailure(
  code: GatewayError['code'],
  status: number
): GatewayError {
  return new GatewayError({
    code,
    status,
    correlationId: `memory-${Math.random().toString(36).slice(2, 10)}`,
    detail: 'produced by ListMemory, no request was sent',
  });
}
