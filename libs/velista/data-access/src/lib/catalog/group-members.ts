import { inject, Injectable, signal } from '@angular/core';
import type { CatalogItem } from '@portfolio/velista/models';
import { CATALOG_SERVICE, type CatalogServiceI } from './catalog-service';
import { ItemNames } from './item-names';

/**
 * Where a group's members are priced: a profile, a set of scopes, or the
 * caller's own profile when neither is named. See `CatalogServiceI.groupMembers`.
 */
export interface GroupMembersScope {
  readonly profileId?: string;
  readonly priceScopeIds?: readonly string[];
}

/** One group at one scope: still loading, answered, or failed. */
export type GroupMembersEntry =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly members: readonly CatalogItem[] }
  | { readonly status: 'failed' };

/**
 * The members of product groups, priced, for "similar products" and the
 * basket's best price mark.
 *
 * A group is one product sold under several labels, so its members are the
 * products a line can change to. The line page, the product sheet and the basket
 * all ask the same question, often about the same group, so the answer is held
 * here for the session, keyed by group **and** scope: the same group priced at a
 * basket's scopes and at a profile's is two different answers.
 *
 * Every member that arrives is also handed to `ItemNames`, so a product somebody
 * changes a line to has its name on the frame the line changes.
 */
// Provided by the app layer, never root: rule D5, like `GroupNames` beside it.
@Injectable()
export class GroupMembers {
  private readonly _catalog = inject<CatalogServiceI>(CATALOG_SERVICE);
  private readonly _itemNames = inject(ItemNames);

  private readonly _entries = signal<ReadonlyMap<string, GroupMembersEntry>>(
    new Map()
  );

  /** One group at one scope, or null when nobody has asked for it yet. */
  entry(groupId: string, scope?: GroupMembersScope): GroupMembersEntry | null {
    return this._entries().get(keyOf(groupId, scope)) ?? null;
  }

  /** The members once they have arrived, or null while loading, failed or unasked. */
  membersOf(
    groupId: string,
    scope?: GroupMembersScope
  ): readonly CatalogItem[] | null {
    const entry = this.entry(groupId, scope);
    return entry?.status === 'ready' ? entry.members : null;
  }

  /**
   * Read a set of groups at one scope, once each.
   *
   * Idempotent, so a page calls it from an effect. A group that failed is asked
   * again on the next call, so a later visit can recover.
   */
  async ensure(
    groupIds: readonly string[],
    scope?: GroupMembersScope
  ): Promise<void> {
    const current = this._entries();
    const missing = [...new Set(groupIds)].filter((groupId) => {
      const entry = current.get(keyOf(groupId, scope));
      return (
        groupId !== '' && (entry === undefined || entry.status === 'failed')
      );
    });
    if (missing.length === 0) {
      return;
    }

    this._set(missing, scope, () => ({ status: 'loading' }));

    await Promise.all(
      missing.map(async (groupId) => {
        const members = await this._catalog.groupMembers(groupId, scope);
        if (members !== null) {
          this._itemNames.prime(members);
        }
        this._set([groupId], scope, () =>
          members === null ? { status: 'failed' } : { status: 'ready', members }
        );
      })
    );
  }

  private _set(
    groupIds: readonly string[],
    scope: GroupMembersScope | undefined,
    entry: () => GroupMembersEntry
  ): void {
    this._entries.update((current) => {
      const next = new Map(current);
      for (const groupId of groupIds) {
        next.set(keyOf(groupId, scope), entry());
      }
      return next;
    });
  }
}

function keyOf(groupId: string, scope: GroupMembersScope | undefined): string {
  const scopes = [...(scope?.priceScopeIds ?? [])].sort().join(',');
  return `${groupId}|${scope?.profileId ?? ''}|${scopes}`;
}
