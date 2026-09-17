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
 * **A brand can be a spelling of another brand** (backend plan 0124). `DEBORAH
 * 48H` and `Deborah` are one brand and cannot share one key, so the spelling
 * keeps its own row and points at the brand it spells, one level deep, and its
 * products move with the link. That is the "Same brand as" field, the column
 * beside it and the filter above.
 *
 * **There is no delete on the list**, and the reason has narrowed rather than
 * gone. A brand with products on it is not a row to remove. A **spelling** of
 * another brand is: its products belong to the brand it spells, so deleting it
 * gives them back to nobody and returns the spelling to the suggestions. The
 * gateway takes only that one, and the control is on the detail screen where the
 * link that makes it legal is on the page. A list control would be a button
 * offered on every row and refused on all but a few.
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
      name: 'canonicalBrandId',
      label: 'brands.registered.field.canonicalBrandId',
      help: 'brands.registered.help.canonicalBrandId',
      // At itself, which is the point: a brand is a spelling of another brand.
      resource: 'brands',
      // The label rides the row, joined on the read, because brands are a large
      // target and one lookup per distinct id would be a request storm on a
      // list where most rows point somewhere. It is a plain string rather than a
      // localized text: a brand is spelled the same in both content languages.
      nameFrom: 'canonicalLabel',
      // Most brands are a spelling of nothing, and an emptied field sends null,
      // which is what unlinks.
      nullable: true,
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
    columns: [
      'label',
      'canonicalBrandId',
      'key',
      'privateLabelSupermarketId',
      'itemCount',
    ],
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
    {
      kind: 'reference',
      param: 'canonicalBrandId',
      label: 'brands.registered.filter.canonicalBrandId',
      resource: 'brands',
      // Not nullable either, and for the same reason: the route takes a brand's
      // uuid and answers its spellings. "Brands that are nobody's spelling" is
      // most of the registry, which is the unfiltered list.
    },
  ],

  // Which refusals name a row, and where that row lives (section 2.3). The form
  // draws the sentence and a link to the brand beside it; without one, an
  // operator reading "that link makes a chain of spellings" has to go and find
  // the brand it means.
  errorLinks: {
    brand_link_too_deep: {
      detail: 'brandId',
      resource: 'brands',
      label: 'brands.registered.links.open',
    },
    // An edit can raise this too: renaming a brand into a name that makes a key
    // another brand already holds.
    brand_key_taken: {
      detail: 'brandId',
      resource: 'brands',
      label: 'brands.registered.links.open',
    },
  },

  // Create and edit. Deleting a spelling is on the detail screen, because it is
  // legal for a linked brand alone and the list cannot say which rows those are
  // without a control refused on most of them.
  actions: { create: true, edit: true },

  // The generic form, plus the two blocks the generic form cannot draw.
  detail: BrandDetailPage,

  // What a create linked, or what an edit moved, said once on the list it
  // returns to.
  notices: () => inject(BrandsGateway).notices,

  gateway: () => inject(BrandsGateway),
});
