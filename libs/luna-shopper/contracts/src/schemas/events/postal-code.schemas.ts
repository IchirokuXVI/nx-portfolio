import { POSTAL_CODE_EVENTS } from '../../lib/events/postal-code.events';
import {
  array,
  JsonSchema,
  nonEmptyString,
  object,
  schemaId,
} from '../builders';

/**
 * The announcement core makes after writing postal codes (plan 0062, section 5),
 * which plan `0063` turns into discovery runs.
 *
 * A schema for an event nothing consumes yet, on purpose: the payload is the
 * contract between two services written weeks apart, and writing it down now is
 * what stops the second one guessing.
 */
export const POSTAL_CODE_EVENT_SCHEMA_IDS = {
  postalCodesAdded: schemaId('event/postalCode.added'),
} as const;

const postalCodesAdded = object(
  POSTAL_CODE_EVENT_SCHEMA_IDS.postalCodesAdded,
  {
    country: nonEmptyString({ maxLength: 2 }),
    postalCodes: array(nonEmptyString()),
  },
  ['country', 'postalCodes']
);

export const postalCodeEventSchemas: JsonSchema[] = [postalCodesAdded];

/** event name -> payload schema id. */
export const postalCodeEventContracts: Record<string, string> = {
  [POSTAL_CODE_EVENTS.postalCodesAdded]:
    POSTAL_CODE_EVENT_SCHEMA_IDS.postalCodesAdded,
};
