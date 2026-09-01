import { inject, Injectable, signal } from '@angular/core';
import type { CatalogItem } from '@portfolio/velista/models';
import { CATALOG_SERVICE, type CatalogServiceI } from './catalog-service';

/**
 * What the catalog calls the products a line carries (velista plan 0047, section 1).
 *
 * ## Why this exists at all
 *
 * A `Line` carries `itemIds` and no names. Until this landed, the two screens that
 * draw those products resolved them through `catalogItemById`, a hand written fixture
 * of a few Spanish products living in `catalog-memory.ts`. Against a real catalog every
 * id missed, so both screens told the reader their line had no products when it
 * demonstrably had some: the D4 rule arriving from the other direction, a fixture
 * trusted as though it were a backend.
 *
 * So the names come from the service, and they are cached here rather than fetched per
 * screen for `MemberNames`' reason: the sheet and the page both want them, the second
 * is usually opened from the first, and a chip is not a thing that should cost a
 * request.
 *
 * ## Three answers, and nothing may collapse them
 *
 * The distinction is the whole point of this class, and each of the three draws
 * differently:
 *
 * - **A name.** The catalog answered and knows the product.
 * - **No name, and no failure.** The catalog answered and that id matched nothing: a
 *   line outlives a product, and a withdrawn one is an ordinary thing for a set to
 *   contain. The chip is drawn without a name and nothing apologises.
 * - **A failure.** The request did not answer. The screen says the names could not be
 *   loaded, and it must **never** say the line has no products, because that is a
 *   claim about the line rather than about the request.
 *
 * ## It is asked for a set and it fails soft
 *
 * {@link ensure} takes a whole line's products in one call, and a failure is swallowed:
 * the ids are left unasked so the next visit retries, and marked failed so the screen
 * currently on it can say so. A name lookup must never be able to stop a sheet opening.
 */
// Provided by the app layer, never root: rule D5, like every other holder here.
@Injectable()
export class ItemNames {
  private readonly _catalog = inject<CatalogServiceI>(CATALOG_SERVICE);

  /**
   * The products this session has resolved, by id.
   *
   * Not keyed by anything else, unlike `MemberNames`' per zone map: a product's name
   * is the catalog's and is the same everywhere, which is exactly why the batch route
   * is unscoped.
   */
  private readonly _byId = signal<ReadonlyMap<string, CatalogItem>>(new Map());

  /**
   * Ids whose request is in flight or has answered, so a set is asked for once.
   *
   * An id that answered with nothing stays in here. Re-asking for a product the
   * catalog has already said it does not have would be a request per render of a line
   * that will never resolve.
   */
  private readonly _asked = new Set<string>();

  /**
   * Ids whose last lookup did not answer.
   *
   * A signal rather than a plain set, because a screen reads it to decide what to draw
   * and has to redraw when it clears.
   */
  private readonly _failed = signal<ReadonlySet<string>>(new Set());

  /**
   * One product, or null.
   *
   * Null covers "not asked yet", "asked and gone", and "the request failed", and a
   * caller drawing a chip must not try to tell them apart: all three draw a chip with
   * no name. {@link anyFailed} is what separates the third, and it is asked about the
   * **set** rather than about the chip, because the sentence it produces is one line
   * under the whole set and not a mark on one product.
   */
  nameOf(itemId: string): CatalogItem | null {
    return this._byId().get(itemId) ?? null;
  }

  /** Whether any of these ids is unresolved because the lookup did not answer. */
  anyFailed(itemIds: readonly string[]): boolean {
    const failed = this._failed();
    return itemIds.some((itemId) => failed.has(itemId));
  }

  /**
   * Resolve a line's products, once.
   *
   * Only the ids nothing is known about are asked for, so opening the page after the
   * sheet costs nothing, and a line whose set has not changed costs nothing on a
   * redraw. Idempotent by design: both screens call it from an effect.
   */
  async ensure(itemIds: readonly string[]): Promise<void> {
    const missing = [...new Set(itemIds)].filter(
      (itemId) => itemId !== '' && !this._asked.has(itemId)
    );
    if (missing.length === 0) {
      return;
    }

    for (const itemId of missing) {
      this._asked.add(itemId);
    }

    const found = await this._catalog.itemsByIds(missing);

    if (found === null) {
      // Unasked, so a later visit retries rather than being permanently nameless, and
      // marked failed so the screen on it now can say the names could not be loaded
      // rather than that the line is empty.
      for (const itemId of missing) {
        this._asked.delete(itemId);
      }
      this._failed.update((current) => {
        const next = new Set(current);
        for (const itemId of missing) {
          next.add(itemId);
        }
        return next;
      });
      return;
    }

    this._absorb(found);

    // Cleared for every id in the request, not only the ones that came back. An id the
    // catalog answered about and does not have is resolved: it is a gone product, not
    // a failed lookup, and leaving it marked would put a failure line under a set that
    // was read perfectly well.
    this._failed.update((current) => {
      if (current.size === 0) {
        return current;
      }
      const next = new Set(current);
      for (const itemId of missing) {
        next.delete(itemId);
      }
      return next;
    });
  }

  /** Test seam: seed the cache without a request, as `MemberNames.prime` does. */
  prime(items: readonly CatalogItem[]): void {
    for (const item of items) {
      this._asked.add(item.id);
    }
    this._absorb(items);
  }

  private _absorb(items: readonly CatalogItem[]): void {
    if (items.length === 0) {
      return;
    }

    this._byId.update((current) => {
      const next = new Map(current);
      for (const item of items) {
        next.set(item.id, item);
      }
      return next;
    });
  }
}
