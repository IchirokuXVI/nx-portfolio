import { AsyncLocalStorage } from 'node:async_hooks';
import type { SupportedLocale } from '../localization/locale';

/**
 * Per request context (plan 0004, section 1.1 and 3).
 *
 * Every request, whether it arrives over HTTP at the gateway or as a NATS message
 * at auth/core/realtime, runs inside an AsyncLocalStorage scope carrying the
 * fields that tag its log lines and thread its correlation id across services. A
 * field is present only when it is actually known: `userId`/`username` appear
 * only once a token is resolved, `zoneId` only when the request targets a zone.
 * Their presence in a log line is therefore meaningful, never blank filler.
 */
export interface RequestContext {
  /** Threads one user action across every service and into the realtime push. */
  correlationId: string;
  /** Client IP (from the proxy `X-Forwarded-For`), when known. */
  ip?: string;
  userId?: string;
  username?: string;
  zoneId?: string;
  /** Resolved request locale, so error messages come back translated. */
  locale?: SupportedLocale;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Runs `callback` inside a fresh context scope. Message handlers and the HTTP
 * pipeline seed the scope once; everything they call reads the same store.
 */
export function runWithRequestContext<T>(
  context: RequestContext,
  callback: () => T
): T {
  return storage.run(context, callback);
}

/** The active context, or `undefined` outside any request scope. */
export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/** The active correlation id, or `undefined` outside any request scope. */
export function getCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}

/**
 * Merges fields into the active context in place (for example once a token is
 * verified and the user is known). A no op outside a request scope, so callers
 * never have to guard.
 */
export function setRequestContext(patch: Partial<RequestContext>): void {
  const current = storage.getStore();
  if (current) {
    Object.assign(current, patch);
  }
}
