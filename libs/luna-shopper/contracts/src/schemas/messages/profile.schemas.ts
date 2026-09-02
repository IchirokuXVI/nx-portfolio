import {
  GenerationScope,
  ProfilePostalCodeSource,
} from '../../lib/enums/profile.enums';
import {
  PROFILE_LIMITS,
  PROFILE_PATTERNS,
} from '../../lib/messages/profile.messages';
import {
  array,
  boolean,
  enumOf,
  integer,
  JsonSchema,
  nonEmptyString,
  nullableString,
  object,
  ref,
  schemaId,
  string,
} from '../builders';
import { COMMON_IDS } from '../common.schemas';

/**
 * Shopping profile schemas (plan 0049). Core owns the tables; the gateway is the
 * only caller. The `name` cap is spread from {@link PROFILE_LIMITS} rather than
 * written twice, so the schema and the service cannot disagree about what 64
 * means.
 */
export const PROFILE_SCHEMA_IDS = {
  generationScope: schemaId('enums/GenerationScope'),
  postalCodeSource: schemaId('enums/ProfilePostalCodeSource'),
  postalCodeView: schemaId('profile/ProfilePostalCodeView'),
  supermarketPreferenceView: schemaId(
    'profile/ProfileSupermarketPreferenceView'
  ),
  locationPreferenceView: schemaId('profile/ProfileLocationPreferenceView'),
  generationSourceView: schemaId('profile/ProfileGenerationSourceView'),
  shoppingProfileView: schemaId('profile/ShoppingProfileView'),
  shoppingProfileListResult: schemaId('profile/ShoppingProfileListResult'),
  scopeSelector: schemaId('profile/ProfileScopeSelector'),
  postalCodeInput: schemaId('profile/ProfilePostalCodeInput'),
  supermarketPreferenceInput: schemaId(
    'profile/ProfileSupermarketPreferenceInput'
  ),
  locationPreferenceInput: schemaId('profile/ProfileLocationPreferenceInput'),
  generationSourceInput: schemaId('profile/ProfileGenerationSourceInput'),
  listRequest: schemaId('msg/profiles.list/request'),
  createRequest: schemaId('msg/profiles.create/request'),
  updateRequest: schemaId('msg/profiles.update/request'),
  idRequest: schemaId('msg/profiles.id/request'),
  resolveScopesRequest: schemaId('msg/profiles.resolveScopes/request'),
  addPostalCodeRequest: schemaId('msg/profiles.addPostalCode/request'),
  removePostalCodeRequest: schemaId('msg/profiles.removePostalCode/request'),
  setLocationPreferencesRequest: schemaId(
    'msg/profiles.setLocationPreferences/request'
  ),
} as const;

const postalCodeView = object(
  PROFILE_SCHEMA_IDS.postalCodeView,
  {
    id: nonEmptyString(),
    postalCode: nonEmptyString(),
    label: nullableString(),
    position: integer({ minimum: 0 }),
    country: nonEmptyString({ maxLength: 2 }),
    source: ref(PROFILE_SCHEMA_IDS.postalCodeSource),
    expandNearby: boolean(),
  },
  ['id', 'postalCode', 'label', 'position', 'country', 'source', 'expandNearby']
);

const supermarketPreferenceView = object(
  PROFILE_SCHEMA_IDS.supermarketPreferenceView,
  {
    id: nonEmptyString(),
    supermarketId: nonEmptyString(),
    excluded: boolean(),
  },
  ['id', 'supermarketId', 'excluded']
);

const locationPreferenceView = object(
  PROFILE_SCHEMA_IDS.locationPreferenceView,
  {
    id: nonEmptyString(),
    supermarketLocationId: nonEmptyString(),
    excluded: boolean(),
  },
  ['id', 'supermarketLocationId', 'excluded']
);

const generationSourceView = object(
  PROFILE_SCHEMA_IDS.generationSourceView,
  {
    id: nonEmptyString(),
    zoneId: nonEmptyString(),
    listId: nullableString(),
  },
  ['id', 'zoneId', 'listId']
);

const shoppingProfileView = object(
  PROFILE_SCHEMA_IDS.shoppingProfileView,
  {
    id: nonEmptyString(),
    // Nullable and not merely optional: null is the value the client renders as
    // the localized default name (plan 0049, section 1.3).
    name: nullableString(),
    isDefault: boolean(),
    position: integer({ minimum: 0 }),
    addressText: nullableString(),
    minSavingCents: integer({ minimum: 0 }),
    minSavingPercent: { type: ['integer', 'null'], minimum: 0, maximum: 100 },
    generationScope: ref(PROFILE_SCHEMA_IDS.generationScope),
    postalCodes: array(ref(PROFILE_SCHEMA_IDS.postalCodeView)),
    supermarkets: array(ref(PROFILE_SCHEMA_IDS.supermarketPreferenceView)),
    locations: array(ref(PROFILE_SCHEMA_IDS.locationPreferenceView)),
    generationSources: array(ref(PROFILE_SCHEMA_IDS.generationSourceView)),
  },
  [
    'id',
    'name',
    'isDefault',
    'position',
    'addressText',
    'minSavingCents',
    'minSavingPercent',
    'generationScope',
    'postalCodes',
    'supermarkets',
    'locations',
    'generationSources',
  ]
);

const shoppingProfileListResult = object(
  PROFILE_SCHEMA_IDS.shoppingProfileListResult,
  { profiles: array(ref(PROFILE_SCHEMA_IDS.shoppingProfileView)) },
  ['profiles']
);

const scopeSelector = object(
  PROFILE_SCHEMA_IDS.scopeSelector,
  {
    profileId: nonEmptyString(),
    postalCodes: array(nonEmptyString()),
    supermarketIds: array(nonEmptyString()),
    excludedSupermarketIds: array(nonEmptyString()),
    excludedSupermarketLocationIds: array(nonEmptyString()),
    empty: boolean(),
  },
  [
    'profileId',
    'postalCodes',
    'supermarketIds',
    'excludedSupermarketIds',
    'excludedSupermarketLocationIds',
    'empty',
  ]
);

/**
 * `source` is the two the user may state and not the three the column holds:
 * `NEARBY` is a conclusion, never an input (plan 0062, section 2).
 */
const userStatedSource = {
  type: 'string',
  enum: [ProfilePostalCodeSource.TYPED, ProfilePostalCodeSource.DEVICE],
};

const postalCodeInput = object(
  PROFILE_SCHEMA_IDS.postalCodeInput,
  {
    postalCode: nonEmptyString({
      maxLength: PROFILE_LIMITS.postalCodeMaxLength,
    }),
    label: nullableString(),
    country: nonEmptyString({ maxLength: 2 }),
    source: userStatedSource,
    expandNearby: boolean(),
  },
  ['postalCode']
);

const supermarketPreferenceInput = object(
  PROFILE_SCHEMA_IDS.supermarketPreferenceInput,
  { supermarketId: nonEmptyString(), excluded: boolean() },
  ['supermarketId']
);

const locationPreferenceInput = object(
  PROFILE_SCHEMA_IDS.locationPreferenceInput,
  { supermarketLocationId: nonEmptyString(), excluded: boolean() },
  ['supermarketLocationId']
);

const generationSourceInput = object(
  PROFILE_SCHEMA_IDS.generationSourceInput,
  { zoneId: nonEmptyString(), listId: nullableString() },
  ['zoneId']
);

/** The editable half, shared by create and update so the two cannot drift. */
const profileFields = {
  name: { type: ['string', 'null'], maxLength: PROFILE_LIMITS.nameMaxLength },
  addressText: {
    type: ['string', 'null'],
    maxLength: PROFILE_LIMITS.addressMaxLength,
  },
  minSavingCents: integer({ minimum: 0 }),
  minSavingPercent: { type: ['integer', 'null'], minimum: 0, maximum: 100 },
  generationScope: ref(PROFILE_SCHEMA_IDS.generationScope),
  postalCodes: array(ref(PROFILE_SCHEMA_IDS.postalCodeInput)),
  supermarkets: array(ref(PROFILE_SCHEMA_IDS.supermarketPreferenceInput)),
  generationSources: array(ref(PROFILE_SCHEMA_IDS.generationSourceInput)),
};

const listRequest = object(
  PROFILE_SCHEMA_IDS.listRequest,
  { userId: nonEmptyString() },
  ['userId']
);

const createRequest = object(
  PROFILE_SCHEMA_IDS.createRequest,
  { userId: nonEmptyString(), ...profileFields },
  ['userId']
);

const updateRequest = object(
  PROFILE_SCHEMA_IDS.updateRequest,
  {
    userId: nonEmptyString(),
    profileId: nonEmptyString(),
    ...profileFields,
  },
  ['userId', 'profileId']
);

const idRequest = object(
  PROFILE_SCHEMA_IDS.idRequest,
  { userId: nonEmptyString(), profileId: nonEmptyString() },
  ['userId', 'profileId']
);

const resolveScopesRequest = object(
  PROFILE_SCHEMA_IDS.resolveScopesRequest,
  { userId: nonEmptyString(), profileId: string() },
  ['userId']
);

const addPostalCodeRequest = object(
  PROFILE_SCHEMA_IDS.addPostalCodeRequest,
  {
    userId: nonEmptyString(),
    profileId: nonEmptyString(),
    postalCode: nonEmptyString({
      maxLength: PROFILE_LIMITS.postalCodeMaxLength,
    }),
    label: nullableString(),
    country: nonEmptyString({ maxLength: 2 }),
    source: userStatedSource,
    expandNearby: boolean(),
  },
  ['userId', 'profileId', 'postalCode']
);

const removePostalCodeRequest = object(
  PROFILE_SCHEMA_IDS.removePostalCodeRequest,
  {
    userId: nonEmptyString(),
    profileId: nonEmptyString(),
    postalCode: nonEmptyString({
      maxLength: PROFILE_LIMITS.postalCodeMaxLength,
    }),
  },
  ['userId', 'profileId', 'postalCode']
);

const setLocationPreferencesRequest = object(
  PROFILE_SCHEMA_IDS.setLocationPreferencesRequest,
  {
    userId: nonEmptyString(),
    profileId: nonEmptyString(),
    locations: array(ref(PROFILE_SCHEMA_IDS.locationPreferenceInput)),
  },
  ['userId', 'profileId', 'locations']
);

export const profileSchemas: JsonSchema[] = [
  enumOf(PROFILE_SCHEMA_IDS.generationScope, Object.values(GenerationScope)),
  enumOf(
    PROFILE_SCHEMA_IDS.postalCodeSource,
    Object.values(ProfilePostalCodeSource)
  ),
  postalCodeView,
  supermarketPreferenceView,
  locationPreferenceView,
  generationSourceView,
  shoppingProfileView,
  shoppingProfileListResult,
  scopeSelector,
  postalCodeInput,
  supermarketPreferenceInput,
  locationPreferenceInput,
  generationSourceInput,
  listRequest,
  createRequest,
  updateRequest,
  idRequest,
  resolveScopesRequest,
  addPostalCodeRequest,
  removePostalCodeRequest,
  setLocationPreferencesRequest,
];

export const profileMessageContracts: Record<
  string,
  { request: string; response: string }
> = {
  [PROFILE_PATTERNS.list]: {
    request: PROFILE_SCHEMA_IDS.listRequest,
    response: PROFILE_SCHEMA_IDS.shoppingProfileListResult,
  },
  [PROFILE_PATTERNS.create]: {
    request: PROFILE_SCHEMA_IDS.createRequest,
    response: PROFILE_SCHEMA_IDS.shoppingProfileView,
  },
  [PROFILE_PATTERNS.update]: {
    request: PROFILE_SCHEMA_IDS.updateRequest,
    response: PROFILE_SCHEMA_IDS.shoppingProfileView,
  },
  [PROFILE_PATTERNS.setDefault]: {
    request: PROFILE_SCHEMA_IDS.idRequest,
    response: PROFILE_SCHEMA_IDS.shoppingProfileView,
  },
  [PROFILE_PATTERNS.delete]: {
    request: PROFILE_SCHEMA_IDS.idRequest,
    response: COMMON_IDS.idResult,
  },
  [PROFILE_PATTERNS.resolveScopes]: {
    request: PROFILE_SCHEMA_IDS.resolveScopesRequest,
    response: PROFILE_SCHEMA_IDS.scopeSelector,
  },
  // Both answer the whole profile rather than the row they touched: one add can
  // write a parent and its neighbours, and one remove can prune several.
  [PROFILE_PATTERNS.addPostalCode]: {
    request: PROFILE_SCHEMA_IDS.addPostalCodeRequest,
    response: PROFILE_SCHEMA_IDS.shoppingProfileView,
  },
  [PROFILE_PATTERNS.removePostalCode]: {
    request: PROFILE_SCHEMA_IDS.removePostalCodeRequest,
    response: PROFILE_SCHEMA_IDS.shoppingProfileView,
  },
  // The whole profile again, for the same reason: one call writes several rows,
  // and some of them by deleting (plan 0064, section 5).
  [PROFILE_PATTERNS.setLocationPreferences]: {
    request: PROFILE_SCHEMA_IDS.setLocationPreferencesRequest,
    response: PROFILE_SCHEMA_IDS.shoppingProfileView,
  },
};
