// Platform conventions shared by every luna-shopper service (plan 0004).
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
export * from './lib/errors/problem-factory';

// Localization
export * from './lib/localization/locale';

// Versioning & docs
export * from './lib/swagger/swagger';
export * from './lib/versioning/versioning';

// Validation
export * from './lib/validation/validation-pipe';

// Health
export * from './lib/health/health.module';
export * from './lib/health/readiness-state';

// Rate limiting
export * from './lib/throttling/throttler-config';

// Pagination
export * from './lib/pagination/cursor';
export * from './lib/pagination/page-query.dto';

// Idempotency
export * from './lib/idempotency/idempotency';

// NATS correlation
export * from './lib/nats/correlation-headers';
