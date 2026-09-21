import { APP_STATE_PATTERNS } from '../../lib/messages/app-state.messages';
import {
  boolean,
  JsonSchema,
  nonEmptyString,
  nullableString,
  object,
  ref,
  schemaId,
} from '../builders';
import {
  USER_PROFILE_VIEW_PROPERTIES,
  USER_PROFILE_VIEW_REQUIRED,
} from './auth.schemas';

/**
 * What an account has been shown (plan 0145): core's two subjects, and the body
 * `GET /v1/account/me` answers with once the gateway has composed them.
 */
export const APP_STATE_SCHEMA_IDS = {
  getUserAppStateRequest: schemaId('msg/appState.get/request'),
  setUserAppStateRequest: schemaId('msg/appState.set/request'),
  userAppStateView: schemaId('core/UserAppStateView'),
  /**
   * Composed by the gateway from two services, so it belongs to no subject and
   * is documented with `ApiComposedResponse` rather than through a pattern.
   */
  accountMeView: schemaId('gateway/AccountMeView'),
} as const;

const getUserAppStateRequest = object(
  APP_STATE_SCHEMA_IDS.getUserAppStateRequest,
  { userId: nonEmptyString() },
  ['userId']
);

/**
 * Both flags are plain booleans here and are refused unless true by the
 * gateway's DTO, which is the one place a caller is told why.
 *
 * A `const: true` would state the same rule a second time, in a document a
 * polyglot caller reads and a 400 never quotes, and the two would then have to
 * agree forever. Neither flag is required: what makes an empty body a mistake
 * is that nothing was asked for, and the gateway says that in the refusal.
 */
const setUserAppStateRequest = object(
  APP_STATE_SCHEMA_IDS.setUserAppStateRequest,
  {
    userId: nonEmptyString(),
    setupCompleted: boolean(),
    tourSeen: boolean(),
  },
  ['userId']
);

const userAppStateView = object(
  APP_STATE_SCHEMA_IDS.userAppStateView,
  {
    setupCompletedAt: nullableString(),
    tourSeenAt: nullableString(),
  },
  ['setupCompletedAt', 'tourSeenAt']
);

/**
 * The profile's own fields plus `appState`, flat.
 *
 * Built from auth's property map rather than from an `allOf` over
 * `UserProfileView`, for two reasons that point the same way. That schema is
 * strict, so an `allOf` against it would refuse the very field this one adds;
 * and a client author reading the published document gets one object with seven
 * entries instead of a composition to unpick. Nothing is copied: the six fields
 * come from the map auth exports, so a change there lands here.
 */
const accountMeView = object(
  APP_STATE_SCHEMA_IDS.accountMeView,
  {
    ...USER_PROFILE_VIEW_PROPERTIES,
    appState: ref(APP_STATE_SCHEMA_IDS.userAppStateView),
  },
  [...USER_PROFILE_VIEW_REQUIRED, 'appState']
);

export const appStateSchemas: JsonSchema[] = [
  getUserAppStateRequest,
  setUserAppStateRequest,
  userAppStateView,
  accountMeView,
];

export const appStateMessageContracts: Record<
  string,
  { request: string; response: string }
> = {
  [APP_STATE_PATTERNS.get]: {
    request: APP_STATE_SCHEMA_IDS.getUserAppStateRequest,
    response: APP_STATE_SCHEMA_IDS.userAppStateView,
  },
  [APP_STATE_PATTERNS.set]: {
    // The whole view, as every profile write answers the profile: the client
    // that pressed Done holds the same shape it read at startup.
    request: APP_STATE_SCHEMA_IDS.setUserAppStateRequest,
    response: APP_STATE_SCHEMA_IDS.userAppStateView,
  },
};
