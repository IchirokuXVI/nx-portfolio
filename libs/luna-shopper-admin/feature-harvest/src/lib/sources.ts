import { inject } from '@angular/core';
import { defineResource } from '@portfolio/luna-shopper-admin/models';
import {
  SOURCE_ADAPTERS,
  SourcesGateway,
  type Source,
} from './sources-gateway';

export type { Source };

/**
 * How the harvester fetches one chain: which adapter, how many workers, how
 * fast, and whether it may run at all (admin plan 0059).
 *
 * It was the one record of the back office with no descriptor: a page of its
 * own drew a list, a form to add a source and a form inside each row. It is a
 * resource like the others now, with the generic list and the record page.
 *
 * **A source is keyed on its chain.** Every route of the harvester takes the
 * ID of the chain, so that is the address of the record and what the gateway
 * is asked for. The chain is chosen when the source is added and is fixed
 * afterwards: the upsert of another chain writes a second source and does
 * not move this one.
 *
 * **Whether a chain may be fetched is not a field of the form** (section 5 of
 * the plan). `enabled` is a row for each chain, off by default (backend plan
 * 0083), and it permits a crawl of a storefront. A switch changes with Save
 * like every other field, and this change must not wait on a Save nor ride
 * along with one. So the page reads it as "Yes" or "No", and the two named
 * actions change it, each after its own question.
 *
 * **"Places are added with no review" is a switch of the form.** It is a
 * setting that is thought about, and no run waits on it.
 */
export const SOURCES = defineResource<Source>({
  name: 'sources',
  // Under the Setup tab of the harvester, where `harvestRoutes` mounts it.
  segment: 'sources',
  labels: {
    one: 'harvest.sources.one',
    many: 'harvest.sources.many',
    // `one` is written as a heading. A sentence takes this one.
    noun: 'harvest.sources.noun',
    create: 'harvest.sources.add',
  },

  // The chain, because that is the key every route of the harvester takes.
  rowId: (row) => row.supermarketId,

  // The name of the chain. A source whose chain cannot be named is headed by
  // its adapter, and never by an ID.
  title: (row) => row.chainName ?? row.adapterKey,

  fields: [
    {
      kind: 'reference',
      name: 'supermarketId',
      label: 'harvest.sources.field.chain',
      resource: 'supermarkets',
      required: true,
      // A source cannot be moved to another chain: see above.
      editable: 'create',
      // Chains number a handful, so one cached resolve for each names the
      // column (admin plan 0023, section 4).
      nameLookup: true,
    },
    {
      kind: 'enum',
      name: 'adapterKey',
      label: 'harvest.sources.field.adapter',
      required: true,
      // The key itself is the label: it is the word the settings, the runs
      // and the logs name an adapter by.
      options: SOURCE_ADAPTERS.map((key) => ({
        value: key,
        label: `harvest.sources.adapter.${key}`,
      })),
    },
    {
      kind: 'number',
      name: 'workers',
      label: 'harvest.sources.field.workers',
      integer: true,
      // The column takes no null. An emptied box was left out of what the
      // form sent, so the save kept the old number and said it went through.
      required: true,
      // The limits of `UpsertSupermarketSourceDto`.
      min: 1,
      max: 64,
    },
    {
      kind: 'number',
      name: 'maxRequestsPerSecond',
      label: 'harvest.sources.field.rate',
      // For the reason `workers` is.
      required: true,
      min: 0.1,
      max: 100,
    },
    {
      kind: 'boolean',
      name: 'enabled',
      label: 'harvest.sources.field.enabled',
      help: 'harvest.sources.help.enabled',
      // Changed by the two named actions and by nothing else.
      editable: false,
      setBy: 'harvest.sources.enabledSetBy',
    },
    {
      kind: 'boolean',
      name: 'autoImportPlaces',
      label: 'harvest.sources.field.autoImportPlaces',
      help: 'harvest.sources.help.autoImportPlaces',
    },
    {
      kind: 'json',
      name: 'config',
      label: 'harvest.sources.field.config',
      help: 'harvest.sources.config.hint',
      // An emptied box is an answer: "no settings at all", as the help says.
      // With this the form sends `{}` for it. Without it the form sent
      // nothing, and the save kept the settings that were there.
      nullable: true,
    },
    {
      kind: 'date',
      name: 'lastRunAt',
      label: 'harvest.sources.field.lastRunAt',
      time: true,
      nullable: true,
      editable: false,
    },
    {
      kind: 'date',
      name: 'lastSuccessAt',
      label: 'harvest.sources.field.lastSuccessAt',
      time: true,
      nullable: true,
      editable: false,
    },
    {
      kind: 'number',
      name: 'consecutiveFailures',
      label: 'harvest.sources.field.failures',
      editable: false,
    },
  ],

  list: {
    columns: [
      'supermarketId',
      'adapterKey',
      'lastRunAt',
      'consecutiveFailures',
    ],
    // The chain and how it is fetched. The state beside them says whether it
    // is, and the rest is on the record.
    compact: ['supermarketId', 'adapterKey'],
    // A list with no source is why no run can be started, so it says that.
    empty: 'harvest.sources.empty',
  },

  // Raising either number too far gets the chain to block the crawl, which
  // cannot be taken back from here (admin plan 0041, section 3).
  caution: 'harvest.sources.caution',

  rowStates: () => (row) => [
    row.enabled
      ? { label: 'harvest.sources.state.fetched', tone: 'good' }
      : { label: 'harvest.sources.state.off', tone: 'neutral' },
  ],

  actions: {
    create: true,
    edit: true,
    delete: true,
    named: () => {
      const sources = inject(SourcesGateway);
      // Neither destroys: each is taken back by the other, with one press
      // and one answer.
      return [
        {
          name: 'stop-fetching',
          label: 'harvest.sources.action.stop',
          available: (row) => row.enabled,
          confirm: {
            heading: 'harvest.sources.confirm.stop.heading',
            body: 'harvest.sources.confirm.stop.body',
            confirm: 'harvest.sources.confirm.stop.confirm',
          },
          run: (row) => sources.setEnabled(row.supermarketId, false),
        },
        {
          name: 'allow-fetching',
          label: 'harvest.sources.action.allow',
          available: (row) => !row.enabled,
          confirm: {
            heading: 'harvest.sources.confirm.allow.heading',
            body: 'harvest.sources.confirm.allow.body',
            confirm: 'harvest.sources.confirm.allow.confirm',
          },
          run: (row) => sources.setEnabled(row.supermarketId, true),
        },
      ];
    },
  },

  // What the record page draws (section 2 of the plan). The view carries no
  // date of its own making, so the Record block has no "Added".
  record: {
    sections: [
      {
        title: 'harvest.sources.section.source',
        fields: ['supermarketId', 'adapterKey'],
      },
      {
        title: 'harvest.sources.section.speed',
        fields: ['workers', 'maxRequestsPerSecond'],
      },
      {
        title: 'harvest.sources.section.may',
        fields: ['enabled', 'autoImportPlaces', 'config'],
      },
    ],
    facts: { also: ['lastRunAt', 'lastSuccessAt', 'consecutiveFailures'] },
  },

  gateway: () => inject(SourcesGateway),
});
