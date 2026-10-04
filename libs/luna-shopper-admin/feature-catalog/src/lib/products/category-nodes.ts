import { computed, inject, Injectable, signal } from '@angular/core';
import {
  ContentLocaleStore,
  RESOURCE_GATEWAYS,
  toGatewayError,
} from '@portfolio/luna-shopper-admin/data-access';
import { gatewayErrorKey } from '@portfolio/luna-shopper-admin/feature-resource';
import {
  localizedTextValue,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import type { CategoryTreeNode } from '@portfolio/luna-shopper-admin/ui';
import { categorySource } from '../catalog-sources';

/** How many categories one read asks for. The gateway's own maximum. */
const PAGE_SIZE = 100;

/**
 * How many pages the tree is read to. The tree is a few dozen rows, so this is
 * one request. The bound stops a walk nobody meant.
 */
const MAX_PAGES = 10;

/** A category, as the gateway describes it. */
type CategoryRow = Wire.CatalogCategoryView;

/** A category of the tree with the row it was built from. */
export interface CategoryNode extends CategoryTreeNode {
  readonly row: CategoryRow;
  readonly children: readonly CategoryNode[];
}

/**
 * The two levels of the tree, from the flat rows: each top level category by
 * position, with the categories inside it by position.
 *
 * A category whose parent is not among the rows is drawn at the top level, so
 * that a row is never lost to a parent a page did not carry.
 */
export function toCategoryNodes(
  rows: readonly CategoryRow[],
  locales: readonly string[]
): CategoryNode[] {
  const ids = new Set(rows.map((row) => row.id));
  const byPosition = (a: CategoryRow, b: CategoryRow) =>
    (a.position ?? 0) - (b.position ?? 0);
  const node = (row: CategoryRow): CategoryNode => ({
    id: row.id,
    name: localizedTextValue(row.name, locales) || row.slug,
    count: typeof row.itemCount === 'number' ? row.itemCount : null,
    children: rows
      .filter((child) => child.parentId === row.id)
      .sort(byPosition)
      .map(node),
    row,
  });

  return rows
    .filter((row) => row.parentId === null || !ids.has(row.parentId))
    .sort(byPosition)
    .map(node);
}

/**
 * The category tree, read whole (admin plan 0043, targets 2 and 5).
 *
 * The product list draws it as a column that narrows the list, and the
 * Categories tab draws it as the thing being edited. Each of them builds one
 * of these, so each reads when it opens and neither shows the other's stale
 * rows.
 *
 * **The rows are kept as the gateway gave them and the names are worked out
 * on read**, in the language the operator reads the catalog in. A switch of
 * that language therefore renames the tree at once. The rows are also read
 * again, as the list is: the server orders a listing in the caller's language.
 */
@Injectable()
export class CategoryTreeStore {
  private readonly _gateways = inject(RESOURCE_GATEWAYS);
  private readonly _content = inject(ContentLocaleStore);

  private readonly _rows = signal<readonly CategoryRow[]>([]);
  private readonly _status = signal<'loading' | 'ready' | 'error'>('loading');
  private readonly _errorKey = signal<string | null>(null);

  /** So that an answer for a read the store has moved on from is dropped. */
  private _generation = 0;

  readonly status = this._status.asReadonly();
  readonly errorKey = this._errorKey.asReadonly();
  readonly rows = this._rows.asReadonly();

  /** The tree, named in the language the catalog is read in. */
  readonly nodes = computed(() =>
    toCategoryNodes(this._rows(), this._content.order())
  );

  /** Every category by id, for a screen that names the chosen one. */
  readonly byId = computed(
    () => new Map(this._rows().map((row) => [row.id, row]))
  );

  /** A category's name in the language the catalog is read in, or `''`. */
  nameOf(id: string): string {
    const row = this.byId().get(id);
    return row === undefined
      ? ''
      : localizedTextValue(row.name, this._content.order()) || row.slug;
  }

  /** Read every category again, keeping what is on screen meanwhile. */
  async load(): Promise<void> {
    this._generation += 1;
    const generation = this._generation;
    const gateway = this._gateways.for(categorySource());
    const rows: CategoryRow[] = [];
    let cursor: string | undefined;

    try {
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const answer = await gateway.list({ cursor, limit: PAGE_SIZE });
        rows.push(...answer.items);
        if (answer.nextCursor === null) {
          break;
        }
        cursor = answer.nextCursor;
      }
      if (generation !== this._generation) {
        return;
      }
      this._rows.set(rows);
      this._errorKey.set(null);
      this._status.set('ready');
    } catch (error) {
      if (generation !== this._generation) {
        return;
      }
      this._errorKey.set(
        gatewayErrorKey(toGatewayError(error)) ?? 'resource.error.unknown'
      );
      this._status.set('error');
    }
  }

  /** Delete a category. Throws what the gateway refused. */
  async remove(id: string): Promise<void> {
    await this._gateways.for(categorySource()).remove(id);
    await this.load();
  }
}
