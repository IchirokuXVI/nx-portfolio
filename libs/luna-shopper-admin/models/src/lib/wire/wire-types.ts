// Generated from apps/luna-shopper-backend/gateway/docs/openapi.json. Do not edit.
//
// Regenerate with `npx nx run luna-shopper-admin/models:wire-types`, and commit
// the result. `wire-types.spec.ts` fails when this file no longer matches the
// document, so a gateway change that is not regenerated is a red test rather
// than silent drift.
//
// Why these are the view models rather than a hand written mapping, and why that
// does not contradict rule D4, is admin plan 0004, section 2.

/**
 * `AcceptSourceEntryDto` in the gateway's OpenAPI document.
 */
export type AcceptSourceEntryDto = {
  itemId: string;
};

/**
 * `AcknowledgeBasketChangesDto` in the gateway's OpenAPI document.
 */
export type AcknowledgeBasketChangesDto = {
  through: string;
};

/**
 * `AddBasketLineDto` in the gateway's OpenAPI document.
 */
export type AddBasketLineDto = {
  targetListId: string;
  content: string;
  quantity?: number;
  itemIds?: string[];
};

/**
 * `AddBasketParticipantDto` in the gateway's OpenAPI document.
 */
export type AddBasketParticipantDto = {
  userId: string;
};

/**
 * `AddCommentDto` in the gateway's OpenAPI document.
 */
export type AddCommentDto = {
  body: string;
};

/**
 * `AddItemPriceDto` in the gateway's OpenAPI document.
 */
export type AddItemPriceDto = {
  itemId: string;
  priceScopeId: string;
  sourceKind?: 'ADMIN' | 'OFFICIAL_API' | 'OFFICIAL_WEB' | 'OFFICIAL_LEAFLET';
  price?: number | null;
  currency?: string | null;
  unitPrice?: number | null;
  unitPriceLabel?: string | null;
  observedAt?: string | null;
  validFrom?: string | null;
  validUntil?: string | null;
};

/**
 * `AddLineDto` in the gateway's OpenAPI document.
 */
export type AddLineDto = {
  content: string;
  quantity?: number;
  itemIds?: string[];
  productGroupId?: string;
};

/**
 * `AddLineQuantityDto` in the gateway's OpenAPI document.
 */
export type AddLineQuantityDto = {
  delta: number;
};

/**
 * `AddLinesDto` in the gateway's OpenAPI document.
 */
export type AddLinesDto = {
  items: AddLinesItemDto[];
};

/**
 * `AddLinesItemDto` in the gateway's OpenAPI document.
 */
export type AddLinesItemDto = {
  content: string;
  quantity?: number;
  itemIds?: string[];
};

/**
 * `AddPostalCodeDiscoveryDto` in the gateway's OpenAPI document.
 */
export type AddPostalCodeDiscoveryDto = {
  country: string;
  postalCode: string;
  discoverNow: boolean;
};

/**
 * `AddPostalCodeDto` in the gateway's OpenAPI document.
 */
export type AddPostalCodeDto = {
  postalCode: string;
  label?: string | null;
  country?: string;
  source?: 'TYPED' | 'DEVICE';
  expandNearby?: boolean;
};

/**
 * `AdminLoginDto` in the gateway's OpenAPI document.
 */
export type AdminLoginDto = {
  username: string;
  password: string;
};

/**
 * `ApplyProductGroupAssignmentsDto` in the gateway's OpenAPI document.
 */
export type ApplyProductGroupAssignmentsDto = {
  operations: ProductGroupAssignmentDto[];
};

/**
 * `ApplySourceEntryDecisionsDto` in the gateway's OpenAPI document.
 */
export type ApplySourceEntryDecisionsDto = {
  runId?: string;
  operations: SourceEntryDecisionDto[];
};

/**
 * `AssistantMessageDto` in the gateway's OpenAPI document.
 */
export type AssistantMessageDto = {
  role: 'USER' | 'ASSISTANT';
  content: string;
};

/**
 * `AssistantTurnDto` in the gateway's OpenAPI document.
 */
export type AssistantTurnDto = {
  message: string;
  transcript: AssistantMessageDto[];
  scope?: TurnScopeDto;
};

/**
 * `AvailabilityEntryDto` in the gateway's OpenAPI document.
 */
export type AvailabilityEntryDto = {
  itemId: string;
  available: boolean;
};

/**
 * `BasketAllocationDto` in the gateway's OpenAPI document.
 */
export type BasketAllocationDto = {
  lineId: string;
  quantity: number;
};

/**
 * `BasketSourceDto` in the gateway's OpenAPI document.
 */
export type BasketSourceDto = {
  zoneId: string;
  listId?: string | null;
};

/**
 * `CreateBasketDto` in the gateway's OpenAPI document.
 */
export type CreateBasketDto = {
  sources?: BasketSourceDto[];
  profileId?: string;
  name?: string | null;
  idempotencyKey?: string;
  memberUserIds?: string[];
};

/**
 * `CreateBrandDto` in the gateway's OpenAPI document.
 */
export type CreateBrandDto = {
  label: string;
  privateLabelSupermarketId?: string | null;
  canonicalBrandId?: string | null;
};

/**
 * `CreateHarvestRunPresetDto` in the gateway's OpenAPI document.
 */
export type CreateHarvestRunPresetDto = {
  supermarketId: string;
  name: string;
  input: HarvestRunPresetInputDto;
};

/**
 * `CreateItemDto` in the gateway's OpenAPI document.
 */
export type CreateItemDto = {
  name: LocalizedTextDto;
  brand?: string | null;
  imageUrl?: string | null;
  sku?: string | null;
  ean?: string | null;
  unitSize?: number | null;
  category:
    | 'PRODUCE'
    | 'DAIRY'
    | 'BAKERY'
    | 'MEAT'
    | 'SEAFOOD'
    | 'FROZEN'
    | 'BEVERAGES'
    | 'SNACKS'
    | 'PANTRY'
    | 'HOUSEHOLD'
    | 'PERSONAL_CARE'
    | 'OTHER';
  defaultUnit: 'UNIT' | 'GRAM' | 'KILOGRAM' | 'MILLILITER' | 'LITER' | 'PACK';
  productGroupId?: string | null;
};

/**
 * `CreateItemFromEntryDto` in the gateway's OpenAPI document.
 */
export type CreateItemFromEntryDto = {
  name?: LocalizedNameDto;
  brand?: string | null;
  ean?: string | null;
  unitSize?: number | null;
  category?:
    | 'PRODUCE'
    | 'DAIRY'
    | 'BAKERY'
    | 'MEAT'
    | 'SEAFOOD'
    | 'FROZEN'
    | 'BEVERAGES'
    | 'SNACKS'
    | 'PANTRY'
    | 'HOUSEHOLD'
    | 'PERSONAL_CARE'
    | 'OTHER';
  defaultUnit?: 'UNIT' | 'GRAM' | 'KILOGRAM' | 'MILLILITER' | 'LITER' | 'PACK';
};

/**
 * `CreateItemsDto` in the gateway's OpenAPI document.
 */
export type CreateItemsDto = {
  items: CreateItemDto[];
};

/**
 * `CreateListDto` in the gateway's OpenAPI document.
 */
export type CreateListDto = {
  name: string;
  shareWithZone?: boolean;
};

/**
 * `CreatePriceScopeDto` in the gateway's OpenAPI document.
 */
export type CreatePriceScopeDto = {
  supermarketId: string;
  kind: 'NATIONAL' | 'REGION' | 'LOCAL_AREA' | 'STORE';
  externalKey?: string | null;
  label?: LocalizedTextDto;
  priority?: number;
};

/**
 * `CreateProductGroupDto` in the gateway's OpenAPI document.
 */
export type CreateProductGroupDto = {
  name: LocalizedTextDto;
  slug: string;
  referenceUnit: 'UNIT' | 'GRAM' | 'KILOGRAM' | 'MILLILITER' | 'LITER' | 'PACK';
  synonyms?: LocalizedSynonymsDto;
};

/**
 * `CreateShoppingProfileDto` in the gateway's OpenAPI document.
 */
export type CreateShoppingProfileDto = {
  name?: string | null;
  addressText?: string | null;
  minSavingCents?: number;
  minSavingPercent?: number | null;
  generationScope?: 'ALL' | 'SELECTED';
  postalCodes?: ProfilePostalCodeDto[];
  supermarkets?: ProfileSupermarketDto[];
  generationSources?: ProfileGenerationSourceDto[];
};

/**
 * `CreateSupermarketDto` in the gateway's OpenAPI document.
 */
export type CreateSupermarketDto = {
  name: LocalizedTextDto;
  logoUrl?: string | null;
  websiteUrl?: string | null;
  externalBrandKey?: string | null;
};

/**
 * `CreateSupermarketLocationDto` in the gateway's OpenAPI document.
 */
export type CreateSupermarketLocationDto = {
  priceScopeId?: string;
  priceScopeIds?: string[];
  label?: LocalizedTextDto;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  postalCode?: string | null;
  externalRef?: string | null;
  externalProvider?: string | null;
};

/**
 * `CreateZoneDto` in the gateway's OpenAPI document.
 */
export type CreateZoneDto = {
  name: string;
  username?: string;
};

/**
 * `ForgotPasswordDto` in the gateway's OpenAPI document.
 */
export type ForgotPasswordDto = {
  email: string;
};

/**
 * `HarvestRunPresetInputDto` in the gateway's OpenAPI document.
 */
export type HarvestRunPresetInputDto = {
  mode: 'STORE_DISCOVERY' | 'CATALOG_DISCOVERY' | 'FILE_IMPORT';
  priceScopeId?: string;
  priceScopeIds?: string[];
  postalCode?: string;
  country?: string;
  radiusMetres?: number;
  brandKeys?: string[];
  postalCodes?: string[];
  detailBackfill?: boolean;
  scopeCopies?: ScopeCopyDto[];
  writes?: 'PRICES_AND_AVAILABILITY' | 'PRICES' | 'AVAILABILITY';
  details?: 'NEW' | 'ALL';
};

/**
 * `ImportDiscoveredPlaceDto` in the gateway's OpenAPI document.
 */
export type ImportDiscoveredPlaceDto = {
  supermarketId?: string;
  priceScopeId?: string;
  force?: boolean;
  newChain?: NewChainDto;
};

/**
 * `ImportHarvestDocumentDto` in the gateway's OpenAPI document.
 */
export type ImportHarvestDocumentDto = {
  supermarketId: string;
  priceScopeId?: string;
  sourceKind: 'OFFICIAL_API' | 'OFFICIAL_WEB' | 'OFFICIAL_LEAFLET';
  validFrom?: string;
  validUntil?: string;
  document: {
    [key: string]: unknown;
  };
};

/**
 * `JoinBasketDto` in the gateway's OpenAPI document.
 */
export type JoinBasketDto = {
  displayName?: string;
};

/**
 * `JoinZoneDto` in the gateway's OpenAPI document.
 */
export type JoinZoneDto = {
  joinCode: string;
  username?: string;
};

/**
 * `LinkDiscoveredPlaceDto` in the gateway's OpenAPI document.
 */
export type LinkDiscoveredPlaceDto = {
  supermarketLocationId: string;
};

/**
 * `ListAccessEntryDto` in the gateway's OpenAPI document.
 */
export type ListAccessEntryDto = {
  membershipId: string;
  permissions: ('READ' | 'WRITE' | 'DECIDE' | 'MANAGE')[];
};

/**
 * `LocalizedNameDto` in the gateway's OpenAPI document.
 */
export type LocalizedNameDto = {
  es?: string;
  en?: string;
};

/**
 * `LocalizedSynonymsDto` in the gateway's OpenAPI document.
 */
export type LocalizedSynonymsDto = {
  en: string[];
  es: string[];
};

/**
 * `LocalizedTextDto` in the gateway's OpenAPI document.
 *
 * A name in at least one of the languages the catalog serves. A language the name does not have is left out, never null.
 */
export type LocalizedTextDto = {
  en?: string;
  es?: string;
};

/**
 * `LoginDto` in the gateway's OpenAPI document.
 */
export type LoginDto = {
  email: string;
  password: string;
};

/**
 * `LookupItemsDto` in the gateway's OpenAPI document.
 */
export type LookupItemsDto = {
  ids: string[];
};

/**
 * `MapSourceLocationDto` in the gateway's OpenAPI document.
 */
export type MapSourceLocationDto = {
  supermarketLocationId: string;
};

/**
 * `NewChainDto` in the gateway's OpenAPI document.
 */
export type NewChainDto = {
  name: string;
  locale: 'en' | 'es';
};

/**
 * `ProblemDetails` in the gateway's OpenAPI document.
 *
 * The RFC 7807 error envelope, served as `application/problem+json`. `message` is already translated to the request locale, so a client can show it without knowing any backend error code; `code` is the stable value to branch on.
 */
export type ProblemDetails = {
  type: string;
  title: string;
  status: number;
  code:
    | 'validation_failed'
    | 'unauthorized'
    | 'not_a_participant'
    | 'participant_expired'
    | 'forbidden'
    | 'not_found'
    | 'conflict'
    | 'rate_limited'
    | 'not_configured'
    | 'client_too_old'
    | 'basket_finished'
    | 'stale_quantity'
    | 'account_locked'
    | 'postal_code_unknown'
    | 'run_in_progress'
    | 'line_merge_required'
    | 'line_merge_needs_approval'
    | 'line_merge_too_many_products'
    | 'brand_label_empty'
    | 'brand_key_taken'
    | 'brand_link_to_self'
    | 'brand_link_too_deep'
    | 'brand_link_owns_no_chain'
    | 'brand_link_keeps_key'
    | 'brand_not_linked'
    | 'place_already_imported'
    | 'place_matches_location'
    | 'scope_not_found'
    | 'internal';
  detail?: string;
  message: string;
  correlationId: string;
  errors?: {
    [key: string]: string[];
  };
  retryAfterSeconds?: number;
  details?: {
    [key: string]: unknown;
  };
};

/**
 * `ProductGroupAssignmentDto` in the gateway's OpenAPI document.
 */
export type ProductGroupAssignmentDto = {
  op: 'createGroup' | 'assignItem';
  ref?: string;
  name?: LocalizedTextDto;
  slug?: string;
  referenceUnit?:
    | 'UNIT'
    | 'GRAM'
    | 'KILOGRAM'
    | 'MILLILITER'
    | 'LITER'
    | 'PACK';
  synonyms?: LocalizedSynonymsDto;
  itemId?: string;
  groupId?: string;
  groupRef?: string;
  expect?: ProductGroupExpectationDto;
};

/**
 * `ProductGroupExpectationDto` in the gateway's OpenAPI document.
 */
export type ProductGroupExpectationDto = {
  productGroupId: string | null;
};

/**
 * `ProfileGenerationSourceDto` in the gateway's OpenAPI document.
 */
export type ProfileGenerationSourceDto = {
  zoneId: string;
  listId?: string | null;
};

/**
 * `ProfileLocationDto` in the gateway's OpenAPI document.
 */
export type ProfileLocationDto = {
  supermarketLocationId: string;
  excluded?: boolean;
};

/**
 * `ProfilePostalCodeDto` in the gateway's OpenAPI document.
 */
export type ProfilePostalCodeDto = {
  postalCode: string;
  label?: string | null;
  country?: string;
  source?: 'TYPED' | 'DEVICE';
  expandNearby?: boolean;
};

/**
 * `ProfileSupermarketDto` in the gateway's OpenAPI document.
 */
export type ProfileSupermarketDto = {
  supermarketId: string;
  excluded?: boolean;
};

/**
 * `RefreshDto` in the gateway's OpenAPI document.
 */
export type RefreshDto = {
  refreshToken: string;
};

/**
 * `RegisterBrandSuggestionDto` in the gateway's OpenAPI document.
 */
export type RegisterBrandSuggestionDto = {
  spelling: string;
  label: string;
  privateLabelSupermarketId?: string | null;
};

/**
 * `RegisterBrandsDto` in the gateway's OpenAPI document.
 */
export type RegisterBrandsDto = {
  brands: RegisterBrandsEntryDto[];
};

/**
 * `RegisterBrandsEntryDto` in the gateway's OpenAPI document.
 */
export type RegisterBrandsEntryDto = {
  label: string;
  privateLabelSupermarketId?: string | null;
};

/**
 * `RegisterDto` in the gateway's OpenAPI document.
 */
export type RegisterDto = {
  email: string;
  password: string;
  displayName?: string;
};

/**
 * `RenameBasketRowDto` in the gateway's OpenAPI document.
 */
export type RenameBasketRowDto = {
  content: string;
  confirmMerge?: boolean;
};

/**
 * `ReorderLinesDto` in the gateway's OpenAPI document.
 */
export type ReorderLinesDto = {
  orderedLineIds: string[];
};

/**
 * `RequestMergeDto` in the gateway's OpenAPI document.
 */
export type RequestMergeDto = {
  sourceUserId: string;
  targetUserId: string;
};

/**
 * `ResendAdminVerificationDto` in the gateway's OpenAPI document.
 */
export type ResendAdminVerificationDto = {
  locale?: string;
};

/**
 * `ResetPasswordDto` in the gateway's OpenAPI document.
 */
export type ResetPasswordDto = {
  token: string;
  password: string;
};

/**
 * `ResolvePostalCodeDto` in the gateway's OpenAPI document.
 */
export type ResolvePostalCodeDto = {
  latitude: number;
  longitude: number;
  country?: string;
};

/**
 * `RevertBasketRowDto` in the gateway's OpenAPI document.
 */
export type RevertBasketRowDto = {
  target: 'UNITS' | 'CLOSE';
  units?: number;
  from?: number;
};

/**
 * `ScopeCopyDto` in the gateway's OpenAPI document.
 */
export type ScopeCopyDto = {
  from: string;
  to: string[];
};

/**
 * `SetAdminLineApprovalDto` in the gateway's OpenAPI document.
 */
export type SetAdminLineApprovalDto = {
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
};

/**
 * `SetApprovalDto` in the gateway's OpenAPI document.
 */
export type SetApprovalDto = {
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
};

/**
 * `SetBasketRowDemandDto` in the gateway's OpenAPI document.
 */
export type SetBasketRowDemandDto = {
  lineId?: string;
  quantity: number;
  from: number;
};

/**
 * `SetListAccessDto` in the gateway's OpenAPI document.
 */
export type SetListAccessDto = {
  entries: ListAccessEntryDto[];
};

/**
 * `SetMembershipUsernameDto` in the gateway's OpenAPI document.
 */
export type SetMembershipUsernameDto = {
  username: string;
};

/**
 * `SetProfileLocationsDto` in the gateway's OpenAPI document.
 */
export type SetProfileLocationsDto = {
  locations: ProfileLocationDto[];
};

/**
 * `SetRoleDto` in the gateway's OpenAPI document.
 */
export type SetRoleDto = {
  role: 'ADMIN' | 'MEMBER';
};

/**
 * `SetSourceEnabledDto` in the gateway's OpenAPI document.
 */
export type SetSourceEnabledDto = {
  enabled: boolean;
};

/**
 * `SetSupermarketItemAvailabilityDto` in the gateway's OpenAPI document.
 */
export type SetSupermarketItemAvailabilityDto = {
  priceScopeId: string;
  entries: AvailabilityEntryDto[];
};

/**
 * `SetSupermarketLocationItemAvailabilityDto` in the gateway's OpenAPI document.
 */
export type SetSupermarketLocationItemAvailabilityDto = {
  supermarketLocationId: string;
  sourceKind:
    | 'OFFICIAL_API'
    | 'OFFICIAL_WEB'
    | 'OFFICIAL_LEAFLET'
    | 'ADMIN'
    | 'USER_RECEIPT'
    | 'USER_REPORTED';
  sourceRunId?: string | null;
  observedAt?: string;
  entries: AvailabilityEntryDto[];
};

/**
 * `SettleBasketRowDto` in the gateway's OpenAPI document.
 */
export type SettleBasketRowDto = {
  outcome: SettlementOutcome;
  quantity?: number;
  from: number;
  itemId?: string;
  priceScopeId?: string;
  supermarketLocationId?: string;
  allocations?: BasketAllocationDto[];
};

/**
 * `SettleLineDto` in the gateway's OpenAPI document.
 */
export type SettleLineDto = {
  outcome: 'BOUGHT' | 'NOT_AVAILABLE';
  quantity?: number;
  itemId?: string;
  priceScopeId?: string;
  supermarketLocationId?: string;
};

/**
 * `SettlementOutcome` in the gateway's OpenAPI document.
 */
export type SettlementOutcome = 'BOUGHT' | 'NOT_AVAILABLE';

/**
 * `SourceEntryDecisionDto` in the gateway's OpenAPI document.
 */
export type SourceEntryDecisionDto = {
  op: 'accept' | 'createItem';
  entryId: string;
  itemId?: string;
  itemRef?: string;
  ref?: string;
  item?: CreateItemFromEntryDto;
  expect: SourceEntryExpectationDto;
};

/**
 * `SourceEntryExpectationDto` in the gateway's OpenAPI document.
 */
export type SourceEntryExpectationDto = {
  status: 'ACTIVE' | 'CANDIDATE' | 'UNRESOLVED' | 'REJECTED';
  lastSeenAt: string;
};

/**
 * `SpawnHarvestRunDto` in the gateway's OpenAPI document.
 */
export type SpawnHarvestRunDto = {
  mode: 'STORE_DISCOVERY' | 'CATALOG_DISCOVERY' | 'FILE_IMPORT';
  supermarketId?: string;
  priceScopeId?: string;
  priceScopeIds?: string[];
  postalCode?: string;
  country?: string;
  radiusMetres?: number;
  brandKeys?: string[];
  postalCodes?: string[];
  detailBackfill?: boolean;
  scopeCopies?: ScopeCopyDto[];
  writes?: 'PRICES_AND_AVAILABILITY' | 'PRICES' | 'AVAILABILITY';
  details?: 'NEW' | 'ALL';
};

/**
 * `TurnScopeDto` in the gateway's OpenAPI document.
 */
export type TurnScopeDto = {
  zoneId: string;
  listId: string;
};

/**
 * `UpdateAdminLineDto` in the gateway's OpenAPI document.
 */
export type UpdateAdminLineDto = {
  content?: string;
  quantity?: number;
  itemIds?: string[];
};

/**
 * `UpdateAdminListDto` in the gateway's OpenAPI document.
 */
export type UpdateAdminListDto = {
  name?: string;
  autoApproveLines?: boolean;
  sharedWithZone?: boolean;
};

/**
 * `UpdateAdminMembershipDto` in the gateway's OpenAPI document.
 */
export type UpdateAdminMembershipDto = {
  role?: 'OWNER' | 'ADMIN' | 'MEMBER';
  username?: string;
};

/**
 * `UpdateAdminUserDto` in the gateway's OpenAPI document.
 */
export type UpdateAdminUserDto = {
  username?: string;
  displayName?: string | null;
  usernamePropagation?: 'GLOBAL_ONLY' | 'MATCHING_ZONES' | 'ALL_ZONES';
};

/**
 * `UpdateAdminZoneDto` in the gateway's OpenAPI document.
 */
export type UpdateAdminZoneDto = {
  name?: string;
  config?: {
    [key: string]: unknown;
  };
};

/**
 * `UpdateAppStateDto` in the gateway's OpenAPI document.
 */
export type UpdateAppStateDto = {
  setupCompleted?: true;
  tourSeen?: true;
};

/**
 * `UpdateBasketDto` in the gateway's OpenAPI document.
 */
export type UpdateBasketDto = {
  name?: string | null;
  status?: 'OPEN' | 'FINISHED' | 'ARCHIVED';
};

/**
 * `UpdateBrandDto` in the gateway's OpenAPI document.
 */
export type UpdateBrandDto = {
  label?: string;
  privateLabelSupermarketId?: string | null;
  canonicalBrandId?: string | null;
};

/**
 * `UpdateHarvestRunPresetDto` in the gateway's OpenAPI document.
 */
export type UpdateHarvestRunPresetDto = {
  name?: string;
  input?: HarvestRunPresetInputDto;
};

/**
 * `UpdateItemDto` in the gateway's OpenAPI document.
 */
export type UpdateItemDto = {
  name?: LocalizedTextDto;
  brand?: string | null;
  imageUrl?: string | null;
  sku?: string | null;
  ean?: string | null;
  unitSize?: number | null;
  category?:
    | 'PRODUCE'
    | 'DAIRY'
    | 'BAKERY'
    | 'MEAT'
    | 'SEAFOOD'
    | 'FROZEN'
    | 'BEVERAGES'
    | 'SNACKS'
    | 'PANTRY'
    | 'HOUSEHOLD'
    | 'PERSONAL_CARE'
    | 'OTHER';
  defaultUnit?: 'UNIT' | 'GRAM' | 'KILOGRAM' | 'MILLILITER' | 'LITER' | 'PACK';
  productGroupId?: string | null;
};

/**
 * `UpdateLineDto` in the gateway's OpenAPI document.
 */
export type UpdateLineDto = {
  content?: string;
  quantity?: number;
  itemIds?: string[];
  adoptItemIds?: string[];
  confirmMerge?: boolean;
};

/**
 * `UpdateListDto` in the gateway's OpenAPI document.
 */
export type UpdateListDto = {
  name?: string;
  autoApproveLines?: boolean;
  sharedWithZone?: boolean;
};

/**
 * `UpdatePricePolicyDto` in the gateway's OpenAPI document.
 */
export type UpdatePricePolicyDto = {
  priority?: number;
  maxAgeDays?: number | null;
  enabled?: boolean;
};

/**
 * `UpdatePriceScopeDto` in the gateway's OpenAPI document.
 */
export type UpdatePriceScopeDto = {
  kind?: 'NATIONAL' | 'REGION' | 'LOCAL_AREA' | 'STORE';
  externalKey?: string | null;
  label?: LocalizedTextDto;
  priority?: number;
};

/**
 * `UpdateProductGroupDto` in the gateway's OpenAPI document.
 */
export type UpdateProductGroupDto = {
  name?: LocalizedTextDto;
  slug?: string;
  referenceUnit?:
    | 'UNIT'
    | 'GRAM'
    | 'KILOGRAM'
    | 'MILLILITER'
    | 'LITER'
    | 'PACK';
  synonyms?: LocalizedSynonymsDto;
};

/**
 * `UpdateProfileDto` in the gateway's OpenAPI document.
 */
export type UpdateProfileDto = {
  username: string;
  propagation?: 'GLOBAL_ONLY' | 'MATCHING_ZONES' | 'ALL_ZONES';
};

/**
 * `UpdateShoppingProfileDto` in the gateway's OpenAPI document.
 */
export type UpdateShoppingProfileDto = {
  name?: string | null;
  addressText?: string | null;
  minSavingCents?: number;
  minSavingPercent?: number | null;
  generationScope?: 'ALL' | 'SELECTED';
  postalCodes?: ProfilePostalCodeDto[];
  supermarkets?: ProfileSupermarketDto[];
  generationSources?: ProfileGenerationSourceDto[];
};

/**
 * `UpdateSupermarketDto` in the gateway's OpenAPI document.
 */
export type UpdateSupermarketDto = {
  name?: LocalizedTextDto;
  logoUrl?: string | null;
  websiteUrl?: string | null;
  externalBrandKey?: string | null;
  defaultPriceScopeId?: string | null;
};

/**
 * `UpdateSupermarketLocationDto` in the gateway's OpenAPI document.
 */
export type UpdateSupermarketLocationDto = {
  priceScopeId?: string;
  priceScopeIds?: string[];
  label?: LocalizedTextDto;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  postalCode?: string | null;
  externalRef?: string | null;
  externalProvider?: string | null;
};

/**
 * `UpdateZoneDto` in the gateway's OpenAPI document.
 */
export type UpdateZoneDto = {
  name?: string;
  config?: Record<string, unknown>;
};

/**
 * `UpgradeDto` in the gateway's OpenAPI document.
 */
export type UpgradeDto = {
  email: string;
  password: string;
  displayName?: string;
};

/**
 * `UpsertSupermarketLocationItemDto` in the gateway's OpenAPI document.
 */
export type UpsertSupermarketLocationItemDto = {
  itemId: string;
  supermarketLocationId: string;
  positionInStore?: string | null;
};

/**
 * `UpsertSupermarketSourceDto` in the gateway's OpenAPI document.
 */
export type UpsertSupermarketSourceDto = {
  adapterKey:
    | 'mercadona-api'
    | 'deza-web'
    | 'carrefour-web'
    | 'lidl-api'
    | 'osm-places'
    | 'manual';
  enabled?: boolean;
  autoImportPlaces?: boolean;
  config?: {
    [key: string]: unknown;
  };
  workers?: number;
  maxRequestsPerSecond?: number;
};

/**
 * `VerifyEmailDto` in the gateway's OpenAPI document.
 */
export type VerifyEmailDto = {
  token: string;
};

/**
 * `admin-auth.AdminAuthTokens` in the gateway's OpenAPI document.
 */
export type AdminAuthAdminAuthTokens = {
  adminId: string;
  username: string;
  displayName: string | null;
  accessToken: string;
  expiresAt: string;
};

/**
 * `admin-auth.AdminIdentityListView` in the gateway's OpenAPI document.
 */
export type AdminAuthAdminIdentityListView = {
  admins: AdminAuthAdminIdentityView[];
};

/**
 * `admin-auth.AdminIdentityView` in the gateway's OpenAPI document.
 */
export type AdminAuthAdminIdentityView = {
  adminId: string;
  username: string;
  displayName: string | null;
  lastLoginAt: string | null;
  disabledAt: string | null;
};

/**
 * `admin-auth.AdminMeView` in the gateway's OpenAPI document.
 */
export type AdminAuthAdminMeView = {
  admin: AdminAuthAdminIdentityView;
  environment: string;
};

/**
 * `admin-core.AdminBasketDetailView` in the gateway's OpenAPI document.
 */
export type AdminCoreAdminBasketDetailView = {
  id: string;
  ownerUserId: string;
  kind: EnumsBasketKind;
  name: string | null;
  status: EnumsBasketStatus;
  zoneIds: string[];
  lineCount: number;
  generatedAt: string;
  createdAt: string;
  updatedAt: string;
  lines: AdminCoreAdminBasketRowView[];
};

/**
 * `admin-core.AdminBasketPage` in the gateway's OpenAPI document.
 *
 * A cursor paginated page. `nextCursor` is null on the last page; otherwise pass it back as the `cursor` query parameter to fetch the next one.
 */
export type AdminCoreAdminBasketPage = {
  items: AdminCoreAdminBasketView[];
  nextCursor: string | null;
};

/**
 * `admin-core.AdminBasketRowView` in the gateway's OpenAPI document.
 */
export type AdminCoreAdminBasketRowView = {
  rowKey: string;
  content: string;
  left: number;
  bought: number;
  asked: number;
  settlements: AdminCoreAdminBasketSettlementView[];
};

/**
 * `admin-core.AdminBasketSettlementView` in the gateway's OpenAPI document.
 */
export type AdminCoreAdminBasketSettlementView = {
  id: string;
  lineId: string;
  itemId: string | null;
  outcome: EnumsSettlementOutcome;
  quantity: number;
  pricePaidCents: number | null;
  pricePaidCurrency: string | null;
  priceScopeId: string | null;
  supermarketLocationId: string | null;
  settledByUserId: string | null;
  settledByParticipantId: string | null;
  settledAt: string;
  revertedAt: string | null;
};

/**
 * `admin-core.AdminBasketView` in the gateway's OpenAPI document.
 */
export type AdminCoreAdminBasketView = {
  id: string;
  ownerUserId: string;
  kind: EnumsBasketKind;
  name: string | null;
  status: EnumsBasketStatus;
  zoneIds: string[];
  lineCount: number;
  generatedAt: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * `admin-core.AdminListDetailView` in the gateway's OpenAPI document.
 */
export type AdminCoreAdminListDetailView = {
  id: string;
  zoneId: string;
  zoneName: string;
  name: string;
  createdByUserId: string;
  autoApproveLines: boolean;
  sharedWithZone: boolean;
  lineCount: number;
  createdAt: string;
  updatedAt: string;
  lines: AdminCoreAdminListLineView[];
};

/**
 * `admin-core.AdminListLinePage` in the gateway's OpenAPI document.
 *
 * A cursor paginated page. `nextCursor` is null on the last page; otherwise pass it back as the `cursor` query parameter to fetch the next one.
 */
export type AdminCoreAdminListLinePage = {
  items: AdminCoreAdminListLineView[];
  nextCursor: string | null;
};

/**
 * `admin-core.AdminListLineView` in the gateway's OpenAPI document.
 */
export type AdminCoreAdminListLineView = {
  id: string;
  listId: string;
  listName: string;
  content: string;
  quantity: number;
  approvalStatus: EnumsLineApprovalStatus;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * `admin-core.AdminListPage` in the gateway's OpenAPI document.
 *
 * A cursor paginated page. `nextCursor` is null on the last page; otherwise pass it back as the `cursor` query parameter to fetch the next one.
 */
export type AdminCoreAdminListPage = {
  items: AdminCoreAdminListView[];
  nextCursor: string | null;
};

/**
 * `admin-core.AdminListView` in the gateway's OpenAPI document.
 */
export type AdminCoreAdminListView = {
  id: string;
  zoneId: string;
  zoneName: string;
  name: string;
  createdByUserId: string;
  autoApproveLines: boolean;
  sharedWithZone: boolean;
  lineCount: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * `admin-core.AdminMembershipPage` in the gateway's OpenAPI document.
 *
 * A cursor paginated page. `nextCursor` is null on the last page; otherwise pass it back as the `cursor` query parameter to fetch the next one.
 */
export type AdminCoreAdminMembershipPage = {
  items: AdminCoreAdminZoneMemberView[];
  nextCursor: string | null;
};

/**
 * `admin-core.AdminZoneDetailView` in the gateway's OpenAPI document.
 */
export type AdminCoreAdminZoneDetailView = {
  id: string;
  name: string;
  status: EnumsZoneStatus;
  ownerUserId: string | null;
  memberCount: number;
  listCount: number;
  markedForDeletionAt: string | null;
  createdAt: string;
  updatedAt: string;
  joinCode: string;
  config: {
    [key: string]: unknown;
  };
  members: AdminCoreAdminZoneMemberView[];
  lists: AdminCoreAdminZoneListView[];
};

/**
 * `admin-core.AdminZoneListView` in the gateway's OpenAPI document.
 */
export type AdminCoreAdminZoneListView = {
  id: string;
  name: string;
  lineCount: number;
};

/**
 * `admin-core.AdminZoneMemberView` in the gateway's OpenAPI document.
 */
export type AdminCoreAdminZoneMemberView = {
  membershipId: string;
  zoneId: string;
  zoneName: string;
  userId: string;
  username: string;
  role: EnumsZoneRole;
  status: EnumsMembershipStatus;
  createdAt: string;
};

/**
 * `admin-core.AdminZoneRowPage` in the gateway's OpenAPI document.
 *
 * A cursor paginated page. `nextCursor` is null on the last page; otherwise pass it back as the `cursor` query parameter to fetch the next one.
 */
export type AdminCoreAdminZoneRowPage = {
  items: AdminCoreAdminZoneRowView[];
  nextCursor: string | null;
};

/**
 * `admin-core.AdminZoneRowView` in the gateway's OpenAPI document.
 */
export type AdminCoreAdminZoneRowView = {
  id: string;
  name: string;
  status: EnumsZoneStatus;
  ownerUserId: string | null;
  memberCount: number;
  listCount: number;
  markedForDeletionAt: string | null;
  createdAt: string;
  updatedAt: string;
  ownerName: string | null;
};

/**
 * `admin-core.PostalCodeUsageListView` in the gateway's OpenAPI document.
 */
export type AdminCorePostalCodeUsageListView = {
  country: string;
  usage: AdminCorePostalCodeUsageView[];
};

/**
 * `admin-core.PostalCodeUsageView` in the gateway's OpenAPI document.
 */
export type AdminCorePostalCodeUsageView = {
  postalCode: string;
  mainProfiles: number;
  nearbyProfiles: number;
  suppressedProfiles: number;
  mainUsers: number;
  nearbyUsers: number;
};

/**
 * `admin-dashboard.AdminActivityEntry` in the gateway's OpenAPI document.
 */
export type AdminDashboardAdminActivityEntry = {
  at: string;
  actorKind: 'ADMIN' | 'SERVICE';
  actorId: string;
  entity: string;
  entityId: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
};

/**
 * `admin-dashboard.AdminCatalogDashboard` in the gateway's OpenAPI document.
 */
export type AdminDashboardAdminCatalogDashboard = {
  supermarkets: number;
  locations: number;
  items: number;
  productGroups: number;
  supermarketItems: {
    total: number;
    priced: number;
    stale: number;
    unavailable: number;
  };
  pricesWritten: AdminDashboardAdminPricesWrittenSeries[];
  activity: AdminDashboardAdminActivityEntry[];
};

/**
 * `admin-dashboard.AdminCoreDashboard` in the gateway's OpenAPI document.
 */
export type AdminDashboardAdminCoreDashboard = {
  zones: {
    total: number;
    active: number;
    markedForDeletion: number;
  };
  memberships: {
    pending: number;
  };
  lists: {
    total: number;
  };
  baskets: {
    total: number;
    open: number;
    finished: number;
    live: number;
  };
  zonesCreated: AdminDashboardDailyCount[];
  listsCreated: AdminDashboardDailyCount[];
  activity: AdminDashboardAdminActivityEntry[];
};

/**
 * `admin-dashboard.AdminDashboardActivityEntry` in the gateway's OpenAPI document.
 */
export type AdminDashboardAdminDashboardActivityEntry = {
  at: string;
  actorKind: 'ADMIN' | 'SERVICE';
  actorId: string;
  entity: string;
  entityId: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  actorName: string;
};

/**
 * `admin-dashboard.AdminDashboardWindow` in the gateway's OpenAPI document.
 */
export type AdminDashboardAdminDashboardWindow = {
  from: string;
  to: string;
};

/**
 * `admin-dashboard.AdminHarvestDashboard` in the gateway's OpenAPI document.
 */
export type AdminDashboardAdminHarvestDashboard = {
  runs: {
    byStatus: AdminDashboardAdminHarvestRunStatusCount[];
    inWindow: number;
  };
  running: HarvestHarvestRunView | null;
  recent: HarvestHarvestRunView[];
  queues: {
    entries: AdminDashboardAdminHarvestQueueEntry[];
    places: number;
    shops: AdminDashboardAdminHarvestShopQueue[];
  };
  sources: {
    total: number;
    enabled: number;
  };
};

/**
 * `admin-dashboard.AdminHarvestQueueEntry` in the gateway's OpenAPI document.
 */
export type AdminDashboardAdminHarvestQueueEntry = {
  supermarketId: string;
  candidate: number;
  unresolved: number;
};

/**
 * `admin-dashboard.AdminHarvestRunStatusCount` in the gateway's OpenAPI document.
 */
export type AdminDashboardAdminHarvestRunStatusCount = {
  status: EnumsHarvestRunStatus;
  count: number;
};

/**
 * `admin-dashboard.AdminHarvestShopQueue` in the gateway's OpenAPI document.
 */
export type AdminDashboardAdminHarvestShopQueue = {
  supermarketId: string;
  unmapped: number;
};

/**
 * `admin-dashboard.AdminIdentityDashboard` in the gateway's OpenAPI document.
 */
export type AdminDashboardAdminIdentityDashboard = {
  users: {
    total: number;
    registered: number;
    temporary: number;
    verified: number;
  };
  signUps: AdminDashboardDailyCount[];
  admins: {
    total: number;
    disabled: number;
  };
  loginFailures: {
    last24h: number;
    last7d: number;
    recent: AdminDashboardAdminLoginFailureView[];
  };
  activity: AdminDashboardAdminActivityEntry[];
};

/**
 * `admin-dashboard.AdminLoginFailureView` in the gateway's OpenAPI document.
 */
export type AdminDashboardAdminLoginFailureView = {
  at: string;
  username: string;
  ip: string | null;
};

/**
 * `admin-dashboard.AdminPricesWrittenSeries` in the gateway's OpenAPI document.
 */
export type AdminDashboardAdminPricesWrittenSeries = {
  sourceKind: EnumsPriceSourceKind;
  points: AdminDashboardDailyCount[];
};

/**
 * `admin-dashboard.DailyCount` in the gateway's OpenAPI document.
 */
export type AdminDashboardDailyCount = {
  day: string;
  count: number;
};

/**
 * `admin-users.AdminUserDetailView` in the gateway's OpenAPI document.
 */
export type AdminUsersAdminUserDetailView = {
  userId: string;
  kind: EnumsUserKind;
  username: string;
  displayName: string | null;
  email: string | null;
  emailVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  hasPassword: boolean;
  providers: EnumsAuthProvider[];
};

/**
 * `admin-users.AdminUserPage` in the gateway's OpenAPI document.
 *
 * A cursor paginated page. `nextCursor` is null on the last page; otherwise pass it back as the `cursor` query parameter to fetch the next one.
 */
export type AdminUsersAdminUserPage = {
  items: AdminUsersAdminUserView[];
  nextCursor: string | null;
};

/**
 * `admin-users.AdminUserView` in the gateway's OpenAPI document.
 */
export type AdminUsersAdminUserView = {
  userId: string;
  kind: EnumsUserKind;
  username: string;
  displayName: string | null;
  email: string | null;
  emailVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * `admin.AdminDashboardResponse` in the gateway's OpenAPI document.
 *
 * What the back office opens to. Each block is `null` when that service did not answer, and the response is still 200: one stopped service costs its own block rather than the whole page.
 */
export type AdminAdminDashboardResponse = {
  window: AdminDashboardAdminDashboardWindow;
  identity: AdminDashboardAdminIdentityDashboard | null;
  core: AdminDashboardAdminCoreDashboard | null;
  catalog: AdminDashboardAdminCatalogDashboard | null;
  harvest: AdminDashboardAdminHarvestDashboard | null;
  activity: AdminDashboardAdminDashboardActivityEntry[];
  measuredAt: string;
};

/**
 * `admin.AdminEnvironmentResponse` in the gateway's OpenAPI document.
 *
 * Which deployment answered. Readable with no token, so the back office can draw its per environment accent colour before anybody has signed in.
 */
export type AdminAdminEnvironmentResponse = {
  environment: string;
  devAutologin: boolean;
};

/**
 * `assistant.AssistantChoice` in the gateway's OpenAPI document.
 */
export type AssistantAssistantChoice = {
  label: string;
  message: string;
};

/**
 * `assistant.AssistantListLink` in the gateway's OpenAPI document.
 */
export type AssistantAssistantListLink = {
  zoneId: string;
  listId: string;
  label: string;
  zoneLabel: string | null;
};

/**
 * `auth.AuthTokens` in the gateway's OpenAPI document.
 */
export type AuthAuthTokens = {
  userId: string;
  kind: EnumsUserKind;
  username: string;
  accessToken: string;
  refreshToken: string;
};

/**
 * `auth.DeleteAccountResult` in the gateway's OpenAPI document.
 */
export type AuthDeleteAccountResult = {
  userId: string;
  deleted: boolean;
};

/**
 * `auth.MintOAuthStateResult` in the gateway's OpenAPI document.
 */
export type AuthMintOAuthStateResult = {
  state: string;
};

/**
 * `auth.RetryAfterResult` in the gateway's OpenAPI document.
 *
 * The request was accepted. `retryAfterSeconds` is how long before another is accepted; a refusal returns the same field on the error envelope with what is actually left. Count down the number you were given rather than assuming a fixed wait.
 */
export type AuthRetryAfterResult = {
  retryAfterSeconds: number;
};

/**
 * `auth.SuggestUsernameResult` in the gateway's OpenAPI document.
 */
export type AuthSuggestUsernameResult = {
  username: string;
};

/**
 * `auth.UserProfileView` in the gateway's OpenAPI document.
 */
export type AuthUserProfileView = {
  userId: string;
  kind: EnumsUserKind;
  username: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
};

/**
 * `basket-sharing.JoinResult` in the gateway's OpenAPI document.
 */
export type BasketSharingJoinResult = {
  basketId: string;
  participant: BasketSharingParticipantView;
  sessionSecret: string | null;
  socketToken: string;
  socketTokenExpiresAt: string;
};

/**
 * `basket-sharing.LinkPreview` in the gateway's OpenAPI document.
 */
export type BasketSharingLinkPreview = {
  joinable: boolean;
  name?: string | null;
  participantCount?: number;
};

/**
 * `basket-sharing.ParticipantListResult` in the gateway's OpenAPI document.
 */
export type BasketSharingParticipantListResult = {
  participants: BasketSharingParticipantView[];
};

/**
 * `basket-sharing.ParticipantTokenResult` in the gateway's OpenAPI document.
 */
export type BasketSharingParticipantTokenResult = {
  socketToken: string;
  socketTokenExpiresAt: string;
  participant: BasketSharingParticipantView;
};

/**
 * `basket-sharing.ParticipantView` in the gateway's OpenAPI document.
 */
export type BasketSharingParticipantView = {
  id: string;
  kind: EnumsParticipantKind;
  displayName: string | null;
  username: string | null;
  guestNumber: number | null;
  userId: string | null;
  joinedAt?: string;
  lastSeenAt?: string;
  shareLinkId: string | null;
  userAgent?: string | null;
  expiresAt: string | null;
};

/**
 * `basket-sharing.ShareLinkResult` in the gateway's OpenAPI document.
 */
export type BasketSharingShareLinkResult = {
  link?: BasketSharingShareLinkView;
};

/**
 * `basket-sharing.ShareLinkView` in the gateway's OpenAPI document.
 */
export type BasketSharingShareLinkView = {
  id: string;
  basketId: string;
  secret: string;
  createdByParticipantId: string;
  createdAt: string;
  expiresAt: string;
  participantCount: number;
};

/**
 * `basket.BasketChangeActorView` in the gateway's OpenAPI document.
 */
export type BasketBasketChangeActorView =
  | {
      participantId: string;
    }
  | {
      userId: string;
    };

/**
 * `basket.BasketChangePage` in the gateway's OpenAPI document.
 *
 * A cursor paginated page. `nextCursor` is null on the last page; otherwise pass it back as the `cursor` query parameter to fetch the next one.
 */
export type BasketBasketChangePage = {
  items: BasketBasketChangeView[];
  nextCursor: string | null;
};

/**
 * `basket.BasketChangeView` in the gateway's OpenAPI document.
 */
export type BasketBasketChangeView = {
  id: string;
  kind: EnumsLineChangeKind;
  at: string;
  unseen: boolean;
  rowKey: string | null;
  contentBefore: string | null;
  contentAfter: string | null;
  quantityBefore: number | null;
  quantityAfter: number | null;
  approvalBefore: EnumsLineApprovalStatus | null;
  approvalAfter: EnumsLineApprovalStatus | null;
  listId?: string;
  actor: BasketBasketChangeActorView | null;
};

/**
 * `basket.BasketChangesAcknowledged` in the gateway's OpenAPI document.
 */
export type BasketBasketChangesAcknowledged = {
  unseenChangeCount: number;
  marksLapseInMs: number;
};

/**
 * `basket.BasketHeaderView` in the gateway's OpenAPI document.
 */
export type BasketBasketHeaderView = {
  id: string;
  kind: EnumsBasketKind;
  name: string | null;
  status: EnumsBasketStatus;
  generatedAt: string;
  sources: BasketBasketSourceView[];
};

/**
 * `basket.BasketHistoryView` in the gateway's OpenAPI document.
 */
export type BasketBasketHistoryView = {
  id: string;
  kind: EnumsBasketKind;
  name: string | null;
  status: EnumsBasketStatus;
  generatedAt: string;
  lineCount: number;
  settledLineCount: number;
  boughtLineCount: number;
  notAvailableLineCount: number;
  presentCount: number;
};

/**
 * `basket.BasketListRef` in the gateway's OpenAPI document.
 */
export type BasketBasketListRef = {
  listId: string;
  name: string;
  zoneId: string;
  zoneName: string;
};

/**
 * `basket.BasketOwnerView` in the gateway's OpenAPI document.
 */
export type BasketBasketOwnerView = {
  userId: string;
  name: string;
};

/**
 * `basket.BasketPage` in the gateway's OpenAPI document.
 *
 * A cursor paginated page. `nextCursor` is null on the last page; otherwise pass it back as the `cursor` query parameter to fetch the next one.
 */
export type BasketBasketPage = {
  items: BasketBasketHistoryView[];
  nextCursor: string | null;
};

/**
 * `basket.BasketPriceScopeView` in the gateway's OpenAPI document.
 */
export type BasketBasketPriceScopeView = {
  priceScopeId: string;
  supermarketId: string;
  supermarketName: CatalogLocalizedText;
  locations: BasketBasketScopeLocationView[];
};

/**
 * `basket.BasketProgress` in the gateway's OpenAPI document.
 */
export type BasketBasketProgress = {
  done: number;
  unavailable: number;
  total: number;
  pending: number;
};

/**
 * `basket.BasketResult` in the gateway's OpenAPI document.
 */
export type BasketBasketResult = {
  id: string;
  kind: EnumsBasketKind;
  name: string | null;
  status: EnumsBasketStatus;
  createdAt: string;
  rows: BasketBasketRowView[];
  lists: BasketBasketListRef[];
  participants: BasketSharingParticipantView[];
  me: BasketSharingParticipantView;
  progress: BasketBasketProgress;
  truncated: boolean;
  servesLocations: boolean;
  unseenChangeCount: number;
  newestUnseenChangeId: string | null;
  products: CatalogItemView[];
  scopes: BasketBasketPriceScopeView[];
};

/**
 * `basket.BasketRowEntryView` in the gateway's OpenAPI document.
 */
export type BasketBasketRowEntryView = {
  lineId: string;
  listId?: string;
  left: number;
  bought: number;
  state: EnumsBasketRowState;
  approvalStatus: EnumsLineApprovalStatus;
  demandEditable: boolean;
};

/**
 * `basket.BasketRowResult` in the gateway's OpenAPI document.
 */
export type BasketBasketRowResult = {
  row: BasketBasketRowView;
  progress: BasketBasketProgress;
  skippedCount?: number;
  replacedRowKey?: string;
};

/**
 * `basket.BasketRowView` in the gateway's OpenAPI document.
 */
export type BasketBasketRowView = {
  rowKey: string;
  content: string;
  left: number;
  bought: number;
  asked: number;
  state: EnumsBasketRowState;
  note: EnumsBasketRowNote | null;
  noteAt: string | null;
  mark: EnumsBasketRowMark | null;
  awaitingApproval: boolean;
  optionIds: string[];
  touchedBy: string | null;
  touchedAt: string | null;
  entries: BasketBasketRowEntryView[];
};

/**
 * `basket.BasketRunResult` in the gateway's OpenAPI document.
 */
export type BasketBasketRunResult = {
  basket: BasketBasketHeaderView;
  list: BasketBasketHeaderView;
};

/**
 * `basket.BasketScopeLocationView` in the gateway's OpenAPI document.
 */
export type BasketBasketScopeLocationView = {
  supermarketLocationId: string;
  label: CatalogLocalizedText | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
};

/**
 * `basket.BasketSourceView` in the gateway's OpenAPI document.
 */
export type BasketBasketSourceView = {
  zoneId: string;
  listId: string | null;
};

/**
 * `basket.BasketSummaryView` in the gateway's OpenAPI document.
 */
export type BasketBasketSummaryView = {
  id: string;
  kind: EnumsBasketKind;
  progress: BasketBasketProgress;
};

/**
 * `basket.SharedBasketPage` in the gateway's OpenAPI document.
 *
 * A cursor paginated page. `nextCursor` is null on the last page; otherwise pass it back as the `cursor` query parameter to fetch the next one.
 */
export type BasketSharedBasketPage = {
  items: BasketSharedBasketView[];
  nextCursor: string | null;
};

/**
 * `basket.SharedBasketView` in the gateway's OpenAPI document.
 */
export type BasketSharedBasketView = {
  id: string;
  kind: EnumsBasketKind;
  name: string | null;
  status: EnumsBasketStatus;
  generatedAt: string;
  lineCount: number;
  settledLineCount: number;
  boughtLineCount: number;
  notAvailableLineCount: number;
  presentCount: number;
  owner: BasketBasketOwnerView;
  sharedAt: string;
};

/**
 * `catalog.AdminPostalCodePage` in the gateway's OpenAPI document.
 *
 * A cursor paginated page. `nextCursor` is null on the last page; otherwise pass it back as the `cursor` query parameter to fetch the next one.
 */
export type CatalogAdminPostalCodePage = {
  items: CatalogAdminPostalCodeView[];
  nextCursor: string | null;
};

/**
 * `catalog.AdminPostalCodeView` in the gateway's OpenAPI document.
 */
export type CatalogAdminPostalCodeView = {
  country: string;
  postalCode: string;
  latitude: number;
  longitude: number;
  locationCount: number;
};

/**
 * `catalog.AdminSupermarketItemPage` in the gateway's OpenAPI document.
 *
 * A cursor paginated page. `nextCursor` is null on the last page; otherwise pass it back as the `cursor` query parameter to fetch the next one.
 */
export type CatalogAdminSupermarketItemPage = {
  items: CatalogAdminSupermarketItemView[];
  nextCursor: string | null;
};

/**
 * `catalog.AdminSupermarketItemView` in the gateway's OpenAPI document.
 */
export type CatalogAdminSupermarketItemView = {
  id: string;
  itemId: string;
  priceScopeId: string;
  price: number | null;
  currency: string | null;
  unitPrice: number | null;
  unitPriceLabel: string | null;
  unitBasis?: 'KILOGRAM' | 'LITER' | 'UNIT' | 'DOZEN' | 'WASH' | null;
  observedAt: string | null;
  sourceKind: EnumsPriceSourceKind | null;
  priceCopiedFromScopeId?: string | null;
  stale: boolean;
  validUntil: string | null;
  itemPriceId: string | null;
  available: boolean;
  itemName: CatalogLocalizedText | null;
};

/**
 * `catalog.BrandPage` in the gateway's OpenAPI document.
 *
 * A cursor paginated page. `nextCursor` is null on the last page; otherwise pass it back as the `cursor` query parameter to fetch the next one.
 */
export type CatalogBrandPage = {
  items: CatalogBrandView[];
  nextCursor: string | null;
};

/**
 * `catalog.BrandView` in the gateway's OpenAPI document.
 */
export type CatalogBrandView = {
  id: string;
  key: string;
  label: string;
  privateLabelSupermarketId: string | null;
  itemCount: number;
  canonicalBrandId: string | null;
  canonicalLabel: string | null;
  linkCount: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * `catalog.BulkOperationError` in the gateway's OpenAPI document.
 */
export type CatalogBulkOperationError = {
  code: EnumsBulkOperationErrorCode;
  detail: string;
};

/**
 * `catalog.CatalogScopeView` in the gateway's OpenAPI document.
 */
export type CatalogCatalogScopeView = {
  priceScopeIds: string[];
  scopes: CatalogResolvedScopeView[];
  coverage: CatalogPostalCodeCoverageView[];
  approximate: boolean;
  profileId: string | null;
  explicit: boolean;
};

/**
 * `catalog.CatalogSuggestResponse` in the gateway's OpenAPI document.
 */
export type CatalogCatalogSuggestResponse = {
  suggestions: CatalogCatalogSuggestion[];
};

/**
 * `catalog.CatalogSuggestion` in the gateway's OpenAPI document.
 */
export type CatalogCatalogSuggestion = {
  kind: 'group' | 'item';
  group: CatalogProductGroupOfferView | null;
  item: CatalogItemView | null;
};

/**
 * `catalog.CreateBrandResult` in the gateway's OpenAPI document.
 */
export type CatalogCreateBrandResult = {
  id: string;
  key: string;
  label: string;
  privateLabelSupermarketId: string | null;
  itemCount: number;
  canonicalBrandId: string | null;
  canonicalLabel: string | null;
  linkCount: number;
  createdAt: string;
  updatedAt: string;
  linkedItems: number;
};

/**
 * `catalog.DeleteBrandResult` in the gateway's OpenAPI document.
 */
export type CatalogDeleteBrandResult = {
  id: string;
  movedItems: number;
};

/**
 * `catalog.ItemOfferView` in the gateway's OpenAPI document.
 */
export type CatalogItemOfferView = {
  itemId: string;
  priceScopeId: string;
  price: number | null;
  currency: string | null;
  unitPrice: number | null;
  unitPriceLabel: string | null;
  unitBasis?: 'KILOGRAM' | 'LITER' | 'UNIT' | 'DOZEN' | 'WASH' | null;
  observedAt: string | null;
  sourceKind: EnumsPriceSourceKind | null;
  priceCopiedFromScopeId?: string | null;
  stale: boolean;
};

/**
 * `catalog.ItemPage` in the gateway's OpenAPI document.
 *
 * A cursor paginated page. `nextCursor` is null on the last page; otherwise pass it back as the `cursor` query parameter to fetch the next one.
 */
export type CatalogItemPage = {
  items: CatalogItemView[];
  nextCursor: string | null;
};

/**
 * `catalog.ItemPriceDetails` in the gateway's OpenAPI document.
 */
export type CatalogItemPriceDetails = {
  offerId: string | null;
  page: number | null;
  rawText: string[];
  promotion: {
    [key: string]: unknown;
  } | null;
  loyalty: {
    [key: string]: unknown;
  } | null;
};

/**
 * `catalog.ItemPriceOverride` in the gateway's OpenAPI document.
 */
export type CatalogItemPriceOverride = {
  price: number | null;
  unitPrice: number | null;
};

/**
 * `catalog.ItemPriceOverrides` in the gateway's OpenAPI document.
 */
export type CatalogItemPriceOverrides = {
  [key: string]: CatalogItemPriceOverride;
};

/**
 * `catalog.ItemPricePage` in the gateway's OpenAPI document.
 *
 * A cursor paginated page. `nextCursor` is null on the last page; otherwise pass it back as the `cursor` query parameter to fetch the next one.
 */
export type CatalogItemPricePage = {
  items: CatalogItemPriceView[];
  nextCursor: string | null;
};

/**
 * `catalog.ItemPriceView` in the gateway's OpenAPI document.
 */
export type CatalogItemPriceView = {
  id: string;
  itemId: string;
  priceScopeId: string;
  sourceKind: EnumsPriceSourceKind;
  price: number | null;
  currency: string | null;
  unitPrice: number | null;
  unitPriceLabel: string | null;
  unitBasis?: 'KILOGRAM' | 'LITER' | 'UNIT' | 'DOZEN' | 'WASH' | null;
  observedAt: string;
  lastObservedAt: string;
  validFrom: string | null;
  validUntil: string | null;
  sourceRunId: string | null;
  lastObservedRunId: string | null;
  copiedFromScopeId?: string | null;
  overrides: CatalogItemPriceOverrides | null;
  protectedUntil: string | null;
  details: CatalogItemPriceDetails | null;
  writtenBy?: EnumsItemPriceWrittenBy;
};

/**
 * `catalog.ItemScopePricesPage` in the gateway's OpenAPI document.
 *
 * A cursor paginated page. `nextCursor` is null on the last page; otherwise pass it back as the `cursor` query parameter to fetch the next one.
 */
export type CatalogItemScopePricesPage = {
  items: CatalogItemScopePricesView[];
  nextCursor: string | null;
};

/**
 * `catalog.ItemScopePricesView` in the gateway's OpenAPI document.
 */
export type CatalogItemScopePricesView = {
  priceScopeId: string;
  supermarketId: string;
  scopeKind: EnumsPriceScopeKind;
  scopeExternalKey: string | null;
  scopeLabel: CatalogLocalizedText | null;
  scopePriority: number;
  rows: CatalogItemPriceView[];
  shownItemPriceId: string | null;
  shownBecause: EnumsPriceShownBecause | null;
  stale: boolean;
  protectedUntil: string | null;
  overrides: CatalogItemPriceOverrides | null;
};

/**
 * `catalog.ItemView` in the gateway's OpenAPI document.
 */
export type CatalogItemView = {
  id: string;
  name: CatalogLocalizedText;
  brand: string | null;
  imageUrl: string | null;
  sku: string | null;
  ean: string | null;
  unitSize: number | null;
  category: EnumsItemCategory;
  defaultUnit: EnumsUnitOfMeasure;
  productGroupId: string | null;
  bestOffer?: CatalogItemOfferView | null;
  offers?: CatalogItemOfferView[];
};

/**
 * `catalog.LocalizedSynonyms` in the gateway's OpenAPI document.
 */
export type CatalogLocalizedSynonyms = {
  en: string[];
  es: string[];
};

/**
 * `catalog.LocalizedText` in the gateway's OpenAPI document.
 */
export type CatalogLocalizedText = {
  en?: string;
  es?: string;
};

/**
 * `catalog.NearbyPostalCodesView` in the gateway's OpenAPI document.
 */
export type CatalogNearbyPostalCodesView = {
  country: string;
  postalCode: string;
  known: boolean;
  postalCodes: CatalogPostalCodeDistanceView[];
};

/**
 * `catalog.PostalCodeCoverageView` in the gateway's OpenAPI document.
 */
export type CatalogPostalCodeCoverageView = {
  postalCode: string;
  served: boolean;
};

/**
 * `catalog.PostalCodeDistanceView` in the gateway's OpenAPI document.
 */
export type CatalogPostalCodeDistanceView = {
  postalCode: string;
  distanceMetres: number;
};

/**
 * `catalog.PricePolicyListView` in the gateway's OpenAPI document.
 */
export type CatalogPricePolicyListView = {
  items: CatalogPricePolicyView[];
};

/**
 * `catalog.PricePolicyView` in the gateway's OpenAPI document.
 */
export type CatalogPricePolicyView = {
  sourceKind: EnumsPriceSourceKind;
  priority: number;
  maxAgeDays: number | null;
  enabled: boolean;
};

/**
 * `catalog.PriceScopePage` in the gateway's OpenAPI document.
 *
 * A cursor paginated page. `nextCursor` is null on the last page; otherwise pass it back as the `cursor` query parameter to fetch the next one.
 */
export type CatalogPriceScopePage = {
  items: CatalogPriceScopeView[];
  nextCursor: string | null;
};

/**
 * `catalog.PriceScopeView` in the gateway's OpenAPI document.
 */
export type CatalogPriceScopeView = {
  id: string;
  supermarketId: string;
  kind: EnumsPriceScopeKind;
  externalKey: string | null;
  label: CatalogLocalizedText | null;
  priority: number;
};

/**
 * `catalog.ProductGroupAssignmentOutcome` in the gateway's OpenAPI document.
 */
export type CatalogProductGroupAssignmentOutcome = {
  op: 'createGroup' | 'assignItem';
  ref: string | null;
  itemId: string | null;
  groupId: string | null;
  applied: boolean;
  error: CatalogBulkOperationError | null;
};

/**
 * `catalog.ProductGroupOfferPage` in the gateway's OpenAPI document.
 *
 * A cursor paginated page. `nextCursor` is null on the last page; otherwise pass it back as the `cursor` query parameter to fetch the next one.
 */
export type CatalogProductGroupOfferPage = {
  items: CatalogProductGroupOfferView[];
  nextCursor: string | null;
};

/**
 * `catalog.ProductGroupOfferView` in the gateway's OpenAPI document.
 */
export type CatalogProductGroupOfferView = {
  group: CatalogProductGroupView;
  cheapestItem: CatalogItemView | null;
  offer: CatalogItemOfferView | null;
  itemIds: string[];
};

/**
 * `catalog.ProductGroupPage` in the gateway's OpenAPI document.
 *
 * A cursor paginated page. `nextCursor` is null on the last page; otherwise pass it back as the `cursor` query parameter to fetch the next one.
 */
export type CatalogProductGroupPage = {
  items: CatalogProductGroupView[];
  nextCursor: string | null;
};

/**
 * `catalog.ProductGroupView` in the gateway's OpenAPI document.
 */
export type CatalogProductGroupView = {
  id: string;
  name: CatalogLocalizedText;
  slug: string;
  referenceUnit: EnumsUnitOfMeasure;
  synonyms: CatalogLocalizedSynonyms;
};

/**
 * `catalog.RegisterBrandSuggestionResult` in the gateway's OpenAPI document.
 */
export type CatalogRegisterBrandSuggestionResult = {
  brand: CatalogBrandView;
  linked: CatalogBrandView | null;
  canonicalCreated: boolean;
  linkedItems: number;
};

/**
 * `catalog.RegisterBrandsOutcome` in the gateway's OpenAPI document.
 */
export type CatalogRegisterBrandsOutcome = {
  label: string;
  outcome: EnumsBrandBatchOutcome;
  brandId: string | null;
  linkedItems: number | null;
  reason: {
    code: string;
    detail: string;
  } | null;
};

/**
 * `catalog.ResolvedScopeView` in the gateway's OpenAPI document.
 */
export type CatalogResolvedScopeView = {
  priceScopeId: string;
  supermarketId: string;
  postalCode: string | null;
  origin: 'POSTAL_CODE' | 'NATIONAL' | 'CHAIN_DEFAULT';
  approximate: boolean;
  supermarketLocationId: string | null;
  priority: number;
  quoted: boolean;
  priced?: boolean;
};

/**
 * `catalog.SetSupermarketItemAvailabilityResult` in the gateway's OpenAPI document.
 */
export type CatalogSetSupermarketItemAvailabilityResult = {
  updated: number;
};

/**
 * `catalog.SetSupermarketLocationItemAvailabilityResult` in the gateway's OpenAPI document.
 */
export type CatalogSetSupermarketLocationItemAvailabilityResult = {
  written: number;
  skipped: number;
  conflicts: CatalogSupermarketLocationItemAvailabilityConflict[];
};

/**
 * `catalog.ShopChainSummariesView` in the gateway's OpenAPI document.
 */
export type CatalogShopChainSummariesView = {
  chains: CatalogShopChainSummaryView[];
};

/**
 * `catalog.ShopChainSummaryView` in the gateway's OpenAPI document.
 */
export type CatalogShopChainSummaryView = {
  supermarketId: string;
  name: CatalogLocalizedText;
  logoUrl: string | null;
  externalBrandKey: string | null;
  locations: number;
  excluded: number;
  excludedChain: boolean;
};

/**
 * `catalog.ShopPage` in the gateway's OpenAPI document.
 *
 * A cursor paginated page. `nextCursor` is null on the last page; otherwise pass it back as the `cursor` query parameter to fetch the next one.
 */
export type CatalogShopPage = {
  items: CatalogShopView[];
  nextCursor: string | null;
};

/**
 * `catalog.ShopView` in the gateway's OpenAPI document.
 */
export type CatalogShopView = {
  location: CatalogSupermarketLocationView;
  supermarket: CatalogSupermarketView;
  excluded: boolean;
  excludedChain: boolean;
};

/**
 * `catalog.SupermarketItemPage` in the gateway's OpenAPI document.
 *
 * A cursor paginated page. `nextCursor` is null on the last page; otherwise pass it back as the `cursor` query parameter to fetch the next one.
 */
export type CatalogSupermarketItemPage = {
  items: CatalogSupermarketItemView[];
  nextCursor: string | null;
};

/**
 * `catalog.SupermarketItemView` in the gateway's OpenAPI document.
 */
export type CatalogSupermarketItemView = {
  id: string;
  itemId: string;
  priceScopeId: string;
  price: number | null;
  currency: string | null;
  unitPrice: number | null;
  unitPriceLabel: string | null;
  unitBasis?: 'KILOGRAM' | 'LITER' | 'UNIT' | 'DOZEN' | 'WASH' | null;
  observedAt: string | null;
  sourceKind: EnumsPriceSourceKind | null;
  priceCopiedFromScopeId?: string | null;
  stale: boolean;
  validUntil: string | null;
  itemPriceId: string | null;
  available: boolean;
};

/**
 * `catalog.SupermarketLocationItemAvailabilityConflict` in the gateway's OpenAPI document.
 */
export type CatalogSupermarketLocationItemAvailabilityConflict = {
  itemId: string;
  held: boolean | null;
  offered: boolean;
};

/**
 * `catalog.SupermarketLocationItemPage` in the gateway's OpenAPI document.
 *
 * A cursor paginated page. `nextCursor` is null on the last page; otherwise pass it back as the `cursor` query parameter to fetch the next one.
 */
export type CatalogSupermarketLocationItemPage = {
  items: CatalogSupermarketLocationItemView[];
  nextCursor: string | null;
};

/**
 * `catalog.SupermarketLocationItemView` in the gateway's OpenAPI document.
 */
export type CatalogSupermarketLocationItemView = {
  id: string;
  itemId: string;
  supermarketLocationId: string;
  positionInStore: string | null;
  available: boolean | null;
  availabilitySourceKind: EnumsPriceSourceKind | null;
  availabilityObservedAt: string | null;
  availabilitySourceRunId: string | null;
};

/**
 * `catalog.SupermarketLocationPage` in the gateway's OpenAPI document.
 *
 * A cursor paginated page. `nextCursor` is null on the last page; otherwise pass it back as the `cursor` query parameter to fetch the next one.
 */
export type CatalogSupermarketLocationPage = {
  items: CatalogSupermarketLocationView[];
  nextCursor: string | null;
};

/**
 * `catalog.SupermarketLocationView` in the gateway's OpenAPI document.
 */
export type CatalogSupermarketLocationView = {
  id: string;
  supermarketId: string;
  priceScopeId: string;
  priceScopeIds: string[];
  label: CatalogLocalizedText | null;
  address: string | null;
  city: string | null;
  country: string | null;
  postalCode: string | null;
  postalCodeSource: EnumsPostalCodeSource | null;
  latitude: number | null;
  longitude: number | null;
  externalRef: string | null;
  externalProvider: string | null;
};

/**
 * `catalog.SupermarketPage` in the gateway's OpenAPI document.
 *
 * A cursor paginated page. `nextCursor` is null on the last page; otherwise pass it back as the `cursor` query parameter to fetch the next one.
 */
export type CatalogSupermarketPage = {
  items: CatalogSupermarketView[];
  nextCursor: string | null;
};

/**
 * `catalog.SupermarketView` in the gateway's OpenAPI document.
 */
export type CatalogSupermarketView = {
  id: string;
  name: CatalogLocalizedText;
  logoUrl: string | null;
  websiteUrl: string | null;
  externalBrandKey: string | null;
  defaultPriceScopeId: string | null;
};

/**
 * `catalog.UpdateBrandResult` in the gateway's OpenAPI document.
 */
export type CatalogUpdateBrandResult = {
  id: string;
  key: string;
  label: string;
  privateLabelSupermarketId: string | null;
  itemCount: number;
  canonicalBrandId: string | null;
  canonicalLabel: string | null;
  linkCount: number;
  createdAt: string;
  updatedAt: string;
  movedItems: number;
};

/**
 * `common.IdResult` in the gateway's OpenAPI document.
 */
export type CommonIdResult = {
  id: string;
};

/**
 * `common.ListIdResult` in the gateway's OpenAPI document.
 */
export type CommonListIdResult = {
  listId: string;
};

/**
 * `common.UserIdResult` in the gateway's OpenAPI document.
 */
export type CommonUserIdResult = {
  userId: string;
};

/**
 * `core.UserAppStateView` in the gateway's OpenAPI document.
 */
export type CoreUserAppStateView = {
  setupCompletedAt: string | null;
  tourSeenAt: string | null;
};

/**
 * `enums.AdapterKey` in the gateway's OpenAPI document.
 */
export type EnumsAdapterKey =
  | 'mercadona-api'
  | 'deza-web'
  | 'carrefour-web'
  | 'lidl-api'
  | 'osm-places'
  | 'manual';

/**
 * `enums.AuthProvider` in the gateway's OpenAPI document.
 */
export type EnumsAuthProvider = 'GOOGLE' | 'EMAIL';

/**
 * `enums.BasketKind` in the gateway's OpenAPI document.
 */
export type EnumsBasketKind = 'LIVE' | 'GENERATED';

/**
 * `enums.BasketRowMark` in the gateway's OpenAPI document.
 */
export type EnumsBasketRowMark = 'ADDED' | 'CHANGED' | 'REMOVED';

/**
 * `enums.BasketRowNote` in the gateway's OpenAPI document.
 */
export type EnumsBasketRowNote = 'SKIPPED_EARLIER';

/**
 * `enums.BasketRowState` in the gateway's OpenAPI document.
 */
export type EnumsBasketRowState =
  | 'WANTED'
  | 'PARTLY'
  | 'DONE'
  | 'NOT_AVAILABLE'
  | 'SKIPPED'
  | 'REMOVED';

/**
 * `enums.BasketStatus` in the gateway's OpenAPI document.
 */
export type EnumsBasketStatus = 'OPEN' | 'FINISHED' | 'ARCHIVED';

/**
 * `enums.BrandBatchOutcome` in the gateway's OpenAPI document.
 */
export type EnumsBrandBatchOutcome = 'CREATED' | 'EXISTS' | 'REFUSED';

/**
 * `enums.BulkOperationErrorCode` in the gateway's OpenAPI document.
 */
export type EnumsBulkOperationErrorCode =
  | 'NOT_FOUND'
  | 'NOT_PENDING'
  | 'EXPECT_MISMATCH'
  | 'DUPLICATE_SUBJECT'
  | 'UNKNOWN_REFERENCE'
  | 'MALFORMED_OPERATION'
  | 'ALREADY_TAKEN';

/**
 * `enums.CommentTranscription` in the gateway's OpenAPI document.
 */
export type EnumsCommentTranscription =
  | 'PENDING'
  | 'READY'
  | 'FAILED'
  | 'UNAVAILABLE';

/**
 * `enums.DiscoveredPlaceStatus` in the gateway's OpenAPI document.
 */
export type EnumsDiscoveredPlaceStatus = 'NEW' | 'IMPORTED' | 'REJECTED';

/**
 * `enums.GenerationScope` in the gateway's OpenAPI document.
 */
export type EnumsGenerationScope = 'ALL' | 'SELECTED';

/**
 * `enums.HarvestDetailFetch` in the gateway's OpenAPI document.
 */
export type EnumsHarvestDetailFetch = 'NEW' | 'ALL';

/**
 * `enums.HarvestRunMode` in the gateway's OpenAPI document.
 */
export type EnumsHarvestRunMode =
  | 'STORE_DISCOVERY'
  | 'CATALOG_DISCOVERY'
  | 'FILE_IMPORT';

/**
 * `enums.HarvestRunStatus` in the gateway's OpenAPI document.
 */
export type EnumsHarvestRunStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'ABORTED'
  | 'STALE';

/**
 * `enums.HarvestRunTrigger` in the gateway's OpenAPI document.
 */
export type EnumsHarvestRunTrigger = 'MANUAL' | 'SCHEDULED' | 'SYSTEM';

/**
 * `enums.HarvestRunWrites` in the gateway's OpenAPI document.
 */
export type EnumsHarvestRunWrites =
  | 'PRICES_AND_AVAILABILITY'
  | 'PRICES'
  | 'AVAILABILITY';

/**
 * `enums.HarvestWarningCode` in the gateway's OpenAPI document.
 */
export type EnumsHarvestWarningCode =
  | 'DUPLICATE_KEY'
  | 'REJECTED_ALIAS'
  | 'CANDIDATE_MATCH'
  | 'NO_MATCH'
  | 'ALREADY_QUEUED'
  | 'EXTRACTOR'
  | 'UNKNOWN_PRICE_SCOPE'
  | 'NO_PRICE_SCOPE'
  | 'COPY_TARGET_GONE'
  | 'COPY_SOURCE_NOT_WRITTEN'
  | 'SCOPE_KIND_MISMATCH'
  | 'DETAIL_SKIPPED_UNKNOWN';

/**
 * `enums.ItemCategory` in the gateway's OpenAPI document.
 */
export type EnumsItemCategory =
  | 'PRODUCE'
  | 'DAIRY'
  | 'BAKERY'
  | 'MEAT'
  | 'SEAFOOD'
  | 'FROZEN'
  | 'BEVERAGES'
  | 'SNACKS'
  | 'PANTRY'
  | 'HOUSEHOLD'
  | 'PERSONAL_CARE'
  | 'OTHER';

/**
 * `enums.ItemPriceWrittenBy` in the gateway's OpenAPI document.
 */
export type EnumsItemPriceWrittenBy = 'INSERTED' | 'CONFIRMED';

/**
 * `enums.ItemSourceMatch` in the gateway's OpenAPI document.
 */
export type EnumsItemSourceMatch =
  | 'EAN'
  | 'NAME_BRAND_SIZE'
  | 'NAME_SIZE'
  | 'MANUAL'
  | 'SHARED_EAN';

/**
 * `enums.LineApprovalStatus` in the gateway's OpenAPI document.
 */
export type EnumsLineApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

/**
 * `enums.LineChangeKind` in the gateway's OpenAPI document.
 */
export type EnumsLineChangeKind =
  | 'ADDED'
  | 'QUANTITY_CHANGED'
  | 'RENAMED'
  | 'MERGED'
  | 'DELETED'
  | 'APPROVAL_CHANGED';

/**
 * `enums.LineSuggestionReason` in the gateway's OpenAPI document.
 */
export type EnumsLineSuggestionReason = 'PERIOD' | 'STAPLE';

/**
 * `enums.ListPermission` in the gateway's OpenAPI document.
 */
export type EnumsListPermission = 'READ' | 'WRITE' | 'DECIDE' | 'MANAGE';

/**
 * `enums.ListResolutionBranch` in the gateway's OpenAPI document.
 */
export type EnumsListResolutionBranch =
  | 'NAMED'
  | 'CONVERSATION'
  | 'ONLY_LIST'
  | 'ASKED';

/**
 * `enums.MembershipStatus` in the gateway's OpenAPI document.
 */
export type EnumsMembershipStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'KICKED'
  | 'BANNED';

/**
 * `enums.MergeRequestStatus` in the gateway's OpenAPI document.
 */
export type EnumsMergeRequestStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED';

/**
 * `enums.ParticipantKind` in the gateway's OpenAPI document.
 */
export type EnumsParticipantKind = 'OWNER' | 'REGISTERED' | 'GUEST';

/**
 * `enums.PostalCodeDiscoveryStatus` in the gateway's OpenAPI document.
 */
export type EnumsPostalCodeDiscoveryStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'DONE'
  | 'FAILED'
  | 'PARKED';

/**
 * `enums.PostalCodeSource` in the gateway's OpenAPI document.
 */
export type EnumsPostalCodeSource = 'SOURCE' | 'DERIVED' | 'MANUAL';

/**
 * `enums.PriceScopeKind` in the gateway's OpenAPI document.
 */
export type EnumsPriceScopeKind =
  | 'NATIONAL'
  | 'REGION'
  | 'LOCAL_AREA'
  | 'STORE';

/**
 * `enums.PriceShownBecause` in the gateway's OpenAPI document.
 */
export type EnumsPriceShownBecause =
  | 'PROTECTED_ADMIN'
  | 'POLICY_PRIORITY'
  | 'ONLY_ROW'
  | 'NEWEST';

/**
 * `enums.PriceSourceKind` in the gateway's OpenAPI document.
 */
export type EnumsPriceSourceKind =
  | 'OFFICIAL_API'
  | 'OFFICIAL_WEB'
  | 'OFFICIAL_LEAFLET'
  | 'ADMIN'
  | 'USER_RECEIPT'
  | 'USER_REPORTED';

/**
 * `enums.ProfilePostalCodeSource` in the gateway's OpenAPI document.
 */
export type EnumsProfilePostalCodeSource = 'TYPED' | 'DEVICE' | 'NEARBY';

/**
 * `enums.SettlementOutcome` in the gateway's OpenAPI document.
 */
export type EnumsSettlementOutcome = 'BOUGHT' | 'NOT_AVAILABLE';

/**
 * `enums.SourceEntryStatus` in the gateway's OpenAPI document.
 */
export type EnumsSourceEntryStatus =
  | 'ACTIVE'
  | 'CANDIDATE'
  | 'UNRESOLVED'
  | 'REJECTED';

/**
 * `enums.SourceLocationStatus` in the gateway's OpenAPI document.
 */
export type EnumsSourceLocationStatus = 'ACTIVE' | 'UNMAPPED' | 'IGNORED';

/**
 * `enums.TripKind` in the gateway's OpenAPI document.
 */
export type EnumsTripKind = 'BASKET' | 'SESSION';

/**
 * `enums.TripRowOutcome` in the gateway's OpenAPI document.
 */
export type EnumsTripRowOutcome =
  | 'BOUGHT'
  | 'PARTLY'
  | 'NOT_AVAILABLE'
  | 'NOT_BOUGHT';

/**
 * `enums.UnitOfMeasure` in the gateway's OpenAPI document.
 */
export type EnumsUnitOfMeasure =
  | 'UNIT'
  | 'GRAM'
  | 'KILOGRAM'
  | 'MILLILITER'
  | 'LITER'
  | 'PACK';

/**
 * `enums.UserKind` in the gateway's OpenAPI document.
 */
export type EnumsUserKind = 'TEMPORARY' | 'REGISTERED';

/**
 * `enums.ZoneRole` in the gateway's OpenAPI document.
 */
export type EnumsZoneRole = 'OWNER' | 'ADMIN' | 'MEMBER';

/**
 * `enums.ZoneStatus` in the gateway's OpenAPI document.
 */
export type EnumsZoneStatus = 'ACTIVE' | 'MARKED_FOR_DELETION';

/**
 * `gateway.AccountMeView` in the gateway's OpenAPI document.
 */
export type GatewayAccountMeView = {
  userId: string;
  kind: EnumsUserKind;
  username: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  appState: CoreUserAppStateView;
};

/**
 * `harvest.AdapterCapabilityTable` in the gateway's OpenAPI document.
 *
 * What each adapter is able to tell us. `writesPrices` means the source states a price, so a run of it needs somewhere to write prices. `scopesItsOwn` means the source names the scope of every price, so it needs no default. `listsItsOwnStores` means a store discovery takes no postal code and no radius. `hasProductPages` means an EAN backfill has something to read. `skipsKnownDetails` means a walk has a detail phase that a known product can skip, so a run takes `details`. `printedLocale` is the language the source writes its own text in, and null when nothing is known, so accepting a queued row files a printed name under the language it was printed in rather than under a constant. `walkablePriorities` is the band of scope priorities the walk of this adapter may write, and null for an adapter whose walk is given no scopes: a Mercadona crawl of one warehouse writes LOCAL_AREA rows and may claim neither the NATIONAL summary of the chain nor a STORE row somebody typed. A reader that does not know an adapter must answer no to every boolean, null to the language and null to the band rather than throw.
 */
export const HarvestAdapterCapabilityTable = {
  'mercadona-api': {
    writesPrices: true,
    scopesItsOwn: true,
    listsItsOwnStores: true,
    hasProductPages: false,
    skipsKnownDetails: true,
    printedLocale: 'es',
    walkablePriorities: {
      min: 200,
      max: 200,
    },
  },
  'deza-web': {
    writesPrices: false,
    scopesItsOwn: false,
    listsItsOwnStores: false,
    hasProductPages: false,
    skipsKnownDetails: false,
    printedLocale: 'es',
    walkablePriorities: null,
  },
  'carrefour-web': {
    writesPrices: true,
    scopesItsOwn: false,
    listsItsOwnStores: false,
    hasProductPages: true,
    skipsKnownDetails: false,
    printedLocale: 'es',
    walkablePriorities: null,
  },
  'lidl-api': {
    writesPrices: true,
    scopesItsOwn: true,
    listsItsOwnStores: true,
    hasProductPages: true,
    skipsKnownDetails: false,
    printedLocale: 'es',
    walkablePriorities: null,
  },
  'osm-places': {
    writesPrices: false,
    scopesItsOwn: false,
    listsItsOwnStores: false,
    hasProductPages: false,
    skipsKnownDetails: false,
    printedLocale: null,
    walkablePriorities: null,
  },
  manual: {
    writesPrices: false,
    scopesItsOwn: false,
    listsItsOwnStores: false,
    hasProductPages: false,
    skipsKnownDetails: false,
    printedLocale: null,
    walkablePriorities: null,
  },
} as const;

/**
 * `harvest.AdapterCapabilityTable` in the gateway's OpenAPI document.
 *
 * What each adapter is able to tell us. `writesPrices` means the source states a price, so a run of it needs somewhere to write prices. `scopesItsOwn` means the source names the scope of every price, so it needs no default. `listsItsOwnStores` means a store discovery takes no postal code and no radius. `hasProductPages` means an EAN backfill has something to read. `skipsKnownDetails` means a walk has a detail phase that a known product can skip, so a run takes `details`. `printedLocale` is the language the source writes its own text in, and null when nothing is known, so accepting a queued row files a printed name under the language it was printed in rather than under a constant. `walkablePriorities` is the band of scope priorities the walk of this adapter may write, and null for an adapter whose walk is given no scopes: a Mercadona crawl of one warehouse writes LOCAL_AREA rows and may claim neither the NATIONAL summary of the chain nor a STORE row somebody typed. A reader that does not know an adapter must answer no to every boolean, null to the language and null to the band rather than throw.
 */
export type HarvestAdapterCapabilityTable =
  typeof HarvestAdapterCapabilityTable;

/**
 * `harvest.BrandSpellingView` in the gateway's OpenAPI document.
 */
export type HarvestBrandSpellingView = {
  supermarketId: string;
  spelling: string;
  productCount: number;
  queuedCount: number;
};

/**
 * `harvest.BrandSpellingsResult` in the gateway's OpenAPI document.
 */
export type HarvestBrandSpellingsResult = {
  spellings: HarvestBrandSpellingView[];
};

/**
 * `harvest.BrandSuggestionChain` in the gateway's OpenAPI document.
 */
export type HarvestBrandSuggestionChain = {
  supermarketId: string;
  productCount: number;
};

/**
 * `harvest.BrandSuggestionPage` in the gateway's OpenAPI document.
 *
 * A cursor paginated page. `nextCursor` is null on the last page; otherwise pass it back as the `cursor` query parameter to fetch the next one.
 */
export type HarvestBrandSuggestionPage = {
  items: HarvestBrandSuggestionView[];
  nextCursor: string | null;
};

/**
 * `harvest.BrandSuggestionView` in the gateway's OpenAPI document.
 */
export type HarvestBrandSuggestionView = {
  key: string;
  spelling: string;
  productCount: number;
  firstSeenAt: string;
  chains: HarvestBrandSuggestionChain[];
};

/**
 * `harvest.DiscoveredPlaceCounts` in the gateway's OpenAPI document.
 */
export type HarvestDiscoveredPlaceCounts = {
  total: number;
  imported: number;
  rejected: number;
  undecided: number;
};

/**
 * `harvest.DiscoveredPlaceGroup` in the gateway's OpenAPI document.
 */
export type HarvestDiscoveredPlaceGroup = {
  brandKey: string | null;
  brandName: string | null;
  count: number;
  known: boolean;
  supermarketId: string | null;
  sample: HarvestDiscoveredPlaceView[];
};

/**
 * `harvest.DiscoveredPlaceGroupsResult` in the gateway's OpenAPI document.
 */
export type HarvestDiscoveredPlaceGroupsResult = {
  groups: HarvestDiscoveredPlaceGroup[];
};

/**
 * `harvest.DiscoveredPlacePage` in the gateway's OpenAPI document.
 *
 * A cursor paginated page. `nextCursor` is null on the last page; otherwise pass it back as the `cursor` query parameter to fetch the next one.
 */
export type HarvestDiscoveredPlacePage = {
  items: HarvestDiscoveredPlaceView[];
  nextCursor: string | null;
};

/**
 * `harvest.DiscoveredPlaceView` in the gateway's OpenAPI document.
 */
export type HarvestDiscoveredPlaceView = {
  id: string;
  runId: string | null;
  provider: string;
  externalRef: string;
  brandKey: string | null;
  brandName: string | null;
  name: string | null;
  latitude: number;
  longitude: number;
  street: string | null;
  city: string | null;
  postalCode: string | null;
  postalCodeSource: EnumsPostalCodeSource | null;
  country: string | null;
  website: string | null;
  openingHours: string | null;
  tags: {
    [key: string]: string;
  };
  scopeKey: string | null;
  status: EnumsDiscoveredPlaceStatus;
  supermarketLocationId: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
};

/**
 * `harvest.HarvestDocument` in the gateway's OpenAPI document.
 *
 * A HarvestDocument (plan 0086, section 6.1), validated against its own versioned JSON schema rather than against this description.
 */
export type HarvestHarvestDocument = {
  [key: string]: unknown;
};

/**
 * `harvest.HarvestRunPage` in the gateway's OpenAPI document.
 *
 * A cursor paginated page. `nextCursor` is null on the last page; otherwise pass it back as the `cursor` query parameter to fetch the next one.
 */
export type HarvestHarvestRunPage = {
  items: HarvestHarvestRunView[];
  nextCursor: string | null;
};

/**
 * `harvest.HarvestRunPresetInput` in the gateway's OpenAPI document.
 */
export type HarvestHarvestRunPresetInput = {
  mode: EnumsHarvestRunMode;
  priceScopeId?: string;
  priceScopeIds?: string[];
  postalCode?: string;
  country?: string;
  radiusMetres?: number;
  brandKeys?: string[];
  postalCodes?: string[];
  detailBackfill?: boolean;
  scopeCopies?: {
    from: string;
    to: string[];
  }[];
  writes?: EnumsHarvestRunWrites;
  details?: EnumsHarvestDetailFetch;
};

/**
 * `harvest.HarvestRunPresetLastRun` in the gateway's OpenAPI document.
 */
export type HarvestHarvestRunPresetLastRun = {
  id: string;
  status: EnumsHarvestRunStatus;
  requestedAt: string;
};

/**
 * `harvest.HarvestRunPresetPage` in the gateway's OpenAPI document.
 *
 * A cursor paginated page. `nextCursor` is null on the last page; otherwise pass it back as the `cursor` query parameter to fetch the next one.
 */
export type HarvestHarvestRunPresetPage = {
  items: HarvestHarvestRunPresetView[];
  nextCursor: string | null;
};

/**
 * `harvest.HarvestRunPresetView` in the gateway's OpenAPI document.
 */
export type HarvestHarvestRunPresetView = {
  id: string;
  supermarketId: string;
  name: string;
  input: HarvestHarvestRunPresetInput;
  createdAt: string;
  updatedAt: string;
  lastRun: HarvestHarvestRunPresetLastRun | null;
};

/**
 * `harvest.HarvestRunView` in the gateway's OpenAPI document.
 */
export type HarvestHarvestRunView = {
  id: string;
  supermarketId: string | null;
  sourceId: string | null;
  mode: EnumsHarvestRunMode;
  trigger: EnumsHarvestRunTrigger;
  status: EnumsHarvestRunStatus;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  heartbeatAt: string | null;
  totalPlanned: number | null;
  processed: number;
  created: number;
  updated: number;
  unchanged: number;
  notFound: number;
  skipped: number;
  failed: number;
  stage: string | null;
  stageLabel: string | null;
  warnings: HarvestHarvestRunWarning[];
  documentSha256: string | null;
  abortRequestedAt: string | null;
  error: string | null;
  report: {
    [key: string]: unknown;
  };
  correlationId: string | null;
  requestedByUserId: string | null;
  revertedAt: string | null;
  revertedByUserId: string | null;
  revertedPriceCount: number | null;
  presetId?: string | null;
};

/**
 * `harvest.HarvestRunWarning` in the gateway's OpenAPI document.
 */
export type HarvestHarvestRunWarning = {
  code: EnumsHarvestWarningCode;
  offerId: string | null;
  page: number | null;
  name: string | null;
  message: string;
};

/**
 * `harvest.ItemSourceEntryPage` in the gateway's OpenAPI document.
 *
 * A cursor paginated page. `nextCursor` is null on the last page; otherwise pass it back as the `cursor` query parameter to fetch the next one.
 */
export type HarvestItemSourceEntryPage = {
  items: HarvestItemSourceEntryView[];
  nextCursor: string | null;
};

/**
 * `harvest.ItemSourceEntryView` in the gateway's OpenAPI document.
 */
export type HarvestItemSourceEntryView = {
  id: string;
  supermarketId: string;
  externalId: string;
  sourceKind: EnumsPriceSourceKind;
  name: string;
  brand: string | null;
  ean: string | null;
  unitSize: number | null;
  sizeFormat: string | null;
  categoryPath: string[];
  url: string | null;
  extra: {
    [key: string]: unknown;
  } | null;
  timesSeen: number;
  firstSeenAt: string;
  lastSeenAt: string;
  firstRunId: string | null;
  lastRunId: string | null;
  itemId: string | null;
  candidateEntryId: string | null;
  status: EnumsSourceEntryStatus;
  matchedBy: EnumsItemSourceMatch | null;
  confidence: number;
  decidedAt: string | null;
  prices: HarvestSourceEntryPriceView[];
  eanSharedBy: number | null;
};

/**
 * `harvest.PostalCodeDiscoveryRequestPage` in the gateway's OpenAPI document.
 *
 * A cursor paginated page. `nextCursor` is null on the last page; otherwise pass it back as the `cursor` query parameter to fetch the next one.
 */
export type HarvestPostalCodeDiscoveryRequestPage = {
  items: HarvestPostalCodeDiscoveryRequestView[];
  nextCursor: string | null;
};

/**
 * `harvest.PostalCodeDiscoveryRequestView` in the gateway's OpenAPI document.
 */
export type HarvestPostalCodeDiscoveryRequestView = {
  id: string;
  country: string;
  postalCode: string;
  status: EnumsPostalCodeDiscoveryStatus;
  requestedAt: string;
  lastAttemptedAt: string | null;
  discoveredAt: string | null;
  nextAttemptAt: string | null;
  attempts: number;
  runId: string | null;
  error: string | null;
  placeName: string | null;
  dismissed: boolean;
  foundByItsRuns: HarvestDiscoveredPlaceCounts;
  locatedInIt: HarvestDiscoveredPlaceCounts;
};

/**
 * `harvest.PostalCodeDiscoverySummaryView` in the gateway's OpenAPI document.
 */
export type HarvestPostalCodeDiscoverySummaryView = {
  queued: number;
  running: number;
  done: number;
  failed: number;
  parked: number;
  oldestQueuedAt: string | null;
  draining: boolean;
};

/**
 * `harvest.SourceCatalogEntryPage` in the gateway's OpenAPI document.
 *
 * A cursor paginated page. `nextCursor` is null on the last page; otherwise pass it back as the `cursor` query parameter to fetch the next one.
 */
export type HarvestSourceCatalogEntryPage = {
  items: HarvestSourceCatalogEntryView[];
  nextCursor: string | null;
};

/**
 * `harvest.SourceCatalogEntryView` in the gateway's OpenAPI document.
 */
export type HarvestSourceCatalogEntryView = {
  id: string;
  supermarketId: string;
  externalId: string;
  sourceKind: EnumsPriceSourceKind;
  name: string;
  brand: string | null;
  ean: string | null;
  unitSize: number | null;
  sizeFormat: string | null;
  categoryPath: string[];
  url: string | null;
  extra: {
    [key: string]: unknown;
  } | null;
  timesSeen: number;
  firstSeenAt: string;
  lastSeenAt: string;
  firstRunId: string | null;
  lastRunId: string | null;
  itemId: string | null;
  candidateEntryId: string | null;
  status: EnumsSourceEntryStatus;
  matchedBy: EnumsItemSourceMatch | null;
  confidence: number;
  decidedAt: string | null;
  prices: HarvestSourceEntryPriceView[];
};

/**
 * `harvest.SourceEntryAcceptResult` in the gateway's OpenAPI document.
 */
export type HarvestSourceEntryAcceptResult = {
  entry: HarvestSourceCatalogEntryView;
  pricesWritten: number;
  createdItem: CatalogItemView | null;
};

/**
 * `harvest.SourceEntryDecisionOutcome` in the gateway's OpenAPI document.
 */
export type HarvestSourceEntryDecisionOutcome = {
  op: 'accept' | 'createItem';
  entryId: string;
  ref: string | null;
  applied: boolean;
  itemId: string | null;
  pricesWritten: number;
  error: CatalogBulkOperationError | null;
};

/**
 * `harvest.SourceEntryPriceSkip` in the gateway's OpenAPI document.
 */
export type HarvestSourceEntryPriceSkip = {
  entryId: string;
  itemId: string;
  reason: string;
};

/**
 * `harvest.SourceEntryPriceView` in the gateway's OpenAPI document.
 */
export type HarvestSourceEntryPriceView = {
  id: string;
  priceScopeId: string;
  price: number | null;
  currency: string;
  unitPrice: number | null;
  unitPriceLabel: string | null;
  validFrom: string | null;
  validUntil: string | null;
  details: {
    [key: string]: unknown;
  } | null;
  observedAt: string;
  runId: string | null;
};

/**
 * `harvest.SourceLocationCandidate` in the gateway's OpenAPI document.
 */
export type HarvestSourceLocationCandidate = {
  supermarketLocationId: string;
  label: CatalogLocalizedText | null;
  address: string | null;
  postalCode: string | null;
  score: number;
  strong: boolean;
};

/**
 * `harvest.SourceLocationPage` in the gateway's OpenAPI document.
 *
 * A cursor paginated page. `nextCursor` is null on the last page; otherwise pass it back as the `cursor` query parameter to fetch the next one.
 */
export type HarvestSourceLocationPage = {
  items: HarvestSourceLocationView[];
  nextCursor: string | null;
};

/**
 * `harvest.SourceLocationView` in the gateway's OpenAPI document.
 */
export type HarvestSourceLocationView = {
  id: string;
  supermarketId: string;
  externalId: string;
  printedName: string;
  supermarketLocationId: string | null;
  status: EnumsSourceLocationStatus;
  matchedBy: EnumsItemSourceMatch;
  firstSeenAt: string;
  lastSeenAt: string;
  firstRunId: string | null;
  lastRunId: string | null;
  candidates: HarvestSourceLocationCandidate[];
};

/**
 * `harvest.SupermarketSourcePage` in the gateway's OpenAPI document.
 *
 * A cursor paginated page. `nextCursor` is null on the last page; otherwise pass it back as the `cursor` query parameter to fetch the next one.
 */
export type HarvestSupermarketSourcePage = {
  items: HarvestSupermarketSourceView[];
  nextCursor: string | null;
};

/**
 * `harvest.SupermarketSourceView` in the gateway's OpenAPI document.
 */
export type HarvestSupermarketSourceView = {
  id: string;
  supermarketId: string;
  adapterKey: EnumsAdapterKey;
  enabled: boolean;
  autoImportPlaces: boolean;
  config: {
    [key: string]: unknown;
  };
  workers: number;
  maxRequestsPerSecond: number;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  consecutiveFailures: number;
};

/**
 * `list.AddLineResult` in the gateway's OpenAPI document.
 */
export type ListAddLineResult = {
  line: ListLineView;
  merged: boolean;
};

/**
 * `list.AddLineResultList` in the gateway's OpenAPI document.
 */
export type ListAddLineResultList = ListAddLineResult[];

/**
 * `list.CommentPage` in the gateway's OpenAPI document.
 *
 * A cursor paginated page. `nextCursor` is null on the last page; otherwise pass it back as the `cursor` query parameter to fetch the next one.
 */
export type ListCommentPage = {
  items: ListCommentView[];
  nextCursor: string | null;
};

/**
 * `list.CommentRecording` in the gateway's OpenAPI document.
 */
export type ListCommentRecording = {
  contentType: string;
  byteLength: number;
  durationSeconds: number | null;
};

/**
 * `list.CommentView` in the gateway's OpenAPI document.
 */
export type ListCommentView = {
  id: string;
  lineId: string;
  authorUserId: string;
  body: string;
  recording: ListCommentRecording | null;
  transcription: EnumsCommentTranscription | null;
  createdAt: string;
};

/**
 * `list.LinePage` in the gateway's OpenAPI document.
 *
 * A cursor paginated page. `nextCursor` is null on the last page; otherwise pass it back as the `cursor` query parameter to fetch the next one.
 */
export type ListLinePage = {
  items: ListLineView[];
  nextCursor: string | null;
};

/**
 * `list.LineSettlementPage` in the gateway's OpenAPI document.
 *
 * A cursor paginated page. `nextCursor` is null on the last page; otherwise pass it back as the `cursor` query parameter to fetch the next one.
 */
export type ListLineSettlementPage = {
  items: ListLineSettlementView[];
  nextCursor: string | null;
};

/**
 * `list.LineSettlementResult` in the gateway's OpenAPI document.
 */
export type ListLineSettlementResult = {
  line: ListLineView;
  settlement: ListLineSettlementView;
};

/**
 * `list.LineSettlementView` in the gateway's OpenAPI document.
 */
export type ListLineSettlementView = {
  id: string;
  lineId: string;
  listId: string;
  itemId: string | null;
  outcome: EnumsSettlementOutcome;
  quantity: number;
  settledByUserId: string;
  settledByParticipantId: string | null;
  settledAt: string;
  revertedAt: string | null;
  pricePaidCents: number | null;
  pricePaidCurrency: string | null;
  priceScopeId: string | null;
  supermarketLocationId: string | null;
};

/**
 * `list.LineSuggestionPage` in the gateway's OpenAPI document.
 */
export type ListLineSuggestionPage = {
  items: ListLineSuggestionView[];
};

/**
 * `list.LineSuggestionView` in the gateway's OpenAPI document.
 */
export type ListLineSuggestionView = {
  lineId: string;
  reason: EnumsLineSuggestionReason;
  periodDays: number | null;
  daysSinceBought: number;
  tripsWith: number | null;
  tripsSeen: number | null;
  quantity: number;
};

/**
 * `list.LineView` in the gateway's OpenAPI document.
 */
export type ListLineView = {
  id: string;
  listId: string;
  content: string;
  quantity: number;
  itemIds: string[];
  itemSetHash: string | null;
  productGroupId: string | null;
  groupItemIds: string[];
  position: number;
  approvalStatus: EnumsLineApprovalStatus;
  createdByUserId: string;
  approvedByUserId: string | null;
  version: number;
  boughtCount: number;
  lastSettlementOutcome: EnumsSettlementOutcome | null;
  claimed: boolean;
  claimedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * `list.ListAccessEntry` in the gateway's OpenAPI document.
 */
export type ListListAccessEntry = {
  membershipId: string;
  permissions: EnumsListPermission[];
};

/**
 * `list.ListAccessView` in the gateway's OpenAPI document.
 */
export type ListListAccessView = {
  listId: string;
  entries: ListListAccessEntry[];
};

/**
 * `list.ListCounts` in the gateway's OpenAPI document.
 */
export type ListListCounts = {
  lineCount: number;
  wantedCount: number;
};

/**
 * `list.ListHoldingItemView` in the gateway's OpenAPI document.
 */
export type ListListHoldingItemView = {
  listId: string;
  name: string;
  zoneId: string;
  zoneName: string;
  quantity: number;
};

/**
 * `list.ListPage` in the gateway's OpenAPI document.
 *
 * A cursor paginated page. `nextCursor` is null on the last page; otherwise pass it back as the `cursor` query parameter to fetch the next one.
 */
export type ListListPage = {
  items: ListListView[];
  nextCursor: string | null;
};

/**
 * `list.ListView` in the gateway's OpenAPI document.
 */
export type ListListView = {
  id: string;
  zoneId: string;
  name: string;
  createdByUserId: string;
  counts: ListListCounts;
  autoApproveLines: boolean;
  sharedWithZone: boolean;
  myPermissions: EnumsListPermission[];
  createdAt: string;
  updatedAt: string;
};

/**
 * `list.TripPage` in the gateway's OpenAPI document.
 */
export type ListTripPage = {
  live: ListTripView[];
  items: ListTripView[];
  nextCursor: string | null;
};

/**
 * `list.TripRowPage` in the gateway's OpenAPI document.
 *
 * A cursor paginated page. `nextCursor` is null on the last page; otherwise pass it back as the `cursor` query parameter to fetch the next one.
 */
export type ListTripRowPage = {
  items: ListTripRowView[];
  nextCursor: string | null;
};

/**
 * `list.TripRowView` in the gateway's OpenAPI document.
 */
export type ListTripRowView = {
  lineId: string;
  asked: number | null;
  bought: number;
  left: number | null;
  outcome: EnumsTripRowOutcome;
  settledByUserId: string | null;
};

/**
 * `list.TripView` in the gateway's OpenAPI document.
 */
export type ListTripView = {
  id: string;
  kind: EnumsTripKind;
  name: string | null;
  live: boolean;
  startedAt: string;
  lineCount: number;
  fullyBoughtLineCount: number;
  boughtLineCount: number;
};

/**
 * `list.UpdateLineResult` in the gateway's OpenAPI document.
 */
export type ListUpdateLineResult = {
  id: string;
  listId: string;
  content: string;
  quantity: number;
  itemIds: string[];
  itemSetHash: string | null;
  productGroupId: string | null;
  groupItemIds: string[];
  position: number;
  approvalStatus: EnumsLineApprovalStatus;
  createdByUserId: string;
  approvedByUserId: string | null;
  version: number;
  boughtCount: number;
  lastSettlementOutcome: EnumsSettlementOutcome | null;
  claimed: boolean;
  claimedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  absorbedLineId?: string;
};

/**
 * `merge.MergeRequestPage` in the gateway's OpenAPI document.
 *
 * A cursor paginated page. `nextCursor` is null on the last page; otherwise pass it back as the `cursor` query parameter to fetch the next one.
 */
export type MergeMergeRequestPage = {
  items: MergeMergeRequestView[];
  nextCursor: string | null;
};

/**
 * `merge.MergeRequestView` in the gateway's OpenAPI document.
 */
export type MergeMergeRequestView = {
  id: string;
  zoneId: string;
  sourceUserId: string;
  targetUserId: string;
  requestedByUserId: string;
  status: EnumsMergeRequestStatus;
  resolvedByUserId: string | null;
};

/**
 * `msg.assistant.turnResponse` in the gateway's OpenAPI document.
 */
export type MsgAssistantTurnResponse = {
  reply: string;
  link: AssistantAssistantListLink | null;
  choices: AssistantAssistantChoice[];
  listResolution?: EnumsListResolutionBranch;
  heard?: string;
};

/**
 * `msg.basket.participant.revoke.response` in the gateway's OpenAPI document.
 */
export type MsgBasketParticipantRevokeResponse = {
  id: string;
};

/**
 * `msg.basket.shareLink.revoke.response` in the gateway's OpenAPI document.
 */
export type MsgBasketShareLinkRevokeResponse = {
  revoked: number;
};

/**
 * `msg.brand.registerMany.response` in the gateway's OpenAPI document.
 */
export type MsgBrandRegisterManyResponse = {
  results: CatalogRegisterBrandsOutcome[];
};

/**
 * `msg.item.createMany.response` in the gateway's OpenAPI document.
 */
export type MsgItemCreateManyResponse = {
  items: CatalogItemView[];
};

/**
 * `msg.item.getMany.response` in the gateway's OpenAPI document.
 */
export type MsgItemGetManyResponse = {
  items: CatalogItemView[];
};

/**
 * `msg.list.holdingItem.response` in the gateway's OpenAPI document.
 */
export type MsgListHoldingItemResponse = {
  lists: ListListHoldingItemView[];
  hasMore: boolean;
};

/**
 * `msg.productGroup.applyAssignments.response` in the gateway's OpenAPI document.
 */
export type MsgProductGroupApplyAssignmentsResponse = {
  applied: boolean;
  error: string | null;
  results: CatalogProductGroupAssignmentOutcome[];
  createdGroups: {
    ref: string;
    groupId: string;
  }[];
};

/**
 * `msg.sourceEntry.applyDecisions.response` in the gateway's OpenAPI document.
 */
export type MsgSourceEntryApplyDecisionsResponse = {
  runId: string | null;
  applied: boolean;
  failedStep: 'VALIDATE' | 'CREATE_ITEMS' | 'BIND' | null;
  error: string | null;
  results: HarvestSourceEntryDecisionOutcome[];
  priceSkips: HarvestSourceEntryPriceSkip[];
  orphanedItemIds: string[];
};

/**
 * `profile.ProfileGenerationSourceView` in the gateway's OpenAPI document.
 */
export type ProfileProfileGenerationSourceView = {
  id: string;
  zoneId: string;
  listId: string | null;
};

/**
 * `profile.ProfileLocationPreferenceView` in the gateway's OpenAPI document.
 */
export type ProfileProfileLocationPreferenceView = {
  id: string;
  supermarketLocationId: string;
  excluded: boolean;
};

/**
 * `profile.ProfilePostalCodeView` in the gateway's OpenAPI document.
 */
export type ProfileProfilePostalCodeView = {
  id: string;
  postalCode: string;
  label: string | null;
  position: number;
  country: string;
  source: EnumsProfilePostalCodeSource;
  expandNearby: boolean;
};

/**
 * `profile.ProfileSupermarketPreferenceView` in the gateway's OpenAPI document.
 */
export type ProfileProfileSupermarketPreferenceView = {
  id: string;
  supermarketId: string;
  excluded: boolean;
};

/**
 * `profile.ResolvedPostalCodeView` in the gateway's OpenAPI document.
 */
export type ProfileResolvedPostalCodeView = {
  country: string;
  postalCode: string | null;
};

/**
 * `profile.ShoppingProfileListResult` in the gateway's OpenAPI document.
 */
export type ProfileShoppingProfileListResult = {
  profiles: ProfileShoppingProfileView[];
};

/**
 * `profile.ShoppingProfileView` in the gateway's OpenAPI document.
 */
export type ProfileShoppingProfileView = {
  id: string;
  name: string | null;
  isDefault: boolean;
  position: number;
  addressText: string | null;
  minSavingCents: number;
  minSavingPercent: number | null;
  generationScope: EnumsGenerationScope;
  postalCodes: ProfileProfilePostalCodeView[];
  supermarkets: ProfileProfileSupermarketPreferenceView[];
  locations: ProfileProfileLocationPreferenceView[];
  generationSources: ProfileProfileGenerationSourceView[];
};

/**
 * `purchase.MoneyView` in the gateway's OpenAPI document.
 */
export type PurchaseMoneyView = {
  cents: number;
  currency: string;
};

/**
 * `purchase.PurchaseEntryPage` in the gateway's OpenAPI document.
 */
export type PurchasePurchaseEntryPage = {
  items: PurchasePurchaseEntryView[];
  nextCursor: string | null;
};

/**
 * `purchase.PurchaseEntryView` in the gateway's OpenAPI document.
 */
export type PurchasePurchaseEntryView = {
  id: string;
  kind: EnumsTripKind;
  name: string | null;
  open: boolean;
  startedAt: string;
  endedAt: string;
  settledLineCount: number;
  anyBoughtLineCount: number;
  lineCount: number;
  boughtLineCount: number;
  spent: PurchaseMoneyView | null;
  unpricedCount: number;
};

/**
 * `purchase.PurchaseRowPage` in the gateway's OpenAPI document.
 *
 * A cursor paginated page. `nextCursor` is null on the last page; otherwise pass it back as the `cursor` query parameter to fetch the next one.
 */
export type PurchasePurchaseRowPage = {
  items: PurchasePurchaseRowView[];
  nextCursor: string | null;
};

/**
 * `purchase.PurchaseRowView` in the gateway's OpenAPI document.
 */
export type PurchasePurchaseRowView = {
  id: string;
  itemId: string | null;
  outcome: EnumsSettlementOutcome;
  quantity: number;
  pricePaid: PurchaseMoneyView | null;
  priceScopeId: string | null;
  supermarketLocationId: string | null;
  settledAt: string;
  lineId: string | null;
  listId: string | null;
  listName: string | null;
  zoneId: string | null;
  content: string | null;
};

/**
 * `stats.CoreStats` in the gateway's OpenAPI document.
 */
export type StatsCoreStats = {
  zones: number;
  activeZones: number;
};

/**
 * `stats.IdentityStats` in the gateway's OpenAPI document.
 */
export type StatsIdentityStats = {
  users: number;
  registeredUsers: number;
  temporaryUsers: number;
};

/**
 * `stats.PlatformStatsResponse` in the gateway's OpenAPI document.
 *
 * Platform totals. Either block is `null` when that service did not answer: a broken service degrades the figure rather than taking down the public page.
 */
export type StatsPlatformStatsResponse = {
  identity: StatsIdentityStats | null;
  core: StatsCoreStats | null;
  measuredAt: string;
};

/**
 * `zone.ContactPage` in the gateway's OpenAPI document.
 *
 * A cursor paginated page. `nextCursor` is null on the last page; otherwise pass it back as the `cursor` query parameter to fetch the next one.
 */
export type ZoneContactPage = {
  items: ZoneContactView[];
  nextCursor: string | null;
};

/**
 * `zone.ContactView` in the gateway's OpenAPI document.
 */
export type ZoneContactView = {
  userId: string;
  zoneId: string;
  username: string;
};

/**
 * `zone.MembershipPage` in the gateway's OpenAPI document.
 *
 * A cursor paginated page. `nextCursor` is null on the last page; otherwise pass it back as the `cursor` query parameter to fetch the next one.
 */
export type ZoneMembershipPage = {
  items: ZoneMembershipView[];
  nextCursor: string | null;
};

/**
 * `zone.MembershipView` in the gateway's OpenAPI document.
 */
export type ZoneMembershipView = {
  id: string;
  zoneId: string;
  userId: string;
  username: string;
  role: EnumsZoneRole;
  status: EnumsMembershipStatus;
  createdAt: string;
  updatedAt: string;
};

/**
 * `zone.MembershipView.WithMaybeToken` in the gateway's OpenAPI document.
 *
 * The result, plus the identity minted for the caller. `tokens` is present only when the request arrived without an `Authorization` header: the endpoint created a temporary user to own the operation, and these are the only credentials that will ever be issued for it. An authenticated caller gets `data` alone.
 */
export type ZoneMembershipViewWithMaybeToken = {
  tokens?: AuthAuthTokens;
  data: ZoneMembershipView;
};

/**
 * `zone.MyZoneCounts` in the gateway's OpenAPI document.
 */
export type ZoneMyZoneCounts = {
  owned: number;
  joined: number;
  pending: number;
  total: number;
};

/**
 * `zone.MyZoneView` in the gateway's OpenAPI document.
 */
export type ZoneMyZoneView = {
  id: string;
  name: string;
  joinCode: string;
  status: EnumsZoneStatus;
  ownerUserId: string | null;
  config: {
    [key: string]: unknown;
  };
  createdAt: string;
  updatedAt: string;
  myRole: EnumsZoneRole;
  myStatus: EnumsMembershipStatus;
  counts: ZoneZoneCounts;
  lists: ZoneZoneListPreview[];
  ownerUsername: string | null;
};

/**
 * `zone.ZoneByCodeView` in the gateway's OpenAPI document.
 */
export type ZoneZoneByCodeView = {
  name: string;
  memberCount: number;
};

/**
 * `zone.ZoneCounts` in the gateway's OpenAPI document.
 */
export type ZoneZoneCounts = {
  memberCount: number;
  listCount: number;
  pendingRequestCount: number | null;
  firstPendingRequesterName: string | null;
};

/**
 * `zone.ZoneListPreview` in the gateway's OpenAPI document.
 */
export type ZoneZoneListPreview = {
  id: string;
  name: string;
  lineCount: number;
  wantedCount: number;
};

/**
 * `zone.ZonePage` in the gateway's OpenAPI document.
 *
 * A cursor paginated page. `nextCursor` is null on the last page; otherwise pass it back as the `cursor` query parameter to fetch the next one.
 */
export type ZoneZonePage = {
  items: ZoneMyZoneView[];
  nextCursor: string | null;
};

/**
 * `zone.ZoneView` in the gateway's OpenAPI document.
 */
export type ZoneZoneView = {
  id: string;
  name: string;
  joinCode: string;
  status: EnumsZoneStatus;
  ownerUserId: string | null;
  config: {
    [key: string]: unknown;
  };
  createdAt: string;
  updatedAt: string;
};

/**
 * `zone.ZoneView.WithMaybeToken` in the gateway's OpenAPI document.
 *
 * The result, plus the identity minted for the caller. `tokens` is present only when the request arrived without an `Authorization` header: the endpoint created a temporary user to own the operation, and these are the only credentials that will ever be issued for it. An authenticated caller gets `data` alone.
 */
export type ZoneZoneViewWithMaybeToken = {
  tokens?: AuthAuthTokens;
  data: ZoneZoneView;
};
