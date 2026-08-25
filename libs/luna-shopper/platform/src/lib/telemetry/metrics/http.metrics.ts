import {
  createAllowListAttributesProcessor,
  type ViewOptions,
} from '@opentelemetry/sdk-metrics';

/**
 * HTTP RED metrics (plan 0016, section 5.2).
 *
 * Request count, error count and a duration histogram are **not** hand written
 * here: the `http` auto instrumentation already emits them from the same hooks
 * that produce the HTTP spans, so instrumenting them again would measure the
 * same thing twice and let the two disagree (section 3).
 *
 * What this file contributes is the cardinality guard from section 5.3. The
 * instrumentation labels its metrics from the semantic conventions, and some of
 * those attributes carry the resolved request path, which is unbounded: one
 * permanent time series per zone id in a URL. The views below allow list the
 * attributes that are bounded and drop everything else, so the metric is
 * labelled by method, **route template** and status code, never by
 * `/v1/zones/6f2b.../lists`.
 *
 * Both the current and the previous semantic convention attribute names are
 * allowed, so a dependency bump that renames them degrades to fewer labels
 * rather than to none.
 */

/** Bounded attributes, current semantic conventions plus the older spellings. */
export const ALLOWED_HTTP_METRIC_ATTRIBUTES: readonly string[] = [
  // Current (stable) HTTP semantic conventions.
  'http.request.method',
  'http.response.status_code',
  'http.route',
  'network.protocol.version',
  'url.scheme',
  'server.address',
  'server.port',
  'error.type',
  // Previous spellings, still emitted by some instrumentation versions.
  'http.method',
  'http.status_code',
  'http.flavor',
  'http.scheme',
  'net.host.name',
  'net.host.port',
  'net.peer.name',
];

/**
 * Views applied to every instrument the HTTP instrumentation creates. Registered
 * once by the SDK bootstrap, so no service configures this.
 */
export function httpMetricViews(): ViewOptions[] {
  const allowList = () =>
    createAllowListAttributesProcessor([...ALLOWED_HTTP_METRIC_ATTRIBUTES]);

  return [
    {
      instrumentName: 'http.server.*',
      attributesProcessors: [allowList()],
    },
    {
      instrumentName: 'http.client.*',
      attributesProcessors: [allowList()],
    },
  ];
}
