import {
  BasketChangeOriginKind,
  LineChangeKind,
} from '../../lib/messages/basket-changes.messages';
import { BASKET_PATTERNS } from '../../lib/messages/basket.messages';
import {
  array,
  boolean,
  enumOf,
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
import { BASKET_SCHEMA_IDS } from './basket.schemas';

/**
 * What changed on a basket's lists, as a language neutral contract (plan 0138).
 *
 * `listId` and `actor` are both **optional and never null**, because redaction
 * here is by absence (plan 0130, section 6): a reader cannot tell "a list you may
 * not see" from "no list", and nothing downstream is trusted to hide a value it
 * was handed. `actor` is the one exception to that in shape rather than in rule:
 * it is explicitly nullable, because "nobody may know who" is a real answer a
 * guest gets for every change.
 */
export const BASKET_CHANGE_SCHEMA_IDS = {
  kind: schemaId('enums/LineChangeKind'),
  actorView: schemaId('basket/BasketChangeActorView'),
  origin: schemaId('basket/BasketChangeOrigin'),
  changeView: schemaId('basket/BasketChangeView'),
  changePage: schemaId('basket/BasketChangePage'),
  acknowledged: schemaId('basket/BasketChangesAcknowledged'),
  lineMark: schemaId('basket/BasketLineMark'),
  marksView: schemaId('basket/BasketMarksView'),
  marksRequest: schemaId('msg/basket.changes.marks/request'),
  listRequest: schemaId('msg/basket.changes.list/request'),
  acknowledgeRequest: schemaId('msg/basket.changes.acknowledge/request'),
} as const;

const kind = enumOf(
  BASKET_CHANGE_SCHEMA_IDS.kind,
  Object.values(LineChangeKind)
);

/**
 * One of the two, never both and never neither.
 *
 * Written as a two member `anyOf` rather than as two optional properties on the
 * change itself, so a reader served a participant cannot also be served an
 * account: the pair of them together would name the same person twice and let a
 * guest's view be told an account id by a future field that forgot the rule.
 */
const actorView: JsonSchema = {
  $id: BASKET_CHANGE_SCHEMA_IDS.actorView,
  anyOf: [
    {
      type: 'object',
      properties: { participantId: nonEmptyString() },
      required: ['participantId'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: { userId: nonEmptyString() },
      required: ['userId'],
      additionalProperties: false,
    },
  ],
};

/**
 * Where an outside buy came from (plan 0203, section 5).
 *
 * Two members and no basket id in either. The owner of the other basket is an
 * actor view or null, so a reader who is told no account here is told none.
 *
 * `kind` is a string enum of one value, and not a `const`: the generator of the
 * admin wire types reads an enum as a literal type, and reads a nested `const`
 * as `unknown`.
 */
const origin: JsonSchema = {
  $id: BASKET_CHANGE_SCHEMA_IDS.origin,
  anyOf: [
    {
      type: 'object',
      properties: {
        kind: string({ enum: [BasketChangeOriginKind.ANOTHER_BASKET] }),
        owner: {
          anyOf: [ref(BASKET_CHANGE_SCHEMA_IDS.actorView), { type: 'null' }],
        },
      },
      required: ['kind', 'owner'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: { kind: string({ enum: [BasketChangeOriginKind.LIST] }) },
      required: ['kind'],
      additionalProperties: false,
    },
  ],
};

const changeView = object(
  BASKET_CHANGE_SCHEMA_IDS.changeView,
  {
    id: nonEmptyString(),
    kind: ref(BASKET_CHANGE_SCHEMA_IDS.kind),
    at: nonEmptyString(),
    unseen: boolean(),
    rowKey: nullableString(),
    contentBefore: nullableString(),
    contentAfter: nullableString(),
    quantityBefore: { type: ['integer', 'null'] },
    quantityAfter: { type: ['integer', 'null'] },
    approvalBefore: {
      anyOf: [ref(ENUM_IDS.lineApprovalStatus), { type: 'null' }],
    },
    approvalAfter: {
      anyOf: [ref(ENUM_IDS.lineApprovalStatus), { type: 'null' }],
    },
    // Absent for a reader who was not served this list, never null.
    listId: nonEmptyString(),
    actor: {
      anyOf: [ref(BASKET_CHANGE_SCHEMA_IDS.actorView), { type: 'null' }],
    },
    origin: {
      anyOf: [ref(BASKET_CHANGE_SCHEMA_IDS.origin), { type: 'null' }],
    },
  },
  [
    'id',
    'kind',
    'at',
    'unseen',
    'rowKey',
    'contentBefore',
    'contentAfter',
    'quantityBefore',
    'quantityAfter',
    'approvalBefore',
    'approvalAfter',
    'actor',
    'origin',
  ]
);

const changePage = paginated(
  BASKET_CHANGE_SCHEMA_IDS.changePage,
  BASKET_CHANGE_SCHEMA_IDS.changeView
);

const acknowledged = object(
  BASKET_CHANGE_SCHEMA_IDS.acknowledged,
  {
    unseenChangeCount: integer({ minimum: 0 }),
    marksLapseInMs: integer({ minimum: 0 }),
  },
  ['unseenChangeCount', 'marksLapseInMs']
);

/** The mark of one covered line, before a client folds it into a row (0204). */
const lineMark = object(
  BASKET_CHANGE_SCHEMA_IDS.lineMark,
  {
    lineId: nonEmptyString(),
    mark: ref(BASKET_SCHEMA_IDS.rowMark),
  },
  ['lineId', 'mark']
);

const marksView = object(
  BASKET_CHANGE_SCHEMA_IDS.marksView,
  {
    unseenChangeCount: integer({ minimum: 0 }),
    newestUnseenChangeId: nullableString(),
    lines: array(ref(BASKET_CHANGE_SCHEMA_IDS.lineMark)),
  },
  ['unseenChangeCount', 'newestUnseenChangeId', 'lines']
);

const marksRequest = object(
  BASKET_CHANGE_SCHEMA_IDS.marksRequest,
  {
    basketId: nonEmptyString(),
    participantId: nonEmptyString(),
  },
  ['basketId', 'participantId']
);

const listRequest = object(
  BASKET_CHANGE_SCHEMA_IDS.listRequest,
  {
    basketId: nonEmptyString(),
    participantId: nonEmptyString(),
    cursor: nonEmptyString(),
    limit: integer({ minimum: 1 }),
  },
  ['basketId', 'participantId']
);

const acknowledgeRequest = object(
  BASKET_CHANGE_SCHEMA_IDS.acknowledgeRequest,
  {
    basketId: nonEmptyString(),
    participantId: nonEmptyString(),
    through: nonEmptyString(),
  },
  ['basketId', 'participantId', 'through']
);

export const basketChangeSchemas: JsonSchema[] = [
  kind,
  actorView,
  origin,
  changeView,
  changePage,
  acknowledged,
  lineMark,
  marksView,
  marksRequest,
  listRequest,
  acknowledgeRequest,
];

export const basketChangeMessageContracts: Record<
  string,
  { request: string; response: string }
> = {
  [BASKET_PATTERNS.changesList]: {
    request: BASKET_CHANGE_SCHEMA_IDS.listRequest,
    response: BASKET_CHANGE_SCHEMA_IDS.changePage,
  },
  [BASKET_PATTERNS.changesMarks]: {
    request: BASKET_CHANGE_SCHEMA_IDS.marksRequest,
    response: BASKET_CHANGE_SCHEMA_IDS.marksView,
  },
  [BASKET_PATTERNS.changesAcknowledge]: {
    request: BASKET_CHANGE_SCHEMA_IDS.acknowledgeRequest,
    response: BASKET_CHANGE_SCHEMA_IDS.acknowledged,
  },
};
