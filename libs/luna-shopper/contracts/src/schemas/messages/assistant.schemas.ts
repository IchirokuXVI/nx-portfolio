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
  listLink: schemaId('assistant/AssistantListLink'),
  choice: schemaId('assistant/AssistantChoice'),
  turnRequest: schemaId('msg/assistant/turnRequest'),
  turnResponse: schemaId('msg/assistant/turnResponse'),
  voiceRequest: schemaId('msg/assistant/voiceRequest'),
  turnScope: schemaId('assistant/TurnScope'),
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

/**
 * The one place an answer can send somebody (plan 0046, section 2).
 *
 * Always a list, so there is no `kind` to branch on and no `lineId`: a chip for a
 * line and a chip for its list led to the same screen. `zoneLabel` is null when
 * the caller has one zone, which is the only condition the client has to render
 * and none it has to compute.
 */
const assistantListLink = object(
  ASSISTANT_SCHEMA_IDS.listLink,
  {
    zoneId: nonEmptyString(),
    listId: nonEmptyString(),
    label: string(),
    zoneLabel: nullableString(),
  },
  ['zoneId', 'listId', 'label', 'zoneLabel']
);

/**
 * One answer to the question a turn ended with (plan 0046, section 4).
 *
 * `message` is what the client sends back as an ordinary typed turn, so a tapped
 * chip is indistinguishable from somebody answering the question in words. It is
 * separate from `label` because the two diverge as soon as a choice is not a list
 * name, and changing the wire later for that would be a release nobody needs.
 */
const assistantChoice = object(
  ASSISTANT_SCHEMA_IDS.choice,
  {
    label: nonEmptyString(),
    message: nonEmptyString(),
  },
  ['label', 'message']
);

/**
 * The one list a scoped turn may touch (plan 0044).
 *
 * Both ids required together: a zone with no list, or a list with no zone, is
 * not a narrower scope but an ambiguous one, and the service would have to
 * decide what it meant.
 */
const turnScope = object(
  ASSISTANT_SCHEMA_IDS.turnScope,
  {
    zoneId: nonEmptyString(),
    listId: nonEmptyString(),
  },
  ['zoneId', 'listId']
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
    // Optional, and its absence is the unscoped turn plan 0039 built.
    scope: ref(ASSISTANT_SCHEMA_IDS.turnScope),
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
    scope: ref(ASSISTANT_SCHEMA_IDS.turnScope),
  },
  ['userId', 'authorization', 'transcript', 'audio', 'mimeType']
);

const turnResponse = object(
  ASSISTANT_SCHEMA_IDS.turnResponse,
  {
    reply: string(),
    // Nullable rather than optional, and an empty array rather than an absent
    // one: a reader should never have to work out whether missing and empty are
    // the same thing (plan 0046, section 7).
    link: {
      oneOf: [ref(ASSISTANT_SCHEMA_IDS.listLink), { type: 'null' }],
    },
    choices: array(ref(ASSISTANT_SCHEMA_IDS.choice)),
    listResolution: ref(ENUM_IDS.listResolutionBranch),
    // Present on a spoken turn and absent on every typed one, so it is optional
    // here and both subjects can answer with the same schema (plan 0041).
    heard: string(),
  },
  ['reply', 'link', 'choices']
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
  assistantListLink,
  assistantChoice,
  turnScope,
  turnRequest,
  voiceRequest,
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
  // The same response, deliberately: a spoken turn answers with what a typed one
  // answers plus `heard`, and there is no second reply shape to keep in step.
  [ASSISTANT_PATTERNS.voice]: {
    request: ASSISTANT_SCHEMA_IDS.voiceRequest,
    response: ASSISTANT_SCHEMA_IDS.turnResponse,
  },
  // A transcription answers words and nothing else, which is why it has a reply
  // shape of its own rather than borrowing the turn's.
  [ASSISTANT_PATTERNS.transcribe]: {
    request: ASSISTANT_SCHEMA_IDS.transcribeRequest,
    response: ASSISTANT_SCHEMA_IDS.transcribeResponse,
  },
};
