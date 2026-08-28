import { headers as createNatsHeaders, type MsgHdrs } from 'nats';
import { CORRELATION_ID_HEADER } from '../context/correlation.constants';
import { getCorrelationId } from '../context/request-context';
import {
  toSupportedLocale,
  type SupportedLocale,
} from '../localization/locale';
import { injectTraceContext } from '../telemetry/nats-propagation';

const LOCALE_HEADER = 'x-locale';

/**
 * Correlation over the broker (plan 0004, section 3; plan 0016, section 4.3).
 *
 * The gateway propagates the correlation id (and the request locale) on NATS
 * message headers so one id threads a single user action across auth, core and
 * the realtime fan out, and so auth/core answer in the caller's language. These
 * helpers keep the header names in one place; the request/reply client wiring in
 * the service plans calls {@link buildNatsHeaders} on send and the message
 * handlers read them back with {@link readCorrelationFromHeaders}.
 *
 * Because this is the one place outbound headers are written, it is also where
 * the W3C `traceparent` is injected. That is deliberate: tracing is only useful
 * if *every* hop propagates, and one publish path that forgot would break the
 * tree for every request through it. Adding a new publish path here cannot
 * forget, because it gets propagation by calling the function it already had to
 * call. The correlation id is untouched and stays user facing (section 4.4).
 */
export function buildNatsHeaders(overrides?: {
  correlationId?: string;
  locale?: SupportedLocale;
}): MsgHdrs {
  const hdrs = createNatsHeaders();
  const correlationId = overrides?.correlationId ?? getCorrelationId();
  if (correlationId) {
    hdrs.set(CORRELATION_ID_HEADER, correlationId);
  }
  if (overrides?.locale) {
    hdrs.set(LOCALE_HEADER, overrides.locale);
  }
  injectTraceContext(hdrs);
  return hdrs;
}

/** Reads the correlation id from inbound NATS headers, if present. */
export function readCorrelationFromHeaders(
  hdrs: MsgHdrs | undefined
): string | undefined {
  const value = hdrs?.get(CORRELATION_ID_HEADER);
  return value ? value : undefined;
}

/** Reads the request locale from inbound NATS headers, if present and supported. */
export function readLocaleFromHeaders(
  hdrs: MsgHdrs | undefined
): SupportedLocale | undefined {
  return toSupportedLocale(hdrs?.get(LOCALE_HEADER));
}
