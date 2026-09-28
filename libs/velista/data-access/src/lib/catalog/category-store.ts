import { computed, inject, Injectable, signal } from '@angular/core';
import {
  buildCategoryTree,
  EMPTY_CATEGORY_TREE,
  type CategoryBranch,
  type CategoryNode,
  type CategoryTree,
} from '@portfolio/velista/models';
import { CATALOG_SERVICE, type CatalogServiceI } from './catalog-service';

/**
 * Where the tree read is: not asked yet, in flight, held, or failed the last time.
 */
export type CategoryTreeState = 'idle' | 'loading' | 'loaded' | 'failed';

/**
 * The catalog's category tree, read once per session (velista `0118`, section 4).
 *
 * The zone list sorts its categories by it now, and the category picker (`0119`) and
 * the aisles of a shop (`0120`) walk it. A product carries its own categories with
 * their names, so nothing here is needed to **name** one; what the tree adds is the
 * order, the parents, and the counts.
 *
 * ## It never blocks a screen
 *
 * Nothing waits on {@link ensure}. Until the tree lands every lookup misses and
 * {@link rank} answers null, which the sorts read as "first appearance order". When
 * it lands the signal changes and every `computed` over it re-sorts, with nothing
 * else moving. A failed read leaves the screens in that order and lets the next
 * {@link ensure} try again, so a session that started offline still gets the order
 * once it is back.
 *
 * ## Written by hand
 *
 * A plain `signal` set from the answer, like `RokuLocaleStore`, and no
 * `@angular/core/rxjs-interop`: this is a service every screen of the app shares,
 * which is exactly the kind CLAUDE.md says must not use it.
 */
// Provided by the app layer, never root: rule D5, like `ItemNames` beside it.
@Injectable()
export class CategoryStore {
  private readonly _catalog = inject<CatalogServiceI>(CATALOG_SERVICE);

  private readonly _tree = signal<CategoryTree>(EMPTY_CATEGORY_TREE);
  private readonly _state = signal<CategoryTreeState>('idle');

  /** The read in flight, so a second caller joins it rather than asking again. */
  private _pending: Promise<void> | null = null;

  /** Where the read is. */
  readonly state = this._state.asReadonly();

  /** The whole tree, empty until it lands. */
  readonly tree = this._tree.asReadonly();

  /** Whether the tree has landed this session. */
  readonly loaded = computed(() => this._state() === 'loaded');

  /** The roots, each with its children, both in `position` order. */
  readonly roots = computed<readonly CategoryBranch[]>(() => this._tree().roots);

  /** One row by id, or null for an id the tree does not hold, or before it lands. */
  byId(categoryId: string): CategoryNode | null {
    return this._tree().byId.get(categoryId) ?? null;
  }

  /** One row by slug, or null, for a URL that names a category (`0119`). */
  bySlug(slug: string): CategoryNode | null {
    return this._tree().bySlug.get(slug) ?? null;
  }

  /**
   * Where a row sits in walk order (a root, its children, the next root), for
   * sorting. Null for an id the tree does not hold, and for every id before it lands.
   *
   * An arrow, so it can be handed to a sort as it is.
   */
  readonly rank = (categoryId: string): number | null =>
    this._tree().ranks.get(categoryId) ?? null;

  /**
   * Read the tree, once per session.
   *
   * Idempotent, so every screen that wants the order calls it on its way in. Held
   * after the first answer; a failed read is retried by the next call.
   */
  ensure(): Promise<void> {
    if (this._state() === 'loaded') {
      return Promise.resolve();
    }
    if (this._pending !== null) {
      return this._pending;
    }

    this._state.set('loading');
    this._pending = this._read().finally(() => {
      this._pending = null;
    });
    return this._pending;
  }

  /** Test seam: hold these rows without a request, as `ItemNames.prime` does. */
  prime(rows: readonly CategoryNode[]): void {
    this._tree.set(buildCategoryTree(rows));
    this._state.set('loaded');
  }

  private async _read(): Promise<void> {
    let rows: readonly CategoryNode[] | null;
    try {
      rows = await this._catalog.categories();
    } catch {
      // The contract says it never throws. A double that does is still not
      // allowed to stop a screen.
      rows = null;
    }

    if (rows === null) {
      this._state.set('failed');
      return;
    }
    this._tree.set(buildCategoryTree(rows));
    this._state.set('loaded');
  }
}
