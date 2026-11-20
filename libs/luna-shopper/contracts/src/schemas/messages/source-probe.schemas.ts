import { SourceProbeStatus } from '../../lib/enums/source-probe.enums';
import { SOURCE_PROBE_PATTERNS } from '../../lib/messages/source-probe.messages';
import {
  array,
  boolean,
  enumOf,
  integer,
  JsonSchema,
  nonEmptyString,
  nullableString,
  object,
  paginated,
  ref,
  string,
} from '../builders';
import { adminCredentialProperties } from '../common.schemas';
import { HARVEST_SCHEMA_IDS } from './harvest.schemas';
import { SOURCE_PROBE_SCHEMA_IDS } from './source-probe.ids';

/** The schemas of plan 0219: a probe per chain checks the storefront shape. */

const sourceProbeStepView = object(
  SOURCE_PROBE_SCHEMA_IDS.sourceProbeStepView,
  {
    name: nonEmptyString(),
    url: nullableString(),
    ok: boolean(),
    httpStatus: { type: ['integer', 'null'] },
    error: nullableString(),
    problems: array(string()),
    sample: {
      type: 'object',
      additionalProperties: { type: ['string', 'number', 'boolean', 'null'] },
    },
    durationMs: integer({ minimum: 0 }),
  },
  [
    'name',
    'url',
    'ok',
    'httpStatus',
    'error',
    'problems',
    'sample',
    'durationMs',
  ]
);

const sourceProbeView = object(
  SOURCE_PROBE_SCHEMA_IDS.sourceProbeView,
  {
    id: nonEmptyString(),
    sourceId: nonEmptyString(),
    supermarketId: nonEmptyString(),
    adapterKey: ref(HARVEST_SCHEMA_IDS.adapterKey),
    trigger: ref(HARVEST_SCHEMA_IDS.harvestRunTrigger),
    status: ref(SOURCE_PROBE_SCHEMA_IDS.sourceProbeStatus),
    previousStatus: {
      anyOf: [ref(SOURCE_PROBE_SCHEMA_IDS.sourceProbeStatus), { type: 'null' }],
    },
    changed: boolean(),
    attempt: integer({ minimum: 1, maximum: 3 }),
    startedAt: string({ format: 'date-time' }),
    finishedAt: nullableString(),
    durationMs: { type: ['integer', 'null'], minimum: 0 },
    requests: integer({ minimum: 0 }),
    steps: array(ref(SOURCE_PROBE_SCHEMA_IDS.sourceProbeStepView)),
    error: nullableString(),
    requestedByUserId: nullableString(),
    scheduleId: {
      ...nullableString(),
      description:
        'The schedule whose slot ran this probe as its gate, null for a daily or manual probe.',
    },
  },
  [
    'id',
    'sourceId',
    'supermarketId',
    'adapterKey',
    'trigger',
    'status',
    'previousStatus',
    'changed',
    'attempt',
    'startedAt',
    'finishedAt',
    'durationMs',
    'requests',
    'steps',
    'error',
    'requestedByUserId',
    'scheduleId',
  ]
);

const sourceProbeSummary = object(
  SOURCE_PROBE_SCHEMA_IDS.sourceProbeSummary,
  {
    id: nonEmptyString(),
    status: ref(SOURCE_PROBE_SCHEMA_IDS.sourceProbeStatus),
    startedAt: string({ format: 'date-time' }),
    finishedAt: nullableString(),
    changed: boolean(),
  },
  ['id', 'status', 'startedAt', 'finishedAt', 'changed']
);

const sourceProbePage = paginated(
  SOURCE_PROBE_SCHEMA_IDS.sourceProbePage,
  SOURCE_PROBE_SCHEMA_IDS.sourceProbeView
);

const startSourceProbeRequest = object(
  SOURCE_PROBE_SCHEMA_IDS.startSourceProbeRequest,
  { ...adminCredentialProperties, supermarketId: nonEmptyString() },
  ['userId', 'supermarketId']
);

const listSourceProbesRequest = object(
  SOURCE_PROBE_SCHEMA_IDS.listSourceProbesRequest,
  {
    ...adminCredentialProperties,
    supermarketId: nonEmptyString(),
    cursor: string(),
    limit: integer({ minimum: 1, maximum: 100 }),
  },
  ['userId', 'supermarketId']
);

const sourceProbeIdRequest = object(
  SOURCE_PROBE_SCHEMA_IDS.sourceProbeIdRequest,
  { ...adminCredentialProperties, probeId: nonEmptyString() },
  ['userId', 'probeId']
);

export const sourceProbeSchemas: JsonSchema[] = [
  enumOf(
    SOURCE_PROBE_SCHEMA_IDS.sourceProbeStatus,
    Object.values(SourceProbeStatus)
  ),
  sourceProbeStepView,
  sourceProbeView,
  sourceProbeSummary,
  sourceProbePage,
  startSourceProbeRequest,
  listSourceProbesRequest,
  sourceProbeIdRequest,
];

export const sourceProbeMessageContracts: Record<
  string,
  { request: string; response: string }
> = {
  // The RUNNING row, before the probe ends (section 8).
  [SOURCE_PROBE_PATTERNS.start]: {
    request: SOURCE_PROBE_SCHEMA_IDS.startSourceProbeRequest,
    response: SOURCE_PROBE_SCHEMA_IDS.sourceProbeView,
  },
  [SOURCE_PROBE_PATTERNS.list]: {
    request: SOURCE_PROBE_SCHEMA_IDS.listSourceProbesRequest,
    response: SOURCE_PROBE_SCHEMA_IDS.sourceProbePage,
  },
  [SOURCE_PROBE_PATTERNS.get]: {
    request: SOURCE_PROBE_SCHEMA_IDS.sourceProbeIdRequest,
    response: SOURCE_PROBE_SCHEMA_IDS.sourceProbeView,
  },
};
