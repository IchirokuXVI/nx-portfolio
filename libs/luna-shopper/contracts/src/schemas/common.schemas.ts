import {
  integer,
  JsonSchema,
  nonEmptyString,
  object,
  paginated,
  schemaId,
  string,
} from './builders';

/**
 * Shared response and query shapes reused across domains: the small result
 * envelopes core returns from mutations that carry only an id, and the cursor
 * page query every collection subject accepts (plan 0004, section 11).
 */
export const COMMON_IDS = {
  pageQuery: schemaId('common/PageQuery'),
  idResult: schemaId('common/IdResult'),
  userIdResult: schemaId('common/UserIdResult'),
  listIdResult: schemaId('common/ListIdResult'),
} as const;

export const idResultSchema = object(
  COMMON_IDS.idResult,
  { id: nonEmptyString() },
  ['id']
);

export const userIdResultSchema = object(
  COMMON_IDS.userIdResult,
  { userId: nonEmptyString() },
  ['userId']
);

export const listIdResultSchema = object(
  COMMON_IDS.listIdResult,
  { listId: nonEmptyString() },
  ['listId']
);

export const pageQuerySchema = object(
  COMMON_IDS.pageQuery,
  { cursor: string(), limit: integer({ minimum: 1 }), order: string() },
  []
);

export { paginated };

export const commonSchemas: JsonSchema[] = [
  idResultSchema,
  userIdResultSchema,
  listIdResultSchema,
  pageQuerySchema,
];
