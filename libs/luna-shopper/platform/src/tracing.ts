/**
 * Secondary entry point for the OpenTelemetry bootstrap (plan 0016, section 4.1).
 *
 * A service starts telemetry with one bare side effect import, placed as the very
 * first line of its `main.ts`:
 *
 * ```ts
 * import '@portfolio/luna-shopper/platform/tracing';
 * ```
 *
 * It is a separate entry point rather than part of the main barrel on purpose.
 * The barrel pulls in Nest, and the auto instrumentations can only patch modules
 * that are still unresolved when the SDK starts: importing the barrel first would
 * leave `@nestjs/core`, `http` and `pg` already loaded and silently unpatched.
 * This file imports the SDK bootstrap and nothing else.
 */
import './lib/telemetry/tracing';
