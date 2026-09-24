import { Injectable, type NestMiddleware } from '@nestjs/common';

/**
 * A request whose body must never reach a log line (plan 0164).
 *
 * pino-http's request lines never print a body. `GlobalExceptionFilter` does
 * hand the body of a request that failed with a 500 to the logger, because
 * that is usually what reproduces it, and today pino-http's request serializer
 * happens to drop it. That is an accident of a serializer rather than a rule.
 * Some bodies are exactly what must not be kept: the point a device reports to
 * find the shops near it is the one piece of that feature we promise never to
 * store, and a log is storage. So a route marks its requests, and the filter
 * hands the logger this marker in place of their body, whatever the serializer
 * does.
 *
 * A mark on the request rather than a list of paths in the platform, because
 * the platform knows no routes. A symbol, so nothing a client sends can set it.
 */
const BODY_WITHHELD = Symbol.for('luna.logging.bodyWithheld');

/** What the error log prints in place of a withheld body. */
export const WITHHELD_BODY = '[Withheld]';

/** Mark a request so no log line prints its body. */
export function withholdBodyFromLogs(req: object): void {
  (req as Record<symbol, unknown>)[BODY_WITHHELD] = true;
}

/** Whether a request's body was withheld from the logs. */
export function isBodyWithheld(req: unknown): boolean {
  return (
    typeof req === 'object' &&
    req !== null &&
    (req as Record<symbol, unknown>)[BODY_WITHHELD] === true
  );
}

/**
 * Marks every request of the routes it is applied to.
 *
 * A middleware rather than a guard or an interceptor, because middleware runs
 * before every guard: a request that fails in a guard with a 500 (a broker
 * that does not answer the participant guard) is already marked when the
 * filter logs it. Apply it per controller with `forRoutes(SomeController)`.
 */
@Injectable()
export class WithholdBodyMiddleware implements NestMiddleware {
  use(req: object, _res: unknown, next: () => void): void {
    withholdBodyFromLogs(req);
    next();
  }
}
