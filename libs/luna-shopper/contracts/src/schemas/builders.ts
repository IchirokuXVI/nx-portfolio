/**
 * Tiny helpers for authoring the JSON Schemas that make the Luna Shopper NATS
 * contracts language neutral (plan 0010, section 2.1). They keep the schema
 * objects terse and consistent so a schema stays readable next to the TypeScript
 * interface it mirrors. Everything is plain draft-07 JSON Schema; Ajv is the only
 * consumer (see `validator.ts`).
 *
 * Ids use the `luna://` URI scheme so Ajv can resolve `$ref`s across the whole
 * registry. Every schema is registered by its `$id` and referenced by the same
 * string, never by a relative pointer.
 */

/** A JSON Schema fragment. Loose on purpose: authored by hand, checked by Ajv. */
export type JsonSchema = Record<string, unknown>;

/** Builds a `luna://...` schema id from a slash path. */
export const schemaId = (path: string): string => `luna://${path}`;

export const string = (extra: JsonSchema = {}): JsonSchema => ({
  type: 'string',
  ...extra,
});

/** A non-empty string; the common shape for ids and required text fields. */
export const nonEmptyString = (extra: JsonSchema = {}): JsonSchema =>
  string({ minLength: 1, ...extra });

/** A string that may be explicitly null (nullable columns / optional owners). */
export const nullableString = (): JsonSchema => ({ type: ['string', 'null'] });

export const integer = (extra: JsonSchema = {}): JsonSchema => ({
  type: 'integer',
  ...extra,
});

export const boolean = (): JsonSchema => ({ type: 'boolean' });

export const array = (items: JsonSchema): JsonSchema => ({
  type: 'array',
  items,
});

/** A reference to another registered schema by its `$id`. */
export const ref = (id: string): JsonSchema => ({ $ref: id });

/** A free-form object bag (`Record<string, unknown>`, e.g. a zone `config`). */
export const freeObject = (): JsonSchema => ({
  type: 'object',
  additionalProperties: true,
});

/** Accepts any JSON value (used for the generic DomainEvent `payload`). */
export const any = (): JsonSchema => ({});

/** A string enum schema whose values are pinned to the runtime enum. */
export const enumOf = (id: string, values: readonly string[]): JsonSchema => ({
  $id: id,
  type: 'string',
  enum: [...values],
});

/**
 * An object schema. `required` is explicit (never inferred) so an optional field
 * is never accidentally made mandatory. `additionalProperties` defaults to false
 * because a strict inbound payload catches a typo'd field a polyglot producer
 * might send; set it true only for genuinely open bags.
 */
export const object = (
  id: string,
  properties: Record<string, JsonSchema>,
  required: string[],
  additionalProperties = false
): JsonSchema => ({
  $id: id,
  type: 'object',
  properties,
  required,
  additionalProperties,
});

/** A cursor-paginated envelope of `itemRefId` items (plan 0004, section 11). */
export const paginated = (id: string, itemRefId: string): JsonSchema => ({
  $id: id,
  type: 'object',
  additionalProperties: false,
  required: ['items', 'nextCursor'],
  properties: {
    items: array(ref(itemRefId)),
    nextCursor: nullableString(),
  },
});
