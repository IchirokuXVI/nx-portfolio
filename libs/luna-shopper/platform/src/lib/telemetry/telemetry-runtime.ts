import type { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import type { TelemetryConfig } from './telemetry.config';

/**
 * The handles `tracing.ts` produces, kept in a module of their own so nothing
 * else has to import `tracing.ts` to reach them (plan 0016, section 6).
 *
 * That separation is what keeps the side effect honest: `tracing.ts` is imported
 * exactly once, as the first line of a service's `main.ts`, and importing the
 * `/metrics` controller or the bootstrap helper never starts an SDK by accident.
 * In a unit test nothing registers here, so every reader sees telemetry off.
 */
export interface TelemetryRuntime {
  config: TelemetryConfig;
  /** Present only when metrics are on; serves the scrape (section 5.1). */
  prometheusExporter?: PrometheusExporter;
  /** Flushes and stops the SDK; wired into graceful shutdown (section 4.6). */
  shutdown: () => Promise<void>;
}

let runtime: TelemetryRuntime | undefined;
let shuttingDown: Promise<void> | undefined;

/** Called once by `tracing.ts` after the SDK starts. */
export function registerTelemetryRuntime(value: TelemetryRuntime): void {
  runtime = value;
  shuttingDown = undefined;
}

/** The active runtime, or `undefined` when telemetry never started. */
export function getTelemetryRuntime(): TelemetryRuntime | undefined {
  return runtime;
}

/**
 * Flushes and stops the SDK, at most once. Called from the graceful shutdown
 * sequence (plan 0004, section 7) so a rollout does not lose the traces that
 * explain why it was rolled. Resolves immediately when telemetry never started.
 */
export function shutdownTelemetry(): Promise<void> {
  if (!runtime) {
    return Promise.resolve();
  }
  shuttingDown ??= runtime.shutdown();
  return shuttingDown;
}

/** Test seam: forgets the registered runtime. */
export function resetTelemetryRuntime(): void {
  runtime = undefined;
  shuttingDown = undefined;
}
