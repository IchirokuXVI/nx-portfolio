import { ValidationPipe } from '@nestjs/common';

/**
 * The global validation pipe (plan 0004, section 2).
 *
 * DTO violations become a 400 that the exception filter turns into the house
 * envelope with per field detail. `whitelist` strips unknown properties and
 * `forbidNonWhitelisted` rejects them outright, so a client cannot smuggle extra
 * fields past a DTO; `transform` gives handlers real class instances and coerces
 * path/query primitives.
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });
}
