import type { INestApplication } from '@nestjs/common';

/**
 * How many proxies stand between the public internet and a Luna HTTP service.
 *
 * One: Envoy Gateway. It ends the client's connection and opens its own to the
 * pod, so the socket address a pod sees is always Envoy's, for every caller.
 * Envoy appends the address it accepted the connection from to
 * `X-Forwarded-For`, and that address is the real client because the data plane
 * Service keeps Envoy Gateway's default `externalTrafficPolicy: Local`, which
 * MetalLB honours without rewriting the source.
 *
 * So the client is the **last** entry, never the first. Everything to the left
 * of Envoy's entry arrived from the client itself and can say anything.
 *
 * Found in production on 2026-09-26: with no proxy trusted, the rate limiter
 * keyed every request on Envoy's address, so the whole of velista shared one
 * 120 a minute bucket and one 5 a minute login bucket, and a request from a
 * second address was refused for what a first had spent.
 *
 * A request that arrives with no header at all (a local slot, a spec, a probe
 * from inside the cluster) falls back to the socket address, which is what it
 * would have been anyway.
 */
export const TRUSTED_PROXY_HOPS = 1;

/**
 * The client address of a request, by the same rule Express applies once
 * {@link trustReverseProxy} has run.
 *
 * Kept as a function of the raw header so the correlation middleware, which runs
 * on requests Express has not yet decorated, cannot drift from what the rate
 * limiter reads from `req.ip`.
 */
export function clientAddress(
  forwardedFor: string | undefined,
  socketAddress: string | undefined,
  hops: number = TRUSTED_PROXY_HOPS
): string | undefined {
  const entries = (forwardedFor ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  if (entries.length === 0) {
    return socketAddress;
  }
  // `hops` proxies each appended one entry, so the client is `hops` from the
  // right. A header shorter than that means the chain is not what this
  // service was told, and the leftmost entry is the nearest thing to a client.
  return entries[Math.max(0, entries.length - hops)];
}

/**
 * Makes `req.ip` the client's address rather than the proxy's.
 *
 * Express reads `X-Forwarded-For` from the right and skips exactly as many
 * entries as it is told to trust, which is the rule {@link clientAddress}
 * states. The throttler keys on `req.ip`, so this is what turns its buckets
 * from one for everybody into one per client.
 */
export function trustReverseProxy(app: INestApplication): void {
  const instance = app.getHttpAdapter().getInstance() as {
    set?: (name: string, value: unknown) => unknown;
  };
  if (typeof instance.set !== 'function') {
    throw new Error(
      'trustReverseProxy needs the Express adapter, and this app is not on it.'
    );
  }
  instance.set('trust proxy', TRUSTED_PROXY_HOPS);
}
