import {
  HARVEST_DOCUMENT_1_SCHEMA_ID,
  HARVEST_DOCUMENT_1_VERSION,
} from './harvest-document-1.schema';

/**
 * Every file import schema version this backend can read, by the
 * `schema_version` a document names (plan 0086, section 6.1).
 *
 * A new version is a new file, a new `$id` and one more entry here. The gateway
 * accepts every version the harvester can read, which is what this map says, and
 * both validate against the same object.
 *
 * Its own file rather than the folder's barrel, so the validator can import it
 * without pulling the schema objects into a cycle through that barrel.
 */
export const HARVEST_DOCUMENT_SCHEMA_IDS: Record<number, string> = {
  [HARVEST_DOCUMENT_1_VERSION]: HARVEST_DOCUMENT_1_SCHEMA_ID,
};

/** The versions a document may name, for an error message that lists them. */
export const HARVEST_DOCUMENT_VERSIONS: number[] = Object.keys(
  HARVEST_DOCUMENT_SCHEMA_IDS
).map(Number);

/**
 * The schema id for a document's `schema_version`, or undefined when nothing
 * here can read it.
 *
 * Undefined is an answer the caller reports; it is never a reason to fall back
 * to the newest schema, which would validate a document against a shape it was
 * not written for.
 *
 * **The version is an integer**, so `"1"` is not `1`. A string is refused rather
 * than coerced: a producer that writes the version as text has a bug the first
 * import should name, not one the fiftieth discovers.
 */
export function harvestDocumentSchemaId(
  schemaVersion: unknown
): string | undefined {
  return typeof schemaVersion === 'number' &&
    Number.isInteger(schemaVersion) &&
    schemaVersion in HARVEST_DOCUMENT_SCHEMA_IDS
    ? HARVEST_DOCUMENT_SCHEMA_IDS[schemaVersion]
    : undefined;
}
