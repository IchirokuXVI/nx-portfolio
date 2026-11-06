import {
  PriceRefreshRefusal,
  PriceRefreshStatus,
} from '../../lib/enums/price-refresh.enums';
import { PRICE_REFRESH_PATTERNS } from '../../lib/messages/price-refresh.messages';
import {
  boolean,
  enumOf,
  integer,
  JsonSchema,
  nonEmptyString,
  nullableString,
  object,
  ref,
  schemaId,
} from '../builders';

/**
 * A shopper refreshes the price of one product (harvester plan 0216, section
 * 7): the two enums, the two requests, the two views and the three subjects.
 *
 * No `adminToken` on any request. These are the harvester subjects a shopper
 * reaches, with the `userId` the gateway verified.
 */
export const PRICE_REFRESH_SCHEMA_IDS = {
  priceRefreshStatus: schemaId('enums/PriceRefreshStatus'),
  priceRefreshRefusal: schemaId('enums/PriceRefreshRefusal'),
  priceRefreshRequest: schemaId('msg/priceRefresh.request/request'),
  priceRefreshCheckRequest: schemaId('msg/priceRefresh.check/request'),
  priceRefreshIdRequest: schemaId('msg/priceRefresh.get/request'),
  priceRefreshView: schemaId('harvest/PriceRefreshView'),
  priceRefreshCheckView: schemaId('harvest/PriceRefreshCheckView'),
} as const;

const productAtScope = {
  userId: nonEmptyString(),
  itemId: nonEmptyString(),
  priceScopeId: nonEmptyString(),
};

const priceRefreshRequest = object(
  PRICE_REFRESH_SCHEMA_IDS.priceRefreshRequest,
  productAtScope,
  ['userId', 'itemId', 'priceScopeId']
);

const priceRefreshCheckRequest = object(
  PRICE_REFRESH_SCHEMA_IDS.priceRefreshCheckRequest,
  productAtScope,
  ['userId', 'itemId', 'priceScopeId']
);

const priceRefreshIdRequest = object(
  PRICE_REFRESH_SCHEMA_IDS.priceRefreshIdRequest,
  { userId: nonEmptyString(), refreshId: nonEmptyString() },
  ['userId', 'refreshId']
);

const priceRefreshView = object(
  PRICE_REFRESH_SCHEMA_IDS.priceRefreshView,
  {
    id: nullableString(),
    itemId: nonEmptyString(),
    priceScopeId: nonEmptyString(),
    status: ref(PRICE_REFRESH_SCHEMA_IDS.priceRefreshStatus),
    observedAt: nullableString(),
    requestedAt: nullableString(),
    finishedAt: nullableString(),
  },
  [
    'id',
    'itemId',
    'priceScopeId',
    'status',
    'observedAt',
    'requestedAt',
    'finishedAt',
  ]
);

const priceRefreshCheckView = object(
  PRICE_REFRESH_SCHEMA_IDS.priceRefreshCheckView,
  {
    refreshable: boolean(),
    reason: {
      anyOf: [
        ref(PRICE_REFRESH_SCHEMA_IDS.priceRefreshRefusal),
        { type: 'null' },
      ],
    },
    retryAfterSeconds: integer({ minimum: 0 }),
    pendingRefreshId: nullableString(),
    observedAt: nullableString(),
  },
  [
    'refreshable',
    'reason',
    'retryAfterSeconds',
    'pendingRefreshId',
    'observedAt',
  ]
);

export const priceRefreshSchemas: JsonSchema[] = [
  enumOf(
    PRICE_REFRESH_SCHEMA_IDS.priceRefreshStatus,
    Object.values(PriceRefreshStatus)
  ),
  enumOf(
    PRICE_REFRESH_SCHEMA_IDS.priceRefreshRefusal,
    Object.values(PriceRefreshRefusal)
  ),
  priceRefreshRequest,
  priceRefreshCheckRequest,
  priceRefreshIdRequest,
  priceRefreshView,
  priceRefreshCheckView,
];

export const priceRefreshMessageContracts = {
  // 201 at the gateway with this view, `FRESH` included (section 10).
  [PRICE_REFRESH_PATTERNS.request]: {
    request: PRICE_REFRESH_SCHEMA_IDS.priceRefreshRequest,
    response: PRICE_REFRESH_SCHEMA_IDS.priceRefreshView,
  },
  [PRICE_REFRESH_PATTERNS.check]: {
    request: PRICE_REFRESH_SCHEMA_IDS.priceRefreshCheckRequest,
    response: PRICE_REFRESH_SCHEMA_IDS.priceRefreshCheckView,
  },
  [PRICE_REFRESH_PATTERNS.get]: {
    request: PRICE_REFRESH_SCHEMA_IDS.priceRefreshIdRequest,
    response: PRICE_REFRESH_SCHEMA_IDS.priceRefreshView,
  },
};
