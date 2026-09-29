import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  ApiUrl,
  RESOURCE_GATEWAYS,
  ResourceMemoryGateways,
  toGatewayError,
} from '@portfolio/luna-shopper-admin/data-access';
import type { Wire } from '@portfolio/luna-shopper-admin/models';
import { firstValueFrom } from 'rxjs';
import {
  categorySource,
  ITEMS_BATCH_PATH,
  itemSource,
} from './catalog-sources';
import { resolveItemCategories } from './category-rules';

/** One product, and the categories it is to have, in the order meant. */
export interface CategoryChange {
  readonly itemId: string;
  readonly categoryIds: readonly string[];
}

/**
 * Sets the categories of many products in one request (admin plan 0036;
 * backend plan 0166, section 3).
 *
 * `PATCH /v1/admin/catalog/items/batch`, one entry per product carrying
 * `categoryIds`, which **replaces** each product's set. The route is one
 * transaction and all or nothing: the first refusal refuses the whole request
 * with one problem document and nothing is written, so this answers every
 * product as it now stands, or throws that one refusal. There is no per product
 * outcome to report, because no product moves on its own.
 *
 * Shaped like `ProductGroupAssignments`: over HTTP when the app bound it, and
 * against the memory item table otherwise, so the screens work with nothing
 * listening.
 */
@Injectable({ providedIn: 'root' })
export class ProductCategoriesBatch {
  private readonly _gateways = inject(RESOURCE_GATEWAYS);
  private readonly _http = inject(HttpClient, { optional: true });
  private readonly _urls = inject(ApiUrl, { optional: true });

  async set(
    changes: readonly CategoryChange[]
  ): Promise<readonly Wire.CatalogItemView[]> {
    if (this._gateways instanceof ResourceMemoryGateways) {
      return this._setInMemory(changes);
    }
    const http = this._http;
    const urls = this._urls;
    if (http === null || urls === null) {
      throw new Error(
        'ProductCategoriesBatch needs HttpClient and ApiUrl when the gateways are not in memory.'
      );
    }

    const body: Wire.UpdateItemsDto = {
      items: changes.map((change) => ({
        itemId: change.itemId,
        categoryIds: [...change.categoryIds],
      })),
    };

    let answer: unknown;
    try {
      answer = await firstValueFrom(
        http.patch<unknown>(urls.gateway(ITEMS_BATCH_PATH), body)
      );
    } catch (error) {
      throw toGatewayError(error);
    }
    return toBatchAnswer(answer);
  }

  /**
   * The same rule against the memory tables: every product and every category
   * is checked before anything is written, and one refusal refuses the lot.
   */
  private async _setInMemory(
    changes: readonly CategoryChange[]
  ): Promise<readonly Wire.CatalogItemView[]> {
    const items = this._gateways.for<Wire.CatalogItemView>(itemSource());
    const tree = await this._gateways
      .for<Wire.CatalogCategoryView>(categorySource())
      .list({ limit: 1000 });

    for (const change of changes) {
      await items.read(change.itemId);
      resolveItemCategories(change.categoryIds, tree.items);
    }

    const written: Wire.CatalogItemView[] = [];
    for (const change of changes) {
      written.push(
        await items.update(change.itemId, {
          categoryIds: [...change.categoryIds],
        })
      );
    }
    return written;
  }
}

/**
 * A batch answer, read from `unknown` (rule D4): the products in request
 * order. The rows themselves are the generated wire type, which is this app's
 * recorded exception (admin plan 0004, section 2).
 */
export function toBatchAnswer(
  answer: unknown
): readonly Wire.CatalogItemView[] {
  const record =
    typeof answer === 'object' && answer !== null
      ? (answer as Record<string, unknown>)
      : {};
  const items = record['items'];
  return Array.isArray(items)
    ? (items.filter(
        (entry) => typeof entry === 'object' && entry !== null
      ) as Wire.CatalogItemView[])
    : [];
}
