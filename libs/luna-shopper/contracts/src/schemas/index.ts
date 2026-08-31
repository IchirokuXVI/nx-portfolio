// Public surface of the JSON Schema contracts (plan 0010). The building blocks in
// `builders.ts` are deliberately not re-exported to keep `string`/`object` out of
// the package API.

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
export { buildAsyncApiDocument } from './asyncapi';
export { ENUM_IDS } from './enums.schemas';
export { COMMON_IDS } from './common.schemas';
export { AUTH_SCHEMA_IDS } from './messages/auth.schemas';
export { ZONE_SCHEMA_IDS } from './messages/zone.schemas';
export { LIST_SCHEMA_IDS } from './messages/list.schemas';
export { MERGE_SCHEMA_IDS } from './messages/merge.schemas';
export { PROFILE_SCHEMA_IDS } from './messages/profile.schemas';
export { REALTIME_SCHEMA_IDS } from './messages/realtime.schemas';
export { STATS_SCHEMA_IDS } from './messages/stats.schemas';
export { CATALOG_SCHEMA_IDS } from './messages/catalog.schemas';
export { GENERATED_LIST_SCHEMA_IDS } from './messages/generated-list.schemas';
export { HARVEST_SCHEMA_IDS } from './messages/harvest.schemas';
export { IDENTITY_EVENT_SCHEMA_IDS } from './events/identity.schemas';
export { DOMAIN_EVENT_SCHEMA_IDS } from './events/realtime.schemas';
