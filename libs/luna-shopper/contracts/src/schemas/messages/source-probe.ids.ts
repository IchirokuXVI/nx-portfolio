import { schemaId } from '../builders';

/**
 * The schema ids of plan 0219, in a file of their own that imports nothing
 * but the builders. `harvest.schemas.ts` refers to the probe summary for the
 * source view, and `source-probe.schemas.ts` refers to the harvest enums, so
 * the ids live here and neither schema file imports the other's table.
 */
export const SOURCE_PROBE_SCHEMA_IDS = {
  sourceProbeStatus: schemaId('enums/SourceProbeStatus'),
  sourceProbeStepView: schemaId('harvest/SourceProbeStepView'),
  sourceProbeView: schemaId('harvest/SourceProbeView'),
  sourceProbeSummary: schemaId('harvest/SourceProbeSummary'),
  sourceProbePage: schemaId('harvest/SourceProbePage'),
  startSourceProbeRequest: schemaId('msg/sourceProbe.start/request'),
  listSourceProbesRequest: schemaId('msg/sourceProbe.list/request'),
  sourceProbeIdRequest: schemaId('msg/sourceProbe.get/request'),
} as const;
