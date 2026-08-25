import Ajv, { ErrorObject, ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import {
  allSchemas,
  eventSchemaId,
  messageRequestSchemaId,
  messageResponseSchemaId,
} from './registry';

/**
 * A single Ajv instance loaded with every contract schema; a service validates
 * inbound and outbound NATS payloads against it in tests (plan 0010, section 2.1)
 * and optionally at runtime in development. `strict: false` because the schemas
 * use the `format` keyword (via ajv-formats) and nullable unions.
 */
export function createContractsAjv(): Ajv {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  ajv.addSchema(allSchemas);
  return ajv;
}

let cached: Ajv | undefined;

/** A lazily built, shared instance for the common case. */
export function getContractsAjv(): Ajv {
  return (cached ??= createContractsAjv());
}

export interface ValidationResult {
  valid: boolean;
  errors: ErrorObject[];
}

export function validateSchema(
  id: string,
  data: unknown,
  ajv: Ajv = getContractsAjv()
): ValidationResult {
  const validate = ajv.getSchema(id) as ValidateFunction | undefined;
  if (!validate) {
    throw new Error(`No schema registered for id ${id}`);
  }
  const valid = validate(data) === true;
  return { valid, errors: validate.errors ?? [] };
}

export const validateMessageRequest = (
  subject: string,
  data: unknown,
  ajv?: Ajv
): ValidationResult =>
  validateSchema(messageRequestSchemaId(subject), data, ajv);

export const validateMessageResponse = (
  subject: string,
  data: unknown,
  ajv?: Ajv
): ValidationResult =>
  validateSchema(messageResponseSchemaId(subject), data, ajv);

export const validateEvent = (
  eventName: string,
  data: unknown,
  ajv?: Ajv
): ValidationResult => validateSchema(eventSchemaId(eventName), data, ajv);

/** Throws with the Ajv errors when invalid; for use as a runtime guard. */
export function assertValid(id: string, data: unknown, ajv?: Ajv): void {
  const { valid, errors } = validateSchema(id, data, ajv);
  if (!valid) {
    throw new Error(`Payload failed schema ${id}: ${JSON.stringify(errors)}`);
  }
}
