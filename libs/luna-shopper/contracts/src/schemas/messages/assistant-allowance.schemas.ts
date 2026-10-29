import { ASSISTANT_ALLOWANCE_PATTERNS } from '../../lib/messages/assistant-allowance.messages';
import {
  boolean,
  integer,
  JsonSchema,
  nonEmptyString,
  object,
  ref,
  schemaId,
} from '../builders';
import { ENUM_IDS } from '../enums.schemas';
import { ASSISTANT_SCHEMA_IDS } from './assistant.schemas';

/**
 * Core's three allowance subjects (plan 0234, section 5). The assistant is the
 * only caller. Every amount is a whole number: seconds, turns, tokens, or micro
 * dollars, which is why money is an `integer` here and never a `number`.
 */
export const ASSISTANT_ALLOWANCE_SCHEMA_IDS = {
  limits: schemaId('core/AllowanceLimits'),
  refusal: schemaId('core/AllowanceRefusal'),
  reserveRequest: schemaId('msg/assistantAllowance.reserve/request'),
  reserveResponse: schemaId('msg/assistantAllowance.reserve/response'),
  settleRequest: schemaId('msg/assistantAllowance.settle/request'),
  settleResponse: schemaId('msg/assistantAllowance.settle/response'),
  readRequest: schemaId('msg/assistantAllowance.read/request'),
} as const;

const count = () => integer({ minimum: 0 });
const positive = () => integer({ minimum: 1 });

const limits = object(
  ASSISTANT_ALLOWANCE_SCHEMA_IDS.limits,
  {
    turnsPerDay: positive(),
    turnsPerMonth: positive(),
    assistantAudioSecondsPerDay: positive(),
    assistantAudioSecondsPerMonth: positive(),
    commentAudioSecondsPerDay: positive(),
    commentAudioSecondsPerMonth: positive(),
    costPerDayMicroUsd: positive(),
    costPerMonthMicroUsd: positive(),
    deploymentCostPerDayMicroUsd: positive(),
    deploymentCostPerMonthMicroUsd: positive(),
  },
  [
    'turnsPerDay',
    'turnsPerMonth',
    'assistantAudioSecondsPerDay',
    'assistantAudioSecondsPerMonth',
    'commentAudioSecondsPerDay',
    'commentAudioSecondsPerMonth',
    'costPerDayMicroUsd',
    'costPerMonthMicroUsd',
    'deploymentCostPerDayMicroUsd',
    'deploymentCostPerMonthMicroUsd',
  ]
);

const refusal = object(
  ASSISTANT_ALLOWANCE_SCHEMA_IDS.refusal,
  {
    scope: ref(ENUM_IDS.allowanceScope),
    period: ref(ENUM_IDS.allowancePeriod),
    limit: ref(ENUM_IDS.allowanceLimit),
    resetsAt: nonEmptyString({ format: 'date-time' }),
  },
  ['scope', 'period', 'limit', 'resetsAt']
);

const reserveRequest = object(
  ASSISTANT_ALLOWANCE_SCHEMA_IDS.reserveRequest,
  {
    userId: nonEmptyString(),
    purpose: ref(ENUM_IDS.allowancePurpose),
    audioSeconds: count(),
    microUsd: count(),
    limits: ref(ASSISTANT_ALLOWANCE_SCHEMA_IDS.limits),
    timezone: nonEmptyString(),
    holdSeconds: positive(),
  },
  [
    'userId',
    'purpose',
    'audioSeconds',
    'microUsd',
    'limits',
    'timezone',
    'holdSeconds',
  ]
);

const reserveResponse = object(
  ASSISTANT_ALLOWANCE_SCHEMA_IDS.reserveResponse,
  {
    outcome: ref(ENUM_IDS.allowanceReserveOutcome),
    reservationId: { type: ['string', 'null'] },
    refused: {
      oneOf: [ref(ASSISTANT_ALLOWANCE_SCHEMA_IDS.refusal), { type: 'null' }],
    },
  },
  ['outcome', 'reservationId', 'refused']
);

const settleRequest = object(
  ASSISTANT_ALLOWANCE_SCHEMA_IDS.settleRequest,
  {
    reservationId: nonEmptyString(),
    userId: nonEmptyString(),
    purpose: ref(ENUM_IDS.allowancePurpose),
    timezone: nonEmptyString(),
    turns: count(),
    audioSeconds: count(),
    microUsd: count(),
    promptTokens: count(),
    responseTokens: count(),
    cachedPromptTokens: count(),
  },
  [
    'reservationId',
    'userId',
    'purpose',
    'timezone',
    'turns',
    'audioSeconds',
    'microUsd',
    'promptTokens',
    'responseTokens',
    'cachedPromptTokens',
  ]
);

const settleResponse = object(
  ASSISTANT_ALLOWANCE_SCHEMA_IDS.settleResponse,
  { found: boolean() },
  ['found']
);

const readRequest = object(
  ASSISTANT_ALLOWANCE_SCHEMA_IDS.readRequest,
  {
    userId: nonEmptyString(),
    limits: ref(ASSISTANT_ALLOWANCE_SCHEMA_IDS.limits),
    timezone: nonEmptyString(),
    turnReserveMicroUsd: positive(),
  },
  ['userId', 'limits', 'timezone', 'turnReserveMicroUsd']
);

export const assistantAllowanceSchemas: JsonSchema[] = [
  limits,
  refusal,
  reserveRequest,
  reserveResponse,
  settleRequest,
  settleResponse,
  readRequest,
];

export const assistantAllowanceMessageContracts: Record<
  string,
  { request: string; response: string }
> = {
  [ASSISTANT_ALLOWANCE_PATTERNS.reserve]: {
    request: ASSISTANT_ALLOWANCE_SCHEMA_IDS.reserveRequest,
    response: ASSISTANT_ALLOWANCE_SCHEMA_IDS.reserveResponse,
  },
  [ASSISTANT_ALLOWANCE_PATTERNS.settle]: {
    request: ASSISTANT_ALLOWANCE_SCHEMA_IDS.settleRequest,
    response: ASSISTANT_ALLOWANCE_SCHEMA_IDS.settleResponse,
  },
  // The same view the gateway answers: the assistant passes it through.
  [ASSISTANT_ALLOWANCE_PATTERNS.read]: {
    request: ASSISTANT_ALLOWANCE_SCHEMA_IDS.readRequest,
    response: ASSISTANT_SCHEMA_IDS.allowanceView,
  },
};
