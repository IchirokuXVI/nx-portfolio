import { inject } from '@angular/core';
import { RESOURCE_GATEWAYS } from '@portfolio/luna-shopper-admin/data-access';
import {
  CONTENT_LOCALES,
  defineResource,
  localizedTextValue,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import { sectionSource } from './catalog-sources';

/** One section of one shop, as the gateway describes it. */
export type Section = Wire.CatalogShopSectionView;

/**
 * The sections of a shop (backend plan 0200, admin plan 0063).
 *
 * A **section** is a shop's own name for an aisle, mapped onto the app's
 * categories: Córdoba Centro's "Charcutería" wall, a bakery by the entrance.
 * Its categories are what it holds, a root meaning every category inside it.
 * It may hold none, and then no product is in it. A section belongs to one
 * shop: two shops of a chain hold different ones, and nothing is shared.
 *
 * **Two URLs, like shops.** A shop's sections are listed and created under
 * the shop, at `/locations/{id}/sections`, and one is read, changed and
 * deleted at `/sections/{id}`. So the shop is required before the list can be
 * read, and it is fixed once the section exists.
 *
 * **The slug is written once and is unique in its shop.** Two shops of one
 * chain can both have `fruteria`. One shop cannot have it twice.
 *
 * **The list is the shop's Sections tab**, `location-sections.ts`: it reads
 * these in order, says what each covers by name, reorders them and deletes
 * one, with a confirmation that says what goes with a section. This
 * descriptor is the form behind that tab, at
 * `/chains/{chainId}/shops/{shopId}/sections/new` and `.../sections/{id}`.
 * Its order is not a field: a new section goes last, and the tab moves it.
 */
export const SECTIONS = defineResource<Section>({
  name: 'sections',
  segment: 'sections',
  labels: { one: 'catalog.sections.one', many: 'catalog.sections.many' },

  // The shop is in the address.
  parent: {
    resource: 'locations',
    param: 'shopId',
    filter: 'supermarketLocationId',
  },

  title: (row, locales) => localizedTextValue(row.name, locales),

  fields: [
    {
      kind: 'text',
      name: 'id',
      label: 'catalog.sections.id',
      editable: false,
    },
    {
      kind: 'reference',
      name: 'supermarketLocationId',
      label: 'catalog.sections.supermarketLocationId',
      resource: 'locations',
      required: true,
      // In the URL a section is created at, and no update carries it.
      editable: 'create',
      nameLookup: true,
    },
    {
      kind: 'localized-text',
      name: 'name',
      label: 'catalog.sections.name',
      locales: CONTENT_LOCALES,
      required: true,
      maxLength: 200,
    },
    {
      kind: 'text',
      name: 'slug',
      label: 'catalog.sections.slug',
      help: 'catalog.sections.slugHelp',
      required: true,
      maxLength: 80,
      editable: 'create',
    },
    {
      kind: 'references',
      name: 'categoryIds',
      label: 'catalog.sections.categoryIds',
      help: 'catalog.sections.categoryIdsHelp',
      resource: 'categories',
      // A shop maps a few dozen categories at most, so one cached resolve per
      // id names the chips and the column.
      nameLookup: true,
      // Not a null: an empty list is an ordinary answer, a section that holds
      // no product yet. Declared so that a create sends it, because the
      // gateway requires the list and the form leaves an empty field out.
      nullable: true,
    },
  ],

  list: {
    columns: ['name', 'slug', 'categoryIds'],
    compact: ['slug', 'categoryIds'],
  },

  // Said under the field the refusal is about.
  errorFields: {
    section_slug_taken: 'slug',
    category_not_found: 'categoryIds',
  },

  // No delete here: the shop's Sections tab deletes, with a confirmation
  // that names what goes with it, and a generic "this row will be deleted"
  // would not.
  actions: { create: true, edit: true },

  gateway: () => inject(RESOURCE_GATEWAYS).for<Section>(sectionSource()),
});
