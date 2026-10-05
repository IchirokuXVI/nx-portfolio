// Named, and not `export *`: this barrel offers what another project imports,
// and nothing else (admin plan 0047). A name used only inside this library is
// imported there by its relative path. `no-unused-public-export.spec.ts`
// in the app fails when a name here has no importer outside the library.
export {
  UNKNOWN_ENVIRONMENT,
  toAdminEnvironment,
  type AdminEnvironment,
} from './lib/admin-environment';
export {
  toAdminMe,
  type AdminIdentity,
  type AdminMe,
} from './lib/admin-identity';
export {
  asInstant,
  supersedes,
  toAdminSession,
  type AdminSession,
} from './lib/admin-session';
export { ADMIN_API_CONFIG, type AdminApiConfig } from './lib/app-api-config';
export { ADMIN_APP_VERSION, CLIENT_VERSION_HEADER } from './lib/app-version';
export { activityTarget } from './lib/dashboard/activity-target';
export { type Translate } from './lib/dashboard/translate';
export { type Deployment } from './lib/deployment';
export {
  HARVEST_IMPORT,
  HARVEST_NEW_RUN,
  HARVEST_REVIEW_TAB,
  HARVEST_RUNS_TAB,
  HARVEST_SEGMENT,
  HARVEST_SETUP_TAB,
  PLACES_GROUPED_VIEW,
  REVIEW_CHAIN_PARAM,
  REVIEW_QUEUES,
  SETUP_SOURCES_PART,
  harvestReviewPath,
  harvestRunPath,
  harvestRunsPath,
  harvestSetupPath,
  type ReviewQueue,
} from './lib/harvest/harvest-addresses';
export {
  PREVIEW_PAGE,
  exportFileName,
  harvestFailures,
  hintNotice,
  importConflict,
  parseHarvestDocument,
  previewMatches,
  previewWindow,
  type HarvestDocumentRead,
  type HarvestDocumentRejection,
  type HintResult,
  type ImportConflictNotice,
} from './lib/harvest/harvest-document';
export {
  PRICE_WRITING_MODES,
  canAbort,
  canRevert,
  failureBlockReason,
  isTerminalRun,
  runPriceCounters,
  runProgress,
  spawnBlockReason,
  type HarvestRun,
  type HarvestRunMode,
  type HarvestRunStatus,
  type RunBlockReason,
  type RunProgress,
} from './lib/harvest/harvest-run';
export {
  harvestSwitches,
  harvesterDeployed,
} from './lib/harvest/harvest-switches';
export {
  isFileImportRun,
  queuedByRun,
  runWarningRows,
} from './lib/harvest/run-warnings';
export {
  OFFICIAL_SOURCE_KINDS,
  SOURCE_ENTRY_STATUSES,
  toOfficialSourceKind,
  toSourceEntryMatch,
  toSourceEntryStatus,
  type OfficialSourceKind,
  type SourceEntryMatch,
  type SourceEntryStatus,
} from './lib/harvest/source-enums';
export {
  ADMIN_REACHABILITY_POLICY,
  DEFAULT_REACHABILITY_POLICY,
} from './lib/reachability-policy';
export {
  compositeId,
  compositeIdOf,
  compositeParts,
} from './lib/resource/composite-id';
export {
  type InfoContent,
  type ScopeLevel,
  type ScopeMarkView,
} from './lib/resource/info-content';
export {
  CONTENT_LOCALES,
  localizedTextValue,
  toLocalizedText,
  type LocalizedText,
} from './lib/resource/localized-text';
export { formatCurrencyAmount, parseMoney } from './lib/resource/money';
export {
  recordIdFor,
  recordIdIn,
  rowWithin,
  searchedRecordId,
} from './lib/resource/record-id';
export { REFERENCE_NONE, isReferenceNone } from './lib/resource/reference-none';
export {
  defineResource,
  fieldOf,
  hasDetailScreen,
  idOf,
  type ActionConfirmation,
  type AnyResourceDescriptor,
  type BriefPresentation,
  type BulkAction,
  type BulkPanelInputs,
  type ErrorLink,
  type ErrorLinkTarget,
  type FilterDescriptor,
  type NamedAction,
  type ResourceDescriptor,
  type ResourceGateway,
  type ResourceInput,
  type ResourcePage,
  type ResourceParent,
  type ResourceQuery,
  type RowState,
} from './lib/resource/resource-descriptor';
export {
  draftFor,
  isDirty,
  orderedFieldNames,
  toInput,
  validateDraft,
  type DraftValue,
  type ResourceDraft,
} from './lib/resource/resource-draft';
export {
  fieldMessage,
  isEditable,
  type EnumOption,
  type FieldDescriptor,
  type FieldMessage,
  type FieldName,
  type FilterValue,
  type FormMode,
  type ReferenceField,
  type ReferenceScope,
  type ReferencesField,
  type ResourceRow,
} from './lib/resource/resource-field';
export { appendPage } from './lib/resource/resource-pagination';
export { type PathOf } from './lib/resource/resource-path';
export {
  toCell,
  toRowView,
  type RenderOptions,
  type ResourceCell,
  type ResourceRowView,
  type RowBrief,
} from './lib/resource/resource-view';
export {
  ADMIN_SESSION_POLICY,
  DEFAULT_SESSION_POLICY,
  decideKeepalive,
} from './lib/session-keepalive';
export {
  type SignInFailure,
  type SignInFailureReason,
} from './lib/sign-in-failure';

/**
 * The gateway's own shapes, generated from its OpenAPI document.
 *
 * Under a namespace rather than spread into this barrel, for two reasons. There
 * are several hundred of them and they would bury the eight types this library
 * writes by hand; and `Wire.CatalogSupermarketView` says where a type came from
 * at the point it is used, which is the honest label for a type this app did not
 * author and cannot change.
 */
export * as Wire from './lib/wire/wire-types';
