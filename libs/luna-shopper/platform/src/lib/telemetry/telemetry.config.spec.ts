import { getTelemetryRuntime } from './telemetry-runtime';
import { readTelemetryConfig } from './telemetry.config';

describe('telemetry config', () => {
  it('is off with an empty environment, so an unconfigured service just runs', () => {
    const config = readTelemetryConfig({});

    expect(config.tracingEnabled).toBe(false);
    expect(config.otlpEndpoint).toBeUndefined();
    // Metrics stay on: the endpoint costs nothing when nothing scrapes it.
    expect(config.metricsEnabled).toBe(true);
    expect(config.environment).toBe('development');
  });

  it('stays off when enabled without a collector to send to', () => {
    // Half configured is the dangerous case: an exporter with nowhere to go
    // would retry into the void on every request.
    expect(readTelemetryConfig({ OTEL_ENABLED: 'true' }).tracingEnabled).toBe(
      false
    );
  });

  it('turns tracing on only with both the flag and an endpoint', () => {
    const config = readTelemetryConfig({
      OTEL_ENABLED: 'true',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otel-collector:4318',
      OTEL_SERVICE_NAME: 'luna-shopper-backend-gateway',
      SERVICE_VERSION: '1.4.2',
      DEPLOYMENT_ENVIRONMENT: 'staging',
      OTEL_TRACES_SAMPLER_ARG: '0.25',
    });

    expect(config).toMatchObject({
      tracingEnabled: true,
      otlpEndpoint: 'http://otel-collector:4318',
      serviceName: 'luna-shopper-backend-gateway',
      serviceVersion: '1.4.2',
      environment: 'staging',
      samplingRatio: 0.25,
    });
  });

  it('accepts the usual spellings of a boolean', () => {
    for (const value of ['1', 'true', 'TRUE', 'yes', 'on']) {
      expect(
        readTelemetryConfig({ METRICS_ENABLED: value }).metricsEnabled
      ).toBe(true);
    }
    for (const value of ['0', 'false', 'no', 'off', 'nonsense']) {
      expect(
        readTelemetryConfig({ METRICS_ENABLED: value }).metricsEnabled
      ).toBe(false);
    }
  });

  it('falls back to full sampling rather than a nonsense ratio', () => {
    for (const value of ['', 'half', '-1', '2', 'NaN']) {
      expect(
        readTelemetryConfig({ OTEL_TRACES_SAMPLER_ARG: value }).samplingRatio
      ).toBe(1);
    }
  });

  it('rejects an unknown deployment environment rather than passing it through', () => {
    expect(
      readTelemetryConfig({ DEPLOYMENT_ENVIRONMENT: 'prod' }).environment
    ).toBe('development');
  });

  it('starts nothing merely by being imported', () => {
    // The regression guard from section 10: reading the config, or importing any
    // telemetry module other than `tracing.ts`, must never start an SDK.
    expect(getTelemetryRuntime()).toBeUndefined();
  });
});
