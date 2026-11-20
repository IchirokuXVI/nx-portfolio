/**
 * A boolean query parameter, read from the text the address carried.
 *
 * The pipe of {@link createValidationPipe} converts implicitly, and its
 * conversion of a boolean is `Boolean(value)`. Every text but the empty one
 * thus reaches a transform as `true`, `?flag=false` included, and the empty
 * one as `false`. A transform handed `value` cannot tell `false` from `true`.
 * This one reads `obj[key]`, the request's own text, which is the only place
 * the word `false` still exists.
 *
 * - `true` reads as true, and so does a bare `?flag`, which arrives as the
 *   empty text and means the caller set it.
 * - `false` reads as false.
 * - Absent stays absent, so the default of the route applies.
 * - Anything else is handed on as it was spelled, so `@IsBoolean` refuses it
 *   with a 400 rather than reading a typo as either answer.
 *
 * Every boolean property of a DTO bound with `@Query()` uses it:
 *
 * ```ts
 * @IsOptional()
 * @Transform(asQueryFlag)
 * @IsBoolean()
 * flag?: boolean;
 * ```
 *
 * A body does not need it for the text `false`, because JSON carries a real
 * boolean, but the pipe converts a body too: a JSON string `"false"` in a
 * boolean field reads as true unless the DTO reads the value as sent.
 */
export function asQueryFlag({
  obj,
  key,
}: {
  obj: Record<string, unknown>;
  key: string;
}): unknown {
  const spelled = obj?.[key];
  if (spelled === '' || spelled === 'true' || spelled === true) {
    return true;
  }
  return spelled === 'false' || spelled === false ? false : spelled;
}
