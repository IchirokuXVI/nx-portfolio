import {
  Controller,
  Get,
  Inject,
  Logger,
  Module,
  Req,
  Res,
  VERSION_NEUTRAL,
  type DynamicModule,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { getTelemetryRuntime, shutdownTelemetry } from './telemetry-runtime';

/**
 * The Prometheus scrape endpoint (plan 0016, section 5.1).
 *
 * Every service already runs an HTTP port for health probes, including auth,
 * core and catalog, which are otherwise NATS microservices. `GET /metrics` is
 * served on that same port, so nothing new is exposed and no second listener is
 * opened: the exporter is constructed with `preventServerStart` and its request
 * handler is called from here.
 *
 * Three exclusions are deliberate, because each one is a real bug if forgotten:
 *
 * - **Not URL versioned.** Prometheus scrapes a fixed path, and `/v1/metrics`
 *   would break the scrape config on the next major version.
 * - **Excluded from the throttler.** A scrape every fifteen seconds must never
 *   consume a rate limit bucket; a throttled scrape shows up as a gap in the
 *   graphs rather than as an error.
 * - **Excluded from Swagger.** It is not part of the public API surface.
 *
 * `/metrics` is not routed through the reverse proxy. It is reachable inside the
 * cluster only, because it exposes internal timing and cardinality that has no
 * business being public.
 */
@ApiExcludeController()
@SkipThrottle()
@Controller({ path: 'metrics', version: VERSION_NEUTRAL })
export class MetricsController {
  @Get()
  scrape(
    @Req() request: IncomingMessage,
    @Res() response: ServerResponse
  ): void {
    const exporter = getTelemetryRuntime()?.prometheusExporter;

    if (!exporter) {
      // Metrics were switched off for this process. Answering 404 rather than an
      // empty 200 keeps a misconfigured scrape visibly broken instead of quietly
      // reporting a healthy service with no data.
      response.statusCode = 404;
      response.end();
      return;
    }

    exporter.getMetricsRequestHandler(request, response);
  }
}

export interface TelemetryModuleOptions {
  /**
   * The service name the rest of the platform uses. Compared against the
   * resource `service.name` the SDK started with, so a forgotten
   * `OTEL_SERVICE_NAME` is reported at boot rather than discovered as a
   * mislabelled dashboard weeks later.
   */
  serviceName: string;
}

/** The service name the platform was configured with, for the boot time check. */
export const TELEMETRY_SERVICE_NAME = Symbol('LUNA_TELEMETRY_SERVICE_NAME');

/**
 * Wires the scrape endpoint and checks the resource identity at boot. Imported by
 * {@link PlatformModule}, so a service opts in with the module it already imports
 * and its `app.module.ts` does not change (section 6).
 */
@Module({})
export class TelemetryModule
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(TelemetryModule.name);

  constructor(
    @Inject(TELEMETRY_SERVICE_NAME) private readonly serviceName: string
  ) {}

  static forRoot(options: TelemetryModuleOptions): DynamicModule {
    return {
      module: TelemetryModule,
      controllers: [MetricsController],
      providers: [
        { provide: TELEMETRY_SERVICE_NAME, useValue: options.serviceName },
      ],
    };
  }

  onApplicationBootstrap(): void {
    const runtime = getTelemetryRuntime();

    if (!runtime) {
      // Either the side effect import is missing from main.ts, or both signals
      // are switched off. Both are legitimate (a unit test, a service run with
      // telemetry off), so this is a debug line and not a warning.
      this.logger.debug(
        'Telemetry SDK not started; /metrics answers 404 and no spans are produced.'
      );
      return;
    }

    if (runtime.config.serviceName !== this.serviceName) {
      this.logger.warn(
        `OTEL_SERVICE_NAME is "${runtime.config.serviceName}" but this service is ` +
          `"${this.serviceName}". Traces and metrics would be attributed to the wrong service.`
      );
    }
  }

  /**
   * Flushes pending spans on `SIGTERM`, with the bounded timeout from
   * `tracing.ts`, so a rollout does not lose the traces that explain why it was
   * rolled and is not delayed by a collector that has gone away (section 4.6).
   * Nest runs this only because `bootstrapPlatform` enabled shutdown hooks.
   */
  async onApplicationShutdown(): Promise<void> {
    await shutdownTelemetry();
  }
}
