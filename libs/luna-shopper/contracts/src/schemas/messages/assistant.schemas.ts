import { ASSISTANT_PATTERNS } from '../../lib/messages/assistant.messages';
import {
  array,
  JsonSchema,
  nonEmptyString,
  nullableString,
  object,
  ref,
  schemaId,
  string,
} from '../builders';
import { ENUM_IDS } from '../enums.schemas';

/**
 * The assistant's one request/reply contract (plan 0039).
 *
 * The request is strict about the transcript's *shape* and says nothing about its
 * *content*, which is the right split: the schema is a wire contract, and the cap
 * on how much transcript the service will accept is a policy the service applies
 * after validation, because it is configuration (`ASSISTANT_MAX_TURNS`,
 * `ASSISTANT_MAX_CHARS`) rather than contract.
 */
export const ASSISTANT_SCHEMA_IDS = {
  message: schemaId('assistant/AssistantMessage'),
  reference: schemaId('assistant/AssistantReference'),
  turnRequest: schemaId('msg/assistant/turnRequest'),
  turnResponse: schemaId('msg/assistant/turnResponse'),
  transcribeRequest: schemaId('msg/assistant/transcribeRequest'),
  transcribeResponse: schemaId('msg/assistant/transcribeResponse'),
} as const;

const assistantMessage = object(
  ASSISTANT_SCHEMA_IDS.message,
  {
    role: ref(ENUM_IDS.assistantRole),
    content: string(),
  },
  ['role', 'content']
);

const assistantReference = object(
  ASSISTANT_SCHEMA_IDS.reference,
  {
    kind: ref(ENUM_IDS.assistantReferenceKind),
    zoneId: nonEmptyString(),
    listId: nullableString(),
    lineId: nullableString(),
    label: string(),
  },
  ['kind', 'zoneId', 'listId', 'lineId', 'label']
);

const turnRequest = object(
  ASSISTANT_SCHEMA_IDS.turnRequest,
  {
    userId: nonEmptyString(),
    // The caller's own header, forwarded verbatim (rule A1). It is required
    // rather than optional because a turn with no credential has nothing it
    // could legitimately do: the service holds no account of its own to fall
    // back on, which is the whole point.
    authorization: nonEmptyString(),
    transcript: array(ref(ASSISTANT_SCHEMA_IDS.message)),
    message: nonEmptyString(),
  },
  ['userId', 'authorization', 'transcript', 'message']
);

const turnResponse = object(
  ASSISTANT_SCHEMA_IDS.turnResponse,
  {
    reply: string(),
    references: array(ref(ASSISTANT_SCHEMA_IDS.reference)),
    listResolution: ref(ENUM_IDS.listResolutionBranch),
  },
  ['reply', 'references']
);

/**
 * Words out of a recording (plan 0041, section 3.2).
 *
 * No `userId` and no `authorization`, and their absence is the contract: nothing
 * is being read on anybody's behalf, so there is nothing for rule A1 to enforce
 * and no credential this call could need.
 */
const transcribeRequest = object(
  ASSISTANT_SCHEMA_IDS.transcribeRequest,
  {
    // Base64. Non-empty, because a transcription of nothing is a caller bug
    // rather than a state worth answering.
    audio: nonEmptyString(),
    mimeType: nonEmptyString(),
    locale: nonEmptyString(),
  },
  ['audio', 'mimeType', 'locale']
);

// `text` and not `nonEmptyString`: an empty transcript is the honest answer when
// the provider heard nothing, and the caller records that rather than retrying.
const transcribeResponse = object(
  ASSISTANT_SCHEMA_IDS.transcribeResponse,
  { text: string() },
  ['text']
);

export const assistantSchemas: JsonSchema[] = [
  assistantMessage,
  assistantReference,
  turnRequest,
  turnResponse,
  transcribeRequest,
  transcribeResponse,
];

export const assistantMessageContracts: Record<
  string,
  { request: string; response: string }
> = {
  [ASSISTANT_PATTERNS.turn]: {
    request: ASSISTANT_SCHEMA_IDS.turnRequest,
    response: ASSISTANT_SCHEMA_IDS.turnResponse,
  },
  [ASSISTANT_PATTERNS.transcribe]: {
    request: ASSISTANT_SCHEMA_IDS.transcribeRequest,
    response: ASSISTANT_SCHEMA_IDS.transcribeResponse,
  },
};
