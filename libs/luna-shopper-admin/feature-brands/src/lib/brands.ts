import { inject } from '@angular/core';
import { defineResource } from '@portfolio/luna-shopper-admin/models';
import { BrandDetailPage } from './brand-detail-page';
import { BrandsGateway, type Brand } from './brands-gateway';

export type { Brand };

/**
 * The brands the catalog holds, and the screen that fills the registry (admin
 * plan 0027, section 2).
 *
 * A brand used to be free text on every product, so `+Proteínas` sat as a brand
 * on two dozen Mercadona products when it is a range of Hacendado, and nobody
 * could list the brands the catalog held because there was no such list. This is
 * that list, and the suggested brands screen beside it is where the rest of it
 * comes from.
 *
 * **The key is made and never typed.** `brandKey` takes everything but letters
 * and digits out of the label, which is how `El Pozo`, `ELPOZO` and `elpozo`
 * meet, and there is no `key` in any request body: editing the label is the only
 * thing that changes it. So the column renders and does not edit.
 *
 * **There is no delete** (backend plan 0115, section 9). A brand with products
 * on it is not a row to remove, and the route does not exist, so the descriptor
 * declares no delete rather than offering a control the server refuses.
 */
export const BRANDS = defineResource<Brand>({
  name: 'brands',
  // Under the harvester section, beside the suggested brands it is filled from.
  segment: 'brands',
  labels: {
    one: 'brands.registered.one',
    many: 'brands.registered.many',
  },

  // The label, which is the brand's name everywhere a person reads one. Not
  // localized: a brand is spelled the same in both content languages, which is
  // the whole reason one key can hold every chain's spelling of it.
  title: (row) => row.label,

  fields: [
    {
      kind: 'text',
      name: 'label',
      label: 'brands.registered.field.label',
      help: 'brands.registered.help.label',
      required: true,
      // `CreateBrandDto`'s own limit, and the column's.
      maxLength: 120,
    },
    {
      kind: 'text',
      name: 'key',
      label: 'brands.registered.field.key',
      help: 'brands.registered.help.key',
      // Made from the label by `brandKey`, and absent from every request body.
      // A control the server ignores would be worse than none: the operator
      // would type a key, watch the form succeed, and find it unchanged.
      editable: false,
    },
    {
      kind: 'reference',
      name: 'privateLabelSupermarketId',
      label: 'brands.registered.field.privateLabelSupermarketId',
      help: 'brands.registered.help.privateLabelSupermarketId',
      resource: 'supermarkets',
      // Chains number a handful, so one cached resolve per distinct id names the
      // column (admin plan 0023, section 4).
      nameLookup: true,
      // Most brands belong to nobody, and that is the resting state rather than
      // a missing value.
      nullable: true,
    },
    {
      kind: 'number',
      name: 'itemCount',
      label: 'brands.registered.field.itemCount',
      editable: false,
    },
    {
      kind: 'date',
      name: 'updatedAt',
      label: 'brands.registered.field.updatedAt',
      time: true,
      editable: false,
    },
  ],

  list: {
    columns: ['label', 'key', 'privateLabelSupermarketId', 'itemCount'],
    // The name and how much of the catalog is behind it. The key is derivable
    // from the label by eye, and the chain is what the filter above already
    // fixed in the one search where it matters.
    compact: ['label', 'itemCount'],
  },

  sorts: [
    { value: 'label', label: 'brands.registered.sort.label' },
    { value: 'itemCount', label: 'brands.registered.sort.itemCount' },
  ],

  filters: [
    {
      kind: 'search',
      param: 'query',
      label: 'brands.registered.filter.query',
    },
    {
      kind: 'reference',
      param: 'privateLabelSupermarketId',
      label: 'brands.registered.filter.privateLabelSupermarketId',
      resource: 'supermarkets',
      // **Not nullable**, unlike the field. The route takes a chain's uuid and
      // has no "none", so offering it would be a choice the gateway refuses.
    },
  ],

  // Create and edit, and no delete: the route does not exist.
  actions: { create: true, edit: true },

  // The generic form, plus one block the generic form cannot draw.
  detail: BrandDetailPage,

  // What a create linked, said once on the list it returns to.
  notices: () => inject(BrandsGateway).notices,

  gateway: () => inject(BrandsGateway),
});
