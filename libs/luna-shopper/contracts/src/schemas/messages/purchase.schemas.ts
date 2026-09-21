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
 * `spent` and `pricePaid` are a money shape since plan 0143: an amount with no
 * currency is a number, and every sum over it is only honest while every row
 * happens to be in euros. Both are null when nothing recorded a price, and
 * `spent` is null as well when the entry's priced rows carry two currencies,
 * which has no total (plan 0143, section 7).
 *
 * The five location fields of a row are nullable rather than optional, and they
 * are null **together**: a reader who no longer holds `READ` on the line's list
 * keeps the purchase and loses where it was made. That is redaction by nulling
 * and not by absence, because unlike plan 0138's changes there is nothing to
 * hide here: the reader already knows they bought it.
 */
export const PURCHASE_SCHEMA_IDS = {
  moneyView: schemaId('purchase/MoneyView'),
  entryView: schemaId('purchase/PurchaseEntryView'),
  entryPage: schemaId('purchase/PurchaseEntryPage'),
  rowView: schemaId('purchase/PurchaseRowView'),
  rowPage: schemaId('purchase/PurchaseRowPage'),
  listSessionsRequest: schemaId('msg/purchase.listSessions/request'),
  listSessionRowsRequest: schemaId('msg/purchase.listSessionRows/request'),
} as const;

// An amount of money and the currency it is in. Nullable wherever it appears,
// and the two halves are never apart: an amount with no currency is a number.
//
// The currency is bounded by its length and not by a regex, which is how
// `countryCode` already states the same kind of field: the three upper case
// letters are checked where a settle is written (`paidColumns` in core), and a
// pattern here would be a second statement of one rule in a document nothing
// validates against.
const moneyView = object(
  PURCHASE_SCHEMA_IDS.moneyView,
  {
    cents: integer(),
    currency: nonEmptyString({ maxLength: 3 }),
  },
  ['cents', 'currency']
);

const nullableMoney = (): JsonSchema => ({
  anyOf: [ref(PURCHASE_SCHEMA_IDS.moneyView), { type: 'null' }],
});

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
    // Null, never zero, when nothing in the entry carries a price, and null
    // again when its priced rows carry two currencies (plan 0143, section 7).
    spent: nullableMoney(),
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
    'spent',
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
    pricePaid: nullableMoney(),
    // The one read that serves a shop: the reader is the person the purchase is
    // about (plan 0143, section 6).
    priceScopeId: nullableString(),
    supermarketLocationId: nullableString(),
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
    'pricePaid',
    'priceScopeId',
    'supermarketLocationId',
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
  moneyView,
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
