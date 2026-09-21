import { PURCHASE_PATTERNS } from '../../lib/messages/purchase.messages';
import {
  boolean,
  integer,
  JsonSchema,
  nonEmptyString,
  nullableString,
  object,
  paginated,
  ref,
  schemaId,
  string,
} from '../builders';
import { ENUM_IDS } from '../enums.schemas';

/**
 * What one person bought, as a language neutral contract (plan 0142).
 *
 * `spentCents` and `pricePaidCents` are nullable integers rather than a money
 * shape. Plan 0143 adds the currency beside the amount and changes both, and
 * this plan does not wait for it: before 0143 nothing writes a price, so both
 * read null everywhere and that is the honest answer.
 *
 * The five location fields of a row are nullable rather than optional, and they
 * are null **together**: a reader who no longer holds `READ` on the line's list
 * keeps the purchase and loses where it was made. That is redaction by nulling
 * and not by absence, because unlike plan 0138's changes there is nothing to
 * hide here: the reader already knows they bought it.
 */
export const PURCHASE_SCHEMA_IDS = {
  entryView: schemaId('purchase/PurchaseEntryView'),
  entryPage: schemaId('purchase/PurchaseEntryPage'),
  rowView: schemaId('purchase/PurchaseRowView'),
  rowPage: schemaId('purchase/PurchaseRowPage'),
  listSessionsRequest: schemaId('msg/purchase.listSessions/request'),
  listSessionRowsRequest: schemaId('msg/purchase.listSessionRows/request'),
} as const;

const entryView = object(
  PURCHASE_SCHEMA_IDS.entryView,
  {
    id: nonEmptyString(),
    kind: ref(ENUM_IDS.tripKind),
    name: nullableString(),
    open: boolean(),
    startedAt: string({ format: 'date-time' }),
    endedAt: string({ format: 'date-time' }),
    lineCount: integer({ minimum: 0 }),
    boughtLineCount: integer({ minimum: 0 }),
    // Null, never zero, when nothing in the entry carries a price.
    spentCents: { type: ['integer', 'null'] },
    unpricedCount: integer({ minimum: 0 }),
  },
  [
    'id',
    'kind',
    'name',
    'open',
    'startedAt',
    'endedAt',
    'lineCount',
    'boughtLineCount',
    'spentCents',
    'unpricedCount',
  ]
);

const entryPage = object(
  PURCHASE_SCHEMA_IDS.entryPage,
  {
    items: { type: 'array', items: ref(PURCHASE_SCHEMA_IDS.entryView) },
    nextCursor: nullableString(),
  },
  ['items', 'nextCursor']
);

const rowView = object(
  PURCHASE_SCHEMA_IDS.rowView,
  {
    id: nonEmptyString(),
    itemId: nullableString(),
    outcome: ref(ENUM_IDS.settlementOutcome),
    quantity: integer({ minimum: 0 }),
    pricePaidCents: { type: ['integer', 'null'] },
    settledAt: string({ format: 'date-time' }),
    lineId: nullableString(),
    listId: nullableString(),
    listName: nullableString(),
    zoneId: nullableString(),
    content: nullableString(),
  },
  [
    'id',
    'itemId',
    'outcome',
    'quantity',
    'pricePaidCents',
    'settledAt',
    'lineId',
    'listId',
    'listName',
    'zoneId',
    'content',
  ]
);

const rowPage = paginated(
  PURCHASE_SCHEMA_IDS.rowPage,
  PURCHASE_SCHEMA_IDS.rowView
);

const listSessionsRequest = object(
  PURCHASE_SCHEMA_IDS.listSessionsRequest,
  {
    userId: nonEmptyString(),
    cursor: string(),
    limit: integer({ minimum: 1 }),
  },
  ['userId']
);

const listSessionRowsRequest = object(
  PURCHASE_SCHEMA_IDS.listSessionRowsRequest,
  {
    userId: nonEmptyString(),
    kind: ref(ENUM_IDS.tripKind),
    entryId: nonEmptyString(),
    cursor: string(),
    limit: integer({ minimum: 1 }),
  },
  ['userId', 'kind', 'entryId']
);

export const purchaseSchemas: JsonSchema[] = [
  entryView,
  entryPage,
  rowView,
  rowPage,
  listSessionsRequest,
  listSessionRowsRequest,
];

export const purchaseMessageContracts: Record<
  string,
  { request: string; response: string }
> = {
  [PURCHASE_PATTERNS.listSessions]: {
    request: PURCHASE_SCHEMA_IDS.listSessionsRequest,
    response: PURCHASE_SCHEMA_IDS.entryPage,
  },
  [PURCHASE_PATTERNS.listSessionRows]: {
    request: PURCHASE_SCHEMA_IDS.listSessionRowsRequest,
    response: PURCHASE_SCHEMA_IDS.rowPage,
  },
};
