import {
  boolean,
  integer,
  JsonSchema,
  nonEmptyString,
  nullableString,
  object,
  ref,
  schemaId,
} from '../builders';
import { ENUM_IDS } from '../enums.schemas';

/**
 * What a deployment states about itself for its legal documents (plan 0231,
 * section 2). The gateway composes it from its own configuration and the
 * assistant's answer, so it belongs to no subject and is documented with
 * `ApiComposedResponse`.
 */
export const LEGAL_SCHEMA_IDS = {
  legalSettingsView: schemaId('gateway/LegalSettingsView'),
} as const;

/**
 * A nested, strict block with every property required. Every field of the
 * view is always present, null where a value is absent, so a client never
 * has to tell a missing key from a null one.
 */
function block(properties: Record<string, JsonSchema>): JsonSchema {
  return {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

const days = () => integer({ minimum: 0 });

const properties: Record<string, JsonSchema> = {
  appName: nonEmptyString(),
  controllerName: nullableString(),
  contactEmail: nullableString(),
  published: boolean(),
  terms: block({
    version: nonEmptyString(),
    updatedOn: nonEmptyString(),
    acceptanceRequired: boolean(),
  }),
  privacy: block({ updatedOn: nonEmptyString() }),
  features: block({
    googleSignIn: boolean(),
    assistant: boolean(),
    transcription: boolean(),
    offsiteBackups: boolean(),
    supportAccess: boolean(),
  }),
  processors: block({
    hosting: nullableString(),
    email: nullableString(),
    aiText: { anyOf: [ref(ENUM_IDS.aiTextProvider), { type: 'null' }] },
    offsiteBackups: nullableString(),
  }),
  retention: block({
    auditTrailDays: days(),
    adminLoginFailureDays: days(),
    expiredGrantDays: days(),
    applicationLogDays: days(),
    assistantLogDays: days(),
    backupDays: { type: ['integer', 'null'], minimum: 0 },
  }),
};

const legalSettingsView = object(
  LEGAL_SCHEMA_IDS.legalSettingsView,
  properties,
  Object.keys(properties)
);

export const legalSchemas: JsonSchema[] = [legalSettingsView];
