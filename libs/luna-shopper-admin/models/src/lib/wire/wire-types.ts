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
 * `AcceptSourceAliasDto` in the gateway's OpenAPI document.
 */
export type AcceptSourceAliasDto = {
  itemId: string;
};

/**
 * `AddCommentDto` in the gateway's OpenAPI document.
 */
export type AddCommentDto = {
  body: string;
};

/**
 * `AddGeneratedListLineDto` in the gateway's OpenAPI document.
 */
export type AddGeneratedListLineDto = {
  content: string;
  quantity?: number;
  itemId?: string | null;
  options?: string[];
  targetListId?: string | null;
};

/**
 * `AddGeneratedListParticipantLineDto` in the gateway's OpenAPI document.
 */
export type AddGeneratedListParticipantLineDto = {
  content: string;
  quantity?: number;
  itemId?: string;
  options?: string[];
};

/**
 * `AddItemPriceDto` in the gateway's OpenAPI document.
 */
export type AddItemPriceDto = {
  itemId: string;
  priceScopeId: string;
  sourceKind?:
    | 'OFFICIAL_API'
    | 'OFFICIAL_WEB'
    | 'OFFICIAL_LEAFLET'
    | 'ADMIN'
    | 'USER_RECEIPT'
    | 'USER_REPORTED';
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
 * `BindGeneratedListLineDto` in the gateway's OpenAPI document.
 */
export type BindGeneratedListLineDto = {
  listId: string;
};

/**
 * `CreateGeneratedListDto` in the gateway's OpenAPI document.
 */
export type CreateGeneratedListDto = {
  sources?: GeneratedListSourceDto[];
  profileId?: string;
  name?: string | null;
  defaultTargetListId?: string | null;
  idempotencyKey?: string;
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
 * `CreateItemFromAliasDto` in the gateway's OpenAPI document.
 */
export type CreateItemFromAliasDto = {
  name: LocalizedNameDto;
  brand?: string | null;
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
};

/**
 * `CreateItemFromEntryDto` in the gateway's OpenAPI document.
 */
export type CreateItemFromEntryDto = {
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
  kind: 'NATIONAL' | 'WAREHOUSE' | 'POSTAL_CODE' | 'STORE';
  externalKey?: string | null;
  label?: LocalizedTextDto;
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
 * `EnsureShareLinkDto` in the gateway's OpenAPI document.
 */
export type EnsureShareLinkDto = {
  expiresAt?: string | null;
};

/**
 * `ForgotPasswordDto` in the gateway's OpenAPI document.
 */
export type ForgotPasswordDto = {
  email: string;
};

/**
 * `GeneratedListAllocationDto` in the gateway's OpenAPI document.
 */
export type GeneratedListAllocationDto = {
  listId: string;
  quantity: number;
};

/**
 * `GeneratedListSourceDto` in the gateway's OpenAPI document.
 */
export type GeneratedListSourceDto = {
  zoneId: string;
  listId?: string | null;
};

/**
 * `ImportDiscoveredPlaceDto` in the gateway's OpenAPI document.
 */
export type ImportDiscoveredPlaceDto = {
  supermarketId?: string;
  priceScopeId?: string;
};

/**
 * `ImportLeafletDto` in the gateway's OpenAPI document.
 */
export type ImportLeafletDto = {
  supermarketId: string;
  priceScopeId: string;
  validFrom?: string;
  validUntil?: string;
  document: {
    [key: string]: unknown;
  };
};

/**
 * `JoinGeneratedListDto` in the gateway's OpenAPI document.
 */
export type JoinGeneratedListDto = {
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
    | 'forbidden'
    | 'not_found'
    | 'conflict'
    | 'rate_limited'
    | 'not_configured'
    | 'client_too_old'
    | 'generated_list_finished'
    | 'stale_quantity'
    | 'below_settled'
    | 'account_locked'
    | 'internal';
  detail?: string;
  message: string;
  correlationId: string;
  errors?: {
    [key: string]: string[];
  };
  retryAfterSeconds?: number;
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
 * `RegisterDto` in the gateway's OpenAPI document.
 */
export type RegisterDto = {
  email: string;
  password: string;
  displayName?: string;
};

/**
 * `ReorderGeneratedListLinesDto` in the gateway's OpenAPI document.
 */
export type ReorderGeneratedListLinesDto = {
  lineIds: string[];
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
 * `SetGeneratedListLineOutstandingDto` in the gateway's OpenAPI document.
 */
export type SetGeneratedListLineOutstandingDto = {
  outstanding: number;
  from: number;
};

/**
 * `SetGeneratedListOriginQuantityDto` in the gateway's OpenAPI document.
 */
export type SetGeneratedListOriginQuantityDto = {
  listId: string;
  lineId: string;
  quantity: number;
  from: number;
};

/**
 * `SetGeneratedListPickDto` in the gateway's OpenAPI document.
 */
export type SetGeneratedListPickDto = {
  itemId: string;
};

/**
 * `SetListAccessDto` in the gateway's OpenAPI document.
 */
export type SetListAccessDto = {
  entries: ListAccessEntryDto[];
};

/**
 * `SetManualItemSourceRefDto` in the gateway's OpenAPI document.
 */
export type SetManualItemSourceRefDto = {
  itemId: string;
  supermarketId: string;
  externalId: string;
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
 * `SettleGeneratedListLineDto` in the gateway's OpenAPI document.
 */
export type SettleGeneratedListLineDto = {
  outcome: SettlementOutcome;
  quantity?: number;
  allocations?: GeneratedListAllocationDto[];
  itemId?: string;
};

/**
 * `SettleLineDto` in the gateway's OpenAPI document.
 */
export type SettleLineDto = {
  outcome: 'BOUGHT' | 'NOT_AVAILABLE';
  quantity?: number;
  itemId?: string;
};

/**
 * `SettlementOutcome` in the gateway's OpenAPI document.
 */
export type SettlementOutcome = 'BOUGHT' | 'NOT_AVAILABLE';

/**
 * `SpawnHarvestRunDto` in the gateway's OpenAPI document.
 */
export type SpawnHarvestRunDto = {
  mode: 'STORE_DISCOVERY' | 'CATALOG_DISCOVERY' | 'REFRESH' | 'LEAFLET_IMPORT';
  supermarketId?: string;
  priceScopeId?: string;
  postalCode?: string;
  country?: string;
  radiusMetres?: number;
  brandKeys?: string[];
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
 * `UpdateGeneratedListDto` in the gateway's OpenAPI document.
 */
export type UpdateGeneratedListDto = {
  name?: string | null;
  status?: 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';
  defaultTargetListId?: string | null;
};

/**
 * `UpdateGeneratedListLineDto` in the gateway's OpenAPI document.
 */
export type UpdateGeneratedListLineDto = {
  content?: string;
  quantity?: number;
  itemId?: string | null;
  targetListId?: string | null;
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
  kind?: 'NATIONAL' | 'WAREHOUSE' | 'POSTAL_CODE' | 'STORE';
  externalKey?: string | null;
  label?: LocalizedTextDto;
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
};

/**
 * `UpdateSupermarketLocationDto` in the gateway's OpenAPI document.
 */
export type UpdateSupermarketLocationDto = {
  priceScopeId?: string;
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
  adapterKey: 'mercadona-api' | 'deza-web' | 'osm-places' | 'manual';
  enabled?: boolean;
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
  name: string | null;
  status: EnumsGeneratedListStatus;
  zoneIds: string[];
  lineCount: number;
  generatedAt: string;
  createdAt: string;
  updatedAt: string;
  lines: AdminCoreAdminBasketLineView[];
};

/**
 * `admin-core.AdminBasketLineView` in the gateway's OpenAPI document.
 */
export type AdminCoreAdminBasketLineView = {
  id: string;
  content: string;
  quantity: number;
  createdAt: string;
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
 * `admin-core.AdminBasketView` in the gateway's OpenAPI document.
 */
export type AdminCoreAdminBasketView = {
  id: string;
  ownerUserId: string;
  name: string | null;
  status: EnumsGeneratedListStatus;
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
  group: CatalogProductGroupOfferView | unknown;
  item: CatalogItemView | unknown;
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
  observedAt: string | null;
  sourceKind: EnumsPriceSourceKind | unknown;
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
  promotion:
    | {
        [key: string]: unknown;
      }
    | unknown;
  loyalty:
    | {
        [key: string]: unknown;
      }
    | unknown;
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
  observedAt: string;
  lastObservedAt: string;
  validFrom: string | null;
  validUntil: string | null;
  sourceRunId: string | null;
  lastObservedRunId: string | null;
  overrides: CatalogItemPriceOverrides | unknown;
  protectedUntil: string | null;
  details: CatalogItemPriceDetails | unknown;
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
  bestOffer?: CatalogItemOfferView | unknown;
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
 * `catalog.PostalCodeCoverageView` in the gateway's OpenAPI document.
 */
export type CatalogPostalCodeCoverageView = {
  postalCode: string;
  served: boolean;
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
  label: CatalogLocalizedText | unknown;
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
  cheapestItem: CatalogItemView | unknown;
  offer: CatalogItemOfferView | unknown;
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
 * `catalog.ResolvedScopeView` in the gateway's OpenAPI document.
 */
export type CatalogResolvedScopeView = {
  priceScopeId: string;
  supermarketId: string;
  postalCode: string | null;
  origin: 'POSTAL_CODE' | 'NATIONAL' | 'CHAIN_DEFAULT';
  approximate: boolean;
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
  observedAt: string | null;
  sourceKind: EnumsPriceSourceKind | unknown;
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
  availabilitySourceKind: EnumsPriceSourceKind | unknown;
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
  label: CatalogLocalizedText | unknown;
  address: string | null;
  city: string | null;
  country: string | null;
  postalCode: string | null;
  postalCodeSource: EnumsPostalCodeSource | unknown;
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
 * `enums.AdapterKey` in the gateway's OpenAPI document.
 */
export type EnumsAdapterKey =
  | 'mercadona-api'
  | 'deza-web'
  | 'osm-places'
  | 'manual';

/**
 * `enums.AuthProvider` in the gateway's OpenAPI document.
 */
export type EnumsAuthProvider = 'GOOGLE' | 'EMAIL';

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
 * `enums.GeneratedLineOrigin` in the gateway's OpenAPI document.
 */
export type EnumsGeneratedLineOrigin = 'DERIVED' | 'ADDED';

/**
 * `enums.GeneratedListStatus` in the gateway's OpenAPI document.
 */
export type EnumsGeneratedListStatus =
  | 'DRAFT'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'ARCHIVED';

/**
 * `enums.GenerationScope` in the gateway's OpenAPI document.
 */
export type EnumsGenerationScope = 'ALL' | 'SELECTED';

/**
 * `enums.HarvestRunMode` in the gateway's OpenAPI document.
 */
export type EnumsHarvestRunMode =
  | 'STORE_DISCOVERY'
  | 'CATALOG_DISCOVERY'
  | 'REFRESH'
  | 'LEAFLET_IMPORT';

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
 * `enums.HarvestWarningCode` in the gateway's OpenAPI document.
 */
export type EnumsHarvestWarningCode =
  | 'LOYALTY_REQUIRED'
  | 'CONDITIONAL_PRICE'
  | 'DUPLICATE_KEY'
  | 'REJECTED_ALIAS'
  | 'CANDIDATE_MATCH'
  | 'NO_MATCH'
  | 'ALREADY_QUEUED'
  | 'EXTRACTOR';

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
 * `enums.ItemSourceMatch` in the gateway's OpenAPI document.
 */
export type EnumsItemSourceMatch =
  | 'EXTERNAL_ID'
  | 'EAN'
  | 'NAME_BRAND_SIZE'
  | 'NAME_SIZE'
  | 'MANUAL';

/**
 * `enums.ItemSourceRefStatus` in the gateway's OpenAPI document.
 */
export type EnumsItemSourceRefStatus =
  | 'ACTIVE'
  | 'CANDIDATE'
  | 'REJECTED'
  | 'MANUAL';

/**
 * `enums.LineApprovalStatus` in the gateway's OpenAPI document.
 */
export type EnumsLineApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

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
 * `enums.OriginUnavailableReason` in the gateway's OpenAPI document.
 */
export type EnumsOriginUnavailableReason =
  | 'CLAIMED'
  | 'NOT_APPROVED'
  | 'SETTLED';

/**
 * `enums.ParticipantKind` in the gateway's OpenAPI document.
 */
export type EnumsParticipantKind = 'OWNER' | 'REGISTERED' | 'GUEST';

/**
 * `enums.PostalCodeSource` in the gateway's OpenAPI document.
 */
export type EnumsPostalCodeSource = 'SOURCE' | 'DERIVED' | 'MANUAL';

/**
 * `enums.PriceScopeKind` in the gateway's OpenAPI document.
 */
export type EnumsPriceScopeKind =
  | 'NATIONAL'
  | 'WAREHOUSE'
  | 'POSTAL_CODE'
  | 'STORE';

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
 * `enums.SourceAliasStatus` in the gateway's OpenAPI document.
 */
export type EnumsSourceAliasStatus =
  | 'ACTIVE'
  | 'CANDIDATE'
  | 'UNRESOLVED'
  | 'REJECTED';

/**
 * `enums.SourceLocationStatus` in the gateway's OpenAPI document.
 */
export type EnumsSourceLocationStatus = 'ACTIVE' | 'UNMAPPED' | 'IGNORED';

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
 * `generated-list-sharing.BasketLineView` in the gateway's OpenAPI document.
 */
export type GeneratedListSharingBasketLineView = {
  id: string;
  content: string;
  quantity: number;
  settledQuantity: number;
  itemId: string | null;
  options: string[];
  position: number;
  createdByParticipantId: string | null;
  lastEditedByParticipantId: string | null;
  lastEditedAt: string | null;
  lastOutcome: 'BOUGHT' | 'NOT_AVAILABLE' | null | null;
  origins?: GeneratedListGeneratedListLineOriginView[];
  targetListId?: string | null;
  origin?: EnumsGeneratedLineOrigin;
};

/**
 * `generated-list-sharing.BasketPriceScopeView` in the gateway's OpenAPI document.
 */
export type GeneratedListSharingBasketPriceScopeView = {
  priceScopeId: string;
  supermarketId: string;
  supermarketName: CatalogLocalizedText;
  locations: GeneratedListSharingBasketScopeLocationView[];
};

/**
 * `generated-list-sharing.BasketResult` in the gateway's OpenAPI document.
 */
export type GeneratedListSharingBasketResult = {
  id: string;
  name: string | null;
  status: EnumsGeneratedListStatus;
  generatedAt: string;
  lines: GeneratedListSharingBasketLineView[];
  participants: GeneratedListSharingParticipantView[];
  me: GeneratedListSharingParticipantView;
  seesZoneData: boolean;
  sourceSnapshot?: GeneratedListGeneratedListSourceSnapshot;
  sourceNames?: GeneratedListSharingSourceName[];
  products: CatalogItemView[];
  scopes: GeneratedListSharingBasketPriceScopeView[];
};

/**
 * `generated-list-sharing.BasketScopeLocationView` in the gateway's OpenAPI document.
 */
export type GeneratedListSharingBasketScopeLocationView = {
  supermarketLocationId: string;
  label: CatalogLocalizedText | unknown;
  address: string | null;
  city: string | null;
  postalCode: string | null;
};

/**
 * `generated-list-sharing.JoinResult` in the gateway's OpenAPI document.
 */
export type GeneratedListSharingJoinResult = {
  generatedListId: string;
  participant: GeneratedListSharingParticipantView;
  sessionSecret: string | null;
  socketToken: string;
  socketTokenExpiresAt: string;
};

/**
 * `generated-list-sharing.LineOriginDetail` in the gateway's OpenAPI document.
 */
export type GeneratedListSharingLineOriginDetail = {
  originId: string;
  listId: string;
  lineId: string;
  zoneId: string;
  listName: string | null;
  zoneName: string | null;
  contributed: number;
  listQuantity: number;
  settledHere: number;
  writable: boolean;
};

/**
 * `generated-list-sharing.LineTarget` in the gateway's OpenAPI document.
 */
export type GeneratedListSharingLineTarget = {
  listId: string;
  zoneId: string;
  listName: string | null;
  zoneName: string | null;
  fromRun: boolean;
};

/**
 * `generated-list-sharing.LinkPreview` in the gateway's OpenAPI document.
 */
export type GeneratedListSharingLinkPreview = {
  joinable: boolean;
  name?: string | null;
  participantCount?: number;
};

/**
 * `generated-list-sharing.OriginCandidate` in the gateway's OpenAPI document.
 */
export type GeneratedListSharingOriginCandidate = {
  listId: string;
  lineId: string;
  zoneId: string;
  listName: string | null;
  zoneName: string | null;
  listQuantity: number;
  content: string;
  matchedOnText: boolean;
  unavailable?: EnumsOriginUnavailableReason;
};

/**
 * `generated-list-sharing.ParticipantListResult` in the gateway's OpenAPI document.
 */
export type GeneratedListSharingParticipantListResult = {
  participants: GeneratedListSharingParticipantView[];
};

/**
 * `generated-list-sharing.ParticipantTokenResult` in the gateway's OpenAPI document.
 */
export type GeneratedListSharingParticipantTokenResult = {
  socketToken: string;
  socketTokenExpiresAt: string;
  participant: GeneratedListSharingParticipantView;
};

/**
 * `generated-list-sharing.ParticipantView` in the gateway's OpenAPI document.
 */
export type GeneratedListSharingParticipantView = {
  id: string;
  kind: EnumsParticipantKind;
  displayName: string | null;
  username: string | null;
  guestNumber: number | null;
  userId: string | null;
  joinedAt: string;
  lastSeenAt: string;
  shareLinkId: string | null;
  userAgent?: string | null;
};

/**
 * `generated-list-sharing.ReopenResult` in the gateway's OpenAPI document.
 */
export type GeneratedListSharingReopenResult = {
  line: GeneratedListSharingBasketLineView;
  skippedCount: number;
};

/**
 * `generated-list-sharing.SettleResult` in the gateway's OpenAPI document.
 */
export type GeneratedListSharingSettleResult = {
  line: GeneratedListSharingBasketLineView;
  skippedCount: number;
  settlements?: GeneratedListSharingSettlementRef[];
  skipped?: GeneratedListSharingSettleSkip[];
};

/**
 * `generated-list-sharing.SettleSkip` in the gateway's OpenAPI document.
 */
export type GeneratedListSharingSettleSkip = {
  lineId: string;
  listId: string;
  reason: 'ACCESS_GONE' | 'ORIGIN_DELETED';
  listName: string | null;
  zoneName: string | null;
};

/**
 * `generated-list-sharing.SettlementRef` in the gateway's OpenAPI document.
 */
export type GeneratedListSharingSettlementRef = {
  settlementId: string;
  lineId: string;
  listId: string;
  quantity: number;
};

/**
 * `generated-list-sharing.ShareLinkResult` in the gateway's OpenAPI document.
 */
export type GeneratedListSharingShareLinkResult = {
  link?: GeneratedListSharingShareLinkView;
};

/**
 * `generated-list-sharing.ShareLinkView` in the gateway's OpenAPI document.
 */
export type GeneratedListSharingShareLinkView = {
  id: string;
  generatedListId: string;
  secret: string;
  createdByParticipantId: string;
  createdAt: string;
  expiresAt: string | null;
  participantCount: number;
};

/**
 * `generated-list-sharing.SourceName` in the gateway's OpenAPI document.
 */
export type GeneratedListSharingSourceName = {
  listId: string;
  name: string;
  zoneName: string | null;
};

/**
 * `generated-list.GeneratedListLineOriginView` in the gateway's OpenAPI document.
 */
export type GeneratedListGeneratedListLineOriginView = {
  id: string;
  zoneId: string;
  listId: string;
  lineId: string;
  quantity: number;
  lineVersion: number;
};

/**
 * `generated-list.GeneratedListLineView` in the gateway's OpenAPI document.
 */
export type GeneratedListGeneratedListLineView = {
  id: string;
  content: string;
  quantity: number;
  settledQuantity: number;
  itemId: string | null;
  options: string[];
  origin: EnumsGeneratedLineOrigin;
  targetListId: string | null;
  position: number;
  origins: GeneratedListGeneratedListLineOriginView[];
};

/**
 * `generated-list.GeneratedListPage` in the gateway's OpenAPI document.
 *
 * A cursor paginated page. `nextCursor` is null on the last page; otherwise pass it back as the `cursor` query parameter to fetch the next one.
 */
export type GeneratedListGeneratedListPage = {
  items: GeneratedListGeneratedListSummaryView[];
  nextCursor: string | null;
};

/**
 * `generated-list.GeneratedListRunResult` in the gateway's OpenAPI document.
 */
export type GeneratedListGeneratedListRunResult = {
  list: GeneratedListGeneratedListView;
  skipped: GeneratedListGeneratedListSkippedLineView[];
};

/**
 * `generated-list.GeneratedListSkippedLineView` in the gateway's OpenAPI document.
 */
export type GeneratedListGeneratedListSkippedLineView = {
  zoneId: string;
  listId: string;
  lineId: string;
  content: string;
  carriedByGeneratedListId: string;
};

/**
 * `generated-list.GeneratedListSourceSnapshot` in the gateway's OpenAPI document.
 */
export type GeneratedListGeneratedListSourceSnapshot = {
  profileId: string | null;
  pricingProfileId: string | null;
  sources: GeneratedListGeneratedListSourceSnapshotEntry[];
};

/**
 * `generated-list.GeneratedListSourceSnapshotEntry` in the gateway's OpenAPI document.
 */
export type GeneratedListGeneratedListSourceSnapshotEntry = {
  zoneId: string;
  listId: string;
};

/**
 * `generated-list.GeneratedListSummaryView` in the gateway's OpenAPI document.
 */
export type GeneratedListGeneratedListSummaryView = {
  id: string;
  name: string | null;
  status: EnumsGeneratedListStatus;
  generatedAt: string;
  lineCount: number;
  settledLineCount: number;
  boughtLineCount: number;
  notAvailableLineCount: number;
  presentCount: number;
};

/**
 * `generated-list.GeneratedListView` in the gateway's OpenAPI document.
 */
export type GeneratedListGeneratedListView = {
  id: string;
  name: string | null;
  status: EnumsGeneratedListStatus;
  generatedAt: string;
  sourceSnapshot: GeneratedListGeneratedListSourceSnapshot;
  lines: GeneratedListGeneratedListLineView[];
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
  country: string | null;
  website: string | null;
  openingHours: string | null;
  tags: {
    [key: string]: string;
  };
  status: EnumsDiscoveredPlaceStatus;
  supermarketLocationId: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
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
 * `harvest.ItemSourceRefPage` in the gateway's OpenAPI document.
 *
 * A cursor paginated page. `nextCursor` is null on the last page; otherwise pass it back as the `cursor` query parameter to fetch the next one.
 */
export type HarvestItemSourceRefPage = {
  items: HarvestItemSourceRefView[];
  nextCursor: string | null;
};

/**
 * `harvest.ItemSourceRefView` in the gateway's OpenAPI document.
 */
export type HarvestItemSourceRefView = {
  id: string;
  itemId: string;
  supermarketId: string;
  externalId: string;
  externalUrl: string | null;
  matchedBy: EnumsItemSourceMatch;
  status: EnumsItemSourceRefStatus;
  confidence: number;
  lastResolvedAt: string | null;
  lastSeenAt: string | null;
};

/**
 * `harvest.SourceAliasAcceptResult` in the gateway's OpenAPI document.
 */
export type HarvestSourceAliasAcceptResult = {
  alias: HarvestSourceAliasView;
  pricesWritten: number;
  item: CatalogItemView | unknown;
};

/**
 * `harvest.SourceAliasPage` in the gateway's OpenAPI document.
 *
 * A cursor paginated page. `nextCursor` is null on the last page; otherwise pass it back as the `cursor` query parameter to fetch the next one.
 */
export type HarvestSourceAliasPage = {
  items: HarvestSourceAliasView[];
  nextCursor: string | null;
};

/**
 * `harvest.SourceAliasView` in the gateway's OpenAPI document.
 */
export type HarvestSourceAliasView = {
  id: string;
  supermarketId: string;
  aliasKey: string;
  printedName: string;
  printedFormat: string | null;
  printedBrand: string | null;
  itemId: string | null;
  candidateItemId: string | null;
  candidateEntryId: string | null;
  status: EnumsSourceAliasStatus;
  matchedBy: EnumsItemSourceMatch;
  confidence: number;
  timesSeen: number;
  firstSeenAt: string;
  lastSeenAt: string;
  firstRunId: string | null;
  lastRunId: string | null;
  offerPrice: number | null;
  offerCurrency: string | null;
  offerUnitPrice: number | null;
  offerUnitPriceLabel: string | null;
  offerPage: number | null;
  offerRawText: string[];
  offerConfidence: number | null;
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
  name: string;
  brand: string | null;
  ean: string | null;
  unitSize: number | null;
  sizeFormat: string | null;
  price: number | null;
  unitPrice: number | null;
  unitPriceLabel: string | null;
  categoryPath: string[];
  url: string | null;
  lastSeenAt: string;
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
  recording: ListCommentRecording | unknown;
  transcription: EnumsCommentTranscription | unknown;
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
  settledAt: string;
  revertedAt: string | null;
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
  lastSettlementOutcome: EnumsSettlementOutcome | unknown;
  claimed: boolean;
  claimedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * `list.LineViewList` in the gateway's OpenAPI document.
 */
export type ListLineViewList = ListLineView[];

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
  link: AssistantAssistantListLink | unknown;
  choices: AssistantAssistantChoice[];
  listResolution?: EnumsListResolutionBranch;
  heard?: string;
};

/**
 * `msg.generatedList.bindLine.response` in the gateway's OpenAPI document.
 */
export type MsgGeneratedListBindLineResponse = {
  line: GeneratedListSharingBasketLineView;
  listId: string;
  zoneId: string;
  createdLineId: string;
  quantity: number;
  pendingApproval: boolean;
};

/**
 * `msg.generatedList.lineOrigins.response` in the gateway's OpenAPI document.
 */
export type MsgGeneratedListLineOriginsResponse = {
  generatedListId: string;
  lineId: string;
  origins: GeneratedListSharingLineOriginDetail[];
  candidates: GeneratedListSharingOriginCandidate[];
};

/**
 * `msg.generatedList.lineTargets.response` in the gateway's OpenAPI document.
 */
export type MsgGeneratedListLineTargetsResponse = {
  generatedListId: string;
  lineId: string;
  targets: GeneratedListSharingLineTarget[];
};

/**
 * `msg.generatedList.participant.revoke.response` in the gateway's OpenAPI document.
 */
export type MsgGeneratedListParticipantRevokeResponse = {
  id: string;
};

/**
 * `msg.generatedList.setOriginQuantity.response` in the gateway's OpenAPI document.
 */
export type MsgGeneratedListSetOriginQuantityResponse = {
  line: GeneratedListSharingBasketLineView;
  origin: GeneratedListSharingLineOriginDetail | unknown;
  listQuantity: number;
};

/**
 * `msg.generatedList.shareLink.revoke.response` in the gateway's OpenAPI document.
 */
export type MsgGeneratedListShareLinkRevokeResponse = {
  revoked: number;
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
  identity: StatsIdentityStats | unknown;
  core: StatsCoreStats | unknown;
  measuredAt: string;
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
