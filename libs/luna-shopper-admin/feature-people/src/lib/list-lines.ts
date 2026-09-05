import { inject } from '@angular/core';
import {
  ADMIN_LIST_LINES_PATH,
  DIRECTORY_SERVICE,
  LIST_LINE_KEY,
  listLinePath,
  listLinesPath,
  RESOURCE_GATEWAYS,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  compositeIdOf,
  compositeParts,
  defineResource,
} from '@portfolio/luna-shopper-admin/models';
import { LIST_LINE_SEED, type ListLineRow } from './people-seed';

/** One thing written on a standing list, as the back office reads it. */
export type ListLine = ListLineRow;

/** The bounds core puts on a quantity, repeated so the form refuses first. */
const QUANTITY_MIN = 0;
const QUANTITY_MAX = 100000;

/** How far a line can get, which is the whole of `LineApprovalStatus`. */
export const LINE_APPROVAL_OPTIONS = [
  { value: 'PENDING', label: 'people.lists.approval.PENDING' },
  { value: 'APPROVED', label: 'people.lists.approval.APPROVED' },
  { value: 'REJECTED', label: 'people.lists.approval.REJECTED' },
] as const;

/**
 * One line at a time (plan 0009, section 4.2).
 *
 * The list detail screen still draws every line, because reading what a
 * household wrote down is what that screen is for. This is the other question:
 * correct **this** line's wording or its quantity.
 *
 * What is deliberately missing, and why:
 *
 * - **No create.** `createdByUserId` is not nullable and an operator is not a
 *   user, so a line attributed to nobody would break the attribution every list
 *   screen renders. The list says so where the create control would be (backend
 *   plan 0077, section 6.4).
 * - **`approvalStatus` is not editable.** It is one route and one service call,
 *   and an act can be confirmed while a select cannot. The two acts are beside
 *   it.
 * - **No control for the line's product set.** It is a set of catalog items with
 *   bounds of its own, an operator has no reason to curate it, and the route
 *   exists without this screen needing to offer it (plan 0009, section 10).
 *
 * An operator's edit reaches core with `MANAGE`, so an approved line stays
 * approved: a correction that silently un-approved somebody's line would be a
 * second change nobody asked for, seen by everyone in the zone. A rejected line
 * still reopens, because that rule applies to everyone.
 */
export const LIST_LINES = defineResource<ListLine>({
  name: 'list-lines',
  segment: 'list-lines',
  labels: { one: 'people.lines.one', many: 'people.lines.many' },

  // The pair, because a line's own id addresses nothing on its own: every route
  // that reaches one names the list first.
  rowId: (row) => compositeIdOf(row, LIST_LINE_KEY),

  title: (row) => row.content,

  fields: [
    {
      kind: 'text',
      name: 'id',
      label: 'people.lines.id',
      help: 'people.field.idHelp',
      editable: false,
    },
    {
      kind: 'reference',
      name: 'listId',
      label: 'people.lines.listId',
      resource: 'lists',
      editable: false,
      help: 'people.lines.listIdHelp',
    },
    {
      kind: 'text',
      name: 'content',
      label: 'people.lines.content',
      required: true,
      maxLength: 400,
    },
    {
      kind: 'number',
      name: 'quantity',
      label: 'people.lines.quantity',
      integer: true,
      min: QUANTITY_MIN,
      max: QUANTITY_MAX,
    },
    {
      kind: 'enum',
      name: 'approvalStatus',
      label: 'people.lines.approvalStatus',
      options: LINE_APPROVAL_OPTIONS,
      editable: false,
      help: 'people.lines.approvalStatusHelp',
    },
    {
      kind: 'reference',
      name: 'createdByUserId',
      label: 'people.lines.createdByUserId',
      resource: 'users',
      editable: false,
      help: 'people.lines.createdByUserIdHelp',
    },
    {
      kind: 'date',
      name: 'createdAt',
      label: 'people.lines.createdAt',
      time: true,
      help: 'people.field.createdAtHelp',
      editable: false,
    },
  ],

  list: {
    columns: ['content', 'quantity', 'approvalStatus', 'createdAt'],
    // The card is titled with what the line says, so what belongs under it is
    // how many and whether it counts yet.
    compact: ['quantity', 'approvalStatus'],
  },

  note: 'people.lines.note',
  formNote: 'people.broadcast',

  filters: [
    {
      kind: 'reference',
      param: 'listId',
      label: 'people.lines.filter.listId',
      resource: 'lists',
    },
  ],

  requires: ['listId'],

  actions: {
    edit: true,
    delete: true,
    named: () => {
      const directory = inject(DIRECTORY_SERVICE);

      return [
        {
          name: 'approve-line',
          label: 'people.lines.action.approve',
          available: (row) => row.approvalStatus !== 'APPROVED',
          confirm: {
            heading: 'people.lines.confirm.approve.heading',
            body: 'people.lines.confirm.approve.body',
            confirm: 'people.lines.confirm.approve.confirm',
          },
          run: (row) =>
            directory.setLineApproval(row.listId, row.id, 'APPROVED'),
        },
        {
          name: 'reject-line',
          label: 'people.lines.action.reject',
          available: (row) => row.approvalStatus !== 'REJECTED',
          confirm: {
            heading: 'people.lines.confirm.reject.heading',
            body: 'people.lines.confirm.reject.body',
            confirm: 'people.lines.confirm.reject.confirm',
          },
          run: (row) =>
            directory.setLineApproval(row.listId, row.id, 'REJECTED'),
        },
      ];
    },
  },

  gateway: () =>
    inject(RESOURCE_GATEWAYS).for<ListLine>({
      // Not a URL, and never used as one: both halves below build the real
      // path. It is the name this resource's in-memory table goes under.
      path: ADMIN_LIST_LINES_PATH,
      collectionPath: (values) => {
        const listId = values['listId'];
        return typeof listId === 'string' && listId !== ''
          ? listLinesPath(listId)
          : null;
      },
      memberPath: (id) => {
        const parts = compositeParts(id, LIST_LINE_KEY);
        return parts === null
          ? null
          : listLinePath(parts['listId'], parts['id']);
      },
      // In the path, and therefore not also in the query string or the body.
      pathParams: ['listId'],
      key: [...LIST_LINE_KEY],
      seed: LIST_LINE_SEED,
    }),
});
