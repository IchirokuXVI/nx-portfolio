import * as Joi from 'joi';

/**
 * The telemetry variables every service accepts (plan 0016, section 7), declared
 * once so all five schemas agree and a new service cannot invent its own
 * spellings.
 *
 * Spread into a service's `Joi.object({ ... })` alongside its own keys. Every
 * value is optional with a working default, which is the point: absence of
 * configuration is a running service with telemetry off (section 4.6). What the
 * validation buys is failing fast on a *malformed* value, consistent with plan
 * 0002, instead of silently sampling at 100% because a ratio was typed wrong.
 *
 * `tracing.ts` reads these straight from `process.env` before Nest exists, so
 * this schema validates them rather than supplying them. `OTEL_SERVICE_NAME` in
 * particular has to be set in the environment; `TelemetryModule` warns at boot
 * when it does not match the service.
 */
export const telemetryValidationSchema = {
  /** Resource `service.name`. Set per service in its `.env` and its Deployment. */
  OTEL_SERVICE_NAME: Joi.string().allow('').default(''),
  /** Resource `service.version`; the release version baked as the image tag. */
  SERVICE_VERSION: Joi.string().allow('').default(''),
  /** Resource `deployment.environment.name`. */
  DEPLOYMENT_ENVIRONMENT: Joi.string()
    .valid('production', 'staging', 'development')
    .default('development'),
  /** Off by default: no collector configured means no exporter and no traffic. */
  OTEL_ENABLED: Joi.boolean().default(false),
  /** OTLP HTTP collector base URL, e.g. `http://otel-collector:4318`. */
  OTEL_EXPORTER_OTLP_ENDPOINT: Joi.string().uri().allow('').default(''),
  /** `ParentBased(TraceIdRatioBased(ratio))` ratio: 1.0 in dev, lower in prod. */
  OTEL_TRACES_SAMPLER_ARG: Joi.number().min(0).max(1).default(1),
  /** `/metrics` on the health port. On by default; it costs nothing unscraped. */
  METRICS_ENABLED: Joi.boolean().default(true),
};
