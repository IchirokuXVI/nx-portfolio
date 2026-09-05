/**
 * TEMPORARY. The real `HarvestDocument` is plan 0086 section 6.1's file schema
 * and lives under `schemas/harvest-document/`, beside its JSON schema, its
 * validator and its fixtures. This file exists only so the message contracts and
 * the gateway route that carry a document could be written before that directory
 * landed, and it is deleted the moment it does: nothing else reads it.
 *
 * Do not add fields to the type. A shape the JSON schema does not describe is a
 * gap in the schema, and stating one here would be a second copy to drift.
 */
export type HarvestDocument = Record<string, unknown>;

/** Where a document failed the schema, and which product it was about. */
export interface HarvestDocumentValidationFailure {
  /** The JSON path the failure is at, e.g. `/products/3/price/currency`. */
  path: string;
  message: string;
  /** The product's own `id`, where the path falls inside one. */
  productId: string | null;
}

export interface HarvestDocumentValidationResult {
  valid: boolean;
  failures: HarvestDocumentValidationFailure[];
}

/** The schema versions this backend can read. */
export const HARVEST_DOCUMENT_VERSIONS = [1] as const;

/**
 * Validate an uploaded file, in the one place both readers share.
 *
 * **Validation runs twice**: the gateway validates before the document crosses
 * the broker and answers a 400 listing every failure by JSON path, and the
 * harvester validates again at run start because it owns the schema version and
 * a broker message is not a trusted input. Two callers, one function, so the two
 * cannot disagree about what a file is.
 *
 * It throws nothing. The gateway turns failures into a problem document and the
 * harvester into a `ValidationException`, and neither shape belongs in a library
 * that only knows what the schema says.
 *
 * **This implementation checks the four things a document cannot be read
 * without**, and the JSON schema replaces it with the full field by field check.
 * It is deliberately not permissive: a placeholder that accepted anything would
 * be a hole if it ever shipped.
 */
export function validateHarvestDocument(
  value: unknown
): HarvestDocumentValidationResult {
  const failures: HarvestDocumentValidationFailure[] = [];
  const fail = (path: string, message: string) =>
    failures.push({ path, message, productId: null });

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('/', 'must be an object');
    return { valid: false, failures };
  }
  const document = value as Record<string, unknown>;

  const version = document['schema_version'];
  if (!HARVEST_DOCUMENT_VERSIONS.includes(version as 1)) {
    fail(
      '/schema_version',
      `this backend cannot read schema_version ${JSON.stringify(version)}; ` +
        `it reads ${HARVEST_DOCUMENT_VERSIONS.join(', ')}`
    );
  }
  if (typeof document['sha256'] !== 'string' || !document['sha256']) {
    fail(
      '/sha256',
      'is required: it is what a second import of one file is refused by'
    );
  }

  const products = document['products'];
  if (!Array.isArray(products) || products.length === 0) {
    fail(
      '/products',
      'must hold at least one product, or there is nothing to run'
    );
    return { valid: failures.length === 0, failures };
  }
  products.forEach((product, index) => {
    const at = `/products/${index}`;
    if (typeof product !== 'object' || product === null) {
      fail(at, 'must be an object');
      return;
    }
    const row = product as Record<string, unknown>;
    const productId = typeof row['id'] === 'string' ? row['id'] : null;
    if (typeof row['name'] !== 'string' || !row['name'].trim()) {
      failures.push({
        path: `${at}/name`,
        message:
          'is required: it is the row and, for a product with no id, the key',
        productId,
      });
    }
    const price = row['price'];
    if (price !== undefined && price !== null) {
      const bag = price as Record<string, unknown>;
      if (typeof bag['amount'] !== 'number') {
        failures.push({
          path: `${at}/price/amount`,
          message: 'is required inside a price',
          productId,
        });
      }
      if (typeof bag['currency'] !== 'string' || !bag['currency']) {
        failures.push({
          path: `${at}/price/currency`,
          message: 'is required inside a price',
          productId,
        });
      }
    }
  });

  return { valid: failures.length === 0, failures };
}
