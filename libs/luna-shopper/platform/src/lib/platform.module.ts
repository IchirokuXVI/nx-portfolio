import { Module, type DynamicModule, type Provider } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { RpcCorrelationInterceptor } from './context/rpc-correlation.interceptor';
import { GlobalExceptionFilter } from './errors/global-exception.filter';
import { createLoggerOptions } from './logging/logger.options';
import { createValidationPipe } from './validation/validation-pipe';

export interface PlatformModuleOptions {
  /** Emitting service name, e.g. `luna-shopper-gateway`. Tags every log line. */
  serviceName: string;
}

/**
 * The one import that gives a service the platform conventions (plan 0004,
 * section 13): structured, correlation tagged, secret redacting logging
 * (nestjs-pino), the global problem+json exception filter, and the global
 * validation pipe. Import it once in the service's `AppModule`; the HTTP
 * correlation middleware, API versioning and shutdown hooks are applied in
 * `bootstrap` via {@link bootstrapPlatform}.
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
      ],
      providers,
      exports: [LoggerModule],
    };
  }
}
