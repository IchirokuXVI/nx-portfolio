/**
 * Mints the correlation id the client sends on every gateway request.
 *
 * The gateway honours an inbound `x-correlation-id`
 * (`libs/luna-shopper/platform/src/lib/context/correlation.middleware.ts:37`) and
 * mints one otherwise. It returns the id in the **body** of a problem document and in
 * no response header at all.
 *
 * So the client mints its own, for two reasons, and the second is the one that matters:
 *
 * - The id a user copies is then the id in the backend logs, with no round trip.
 * - **A network failure has no body**, so a server minted id would not exist for
 *   precisely the failure a user is most likely to report. `0003` promises a copyable
 *   reference on its error state, and this is what keeps that promise
 *   (plan 0004, section 4.6).
 */
export function newCorrelationId(): string {
  // Available in browsers on a secure context and in Node 19+, but not on plain HTTP
  // origins, which is exactly how this app is served in development.
  const uuid = globalThis.crypto?.randomUUID;
  if (typeof uuid === 'function') {
    return uuid.call(globalThis.crypto);
  }

  return fallbackId();
}

/**
 * Not a UUID and not trying to be. It is a log correlation handle: it has to be
 * unlikely to collide within one session, and readable enough to be dictated over the
 * phone, which `0003` section 7 names as a real support path.
 */
function fallbackId(): string {
  const random = () => Math.random().toString(16).slice(2, 10);
  return `${Date.now().toString(16)}-${random()}-${random()}`;
}
