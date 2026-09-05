/**
 * TEMPORARY. The real `HarvestDocument` is plan 0086 section 6.1's file schema
 * and lives under `schemas/harvest-document/`, beside its JSON schema, its
 * validator and its fixtures. This placeholder exists only so the message
 * contracts that carry a document can be written before that directory lands,
 * and it is deleted the moment it does: this file has no other reader.
 *
 * Do not add fields here. A shape the JSON schema does not describe is a gap in
 * the schema, and stating one here would be a second copy to drift from it.
 */
export type HarvestDocument = Record<string, unknown>;
