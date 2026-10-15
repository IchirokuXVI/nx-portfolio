import { IMPERSONATION_NOTE_MAX } from '../../lib/enums/auth.enums';
import {
  IMPERSONATION_EVENTS,
  IMPERSONATION_PATTERNS,
} from '../../lib/messages/impersonation.messages';
import {
  boolean,
  integer,
  JsonSchema,
  nonEmptyString,
  object,
  ref,
  schemaId,
  string,
} from '../builders';
import { adminCredentialProperties } from '../common.schemas';
import { ENUM_IDS } from '../enums.schemas';
import { AUTH_SCHEMA_IDS } from './auth.schemas';

/**
 * JSON Schemas for support sessions (plan 0194).
 *
 * The exchange answers with `AuthTokens`, referenced and not restated: the app
 * stores the pair of a support session exactly as it stores any other pair.
 *
 * `StartImpersonationView` is the one schema here that no subject answers with.
 * It is the HTTP answer of the start route, which carries a URL where the
 * broker message carries the raw code.
 */
export const IMPERSONATION_SCHEMA_IDS = {
  statusRequest: schemaId('msg/auth.impersonation.status/request'),
  statusView: schemaId('impersonation/ImpersonationStatusView'),
  startRequest: schemaId('msg/auth.impersonation.start/request'),
  startResult: schemaId('msg/auth.impersonation.start/response'),
  startView: schemaId('impersonation/StartImpersonationView'),
  exchangeRequest: schemaId('msg/auth.impersonation.exchange/request'),
  endRequest: schemaId('msg/auth.impersonation.end/request'),
  endResult: schemaId('msg/auth.impersonation.end/response'),
  checkRequest: schemaId('msg/auth.impersonation.check/request'),
  checkResult: schemaId('msg/auth.impersonation.check/response'),
  endedEvent: schemaId('event/impersonation.ended'),
} as const;

const statusRequest = object(
  IMPERSONATION_SCHEMA_IDS.statusRequest,
  { ...adminCredentialProperties },
  ['userId']
);

const statusView = object(
  IMPERSONATION_SCHEMA_IDS.statusView,
  { enabled: boolean() },
  ['enabled']
);

// `note` is bounded here and its pairing with the reason is checked in auth:
// a schema that tied the two together would say so with an `if`, which the
// OpenAPI sampler cannot follow.
const startRequest = object(
  IMPERSONATION_SCHEMA_IDS.startRequest,
  {
    ...adminCredentialProperties,
    targetUserId: nonEmptyString(),
    reason: ref(ENUM_IDS.impersonationReason),
    note: string({ maxLength: IMPERSONATION_NOTE_MAX }),
  },
  ['userId', 'targetUserId', 'reason']
);

const sessionTimes = {
  sessionId: nonEmptyString(),
  codeExpiresAt: string({ format: 'date-time' }),
  // A duration, so a client counts it on its own clock (admin plan 0062).
  codeTtlMs: integer({ minimum: 1 }),
  expiresAt: string({ format: 'date-time' }),
};

const startResult = object(
  IMPERSONATION_SCHEMA_IDS.startResult,
  { ...sessionTimes, code: nonEmptyString() },
  ['sessionId', 'code', 'codeExpiresAt', 'codeTtlMs', 'expiresAt']
);

const startView = object(
  IMPERSONATION_SCHEMA_IDS.startView,
  { ...sessionTimes, url: nonEmptyString() },
  ['sessionId', 'url', 'codeExpiresAt', 'codeTtlMs', 'expiresAt']
);

const exchangeRequest = object(
  IMPERSONATION_SCHEMA_IDS.exchangeRequest,
  { code: nonEmptyString() },
  ['code']
);

const endRequest = object(
  IMPERSONATION_SCHEMA_IDS.endRequest,
  { userId: nonEmptyString(), sessionId: nonEmptyString() },
  ['userId']
);

const endResult = object(
  IMPERSONATION_SCHEMA_IDS.endResult,
  { ended: boolean() },
  ['ended']
);

const checkRequest = object(
  IMPERSONATION_SCHEMA_IDS.checkRequest,
  { sessionId: nonEmptyString() },
  ['sessionId']
);

const checkResult = object(
  IMPERSONATION_SCHEMA_IDS.checkResult,
  { live: boolean() },
  ['live']
);

const endedEvent = object(
  IMPERSONATION_SCHEMA_IDS.endedEvent,
  { sessionId: nonEmptyString(), userId: nonEmptyString() },
  ['sessionId', 'userId']
);

export const impersonationSchemas: JsonSchema[] = [
  statusRequest,
  statusView,
  startRequest,
  startResult,
  startView,
  exchangeRequest,
  endRequest,
  endResult,
  checkRequest,
  checkResult,
  endedEvent,
];

export const impersonationMessageContracts: Record<
  string,
  { request: string; response: string }
> = {
  [IMPERSONATION_PATTERNS.status]: {
    request: IMPERSONATION_SCHEMA_IDS.statusRequest,
    response: IMPERSONATION_SCHEMA_IDS.statusView,
  },
  [IMPERSONATION_PATTERNS.start]: {
    request: IMPERSONATION_SCHEMA_IDS.startRequest,
    response: IMPERSONATION_SCHEMA_IDS.startResult,
  },
  [IMPERSONATION_PATTERNS.exchange]: {
    request: IMPERSONATION_SCHEMA_IDS.exchangeRequest,
    response: AUTH_SCHEMA_IDS.authTokens,
  },
  [IMPERSONATION_PATTERNS.end]: {
    request: IMPERSONATION_SCHEMA_IDS.endRequest,
    response: IMPERSONATION_SCHEMA_IDS.endResult,
  },
  [IMPERSONATION_PATTERNS.check]: {
    request: IMPERSONATION_SCHEMA_IDS.checkRequest,
    response: IMPERSONATION_SCHEMA_IDS.checkResult,
  },
};

/** event name -> payload schema id. */
export const impersonationEventContracts: Record<string, string> = {
  [IMPERSONATION_EVENTS.ended]: IMPERSONATION_SCHEMA_IDS.endedEvent,
};
