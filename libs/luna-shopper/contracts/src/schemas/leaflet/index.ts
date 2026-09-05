import type { JsonSchema } from '../builders';
import { leafletImport10Schema } from './leaflet-import-1.0.schema';

export * from './leaflet-document';
export {
  LEAFLET_IMPORT_1_0_SCHEMA_ID,
  LEAFLET_IMPORT_1_0_VERSION,
  leafletImport10Schema,
} from './leaflet-import-1.0.schema';
export {
  LEAFLET_IMPORT_SCHEMA_IDS,
  LEAFLET_IMPORT_VERSIONS,
  leafletImportSchemaId,
} from './leaflet-import-registry';
export { validateLeafletDocument } from './leaflet-validation';
export type {
  LeafletValidationFailure,
  LeafletValidationResult,
} from './leaflet-validation';

/** Registered into the shared Ajv instance beside the message schemas. */
export const leafletSchemas: JsonSchema[] = [leafletImport10Schema];
