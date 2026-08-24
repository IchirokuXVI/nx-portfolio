import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolveLocale } from '../localization/locale';
import { CORRELATION_ID_HEADER } from './correlation.constants';
import { runWithRequestContext } from './request-context';

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Seeds the per request context for the HTTP surface (plan 0004, sections 1.1,
 * 3 and 12).
 *
 * Running downstream inside {@link runWithRequestContext} keeps the
 * AsyncLocalStorage scope active for the whole request, so the logger mixin, the
 * exception filter and even the request completion log all see the same
 * correlation id, client IP and locale. The user and zone are filled in later, by
 * the auth guard and the zone resolution, once they are known.
 *
 * A trusted client may supply the correlation id; otherwise one is minted. The IP
 * is taken from the proxy `X-Forwarded-For`, trusting the reverse proxy in front
 * of the cluster.
 *
 * This is a plain Express style middleware applied with `app.use()` before the
 * router, so the AsyncLocalStorage scope wraps the whole request (guards,
 * interceptors, handler, the exception filter and pino's request completion log)
 * rather than only part of it, and it sidesteps Nest's route-path matching.
 */
export function correlationMiddleware(
  req: IncomingMessage,
  _res: ServerResponse,
  next: () => void
): void {
  const supplied = headerValue(req, CORRELATION_ID_HEADER);
  const correlationId = supplied && supplied.trim() ? supplied : randomUUID();

  const forwardedFor = headerValue(req, 'x-forwarded-for');
  const ip =
    forwardedFor?.split(',')[0]?.trim() ||
    (req.socket?.remoteAddress ?? undefined);

  const locale = resolveLocale({
    acceptLanguage: headerValue(req, 'accept-language'),
  });

  runWithRequestContext({ correlationId, ip: ip || undefined, locale }, () =>
    next()
  );
}
