import { inject } from '@angular/core';
import { RESOURCE_GATEWAYS } from '@portfolio/luna-shopper-admin/data-access';
import {
  CONTENT_LOCALES,
  defineResource,
  localizedTextValue,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import { sectionSource } from './catalog-sources';

/** One aisle of one chain, as the gateway describes it. */
export type Section = Wire.CatalogSupermarketSectionView;

/**
 * A chain's sections (backend plan 0167, admin plan 0037, target 1).
 *
 * A **section** is the chain's own name for an aisle, mapped onto the app's
 * categories: Mercadona's "Charcutería" wall, LIDL's bakery by the entrance.
 * Its categories are what it holds, a root meaning every category inside it,
 * and it may hold none at all: an aisle of whatever is on offer this week has
 * only the products somebody pinned to it.
 *
 * **Two URLs, like shops.** A chain's sections are listed and created under
 * the chain, at `/supermarkets/{id}/sections`, and one is read, changed and
 * deleted at `/sections/{id}`. So the chain is required before the list can
 * be read, and it is fixed once the section exists.
 *
 * **The slug is written once.** It is how a file naming a chain's aisles will
 * address them, and two sections called "Frescos" in one chain is a mistake
 * worth refusing, so the chain refuses a slug it already holds.
 *
 * **The list is the chain's Sections tab** (admin plan 0042), which is
 * `chain-sections.ts`: it reads these in order, says what each covers by name,
 * moves one up or down and deletes one, with a confirmation that says what
 * goes with a section. This descriptor is the form behind that tab, at
 * `/chains/{chainId}/sections/new` and `/chains/{chainId}/sections/{id}`.
 */
export const SECTIONS = defineResource<Section>({
  name: 'sections',
  segment: 'sections',
  labels: { one: 'catalog.sections.one', many: 'catalog.sections.many' },

  // The chain is in the address.
  parent: { resource: 'supermarkets', param: 'chainId', filter: 'supermarketId' },

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
      name: 'supermarketId',
      label: 'catalog.sections.supermarketId',
      resource: 'supermarkets',
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
      kind: 'number',
      name: 'position',
      label: 'catalog.sections.position',
      help: 'catalog.sections.positionHelp',
      integer: true,
      min: 0,
    },
    {
      kind: 'references',
      name: 'categoryIds',
      label: 'catalog.sections.categoryIds',
      help: 'catalog.sections.categoryIdsHelp',
      resource: 'categories',
      // A chain maps a few dozen categories at most, so one cached resolve per
      // id names the chips and the column.
      nameLookup: true,
      // Not a null: an empty list is an ordinary answer, a section that holds
      // only pinned products. Declared so that a create sends it, because the
      // gateway requires the list and the form leaves an empty field out.
      nullable: true,
    },
    {
      kind: 'number',
      name: 'locationCount',
      label: 'catalog.sections.locationCount',
      help: 'catalog.sections.locationCountHelp',
      editable: false,
    },
  ],

  list: {
    columns: ['position', 'name', 'slug', 'categoryIds', 'locationCount'],
    compact: ['slug', 'categoryIds', 'locationCount'],
  },

  filters: [
    {
      kind: 'search',
      param: 'query',
      label: 'catalog.sections.filter.query',
    },
  ],

  // Said under the field the refusal is about.
  errorFields: {
    section_slug_taken: 'slug',
    category_not_found: 'categoryIds',
  },

  // No delete here: the chain's Sections tab deletes, with a confirmation
  // that names what goes with it, and a generic "this row will be deleted"
  // would not.
  actions: { create: true, edit: true },

  gateway: () => inject(RESOURCE_GATEWAYS).for<Section>(sectionSource()),
});
