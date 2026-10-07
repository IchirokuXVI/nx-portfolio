import {
  computed,
  inject,
  Injectable,
  signal,
  type Signal,
} from '@angular/core';
import {
  HARVEST_SERVICE,
  RESOURCE_GATEWAYS,
  toGatewayError,
} from '@portfolio/luna-shopper-admin/data-access';
import { gatewayErrorKey } from '@portfolio/luna-shopper-admin/feature-resource';
import type { ItemScopePrices } from '../catalog-seed';
import { itemScopePricesSource } from '../catalog-sources';

/** How many scopes one page of a product's prices asks for. */
const SCOPE_PAGE_SIZE = 50;

/**
 * How many pages of scopes are read when a product opens.
 *
 * The gateway lists a chain's most specific scopes first, and it lists every
 * shop that only inherits a wider scope's price. So the scopes that hold a
 * price of their own can sit behind pages of shops that hold none. Reading
 * this far finds them for all but the largest chains. Past it the tab offers
 * the next page, and says no number it did not read.
 */
const SCOPE_PAGES_ON_OPEN = 5;

/**
 * Whether a scope holds a price of its own for the product.
 *
 * The gateway answers every scope at which the product is priced, and that
 * includes a shop that only inherits the price of a wider scope: its rows are
 * the wider scope's rows. Such a scope is not a place a price was written. A
 * scope with no row at all is one where only stock was said, and that is its
 * own.
 */
export function holdsOwnPrice(scope: ItemScopePrices): boolean {
  const rows = Array.isArray(scope.rows) ? scope.rows : [];
  return (
    rows.length === 0 ||
    rows.some((row) => row.priceScopeId === scope.priceScopeId)
  );
}

/**
 * How many source rows the count will read before it gives up. A product is
 * named by a handful of them. Past one page the tab shows no number and not a
 * number that is too small.
 */
const SOURCE_COUNT_PAGE = 50;

/** What the tabs of a product count, by the name of the tab. */
export type ProductTabCounts = Readonly<{
  prices: number | null;
  sources: number | null;
}>;

/**
 * What a product's page counts beside its tabs, and the price scopes its
 * Prices tab draws (admin plan 0055, section 2.2).
 *
 * The product itself is the record page's: its row, its delete and its
 * heading. What no field of the row holds is here, read once for the page and
 * the tab alike. Without it the header and the tab would each read the
 * scopes, and after a write they would disagree.
 *
 * `providedIn: 'root'`, because the page asks for it while it is built and
 * the tab is a route under the page. It holds one product, the one that is
 * open: {@link of} is the page opening a product, and everything read for
 * the one before is dropped.
 *
 * **A count is shown only when the gateway gave it.** The scopes are counted
 * when the first page is the last. The source rows the same.
 */
@Injectable({ providedIn: 'root' })
export class ProductCounts {
  private readonly _gateways = inject(RESOURCE_GATEWAYS);
  private readonly _harvest = inject(HARVEST_SERVICE);

  private readonly _id = signal<string | null>(null);

  private readonly _scopes = signal<readonly ItemScopePrices[]>([]);
  private readonly _scopesStatus = signal<'loading' | 'ready' | 'error'>(
    'loading'
  );
  private readonly _scopesErrorKey = signal<string | null>(null);
  private readonly _scopesCursor = signal<string | null>(null);
  private readonly _sourceCount = signal<number | null>(null);

  /** So that an answer for a product the page has left is dropped. */
  private _generation = 0;

  /** The product that is open, or `null` before the first. */
  readonly id = this._id.asReadonly();

  /** The product at every scope that holds a price for it, as far as read. */
  readonly scopes = this._scopes.asReadonly();
  readonly scopesStatus = this._scopesStatus.asReadonly();
  readonly scopesErrorKey = this._scopesErrorKey.asReadonly();
  /** Whether more scopes can be read. */
  readonly moreScopes = () => this._scopesCursor() !== null;

  /** The source rows that name the product, or `null` when not counted. */
  readonly sourceCount = this._sourceCount.asReadonly();

  /**
   * The counts beside the tabs of one product, for `record.counts`.
   *
   * The page asks once for each product it opens, and asking is what starts
   * the reads.
   */
  readonly of = (id: string): Signal<ProductTabCounts> => {
    void this.open(id);
    return computed(() =>
      this._id() === id
        ? { prices: this.scopeCount(), sources: this._sourceCount() }
        : { prices: null, sources: null }
    );
  };

  /**
   * How many scopes hold a price of their own for it, or `null` while there
   * are more scopes to read.
   */
  scopeCount(): number | null {
    return this._scopesStatus() === 'ready' && this._scopesCursor() === null
      ? this._scopes().filter(holdsOwnPrice).length
      : null;
  }

  /** Open a product. Everything held about the one before is dropped. */
  async open(id: string): Promise<void> {
    this._generation += 1;
    this._id.set(id);
    this._scopes.set([]);
    this._scopesStatus.set('loading');
    this._scopesErrorKey.set(null);
    this._scopesCursor.set(null);
    this._sourceCount.set(null);

    void this._readSourceCount(id, this._generation);
    await this.reloadPrices();
  }

  /**
   * Read the product's prices again, from the first page.
   *
   * After a price is added or removed the shown price of the scope is worked
   * out again by the server, so the scopes are read and never patched here.
   */
  async reloadPrices(): Promise<void> {
    const generation = this._generation;
    await this._readScopes(undefined);

    for (let page = 1; page < SCOPE_PAGES_ON_OPEN; page += 1) {
      const cursor = this._scopesCursor();
      if (
        cursor === null ||
        generation !== this._generation ||
        this._scopesStatus() !== 'ready' ||
        this._scopesErrorKey() !== null
      ) {
        return;
      }
      await this._readScopes(cursor);
    }
  }

  /** The next page of scopes, appended. */
  moreScopePrices(): Promise<void> {
    const cursor = this._scopesCursor();
    return cursor === null ? Promise.resolve() : this._readScopes(cursor);
  }

  private async _readScopes(cursor: string | undefined): Promise<void> {
    const id = this._id();
    if (id === null) {
      return;
    }
    const generation = this._generation;

    this._scopesErrorKey.set(null);
    if (this._scopes().length === 0) {
      this._scopesStatus.set('loading');
    }

    try {
      const page = await this._gateways
        .for<ItemScopePrices>(itemScopePricesSource())
        .list({ cursor, filters: { itemId: id }, limit: SCOPE_PAGE_SIZE });
      if (generation !== this._generation) {
        return;
      }
      this._scopes.update((held) =>
        cursor === undefined ? page.items : [...held, ...page.items]
      );
      this._scopesCursor.set(page.nextCursor);
      this._scopesStatus.set('ready');
    } catch (error) {
      if (generation !== this._generation) {
        return;
      }
      this._scopesErrorKey.set(
        gatewayErrorKey(toGatewayError(error)) ?? 'resource.error.unknown'
      );
      this._scopesStatus.set(this._scopes().length > 0 ? 'ready' : 'error');
    }
  }

  private async _readSourceCount(id: string, generation: number) {
    try {
      const page = await this._harvest.listItemEntries(id, {
        limit: SOURCE_COUNT_PAGE,
      });
      if (generation !== this._generation) {
        return;
      }
      const items = Array.isArray(page?.items) ? page.items : [];
      const whole = page?.nextCursor === null || page?.nextCursor === undefined;
      this._sourceCount.set(whole ? items.length : null);
    } catch {
      // The harvester did not answer. The tab then shows no number.
      if (generation === this._generation) {
        this._sourceCount.set(null);
      }
    }
  }
}
