import {
  BadRequestException,
  Injectable,
  Param,
  type PipeTransform,
} from '@nestjs/common';

/**
 * The canonical uuid shape, any version (plan 0158). Every id a service keeps
 * in a `uuid` column, and every id it later casts with `::uuid`, has it.
 */
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a value is a string in the {@link UUID_PATTERN} shape. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/**
 * The 400 a malformed id answers, in exactly the shape a failed DTO answers:
 * the global `ValidationPipe` throws a `BadRequestException` over an array of
 * messages, and the exception filter files each message under its first word.
 * So the message starts with the parameter's name.
 */
export function malformedUuid(name: string): BadRequestException {
  return new BadRequestException([`${name} must be a UUID`]);
}

/**
 * Refuses a path parameter that is not a uuid, before the handler runs.
 *
 * Without it a malformed id travels to the service, Postgres refuses the
 * `uuid` cast with `22P02`, and the caller is told 500 "Something went wrong
 * on our side" for a typo in their own URL.
 */
@Injectable()
export class UuidPipe implements PipeTransform<unknown, string> {
  constructor(private readonly name: string) {}

  transform(value: unknown): string {
    if (!isUuid(value)) {
      throw malformedUuid(this.name);
    }
    return value;
  }
}

/**
 * `@Param(name)` for a parameter that must be a uuid (plan 0158).
 *
 * Put it only on a parameter the service stores as a uuid. A postal code, a
 * secret, a source kind or a code is not one, and the decorator would refuse
 * every request the route exists for.
 */
export function UuidParam(name: string): ParameterDecorator {
  return Param(name, new UuidPipe(name));
}
