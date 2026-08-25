import { Module, type DynamicModule, type Provider } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { RpcCorrelationInterceptor } from './context/rpc-correlation.interceptor';
import { GlobalExceptionFilter } from './errors/global-exception.filter';
import { createLoggerOptions } from './logging/logger.options';
import { TelemetryModule } from './telemetry/telemetry.module';
import { createValidationPipe } from './validation/validation-pipe';

export interface PlatformModuleOptions {
  /** Emitting service name, e.g. `luna-shopper-backend-gateway`. Tags every log line. */
  serviceName: string;
  /**
   * Serve `GET /metrics` in Prometheus format on this service's HTTP port
   * (plan 0016, section 5.1). On by default, because the endpoint costs nothing
   * when nothing scrapes it and a service that quietly stopped reporting is
   * worse than one that reports into the void. Switch it off only for a process
   * that has no HTTP port at all.
   */
  telemetry?: boolean;
}

/**
 * The one import that gives a service the platform conventions (plan 0004,
 * section 13): structured, correlation tagged, secret redacting logging
 * (nestjs-pino), the global problem+json exception filter, the global validation
 * pipe, and the Prometheus `/metrics` endpoint (plan 0016). Import it once in the
 * service's `AppModule`; the HTTP correlation middleware, API versioning and
 * shutdown hooks are applied in `bootstrap` via {@link bootstrapPlatform}.
 *
 * Tracing itself is not started here. It has to start before Nest loads, so it
 * is a side effect import at the top of `main.ts`; see `telemetry/tracing.ts`.
 *
 * The log level is read from the already validated `LOG_LEVEL` env var, so the
 * module needs no `ConfigService` dependency and stays identical across services.
 */
@Module({})
export class PlatformModule {
  static forRoot(options: PlatformModuleOptions): DynamicModule {
    const providers: Provider[] = [
      { provide: APP_FILTER, useClass: GlobalExceptionFilter },
      { provide: APP_INTERCEPTOR, useClass: RpcCorrelationInterceptor },
      { provide: APP_PIPE, useFactory: createValidationPipe },
    ];

    return {
      module: PlatformModule,
      global: true,
      imports: [
        LoggerModule.forRoot(
          createLoggerOptions({
            serviceName: options.serviceName,
            level: process.env['LOG_LEVEL'] ?? 'info',
          })
        ),
        ...(options.telemetry === false
          ? []
          : [TelemetryModule.forRoot({ serviceName: options.serviceName })]),
      ],
      providers,
      exports: [LoggerModule],
    };
  }
}
