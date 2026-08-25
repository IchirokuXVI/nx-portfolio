/**
 * Telemetry configuration (plan 0016, section 7).
 *
 * Read straight from `process.env` rather than through `ConfigService`, because
 * the SDK starts in `tracing.ts` before Nest exists (section 4.1) and therefore
 * cannot inject anything. The same variables are declared in each service's Joi
 * schema so a malformed value still fails the boot fast, consistent with plan
 * 0002; this module only has to survive being loaded first.
 *
 * It deliberately imports nothing: every module reachable from `tracing.ts` is a
 * module the auto instrumentations can no longer patch once they start.
 */

/** Deployment environments: plan 0002's two cluster environments, plus local. */
export type DeploymentEnvironment = 'production' | 'staging' | 'development';

export interface TelemetryConfig {
  /** Resource `service.name`, e.g. `luna-shopper-backend-gateway`. */
  serviceName: string;
  /** Resource `service.version`; the release version baked as the image tag. */
  serviceVersion: string;
  /** Resource `deployment.environment.name`. */
  environment: DeploymentEnvironment;
  /**
   * Tracing is on only when `OTEL_ENABLED` is truthy AND an OTLP endpoint is
   * configured. Absence of configuration is a working service with no exporter
   * constructed and no network call attempted (section 4.6).
   */
  tracingEnabled: boolean;
  /** OTLP HTTP collector base URL, when configured. */
  otlpEndpoint?: string;
  /** `ParentBased(TraceIdRatioBased(ratio))` ratio, 0..1 (section 4.5). */
  samplingRatio: number;
  /** `/metrics` and the Prometheus meter provider. On unless switched off. */
  metricsEnabled: boolean;
}

const DEFAULT_SAMPLING_RATIO = 1;
const DEPLOYMENT_ENVIRONMENTS: readonly DeploymentEnvironment[] = [
  'production',
  'staging',
  'development',
];

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function readRatio(value: string | undefined): number {
  // An unset or blank variable must fall back, not coerce: `Number('')` is 0,
  // which is a valid ratio meaning "sample nothing", so the empty string would
  // otherwise switch tracing off while looking configured.
  if (value === undefined || value.trim() === '') {
    return DEFAULT_SAMPLING_RATIO;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return DEFAULT_SAMPLING_RATIO;
  }
  return parsed;
}

function readEnvironment(value: string | undefined): DeploymentEnvironment {
  const candidate = value?.trim().toLowerCase() as DeploymentEnvironment;
  return DEPLOYMENT_ENVIRONMENTS.includes(candidate)
    ? candidate
    : 'development';
}

/**
 * Resolves the telemetry configuration from the environment. `env` is a parameter
 * so the unit tests can exercise the on, off and malformed paths without mutating
 * the real `process.env`.
 */
export function readTelemetryConfig(
  env: NodeJS.ProcessEnv = process.env
): TelemetryConfig {
  const otlpEndpoint = env['OTEL_EXPORTER_OTLP_ENDPOINT']?.trim() || undefined;

  return {
    serviceName: env['OTEL_SERVICE_NAME']?.trim() || 'luna-shopper-backend',
    serviceVersion: env['SERVICE_VERSION']?.trim() || '0.0.0',
    environment: readEnvironment(env['DEPLOYMENT_ENVIRONMENT']),
    tracingEnabled:
      readBoolean(env['OTEL_ENABLED'], false) && Boolean(otlpEndpoint),
    otlpEndpoint,
    samplingRatio: readRatio(env['OTEL_TRACES_SAMPLER_ARG']),
    metricsEnabled: readBoolean(env['METRICS_ENABLED'], true),
  };
}
