import type { JsonSchema } from '../builders';
import { harvestDocument1Schema } from './harvest-document-1.schema';

export * from './harvest-document';
export {
  HARVEST_DOCUMENT_1_SCHEMA_ID,
  HARVEST_DOCUMENT_1_VERSION,
  harvestDocument1Schema,
} from './harvest-document-1.schema';
export {
  HARVEST_DOCUMENT_SCHEMA_IDS,
  HARVEST_DOCUMENT_VERSIONS,
  harvestDocumentSchemaId,
} from './harvest-document-registry';
export { validateHarvestDocument } from './harvest-document-validation';
export type {
  HarvestDocumentValidationFailure,
  HarvestDocumentValidationResult,
} from './harvest-document-validation';

/** Registered into the shared Ajv instance beside the message schemas. */
export const harvestDocumentSchemas: JsonSchema[] = [harvestDocument1Schema];
