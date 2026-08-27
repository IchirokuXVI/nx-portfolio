import { Module, type DynamicModule, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Joi from 'joi';
import { Logger } from 'nestjs-pino';
import { RedisService } from './redis.service';

/** The resolved connection string, so RedisService takes it by injection. */
export const REDIS_URL = Symbol('LUNA_REDIS_URL');

/**
 * `REDIS_URL` for a service's validation schema (plan 0028, section 3).
 *
 * Spread into the service's Joi object exactly like `telemetryValidationSchema`.
 * It is **required** wherever it appears, which is the decision from section 5
 * rather than an oversight: realtime is incorrect at more than one replica
 * without it, and a gateway that silently starts with no working rate limiter is
 * the worst of the available outcomes. A service that does not use Redis simply
 * does not spread this in.
 */
export const redisValidationSchema = {
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .required(),
};

export interface RedisModuleOptions {
  /**
   * Where to read the connection string from. Defaults to the validated
   * `REDIS_URL` environment variable, which is what every service uses; the
   * override exists for tests that point at an ephemeral instance.
   */
  inject?: unknown[];
  useFactory?: (...args: never[]) => string;
}

/**
 * Makes {@link RedisService} available to a service (plan 0028, section 4).
 *
 * Global, like `PlatformModule`, because presence, the relay, the throttler
 * storage and the caches all want the same connection and threading it through
 * every feature module's imports would be noise. Import it once in the service's
 * `AppModule`.
 */
@Module({})
export class RedisModule {
  static forRoot(options: RedisModuleOptions = {}): DynamicModule {
    const urlProvider: Provider = {
      provide: REDIS_URL,
      inject: (options.inject ?? [ConfigService]) as never[],
      useFactory:
        options.useFactory ??
        ((config: ConfigService) => config.getOrThrow<string>('REDIS_URL')),
    };

    return {
      module: RedisModule,
      global: true,
      providers: [
        urlProvider,
        {
          provide: RedisService,
          inject: [REDIS_URL, Logger],
          useFactory: (url: string, logger: Logger) =>
            new RedisService(url, logger),
        },
      ],
      exports: [RedisService],
    };
  }
}
