import type { Params } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { CORRELATION_ID_HEADER } from '../context/correlation.constants';
import { getRequestContext } from '../context/request-context';
import { REDACTION_CENSOR, REDACTION_PATHS } from './redaction';

export interface LoggerOptions {
  /** Tags every line with the emitting service, e.g. `luna-shopper-backend-auth`. */
  serviceName: string;
  /** pino level; comes from the validated `LOG_LEVEL` env var. */
  level: string;
  /**
   * Colored, human readable console in development; structured JSON in
   * production (plan 0004, section 1). Defaults to pretty unless
   * `NODE_ENV === 'production'`.
   */
  pretty?: boolean;
}

/**
 * Builds the nestjs-pino configuration every service shares (plan 0004,
 * section 1). One factory keeps redaction, correlation and the per request
 * context tagging identical across all four services, which is what lets a
 * future .NET or Spring service match the format from a single written spec.
 *
 * - `genReqId` honours an inbound correlation id from a trusted caller or mints
 *   one; pino-http logs it as `correlationId` on the automatic request lines.
 * - `mixin` reads the AsyncLocalStorage request context so *every* line emitted
 *   while handling a request, including inside NATS message handlers, is tagged
 *   with the correlation id and (only when known) ip, user and zone.
 * - `redact` strips secrets before anything is written.
 *
 * `trace_id`, `span_id` and `trace_flags` are **not** added here, though plan
 * 0016 section 4.4 asks for them on every line. The auto instrumentation bundle
 * includes `@opentelemetry/instrumentation-pino`, which patches pino as it is
 * required (which is after `tracing.ts` has run) and injects exactly those three
 * from the active span already. Adding them in this mixin as well would be two
 * mechanisms writing the same keys, and the one that is not the library's own is
 * the one that silently goes stale. They appear on the same line as
 * `correlationId`, which is the two way navigation the plan asked for; when
 * telemetry is off there is no span, so nothing is added and the log contract is
 * exactly as it was.
 */
export function createLoggerOptions(options: LoggerOptions): Params {
  const pretty = options.pretty ?? process.env['NODE_ENV'] !== 'production';

  return {
    pinoHttp: {
      level: options.level,
      base: { service: options.serviceName },
      // The client IP already rides in the request context; keep pid/hostname
      // out of the noisy per line output.
      redact: { paths: REDACTION_PATHS, censor: REDACTION_CENSOR },
      genReqId: (req: IncomingMessage) => {
        const header = req.headers[CORRELATION_ID_HEADER];
        const supplied = Array.isArray(header) ? header[0] : header;
        return supplied && supplied.trim() ? supplied : randomUUID();
      },
      // Auto request/response lines show the correlation id under a stable key.
      customAttributeKeys: { reqId: 'correlationId' },
      // Every log line (including mid-handler and NATS handler lines) inherits
      // the active request context. Fields absent from the context stay absent.
      mixin() {
        const context = getRequestContext();
        if (!context) {
          return {};
        }
        const { correlationId, ip, userId, username, zoneId } = context;
        return {
          ...(correlationId ? { correlationId } : {}),
          ...(ip ? { ip } : {}),
          ...(userId ? { userId } : {}),
          ...(username ? { username } : {}),
          ...(zoneId ? { zoneId } : {}),
        };
      },
      transport: pretty
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'SYS:standard',
              ignore: 'pid,hostname',
            },
          }
        : undefined,
    },
  };
}
