import { inject, Injectable } from '@angular/core';
import {
  CATALOG_BROWSE_SERVICE,
  type CatalogBrowseServiceI,
} from '@portfolio/velista/data-access';
import type { CatalogBrowseContext } from '@portfolio/velista/models';

/**
 * Where the person shops, read once for the catalog tab and its sheet.
 *
 * Provided by `CatalogPage`, so the product sheet drawn in the page's outlet asks
 * the same holder and reuses the answer rather than making the page's three reads
 * again on every tap. A sheet opened cold, with no page under it yet, still gets
 * the page's holder, because the page is the sheet's parent route and is created
 * first.
 *
 * A failed read is not kept: the next caller asks again, so a tap after the
 * connection came back does not inherit the old failure.
 */
@Injectable()
export class CatalogContext {
  private readonly _browse = inject<CatalogBrowseServiceI>(
    CATALOG_BROWSE_SERVICE
  );
  private _pending: Promise<CatalogBrowseContext | null> | null = null;

  load(): Promise<CatalogBrowseContext | null> {
    if (this._pending === null) {
      const pending = this._browse.context();
      this._pending = pending;
      void pending.then((answer) => {
        if (answer === null && this._pending === pending) {
          this._pending = null;
        }
      });
    }
    return this._pending;
  }
}
