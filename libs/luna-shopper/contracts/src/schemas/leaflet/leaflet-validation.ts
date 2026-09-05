import type { ErrorObject } from 'ajv';
import { validateSchema } from '../validator';
import {
  LEAFLET_IMPORT_VERSIONS,
  leafletImportSchemaId,
} from './leaflet-import-registry';

/**
 * Validating an uploaded leaflet, in the one place both readers share (plan
 * 0081, section 4).
 *
 * **Validation runs twice**: the gateway validates before the document crosses
 * the broker and answers a 400 listing every failure by JSON path, and the
 * harvester validates again at run start because it owns the schema version and
 * a broker message is not a trusted input. Two callers, one function, so the two
 * cannot disagree about what a leaflet is.
 *
 * It throws nothing. The gateway turns failures into a problem document and the
 * harvester into a `ValidationException`, and neither shape belongs in a library
 * that only knows what the schema says.
 */

export interface LeafletValidationFailure {
  /** The JSON path the failure is at, e.g. `/offers/3/pricing/price`. */
  path: string;
  message: string;
  /** The offer's own id, where the path falls inside one. */
  offerId: string | null;
}

export interface LeafletValidationResult {
  valid: boolean;
  failures: LeafletValidationFailure[];
}

/**
 * Validate a value against the schema version **it names**, never against the
 * newest one: a document written for a version this backend cannot read is
 * refused by name rather than checked against a shape it was not written for.
 */
export function validateLeafletDocument(
  value: unknown
): LeafletValidationResult {
  const version = (value as { schema_version?: unknown } | null)
    ?.schema_version;
  const schemaId = leafletImportSchemaId(version);
  if (!schemaId) {
    return {
      valid: false,
      failures: [
        {
          path: '/schema_version',
          offerId: null,
          message:
            `this backend cannot read schema_version ${describe(version)}; ` +
            `it reads ${LEAFLET_IMPORT_VERSIONS.join(', ')}`,
        },
      ],
    };
  }

  const { valid, errors } = validateSchema(schemaId, value);
  return {
    valid,
    failures: errors.map((error) => describeFailure(error, value)),
  };
}

/** The offer id a path falls under, so a failure names the tile, not an index. */
function describeFailure(
  error: ErrorObject,
  document: unknown
): LeafletValidationFailure {
  const path = error.instancePath;
  const match = /^\/offers\/(\d+)/.exec(path);
  const offers = (document as { offers?: unknown[] } | null)?.offers;
  const offer =
    match && Array.isArray(offers) ? offers[Number(match[1])] : undefined;
  const offerId = (offer as { id?: unknown } | undefined)?.id;
  return {
    path,
    offerId: typeof offerId === 'string' ? offerId : null,
    message: error.message ?? 'is not valid',
  };
}

function describe(version: unknown): string {
  return typeof version === 'string' ? `"${version}"` : String(version);
}
