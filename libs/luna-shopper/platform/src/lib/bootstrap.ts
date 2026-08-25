import type { INestApplication } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { correlationMiddleware } from './context/correlation.middleware';
import { enableApiVersioning } from './versioning/versioning';

export interface BootstrapPlatformOptions {
  /**
   * Enable URI API versioning on this app (plan 0004, section 4). Only the
   * gateway's public HTTP surface is versioned; the internal services' health
   * port leaves it off.
   */
  versioning?: boolean;
}

/**
 * Applies the runtime half of the platform conventions to a Nest app during
 * bootstrap (plan 0004, sections 1, 3, 4, 7):
 *
 * - routes Nest's own logs through pino so framework and application lines share
 *   one format,
 * - installs the correlation middleware before the router so the request context
 *   (correlation id, IP, locale) wraps the whole request,
 * - enables API versioning when asked,
 * - enables shutdown hooks so `SIGTERM` drains cleanly (the app half of the zero
 *   downtime contract whose infra half lives in 0002 section 6). Those hooks are
 *   also what flush pending spans: `TelemetryModule` shuts the OpenTelemetry SDK
 *   down with a bounded timeout on `onApplicationShutdown` (plan 0016,
 *   section 4.6), so a rollout keeps the traces that explain why it happened.
 */
export function bootstrapPlatform(
  app: INestApplication,
  options: BootstrapPlatformOptions = {}
): void {
  app.useLogger(app.get(Logger));
  app.flushLogs();

  app.use(correlationMiddleware);

  if (options.versioning) {
    enableApiVersioning(app);
  }

  app.enableShutdownHooks();
}
