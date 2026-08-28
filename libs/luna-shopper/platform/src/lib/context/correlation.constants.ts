/**
 * Wire names for the correlation id (plan 0004, section 3).
 *
 * The same logical id travels as an HTTP header at the edge and as a NATS message
 * header between services, so both transports agree on one spelling. A trusted
 * client may supply the HTTP header; otherwise the gateway generates one.
 */
export const CORRELATION_ID_HEADER = 'x-correlation-id';

/**
 * Idempotency key header (plan 0004, section 9). Orchestrated commands that span
 * services carry it so a retry after a partial failure does not, for example,
 * mint a second temporary user or create a duplicate zone.
 */
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
