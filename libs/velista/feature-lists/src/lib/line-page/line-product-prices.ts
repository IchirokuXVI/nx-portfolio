import { inject, Injectable, signal } from '@angular/core';
import {
  CATALOG_BROWSE_SERVICE,
  type CatalogBrowseServiceI,
} from '@portfolio/velista/data-access';
import {
  productShopPrices,
  type CatalogBrowseContext,
  type LineProductPriceRead,
  type ProductShopPrice,
} from '@portfolio/velista/models';

/**
 * What the supermarkets near the reader charge for the products of one line
 * (velista `0135`, section 3).
 *
 * The read the product page uses, `scopeOffers` over the reader's own context,
 * held for one visit of the line page. The page provides it, so the supermarket
 * sheet over the page reads the same answers and asks for nothing twice.
 *
 * **A product is read once, and only when somebody asks for it.** A line can hold
 * a hundred products and the rail shows two and a half, so the page asks for the
 * cards on screen and the next two, and for more as the rail scrolls.
 *
 * Signals written by hand, with no `rxjs-interop` (CLAUDE.md).
 */
@Injectable()
export class LineProductPrices {
  private readonly _browse = inject<CatalogBrowseServiceI>(
    CATALOG_BROWSE_SERVICE
  );

  /**
   * Where the reader shops. `undefined` before the read, null when it failed.
   */
  private readonly _context = signal<CatalogBrowseContext | null | undefined>(
    undefined
  );
  readonly context = this._context.asReadonly();

  private readonly _reads = signal<
    ReadonlyMap<string, readonly ProductShopPrice[] | null>
  >(new Map());

  private _contextRead: Promise<CatalogBrowseContext | null> | null = null;
  private readonly _asked = new Set<string>();

  /** The prices of one product, as `lineProductPrices` reads them. */
  readonly priceOf = (itemId: string): LineProductPriceRead => {
    const context = this._context();
    if (context === null) {
      return null;
    }
    return this._reads().get(itemId);
  };

  /** Read the prices of these products, those not asked for yet. */
  async ensure(itemIds: readonly string[]): Promise<void> {
    const wanted = itemIds.filter((itemId) => !this._asked.has(itemId));
    for (const itemId of wanted) {
      this._asked.add(itemId);
    }

    const context = await this._loadContext();
    if (context === null) {
      // Nothing is kept, so the next call asks again once the context answers.
      for (const itemId of wanted) {
        this._asked.delete(itemId);
      }
      return;
    }

    await Promise.all(wanted.map((itemId) => this._read(itemId, context)));
  }

  private _loadContext(): Promise<CatalogBrowseContext | null> {
    if (this._contextRead === null) {
      const read = this._browse.context();
      this._contextRead = read;
      void read.then((context) => {
        this._context.set(context);
        // A failed read is not kept: the next caller asks again.
        if (context === null && this._contextRead === read) {
          this._contextRead = null;
        }
      });
    }
    return this._contextRead;
  }

  private async _read(
    itemId: string,
    context: CatalogBrowseContext
  ): Promise<void> {
    // With no place to shop nothing is priced, and nothing has to be asked.
    const rows =
      context.scopes.length === 0 ? [] : await this._browse.scopeOffers(itemId);

    this._reads.update((reads) => {
      const next = new Map(reads);
      next.set(itemId, rows === null ? null : productShopPrices(rows, context));
      return next;
    });

    if (rows === null) {
      // So a later call retries the product that failed.
      this._asked.delete(itemId);
    }
  }
}
