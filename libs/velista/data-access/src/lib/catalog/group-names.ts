import { inject, Injectable, signal } from '@angular/core';
import type { ProductGroup } from '@portfolio/velista/models';
import { CATALOG_SERVICE, type CatalogServiceI } from './catalog-service';

/**
 * What the catalog calls the group a line follows (velista plan 0065, section 2.1).
 *
 * ## Why this exists at all
 *
 * A `Line` carries `productGroupId` and no name, exactly as it carries `itemIds`
 * and no names, and the heading over the catalog's cluster of chips wants one:
 * `From Milk`, not `From 8f14e45f`.
 *
 * ## Deliberately the same shape as `ItemNames`
 *
 * `ensure` for a set, a cache, `nameOf` for one, `anyFailed` for the sentence a
 * failure earns. Not a general purpose cache abstraction shared with it, and not a
 * resolver that answers differently: `item-names.ts` made every one of these
 * decisions once, and a second resolver that disagreed with it would only reveal
 * itself in the failure case, which is the case nobody exercises.
 *
 * The three answers are that file's three and mean the same things here:
 *
 * - **A name.** The catalog answered and knows the group.
 * - **No name, and no failure.** The catalog answered and that id matched nothing:
 *   a line outlives the group it was bound to, and a deleted group is an ordinary
 *   thing for an old line to name.
 * - **A failure.** The request did not answer.
 *
 * The last two draw the **same heading**, `From a group`, and that is the one place
 * this differs from its sibling in what it is used for rather than in what it
 * knows. `ItemNames` separates them because a failed set of names earns a sentence
 * under the chips; a heading earns no apology, and the reader is owed the same
 * words whether the lookup failed or the group is gone. {@link anyFailed} is here
 * anyway, because the distinction is real and the caller should not have to
 * reconstruct it if a screen ever wants it.
 */
// Provided by the app layer, never root: rule D5, like every other holder here.
@Injectable()
export class GroupNames {
  private readonly _catalog = inject<CatalogServiceI>(CATALOG_SERVICE);

  /**
   * The groups this session has resolved, by id.
   *
   * Unscoped, like `ItemNames`' map and for its reason: a group's name is the
   * catalog's and is the same in every zone.
   */
  private readonly _byId = signal<ReadonlyMap<string, ProductGroup>>(new Map());

  /**
   * Ids whose request is in flight or has answered, so a set is asked for once.
   *
   * An id that answered with nothing stays in here: re-asking for a group the
   * catalog has already said it does not have would be a request per redraw of a
   * heading that will never resolve.
   */
  private readonly _asked = new Set<string>();

  /**
   * Ids whose last lookup did not answer.
   *
   * A signal rather than a plain set, because a screen reads it to decide what to
   * draw and has to redraw when it clears.
   */
  private readonly _failed = signal<ReadonlySet<string>>(new Set());

  /**
   * One group, or null.
   *
   * Null covers "not asked yet", "asked and gone", and "the request failed", and
   * the heading draws all three the same way, which is the unnamed one.
   */
  nameOf(groupId: string): ProductGroup | null {
    return this._byId().get(groupId) ?? null;
  }

  /** Whether any of these ids is unresolved because the lookup did not answer. */
  anyFailed(groupIds: readonly string[]): boolean {
    const failed = this._failed();
    return groupIds.some((groupId) => failed.has(groupId));
  }

  /**
   * Resolve a set of groups, once.
   *
   * Only the ids nothing is known about are asked for, so a redraw costs nothing
   * and a line whose binding has not changed costs nothing. Idempotent by design:
   * the page calls it from an effect.
   */
  async ensure(groupIds: readonly string[]): Promise<void> {
    const missing = [...new Set(groupIds)].filter(
      (groupId) => groupId !== '' && !this._asked.has(groupId)
    );
    if (missing.length === 0) {
      return;
    }

    for (const groupId of missing) {
      this._asked.add(groupId);
    }

    const found = await this._catalog.productGroupsByIds(missing);

    if (found === null) {
      // Unasked, so a later visit retries rather than the heading being permanently
      // unnamed, and marked failed so a screen that wants to tell a failure from a
      // deleted group still can.
      for (const groupId of missing) {
        this._asked.delete(groupId);
      }
      this._failed.update((current) => {
        const next = new Set(current);
        for (const groupId of missing) {
          next.add(groupId);
        }
        return next;
      });
      return;
    }

    this._absorb(found);

    // Cleared for every id in the request, not only the ones that came back: an id
    // the catalog answered about and does not have is resolved, and leaving it
    // marked would report a failure for a request that went perfectly well.
    this._failed.update((current) => {
      if (current.size === 0) {
        return current;
      }
      const next = new Set(current);
      for (const groupId of missing) {
        next.delete(groupId);
      }
      return next;
    });
  }

  /** Test seam: seed the cache without a request, as `ItemNames.prime` does. */
  prime(groups: readonly ProductGroup[]): void {
    for (const group of groups) {
      this._asked.add(group.id);
    }
    this._absorb(groups);
  }

  private _absorb(groups: readonly ProductGroup[]): void {
    if (groups.length === 0) {
      return;
    }

    this._byId.update((current) => {
      const next = new Map(current);
      for (const group of groups) {
        next.set(group.id, group);
      }
      return next;
    });
  }
}
