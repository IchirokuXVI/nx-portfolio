import {
  buildMessage,
  isUUID,
  ValidateBy,
  type ValidationOptions,
} from 'class-validator';

/**
 * A reference filter that may ask for the rows pointing at nothing (admin plan
 * 0012, section 2).
 *
 * A query parameter that is absent means "any", so it cannot spell "none" by
 * being left out. The back office spells it with this literal on the **same**
 * parameter a uuid would go on: `productGroupId=none` is the products in no
 * group, `ownerUserId=none` is the zones nobody owns. One word end to end,
 * rather than a second boolean parameter per reference that each route, its
 * DTO and its descriptor would have to agree on by name.
 *
 * The literal is safe because no uuid can equal it. It stops at the gateway:
 * the services keep their own vocabulary (`withoutProductGroup`,
 * `withoutOwner`), and {@link referenceFilter} is the one place that
 * translates.
 */
export const REFERENCE_NONE = 'none';

/** A uuid, or the literal {@link REFERENCE_NONE}. */
export function IsUuidOrNone(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isUuidOrNone',
      validator: {
        validate: (value: unknown) =>
          value === REFERENCE_NONE ||
          (typeof value === 'string' && isUUID(value)),
        defaultMessage: buildMessage(
          (prefix) =>
            `${prefix}$property must be a UUID or the literal "${REFERENCE_NONE}"`,
          options
        ),
      },
    },
    options
  );
}

/** What a reference query parameter asked for, split the way a service reads it. */
export interface ReferenceFilter {
  /** The uuid named, when one was. */
  readonly id: string | undefined;
  /** Whether the rows that point at nothing were asked for instead. */
  readonly none: boolean;
}

/** The two questions a reference parameter can ask, told apart. */
export function referenceFilter(value: string | undefined): ReferenceFilter {
  if (value === REFERENCE_NONE) {
    return { id: undefined, none: true };
  }
  return { id: value, none: false };
}

/**
 * The words the OpenAPI document uses for such a parameter, so every route
 * describes the literal the same way.
 */
export function referenceFilterDescription(
  named: string,
  none: string
): string {
  return `${named} The literal \`${REFERENCE_NONE}\` instead of a uuid asks for ${none}`;
}
