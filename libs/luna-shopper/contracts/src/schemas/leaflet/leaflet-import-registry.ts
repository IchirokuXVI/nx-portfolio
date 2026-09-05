import {
  LEAFLET_IMPORT_1_0_SCHEMA_ID,
  LEAFLET_IMPORT_1_0_VERSION,
} from './leaflet-import-1.0.schema';

/**
 * Every leaflet import schema version this backend can read, by the
 * `schema_version` a document names (plan 0081, section 4).
 *
 * A new version is a new file, a new `$id` and one more entry here. The gateway
 * accepts every version the harvester can read, which is what this map says, and
 * both validate against the same object.
 *
 * Its own file rather than the folder's barrel, so the validator can import it
 * without pulling the schema objects into a cycle through that barrel.
 */
export const LEAFLET_IMPORT_SCHEMA_IDS: Record<string, string> = {
  [LEAFLET_IMPORT_1_0_VERSION]: LEAFLET_IMPORT_1_0_SCHEMA_ID,
};

/** The versions a document may name, for an error message that lists them. */
export const LEAFLET_IMPORT_VERSIONS = Object.keys(LEAFLET_IMPORT_SCHEMA_IDS);

/**
 * The schema id for a document's `schema_version`, or undefined when nothing
 * here can read it. Undefined is an answer the caller reports; it is never a
 * reason to fall back to the newest schema, which would validate a document
 * against a shape it was not written for.
 */
export function leafletImportSchemaId(
  schemaVersion: unknown
): string | undefined {
  return typeof schemaVersion === 'string'
    ? LEAFLET_IMPORT_SCHEMA_IDS[schemaVersion]
    : undefined;
}
