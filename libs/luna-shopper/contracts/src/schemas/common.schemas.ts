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

/**
 * The two properties every admin gated request carries (plan 0072, section 2),
 * spread into each one's schema so the pair is described in a single place.
 *
 * Not a schema of its own and therefore not in {@link commonSchemas}: request
 * schemas are strict (`additionalProperties` defaults to false), so a shared
 * `$ref` would have to be composed rather than spread, and every one of these
 * requests carries domain fields beside the credential. Spreading keeps each
 * request a single flat object a polyglot producer can validate against without
 * resolving a reference.
 *
 * `adminToken` is never in a `required` list. A service to service call has no
 * token to forward and passes catalog's gate on `userId` alone.
 */
export const adminCredentialProperties = {
  userId: nonEmptyString(),
  adminToken: string(),
};

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
