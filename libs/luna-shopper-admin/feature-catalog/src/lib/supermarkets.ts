import { inject, Injector } from '@angular/core';
import { RESOURCE_GATEWAYS } from '@portfolio/luna-shopper-admin/data-access';
import { RECORD_CONTEXT } from '@portfolio/luna-shopper-admin/feature-resource';
import {
  CONTENT_LOCALES,
  defineResource,
  localizedTextValue,
  type InfoContent,
  type RowState,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import { CHAIN_SECTIONS_TAB, ChainCounts } from './chains/chain-context';
import { ChainSectionsTab } from './chains/section-tabs';
import { SUPERMARKET_SEED } from './supermarkets-seed';

/** A chain, as the gateway describes it. */
export type Supermarket = Wire.CatalogSupermarketView;

/** Where the back office reads and writes chains (backend plan 0073). */
export const SUPERMARKETS_PATH = '/v1/admin/catalog/supermarkets';

/** What the info button of a chain's page says (admin plan 0042, target 10). */
const CHAIN_INFO: InfoContent = {
  title: 'catalog.chains.info.title',
  points: ['catalog.chains.info.holds', 'catalog.chains.info.openShop'],
};

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
 * **`defaultPriceScopeId` is editable on an existing chain only** (admin plan
 * 0034, section 2; backend plan 0153). A new chain is created with a
 * `NATIONAL` scope that catalog makes its default in the same write, so there
 * is nothing to pick at creation and `CreateSupermarketDto` has no property
 * for it. Afterwards `UpdateSupermarketDto` takes one, and the gateway refuses
 * a scope of another chain, so the picker offers this chain's scopes only.
 *
 * A chain with no default is a gap, not a resting state: chains made before
 * `0153` have none until somebody sets one. The chain's Price scopes tab is
 * where one is made the default.
 *
 * **A chain is a page, and its list is the column beside that page** (admin
 * plan 0042). The section mounts it at `/chains`, a chain at
 * `/chains/{chainId}`, and its shops, sections and price scopes are tabs of
 * that page. So the segment is `chains` and nothing mounts this as a flat
 * list.
 *
 * **The page is the record page** (admin plan 0056, section 3.1). The tabs
 * are the children of the `record` block, with Details last, so a chain
 * opens on its shops.
 */
export const SUPERMARKETS = defineResource<Supermarket>({
  name: 'supermarkets',
  segment: 'chains',
  labels: {
    one: 'catalog.supermarkets.one',
    many: 'catalog.supermarkets.many',
    create: 'catalog.supermarkets.add',
  },

  title: (row, locales) => localizedTextValue(row.name, locales),

  info: CHAIN_INFO,

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
      // Read as the picture beside its address, and checked as an address.
      format: 'image',
      nullable: true,
    },
    {
      kind: 'text',
      name: 'externalBrandKey',
      label: 'catalog.supermarkets.externalBrandKey',
      help: 'catalog.supermarkets.externalBrandKeyHelp',
      // An identifier that is copied letter by letter.
      format: 'code',
      nullable: true,
    },
    {
      kind: 'reference',
      name: 'defaultPriceScopeId',
      label: 'catalog.supermarkets.defaultPriceScopeId',
      help: 'catalog.supermarkets.defaultPriceScopeIdHelp',
      resource: 'price-scopes',
      editable: 'edit',
      nullable: true,
      // A chain holds a handful of scopes, so one cached resolve per id names
      // the column.
      nameLookup: true,
      scopeFrom: (row) =>
        typeof row.id === 'string' && row.id !== ''
          ? { supermarketId: row.id }
          : null,
      unsetFlag: 'catalog.supermarkets.noDefaultScope',
      // The same gap, said on the page of the chain where the value reads
      // "None": somebody has to pick one.
      check: (row) =>
        row.defaultPriceScopeId === null
          ? { label: 'catalog.supermarkets.noDefaultScope' }
          : null,
    },
    {
      kind: 'number',
      name: 'locationCount',
      label: 'catalog.supermarkets.locationCount',
      // Counted by catalog on every read of a chain (admin plan 0042, section
      // 2), and never typed.
      editable: false,
    },
  ],

  list: {
    columns: ['name', 'websiteUrl', 'externalBrandKey', 'defaultPriceScopeId'],
    // The one piece of per entity judgement the generic list cannot make. A
    // chain is recognised by its name and, when two look alike, by the brand key
    // that tells Carrefour from Carrefour Express. Its website is not what
    // anybody is scanning a phone screen for.
    compact: ['name', 'externalBrandKey', 'defaultPriceScopeId'],
    // In the column beside the open chain, a chain is its name and the shops
    // it holds.
    brief: { trailing: 'locationCount' },
  },

  // What the page of a chain draws (admin plan 0056, section 3.1). Details
  // is the last tab, so a chain opens on its shops.
  record: {
    details: 'last',
    // What the gateway refuses, said before it is asked.
    deleteBody: 'catalog.chains.deleteBody',
    sections: [
      {
        title: 'catalog.supermarkets.section.name',
        fields: ['name', 'websiteUrl', 'logoUrl', 'externalBrandKey'],
      },
      {
        title: 'catalog.supermarkets.section.prices',
        fields: ['defaultPriceScopeId'],
      },
    ],
    children: [
      // A split with a shop open inside it, so `chainsRoutes` hands the
      // route over. The count is a field of the chain.
      {
        as: 'tab',
        resource: 'locations',
        by: 'supermarketId',
        count: 'locationCount',
      },
      {
        as: 'tab',
        name: CHAIN_SECTIONS_TAB,
        label: 'catalog.chains.tabs.sections',
        component: ChainSectionsTab,
      },
      { as: 'tab', resource: 'price-scopes', by: 'supermarketId' },
    ],
    // No field of a chain holds either count: its sections and its price
    // scopes are each another read.
    counts: () => inject(ChainCounts).of,
  },

  /**
   * What a chain says beside its name.
   *
   * A chain with no default scope is a gap somebody has to close, so the
   * column says so on the row. The flat list flagged it in a column of its
   * own, and the column of chains has no such column to flag it in.
   *
   * **Whether the harvester fetches the chain is said on the page of the
   * chain alone** (admin plan 0056, target 2). It is another read, made for
   * the one chain that is open, so a row of the column never says it. The
   * page is found when a row is asked about and not when this is built: the
   * page builds its states while it is itself being built.
   */
  rowStates: () => {
    const counts = inject(ChainCounts);
    const injector = inject(Injector);

    return (row) => {
      const states: RowState[] = [];
      const page = injector.get(RECORD_CONTEXT, null, { optional: true });
      const source =
        page !== null && page.descriptor.name === 'supermarkets'
          ? counts.sourceOf(row.id)
          : null;
      if (source === 'fetched') {
        states.push({ label: 'catalog.chains.source.fetched', tone: 'good' });
      } else if (source === 'off') {
        states.push({ label: 'catalog.chains.source.off', tone: 'neutral' });
      }
      if (row.defaultPriceScopeId === null) {
        states.push({
          label: 'catalog.supermarkets.noDefaultScope',
          tone: 'waiting',
        });
      }
      return states;
    };
  },

  sorts: [
    { value: 'name', label: 'catalog.supermarkets.sort.name' },
    { value: 'created', label: 'catalog.supermarkets.sort.created' },
    { value: 'updated', label: 'catalog.supermarkets.sort.updated' },
  ],

  // The route now takes the query parameter this waited for, so the filter the
  // earlier comment here deferred exists. It matters most where it is least
  // visible: a reference field pointing at chains is a picker over one page of
  // twenty, and a descriptor with no search filter has nowhere to put the term,
  // so it dropped it and asked for that page. The picker answered every search
  // with the same twenty chains, and a chain past the twentieth could not be
  // reached by typing its name at all.
  filters: [
    {
      kind: 'search',
      param: 'query',
      label: 'catalog.supermarkets.filter.query',
    },
  ],

  actions: { create: true, edit: true, delete: true },

  gateway: () =>
    inject(RESOURCE_GATEWAYS).for<Supermarket>({
      path: SUPERMARKETS_PATH,
      seed: SUPERMARKET_SEED,
    }),
});
