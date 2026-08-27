// Platform conventions shared by every luna-shopper-backend service (plan 0004).
// Import the module and bootstrap helper for wiring; the rest are building blocks
// the feature plans (0005+) use on their controllers, consumers and DTOs.

// Wiring
export * from './lib/bootstrap';
export * from './lib/platform.module';

// Logging
export * from './lib/logging/logger.options';
export * from './lib/logging/redaction';

// Request context / correlation
export * from './lib/context/correlation.constants';
export * from './lib/context/correlation.middleware';
export * from './lib/context/request-context';
export * from './lib/context/rpc-correlation.interceptor';

// Errors
export * from './lib/errors/domain-exception';
export * from './lib/errors/error-catalog';
export * from './lib/errors/error-codes';
export * from './lib/errors/global-exception.filter';
export * from './lib/errors/problem-details';
export * from './lib/errors/problem-details.schema';
export * from './lib/errors/problem-factory';

// Localization
export * from './lib/localization/locale';

// Versioning & docs
export * from './lib/swagger/swagger';
export * from './lib/versioning/versioning';

// Validation
export * from './lib/validation/username';
export * from './lib/validation/validation-pipe';

// Health
export * from './lib/health/health.module';
export * from './lib/health/readiness-state';

// Redis (plan 0028): the one client, its connection options and the health
// indicator. The cache, presence, throttler storage and socket backplane all
// build on this rather than constructing their own ioredis.
export * from './lib/redis/redis.module';
export * from './lib/redis/redis.options';
export * from './lib/redis/redis.service';

// Rate limiting
export * from './lib/throttling/problem-throttler.guard';
export * from './lib/throttling/redis-throttler.storage';
export * from './lib/throttling/throttler-config';

// Pagination
export * from './lib/pagination/cursor';
export * from './lib/pagination/page-query.dto';

// Idempotency
export * from './lib/idempotency/idempotency';

// NATS correlation
export * from './lib/nats/correlation-headers';

// Telemetry (plan 0016). The SDK bootstrap is deliberately absent from this
// barrel: it must load before Nest does, so a service imports it as a bare side
// effect from `@portfolio/luna-shopper/platform/tracing` at the top of `main.ts`.
export * from './lib/telemetry/metrics/declared-metrics';
export * from './lib/telemetry/metrics/http.metrics';
export * from './lib/telemetry/metrics/nats.metrics';
export * from './lib/telemetry/metrics/runtime.metrics';
export * from './lib/telemetry/nats-propagation';
export * from './lib/telemetry/span-attributes';
export * from './lib/telemetry/telemetry-runtime';
export * from './lib/telemetry/telemetry.config';
export * from './lib/telemetry/telemetry.module';
export * from './lib/telemetry/telemetry.schema';
