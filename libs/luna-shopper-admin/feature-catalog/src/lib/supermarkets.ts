import { inject } from '@angular/core';
import { RESOURCE_GATEWAYS } from '@portfolio/luna-shopper-admin/data-access';
import {
  CONTENT_LOCALES,
  defineResource,
  localizedTextValue,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import { SUPERMARKETS_PATH } from './catalog-paths';
import { SUPERMARKET_SEED } from './supermarkets-seed';

/** A chain, as the gateway describes it. */
export type Supermarket = Wire.CatalogSupermarketView;

/**
 * Supermarkets, as a descriptor and nothing else (plan 0004, section 9).
 *
 * This file is the proof the plan asks for: the simplest entity, working end to
 * end through the generic list and the generic form, with no component of its
 * own. Everything peculiar to a supermarket is stated here, and everything
 * general is inherited.
 *
 * Two things about it are worth reading rather than skimming.
 *
 * **`name` is localized text, not a string.** It is a `jsonb` column with an
 * English and a Spanish entry, and the form renders one input per language. The
 * operator's own interface is English only, and that is a different list from
 * this one: the catalog is read by shoppers.
 *
 * **`defaultPriceScopeId` is not editable.** `UpdateSupermarketDto` has no such
 * property, so the gateway would ignore it. A field the form offered and the
 * server dropped is worse than one it does not offer: the operator would type a
 * value, see the form succeed, and find it unchanged. It still renders, as
 * text, because it is worth reading.
 */
export const SUPERMARKETS = defineResource<Supermarket>({
  name: 'supermarkets',
  segment: 'supermarkets',
  labels: {
    one: 'catalog.supermarkets.one',
    many: 'catalog.supermarkets.many',
  },

  title: (row) => localizedTextValue(row.name, CONTENT_LOCALES),

  fields: [
    {
      kind: 'text',
      name: 'id',
      label: 'catalog.supermarkets.id',
      editable: false,
    },
    {
      kind: 'localized-text',
      name: 'name',
      label: 'catalog.supermarkets.name',
      locales: CONTENT_LOCALES,
      required: true,
      // The gateway's own limit: `LocalizedTextDto` caps each entry at 200.
      maxLength: 200,
    },
    {
      kind: 'text',
      name: 'websiteUrl',
      label: 'catalog.supermarkets.websiteUrl',
      format: 'url',
      nullable: true,
    },
    {
      kind: 'text',
      name: 'logoUrl',
      label: 'catalog.supermarkets.logoUrl',
      format: 'url',
      nullable: true,
    },
    {
      kind: 'text',
      name: 'externalBrandKey',
      label: 'catalog.supermarkets.externalBrandKey',
      help: 'catalog.supermarkets.externalBrandKeyHelp',
      nullable: true,
    },
    {
      kind: 'reference',
      name: 'defaultPriceScopeId',
      label: 'catalog.supermarkets.defaultPriceScopeId',
      help: 'catalog.supermarkets.defaultPriceScopeIdHelp',
      resource: 'price-scopes',
      editable: false,
      nullable: true,
    },
  ],

  list: {
    columns: ['name', 'websiteUrl', 'externalBrandKey'],
    // The one piece of per entity judgement the generic list cannot make. A
    // chain is recognised by its name and, when two look alike, by the brand key
    // that tells Carrefour from Carrefour Express. Its website is not what
    // anybody is scanning a phone screen for.
    compact: ['name', 'externalBrandKey'],
  },

  sorts: [
    { value: 'name', label: 'catalog.supermarkets.sort.name' },
    { value: 'created', label: 'catalog.supermarkets.sort.created' },
    { value: 'updated', label: 'catalog.supermarkets.sort.updated' },
  ],

  // No filters. `GET /v1/admin/catalog/supermarkets` takes a cursor, a limit and
  // an order and nothing else, and a filter this app applied to the page it
  // happened to have would hide rows without saying so. Chains are a short list
  // anyway. `0005` adds one here if the route grows a query parameter.

  actions: { create: true, edit: true, delete: true },

  gateway: () =>
    inject(RESOURCE_GATEWAYS).for<Supermarket>({
      path: SUPERMARKETS_PATH,
      seed: SUPERMARKET_SEED,
    }),
});
