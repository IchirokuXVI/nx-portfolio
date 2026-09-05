import type { ErrorObject } from 'ajv';
import { validateSchema } from '../validator';
import {
  HARVEST_DOCUMENT_VERSIONS,
  harvestDocumentSchemaId,
} from './harvest-document-registry';

/**
 * Validating an uploaded file, in the one place both readers share (plan 0086,
 * section 6.1).
 *
 * **Validation runs twice**: the gateway validates before the document crosses
 * the broker and answers a 400 listing every failure by JSON path, and the
 * harvester validates again at the spawn because it owns the schema version and
 * a broker message is not a trusted input. Two callers, one function, so the two
 * cannot disagree about what a file is.
 *
 * It throws nothing. The gateway turns failures into a problem document and the
 * harvester into a `ValidationException`, and neither shape belongs in a library
 * that only knows what the schema says.
 */

export interface HarvestDocumentValidationFailure {
  /**
   * The JSON path the failure is at, e.g. `/products/3/price/currency`.
   *
   * **A missing required property is reported at its own path**, not at the
   * object that should have held it. Ajv reports `required` against the parent
   * and names the property in `params`, so a document with no `products` reads
   * as a failure at `""`, which tells an operator nothing. The property is
   * appended here so every failure, missing or malformed, names one field.
   */
  path: string;
  message: string;
  /**
   * The product's own `id`, when the path falls inside a product that carries
   * one. Null otherwise, and {@link productIndex} names it then.
   */
  productId: string | null;
  /** The product's position in `products`, when the path falls inside one. */
  productIndex: number | null;
}

export interface HarvestDocumentValidationResult {
  valid: boolean;
  failures: HarvestDocumentValidationFailure[];
}

/**
 * Validate a value against the schema version **it names**, never against the
 * newest one: a document written for a version this backend cannot read is
 * refused by name rather than checked against a shape it was not written for.
 */
export function validateHarvestDocument(
  value: unknown
): HarvestDocumentValidationResult {
  const version = (value as { schema_version?: unknown } | null)
    ?.schema_version;
  const schemaId = harvestDocumentSchemaId(version);
  if (!schemaId) {
    return {
      valid: false,
      failures: [
        {
          path: '/schema_version',
          productId: null,
          productIndex: null,
          message:
            `this backend cannot read schema_version ${describe(version)}; ` +
            `it reads ${HARVEST_DOCUMENT_VERSIONS.join(', ')}`,
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

/**
 * The product a path falls under, so a failure names the product rather than an
 * index nobody can look up. The index is answered too, because a hand written
 * file may give no `id` at all and a position is then the only handle.
 */
function describeFailure(
  error: ErrorObject,
  document: unknown
): HarvestDocumentValidationFailure {
  const missing = (error.params as { missingProperty?: unknown } | undefined)
    ?.missingProperty;
  const path =
    error.keyword === 'required' && typeof missing === 'string'
      ? `${error.instancePath}/${missing}`
      : error.instancePath;
  const match = /^\/products\/(\d+)/.exec(path);
  const products = (document as { products?: unknown[] } | null)?.products;
  if (!match) {
    return {
      path,
      productId: null,
      productIndex: null,
      message: error.message ?? 'is not valid',
    };
  }
  const index = Number(match[1]);
  const found = Array.isArray(products) ? products[index] : undefined;
  const id = (found as { id?: unknown } | undefined)?.id;
  return {
    path,
    productId: typeof id === 'string' ? id : null,
    productIndex: index,
    message: error.message ?? 'is not valid',
  };
}

function describe(version: unknown): string {
  return typeof version === 'string' ? `"${version}"` : String(version);
}
