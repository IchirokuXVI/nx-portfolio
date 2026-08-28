import { VersioningType, type INestApplication } from '@nestjs/common';

/**
 * API versioning (plan 0004, section 4).
 *
 * URI versioning, major only: `/v1/...`, `/v2/...` with no minor or patch in the
 * URL. Versioning is enabled here but *not* defaulted: each controller declares
 * its own version (`@Controller({ version: '1' })`) and controllers version
 * independently, so a bump on zones never forces a bump on lists. Only the
 * gateway's public HTTP surface is URL versioned; internal broker subjects carry
 * their own version token.
 */
export function enableApiVersioning(app: INestApplication): void {
  app.enableVersioning({ type: VersioningType.URI, prefix: 'v' });
}
