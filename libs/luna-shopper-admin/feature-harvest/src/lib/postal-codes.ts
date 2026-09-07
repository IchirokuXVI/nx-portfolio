import { inject } from '@angular/core';
import {
  HARVEST_SERVICE,
  PostalCodeSummaryStore,
} from '@portfolio/luna-shopper-admin/data-access';
import { defineResource } from '@portfolio/luna-shopper-admin/models';
import { PostalCodeAddPage } from './postal-code-add-page';
import { PostalCodeDetailPage } from './postal-code-detail-page';
import { PostalCodeQueueGateway } from './postal-code-queue-gateway';
import type { PostalCodeRow } from './postal-code-row';

/**
 * The five states a code in the queue can be in.
 *
 * `PARKED` is the fifth and it is not a claim about a run: every other value
 * says something happened, and this one says a row was created and no run was
 * asked for (backend plan 0097, section 6.1).
 */
const POSTAL_CODE_STATUS_OPTIONS = [
  { value: 'QUEUED', label: 'harvest.postalCodes.status.QUEUED' },
  { value: 'RUNNING', label: 'harvest.postalCodes.status.RUNNING' },
  { value: 'DONE', label: 'harvest.postalCodes.status.DONE' },
  { value: 'FAILED', label: 'harvest.postalCodes.status.FAILED' },
  { value: 'PARKED', label: 'harvest.postalCodes.status.PARKED' },
] as const;

/**
 * The postal codes somebody asked about, and what came of each (admin plan
 * 0021).
 *
 * velista tells a user it has no supermarkets for their postal code, and until
 * this screen there was no way to find out why. The code may never have been
 * looked at, or looked at and failed, or looked at and produced thirty places
 * nobody imported. Those are three problems with three fixes and they used to
 * look identical.
 *
 * **A descriptor rather than a hand written page**, unlike the rest of the
 * harvester section. A run is a process and a review queue is a decision, so
 * neither is a resource; this is a list with a search box, a create form, one
 * named action per row and a detail page, which is exactly the shape a
 * descriptor is. What it does not fit is the *gateway*, and that is written by
 * hand: see {@link PostalCodeQueueGateway}.
 *
 * **One filter, and it is the search box.** The whole table is the working set,
 * and hiding rows behind a status picker before anybody has looked at them is
 * how a queue gets forgotten. The route offers a status filter too and this
 * screen declines it: the list is short enough to read.
 *
 * **Nothing is sortable.** The harvester cannot order by a number core owns
 * (backend plan 0097, section 7), and a column header that looked sortable and
 * was not would be a worse lie than a plain column.
 */
export const POSTAL_CODES = defineResource<PostalCodeRow>({
  name: 'postal-codes',
  // Under the harvester, and `harvestRoutes` is what mounts it there. Every
  // action on this screen starts a run or reads what one produced, so an
  // operator arrives at it from where they arrive at the runs list.
  segment: 'postal-codes',
  labels: {
    one: 'harvest.postalCodes.one',
    many: 'harvest.postalCodes.many',
  },

  // The code, so a confirmation names the thing it is about. `title` is what
  // reaches a confirmation body as `name`, and "discover 14013 again" is the
  // sentence the operator has to agree with.
  title: (row) => row.postalCode,

  // The address is the code and not the uuid. There is no route that reads one
  // row by its uuid, and the URL of a screen whose subject is a number people
  // quote to each other should carry that number.
  rowId: (row) => row.postalCode,

  fields: [
    {
      kind: 'text',
      name: 'postalCode',
      label: 'harvest.postalCodes.field.postalCode',
      editable: false,
    },
    {
      kind: 'text',
      name: 'placeName',
      label: 'harvest.postalCodes.field.placeName',
      editable: false,
    },
    {
      kind: 'enum',
      name: 'status',
      label: 'harvest.postalCodes.field.status',
      options: POSTAL_CODE_STATUS_OPTIONS,
      editable: false,
    },
    {
      // Already relative words, formatted where the locale is known. A `date`
      // field would draw a clock time, and "eleven days ago" is the fact an
      // operator is reading this column for.
      kind: 'text',
      name: 'lastLooked',
      label: 'harvest.postalCodes.field.lastLooked',
      editable: false,
    },
    {
      kind: 'number',
      name: 'found',
      label: 'harvest.postalCodes.field.found',
      editable: false,
    },
    {
      kind: 'number',
      name: 'accepted',
      label: 'harvest.postalCodes.field.accepted',
      editable: false,
    },
    {
      // Null where core did not answer, which draws as nothing rather than as a
      // zero. The sentence above the list is what says which of the two it is.
      kind: 'number',
      name: 'waiting',
      label: 'harvest.postalCodes.field.waiting',
      nullable: true,
      editable: false,
    },
    {
      kind: 'number',
      name: 'attempts',
      label: 'harvest.postalCodes.field.attempts',
      editable: false,
    },
  ],

  list: {
    columns: [
      'postalCode',
      'placeName',
      'status',
      'lastLooked',
      'found',
      'accepted',
      'waiting',
      'attempts',
    ],
    // The demand and the attempt count are the two a phone gives up. Both are
    // context for a decision rather than the decision: what a code is, whether
    // we looked, and what came of it fit, and they are the row.
    compact: [
      'postalCode',
      'placeName',
      'status',
      'lastLooked',
      'found',
      'accepted',
    ],
  },

  filters: [
    {
      kind: 'search',
      param: 'postalCode',
      label: 'harvest.postalCodes.filter.postalCode',
    },
  ],

  actions: {
    create: true,
    named: () => {
      const harvest = inject(HARVEST_SERVICE);
      const summary = inject(PostalCodeSummaryStore);

      return [
        {
          name: 'discover-again',
          label: 'harvest.postalCodes.action.discoverAgain',
          // A row the harvester is working on right now cannot be queued again,
          // and the route refuses it. Saying so with a disabled control is
          // better than an error the operator has to read to learn the same.
          available: (row) => row.status !== 'RUNNING',
          confirm: {
            heading: 'harvest.postalCodes.confirm.discoverAgain.heading',
            body: 'harvest.postalCodes.confirm.discoverAgain.body',
            confirm: 'harvest.postalCodes.confirm.discoverAgain.confirm',
          },
          run: async (row) => {
            await harvest.requeuePostalCode(row.id);
            // The counts on the banner have just changed by one, and the list
            // is about to be read again anyway.
            await summary.load(true);
          },
        },
      ];
    },
  },

  notices: () => inject(PostalCodeQueueGateway).notices,

  editor: PostalCodeAddPage,
  detail: PostalCodeDetailPage,

  gateway: () => inject(PostalCodeQueueGateway),
});
