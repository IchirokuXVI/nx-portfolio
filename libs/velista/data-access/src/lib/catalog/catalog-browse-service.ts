import { inject } from '@angular/core';
import { serviceToken } from '@portfolio/shared/data-access';
import type {
  CatalogBrowseContext,
  CatalogBrowseQuery,
  CatalogProduct,
  CatalogScopeOffer,
  Page,
} from '@portfolio/velista/models';
import { CatalogBrowseApi } from './catalog-browse-api';

/**
 * The catalog tab's reads (velista `0100`).
 *
 * ## Its own service, beside `CatalogServiceI`
 *
 * That interface says it will never list the catalog, and it was right about the
 * composer: a dropdown pages through nothing. This is the one screen whose whole
 * job is paging through it, one cursor page at a time and always narrowed by a
 * query, a chain or an order. Binding it apart keeps that promise true where it
 * was made, and lets the tab fail without taking the composer's suggestions with
 * it.
 *
 * ## Every read fails soft
 *
 * Each returns null when the request did not answer, never an empty answer. An
 * empty page is a fact about the catalog ("nothing matches") and null is a fact
 * about the request, and the screen draws the two differently.
 */
export interface CatalogBrowseServiceI {
  /**
   * Where the person shops and which chains that is: `GET /v1/catalog/scope`,
   * `GET /v1/catalog/shops/summary` and `GET /v1/catalog/supermarkets`, as one
   * answer. Null when the scope read failed.
   */
  context(): Promise<CatalogBrowseContext | null>;

  /** One cursor page of products (`GET /v1/catalog/items`). */
  browse(query: CatalogBrowseQuery): Promise<Page<CatalogProduct> | null>;

  /**
   * Every source row of one product, in every scope in the country
   * (`GET /v1/catalog/items/:id/offers`). The sheet keeps the person's own.
   */
  scopeOffers(itemId: string): Promise<readonly CatalogScopeOffer[] | null>;
}

/**
 * Inject this, typed as the interface, never a concrete class.
 *
 * The default is the real gateway, for the reason `CATALOG_SERVICE` gives. The
 * fake is asked for by name with
 * `{ provide: CATALOG_BROWSE_SERVICE, useExisting: CatalogBrowseMemory }`.
 */
export const CATALOG_BROWSE_SERVICE = serviceToken<CatalogBrowseServiceI>(
  'CATALOG_BROWSE_SERVICE',
  () => inject(CatalogBrowseApi)
);
