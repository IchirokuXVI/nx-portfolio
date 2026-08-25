import {
  diag,
  DiagLogLevel,
  type DiagLogFunction,
  type DiagLogger,
} from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { RuntimeNodeInstrumentation } from '@opentelemetry/instrumentation-runtime-node';
import {
  defaultResource,
  resourceFromAttributes,
} from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-node';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import { httpMetricViews } from './metrics/http.metrics';
import { ATTR_DEPLOYMENT_ENVIRONMENT_NAME } from './semconv-incubating';
import { registerTelemetryRuntime } from './telemetry-runtime';
import { readTelemetryConfig, type TelemetryConfig } from './telemetry.config';

/**
 * OpenTelemetry bootstrap (plan 0016, section 4.1). **Importing this module
 * starts the SDK.**
 *
 * It must be the very first import of a service's `main.ts`, before
 * `@nestjs/core` and before the app module, because the auto instrumentations
 * work by patching modules *as they are required*: anything already resolved
 * when the SDK starts is never patched, and the traces come out missing whole
 * layers. That is the single most common way an OTel setup silently does
 * nothing.
 *
 * The safe form is the bare side effect import
 * `import '@portfolio/luna-shopper/platform/tracing';`. TypeScript's organize
 * imports (which this repo runs through prettier) treats a side effect import as
 * a barrier and will not sort other imports above it, so the ordering survives a
 * format. If that ever proves fragile the fallback is `node --require` in the
 * Dockerfile `CMD`, which cannot be reordered at source level at all.
 *
 * Nothing here throws into the service. With telemetry unconfigured the SDK is
 * not started, no exporter is constructed and the process behaves exactly as it
 * did before this file existed (section 4.6).
 */

/**
 * Diagnostics before pino exists. The SDK starts ahead of Nest, so its own
 * warnings (a collector that will not answer, an exporter that is dropping
 * batches) cannot go through the service logger. They go to stderr as one JSON
 * line each, at warn and above only, so they read like the rest of the output
 * and never become per span noise.
 */
function installDiagLogger(): void {
  const write =
    (level: string): DiagLogFunction =>
    (message: string, ...args: unknown[]) => {
      process.stderr.write(
        `${JSON.stringify({
          level,
          service: process.env['OTEL_SERVICE_NAME'],
          component: 'opentelemetry',
          msg: [message, ...args.map(String)].join(' '),
        })}\n`
      );
    };

  const noop: DiagLogFunction = () => undefined;
  const logger: DiagLogger = {
    error: write('error'),
    warn: write('warn'),
    info: noop,
    debug: noop,
    verbose: noop,
  };

  diag.setLogger(logger, DiagLogLevel.WARN);
}

/**
 * Instrumentations shared by both signals, so HTTP timing is not measured twice
 * (section 3). Filesystem and DNS are disabled explicitly: they add a large
 * volume of spans without adding insight (section 11). No HTTP header is
 * captured as a span attribute, which is what keeps `authorization` and `cookie`
 * out of traces (section 4.7).
 */
function buildInstrumentations() {
  return [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': { enabled: false },
      '@opentelemetry/instrumentation-dns': { enabled: false },
      '@opentelemetry/instrumentation-net': { enabled: false },
      '@opentelemetry/instrumentation-http': {
        headersToSpanAttributes: { client: {}, server: {} },
      },
    }),
    // Event loop lag, heap usage and GC pauses (section 5.2).
    new RuntimeNodeInstrumentation(),
  ];
}

/**
 * One resource for both signals, so a dashboard and a trace search filter on the
 * same values (section 4.2). Everything comes from the environment, so one image
 * serves production and staging.
 */
function buildResource(config: TelemetryConfig) {
  return defaultResource().merge(
    resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.serviceName,
      [ATTR_SERVICE_VERSION]: config.serviceVersion,
      [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: config.environment,
    })
  );
}

/** Bounded flush on shutdown, so a rollout is never delayed by a slow collector. */
const SHUTDOWN_TIMEOUT_MS = 5000;

function startTelemetry(): void {
  const config = readTelemetryConfig();

  if (!config.tracingEnabled && !config.metricsEnabled) {
    return;
  }

  installDiagLogger();

  // Only constructed when metrics are on. `preventServerStart` keeps the
  // exporter from opening a second HTTP port: the scrape is served from the
  // service's existing health port by `TelemetryModule` (section 5.1).
  const prometheusExporter = config.metricsEnabled
    ? new PrometheusExporter({ preventServerStart: true })
    : undefined;

  const sdk = new NodeSDK({
    resource: buildResource(config),
    instrumentations: buildInstrumentations(),
    // Parent based is required, not optional: it is what keeps one sampling
    // decision consistent across every hop of a request (section 4.5).
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(config.samplingRatio),
    }),
    // Reads the standard OTEL_EXPORTER_OTLP_* variables itself, so anyone who
    // already knows OpenTelemetry configures this without reading code. The SDK
    // wraps it in a batch processor, which drops rather than blocks when the
    // collector is unreachable (section 4.6).
    ...(config.tracingEnabled
      ? { traceExporter: new OTLPTraceExporter() }
      : {}),
    ...(prometheusExporter
      ? {
          metricReaders: [prometheusExporter],
          // Allow lists the bounded attributes on the auto emitted HTTP metrics,
          // so the route template is labelled and the resolved path never is
          // (section 5.3).
          views: httpMetricViews(),
        }
      : {}),
  });

  sdk.start();

  registerTelemetryRuntime({
    config,
    prometheusExporter,
    shutdown: () =>
      Promise.race([
        sdk.shutdown(),
        new Promise<void>((resolve) =>
          setTimeout(resolve, SHUTDOWN_TIMEOUT_MS).unref()
        ),
      ]).catch((error: unknown) => {
        diag.warn('telemetry shutdown failed', String(error));
      }),
  });
}

startTelemetry();
