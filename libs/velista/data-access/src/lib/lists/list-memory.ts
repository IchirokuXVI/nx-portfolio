import { inject, Injectable, signal } from '@angular/core';
import type {
  ListAccessEntry,
  ListOrder,
  MyZone,
  Page,
  ShoppingListSummary,
} from '@portfolio/velista/models';
import { TokenStore } from '../auth/token-store';
import { GatewayError } from '../errors';
import { SEED_LIST_ACCESS, SEED_LISTS } from '../zones/static-group-data';
import { SEED_USER_ID } from '../zones/static-zone-data';
import { ZoneMemory } from '../zones/zone-memory';
import type { ListServiceI } from './list-service';

/**
 * Lists, in memory. Asked for by name, never a default.
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
  private readonly _tokens = inject(TokenStore);

  private readonly _byZone = signal<
    ReadonlyMap<string, readonly ShoppingListSummary[]>
  >(new Map(Object.entries(SEED_LISTS)));

  async listLists(
    zoneId: string,
    options?: { cursor?: string; limit?: number; order?: ListOrder }
  ): Promise<Page<ShoppingListSummary>> {
    this._approvedZone(zoneId);

    const ordered = order(this._lists(zoneId), options?.order ?? 'updated');
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
   * Start a list.
   *
   * Only an approved membership is required, and that is the rule the empty state's
   * primary depends on: a plain member really can make the first list, so a fake that
   * demanded staff would have the screen hiding a button that works (section 5.5).
   */
  /** What the last {@link createList} was asked to share. See the note inside it. */
  lastShareWithZone = true;

  async createList(
    zoneId: string,
    name: string,
    shareWithZone: boolean
  ): Promise<ShoppingListSummary> {
    this._approvedZone(zoneId);
    // Recorded and not acted on. This fake has one user, so there is nobody for a
    // grant to reach and nobody a private list could be hidden from; modelling the
    // access table here would be inventing a second implementation of a rule whose
    // only real one is in core. What it must not do is lose the answer, so a test
    // driving this fake can still assert what the sheet sent.
    this.lastShareWithZone = shareWithZone;

    const list: ShoppingListSummary = {
      id: `list-${crypto.randomUUID?.() ?? Date.now()}`,
      zoneId,
      name,
      createdByUserId: this._tokens.tokens()?.userId ?? SEED_USER_ID,
      lineCount: 0,
      readyCount: 0,
    };

    this._byZone.update((current) => {
      const next = new Map(current);
      next.set(zoneId, [list, ...(current.get(zoneId) ?? [])]);
      return next;
    });

    return list;
  }

  /** Rename. `requireManage`, so the creator, a zone admin, or the owner. */
  async updateList(listId: string, name: string): Promise<ShoppingListSummary> {
    return this._patch(listId, (list) => ({ ...list, name }));
  }

  async deleteList(listId: string): Promise<string> {
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
   * Replace the access set.
   *
   * Replaces, exactly as the real `PUT` does, so a spec that sends a partial set sees
   * the revocation rather than a merge. That behaviour is the entire reason the share
   * sheet waits on a read endpoint (section 5.5), and a fake that quietly merged would
   * hide the problem the plan was written about.
   */
  async setListAccess(
    listId: string,
    entries: readonly ListAccessEntry[]
  ): Promise<ShoppingListSummary> {
    const zoneId = this._zoneOf(listId);
    if (zoneId === null) {
      throw memoryFailure('not_found', 404);
    }

    this._access.set(listId, [...entries]);
    return this._patch(listId, (list) => list);
  }

  /**
   * Who can read and write this list.
   *
   * The endpoint this stands in for does not exist yet, and that is the point: the
   * share sheet is built and passing against this method today, so when
   * `LIST_ACCESS_READABLE` flips the sheet is already finished.
   */
  async getListAccess(listId: string): Promise<readonly ListAccessEntry[]> {
    if (this._zoneOf(listId) === null) {
      throw memoryFailure('not_found', 404);
    }

    return this._access.get(listId) ?? [];
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

    return updated;
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
    const zone = this._zones
      .zones()
      .find((candidate) => candidate.id === zoneId);

    if (zone === undefined) {
      throw memoryFailure('not_found', 404);
    }
    if (zone.myStatus !== 'APPROVED') {
      throw memoryFailure('forbidden', 403);
    }

    return zone;
  }
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
