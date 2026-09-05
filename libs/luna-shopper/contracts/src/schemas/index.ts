// Public surface of the JSON Schema contracts (plan 0010). The building blocks in
// `builders.ts` are deliberately not re-exported to keep `string`/`object` out of
// the package API.

export { buildAsyncApiDocument } from './asyncapi';
export { COMMON_IDS } from './common.schemas';
export { ENUM_IDS } from './enums.schemas';
export { CATALOG_EVENT_SCHEMA_IDS } from './events/catalog.schemas';
export { IDENTITY_EVENT_SCHEMA_IDS } from './events/identity.schemas';
export { DOMAIN_EVENT_SCHEMA_IDS } from './events/realtime.schemas';
// The file import contract and the types that mirror it (plan 0086, section 6.1).
export * from './harvest-document';
export { ADMIN_AUTH_SCHEMA_IDS } from './messages/admin-auth.schemas';
export { ADMIN_CORE_SCHEMA_IDS } from './messages/admin-core.schemas';
export { ADMIN_USERS_SCHEMA_IDS } from './messages/admin-users.schemas';
export { AUTH_SCHEMA_IDS } from './messages/auth.schemas';
export { CATALOG_SCHEMA_IDS } from './messages/catalog.schemas';
export { GENERATED_LIST_SHARING_SCHEMA_IDS } from './messages/generated-list-sharing.schemas';
export { GENERATED_LIST_SCHEMA_IDS } from './messages/generated-list.schemas';
export { HARVEST_SCHEMA_IDS } from './messages/harvest.schemas';
export { LIST_SCHEMA_IDS } from './messages/list.schemas';
export { MERGE_SCHEMA_IDS } from './messages/merge.schemas';
export { PROFILE_SCHEMA_IDS } from './messages/profile.schemas';
export { REALTIME_SCHEMA_IDS } from './messages/realtime.schemas';
export { STATS_SCHEMA_IDS } from './messages/stats.schemas';
export { ZONE_SCHEMA_IDS } from './messages/zone.schemas';
export {
  allSchemas,
  eventContracts,
  eventNames,
  eventSchemaId,
  messageContracts,
  messageRequestSchemaId,
  messageResponseSchemaId,
  messageSubjects,
} from './registry';
export type { MessageContract } from './registry';
export {
  assertValid,
  createContractsAjv,
  getContractsAjv,
  validateEvent,
  validateMessageRequest,
  validateMessageResponse,
  validateSchema,
} from './validator';
export type { ValidationResult } from './validator';
