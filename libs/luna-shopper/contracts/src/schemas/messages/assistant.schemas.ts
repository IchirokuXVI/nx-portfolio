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
  voiceRequest: schemaId('msg/assistant/voiceRequest'),
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

/**
 * A spoken turn (plan 0041).
 *
 * The same split as above: the schema says the audio is a base64 string and says
 * nothing about how long it may be, because the byte cap is
 * `ASSISTANT_AUDIO_MAX_BYTES` and the accepted containers are
 * `ASSISTANT_AUDIO_MIME_TYPES`. Both are configuration a deployment sets, not a
 * contract two services agree on, and putting either here would mean a chart
 * value could not change without a schema release.
 *
 * There is no `message`, and its absence is the whole shape of the thing: what
 * the caller said is inside the recording and nobody knows it yet.
 */
const voiceRequest = object(
  ASSISTANT_SCHEMA_IDS.voiceRequest,
  {
    userId: nonEmptyString(),
    authorization: nonEmptyString(),
    transcript: array(ref(ASSISTANT_SCHEMA_IDS.message)),
    audio: nonEmptyString(),
    mimeType: nonEmptyString(),
  },
  ['userId', 'authorization', 'transcript', 'audio', 'mimeType']
);

const turnResponse = object(
  ASSISTANT_SCHEMA_IDS.turnResponse,
  {
    reply: string(),
    references: array(ref(ASSISTANT_SCHEMA_IDS.reference)),
    listResolution: ref(ENUM_IDS.listResolutionBranch),
    // Present on a spoken turn and absent on every typed one, so it is optional
    // here and both subjects can answer with the same schema (plan 0041).
    heard: string(),
  },
  ['reply', 'references']
);

export const assistantSchemas: JsonSchema[] = [
  assistantMessage,
  assistantReference,
  turnRequest,
  voiceRequest,
  turnResponse,
];

export const assistantMessageContracts: Record<
  string,
  { request: string; response: string }
> = {
  [ASSISTANT_PATTERNS.turn]: {
    request: ASSISTANT_SCHEMA_IDS.turnRequest,
    response: ASSISTANT_SCHEMA_IDS.turnResponse,
  },
  // The same response, deliberately: a spoken turn answers with what a typed one
  // answers plus `heard`, and there is no second reply shape to keep in step.
  [ASSISTANT_PATTERNS.voice]: {
    request: ASSISTANT_SCHEMA_IDS.voiceRequest,
    response: ASSISTANT_SCHEMA_IDS.turnResponse,
  },
};
