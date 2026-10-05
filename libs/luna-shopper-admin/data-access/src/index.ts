// Named, and not `export *`: this barrel offers what another project imports,
// and nothing else (admin plan 0047). A name used only inside this library is
// imported there by its relative path. `no-unused-public-export.spec.ts`
// in the app fails when a name here has no importer outside the library.
export { ApiUrl } from './lib/api-url';
export { adminAuthInterceptor } from './lib/auth/admin-auth-interceptor';
export { SessionApi } from './lib/auth/session-api';
export { SessionBootstrap } from './lib/auth/session-bootstrap';
export {
  SIGN_IN_PATH,
  requireNoSession,
  requireSession,
} from './lib/auth/session-guards';
export { SessionLifecycle } from './lib/auth/session-lifecycle';
export {
  SESSION_SERVICE,
  type SessionServiceI,
} from './lib/auth/session-service';
export { SessionStorage } from './lib/auth/session-storage';
export { SessionStore } from './lib/auth/session-store';
export {
  toBulkOperationError,
  type BulkOperationError,
  type BulkOperationErrorCode,
} from './lib/bulk-operation-error';
export {
  CATEGORY_SEED,
  seededCategoryId,
  seededLeaf,
  type ProductCategory,
} from './lib/categories/category-seed';
export { clientVersionInterceptor } from './lib/client-version-interceptor';
export { contentLocaleInterceptor } from './lib/content-locale-interceptor';
export { ContentLocaleStore } from './lib/content-locale-store';
export { DashboardApi } from './lib/dashboard/dashboard-api';
export { DashboardMemory } from './lib/dashboard/dashboard-memory';
export {
  DASHBOARD_SEED,
  dashboardSeedWithout,
} from './lib/dashboard/dashboard-seed';
export {
  DASHBOARD_SERVICE,
  type DashboardDocument,
} from './lib/dashboard/dashboard-service';
export { DashboardStore } from './lib/dashboard/dashboard-store';
export { LUNA_SHOPPER_ADMIN_DATA_ACCESS_PROVIDERS } from './lib/data-access-providers';
export { DeploymentApi } from './lib/deployment/deployment-api';
export {
  DEPLOYMENT_SERVICE,
  type DeploymentServiceI,
} from './lib/deployment/deployment-service';
export { DeploymentStore } from './lib/deployment/deployment-store';
export { DirectoryApi } from './lib/directory/directory-api';
export {
  ADMIN_ADMINS_PATH,
  ADMIN_BASKETS_PATH,
  ADMIN_LISTS_PATH,
  ADMIN_LIST_LINES_PATH,
  ADMIN_MEMBERSHIPS_PATH,
  ADMIN_USERS_PATH,
  ADMIN_ZONES_PATH,
  LIST_LINE_KEY,
  MEMBERSHIP_KEY,
  listLinePath,
  zoneMemberPath,
} from './lib/directory/directory-paths';
export {
  ACCOUNT_ROLES,
  DIRECTORY_SERVICE,
  orderedRoles,
  type AccountRole,
  type DirectoryServiceI,
} from './lib/directory/directory-service';
export {
  GatewayError,
  notFoundError,
  toGatewayError,
} from './lib/gateway-error';
export {
  type ApplyEntryDecisionsInput,
  type EntryDecisionOperation,
  type EntryDecisionOutcome,
  type EntryDecisionsAnswer,
} from './lib/harvest/entry-decisions';
export { HarvestApi } from './lib/harvest/harvest-api';
export { HarvestMemory } from './lib/harvest/harvest-memory';
export {
  HARVEST_RUN_SEED,
  MERCADONA_WEEKLY_PRESET,
} from './lib/harvest/harvest-seed';
export {
  HARVEST_SERVICE,
  type CreateItemFromSourceEntryInput,
  type HarvestRunPresetInput,
  type HarvestServiceI,
  type PostalCodeQuery,
  type RunPriceQuery,
  type RunQuery,
} from './lib/harvest/harvest-service';
export { QueueStore, type QueueBulkResult } from './lib/harvest/queue-store';
export { RunWatches } from './lib/harvest/run-watch';
export { HealthApi } from './lib/health/health-api';
export { HEALTH_SERVICE } from './lib/health/health-service';
export { ServerReachability } from './lib/health/server-reachability';
export { PostalCodeApi } from './lib/postal-codes/postal-code-api';
export { PostalCodeMemory } from './lib/postal-codes/postal-code-memory';
export {
  POSTAL_CODE_SERVICE,
  type PostalCodeServiceI,
} from './lib/postal-codes/postal-code-service';
export { PostalCodeSummaryStore } from './lib/postal-codes/postal-code-summary-store';
export { ResourceApiGateways } from './lib/resource/resource-api';
export { ResourceFormStore } from './lib/resource/resource-form-store';
export {
  RESOURCE_GATEWAYS,
  type MemoryTables,
  type ResourceGatewaysI,
  type ResourceMemoryRules,
  type ResourceSource,
} from './lib/resource/resource-gateways';
export { ResourceListStore } from './lib/resource/resource-list-store';
export { ResourceMemoryGateways } from './lib/resource/resource-memory';
