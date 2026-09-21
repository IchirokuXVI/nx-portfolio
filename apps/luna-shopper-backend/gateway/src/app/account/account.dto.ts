import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UsernamePropagation } from '@portfolio/luna-shopper/contracts';
import {
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
} from '@portfolio/luna-shopper/platform';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  registerDecorator,
  ValidationArguments,
} from 'class-validator';

/**
 * Update the caller's own profile (plan 0018, section 12). A partial update: the
 * profile's other fields (`email`, `kind`, `displayName`) are not settable here,
 * which is why the route is a PATCH and not a PUT.
 */
export class UpdateProfileDto {
  @ApiProperty({ maxLength: USERNAME_MAX_LENGTH })
  @IsString()
  @MinLength(USERNAME_MIN_LENGTH)
  @MaxLength(USERNAME_MAX_LENGTH)
  username!: string;

  @ApiPropertyOptional({
    enum: UsernamePropagation,
    default: UsernamePropagation.GLOBAL_ONLY,
    description:
      'How far the change travels. Omitted means GLOBAL_ONLY: the zones where you chose a different name keep it.',
  })
  @IsOptional()
  @IsEnum(UsernamePropagation)
  propagation?: UsernamePropagation;
}

/** The two flags {@link UpdateAppStateDto} carries, for the rule below. */
const APP_STATE_FLAGS = ['setupCompleted', 'tourSeen'] as const;

/**
 * A flag that is left out, or is `true` (plan 0145, section 3).
 *
 * `false` is refused rather than ignored, because unsetting is not a thing the
 * app needs and a route that can unset is a route that can unset by accident. A
 * client sending `false` believes something this route does not do, and is
 * better told so than quietly obeyed in part.
 *
 * One decorator rather than `@IsOptional()` + `@Equals(true)`, for the reason
 * `LocalizedHalf` gives in `catalog.dto.ts`: `@IsOptional()` switches off every
 * validator on the property for an absent value, including the class rule
 * {@link AtLeastOneAppStateFlag}, which is exactly the value that rule has to
 * see.
 */
export function AppStateFlag(): PropertyDecorator {
  return (target, propertyName) => {
    registerDecorator({
      name: 'appStateFlag',
      target: target.constructor,
      propertyName: propertyName as string,
      validator: {
        validate(value: unknown): boolean {
          return value === undefined || value === true;
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must be left out or be true; it cannot be unset`;
        },
      },
    });
  };
}

/**
 * The one rule no single flag can state: the body asks for something.
 *
 * An empty body is a 400 and not a no-op, because nothing asked for is a client
 * mistake and a 200 would report a write that did not happen. Applied to one
 * property because class-validator has no class level decorator, and reads the
 * whole object through `args.object`.
 */
export function AtLeastOneAppStateFlag(): PropertyDecorator {
  return (target, propertyName) => {
    registerDecorator({
      name: 'atLeastOneAppStateFlag',
      target: target.constructor,
      propertyName: propertyName as string,
      validator: {
        validate(_value: unknown, args: ValidationArguments): boolean {
          const body = args.object as Record<string, unknown>;
          return APP_STATE_FLAGS.some((flag) => body[flag] !== undefined);
        },
        // Opens with a field name on purpose: the problem envelope keys its
        // `errors` map on a message's first word (`extractValidationErrors` in
        // the platform's filter calls that a best effort field name), so a
        // message that opens with a verb is filed under the verb.
        defaultMessage(): string {
          return `${APP_STATE_FLAGS.join(' or ')} must be named, as true; this body asks for nothing`;
        },
      },
    });
  };
}

/**
 * Mark what this account has been shown (plan 0145, section 3).
 *
 * Two flags, each left out or `true`, and at least one of them present.
 * Stamping is idempotent, so a client that presses Done and retries gets the
 * same timestamp back; and replaying the tour does not clear `tourSeen`,
 * because it is a fact about the past rather than a switch.
 */
export class UpdateAppStateDto {
  @ApiPropertyOptional({
    enum: [true],
    description:
      'Set when the setup is finished or dismissed. Left out, or true. Stamping is idempotent: a second call does not move the timestamp.',
  })
  @AtLeastOneAppStateFlag()
  @AppStateFlag()
  setupCompleted?: true;

  @ApiPropertyOptional({
    enum: [true],
    description:
      'Set when the tour is finished or skipped. Left out, or true. Stamping is idempotent.',
  })
  @AppStateFlag()
  tourSeen?: true;
}
