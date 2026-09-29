import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { rootCertificates } from 'node:tls';

/**
 * The intermediate certificate `www.supermercadoseljamon.com` fails to send.
 *
 * The storefront's leaf is issued by **Sectigo Public Server Authentication CA
 * EV R36**, but the server sends a different Sectigo intermediate beside it
 * (checked on 2026-09-29). A browser, and curl on Windows, repair that by
 * fetching the missing certificate from the leaf's Authority Information Access
 * URL. Node does neither, so its `fetch` refuses every request with
 * `UNABLE_TO_VERIFY_LEAF_SIGNATURE`.
 *
 * So the one missing link is pinned here, fetched from
 * `http://crt.sectigo.com/SectigoPublicServerAuthenticationCAEVR36.crt`. It is
 * signed by Sectigo Public Server Authentication Root R46, which is in Node's
 * own root store, and it is valid until 2036-03-21. Nothing is trusted that a
 * browser would not trust: verification still runs, against Node's roots plus
 * this certificate. **Do not replace this with `rejectUnauthorized: false`.**
 *
 * SHA-256 fingerprint:
 * 7A:1A:24:28:5E:25:E9:4D:F2:7C:E8:B3:44:B1:BB:6B:32:F0:25:4F:F0:D7:B5:AB:6E:85:6A:E9:0C:FD:E5:5C
 */
export const SECTIGO_EV_R36_PEM = [
  '-----BEGIN CERTIFICATE-----',
  'MIIGSzCCBDOgAwIBAgIQbU98rTNTd8jG4AHd4uLIjjANBgkqhkiG9w0BAQwFADBf',
  'MQswCQYDVQQGEwJHQjEYMBYGA1UEChMPU2VjdGlnbyBMaW1pdGVkMTYwNAYDVQQD',
  'Ey1TZWN0aWdvIFB1YmxpYyBTZXJ2ZXIgQXV0aGVudGljYXRpb24gUm9vdCBSNDYw',
  'HhcNMjEwMzIyMDAwMDAwWhcNMzYwMzIxMjM1OTU5WjBgMQswCQYDVQQGEwJHQjEY',
  'MBYGA1UEChMPU2VjdGlnbyBMaW1pdGVkMTcwNQYDVQQDEy5TZWN0aWdvIFB1Ymxp',
  'YyBTZXJ2ZXIgQXV0aGVudGljYXRpb24gQ0EgRVYgUjM2MIIBojANBgkqhkiG9w0B',
  'AQEFAAOCAY8AMIIBigKCAYEApduwxkQH5noeb0k4yRXK47Fd+hVkH8twKWQF3FNm',
  'HHShQrOH7S0L3p8Aaf8P7OqojwyZgyqD5o/Sb95N45P/NfmL+lfAOkQ1Bpvz0OcZ',
  'VmwYhMWFYJe8parkz5w9Bk8mn/AtN65hIQF0NqBI6F+23/jzhlpl3E0zKkkUJSfT',
  'dgvwaJvTiPgLQ7CpYyLJvMpgdPHf+nnvA5YJjhae6olh6BRllvRhzKOq0gd60BrO',
  'Aos9QyOfYhUDG3eQovMA9fyiI2qNclCp6DY8hqt55lERoBS/Whza8Cx1bh6q8rTP',
  'nno2uI6FZb2UavIYblyGDamXAW/jv3qsMB42xz/p2mUHg0wQzn/8KAiyu2ZbDs7E',
  'OOwYx0V2ViNsCXGR/GCmJsUNPmhEEXBclOj6qF7rFf7nkST2bokSt9VF1NB1JgRl',
  'djZin1+v2Vm88UEgFxerQPPrPjAEMqDx44vKl22sGWnl+jOyxf/H59DHKbIezrIY',
  'rJpSnA3WEVaiXs1oIRy1ZziNAgMBAAGjggGAMIIBfDAfBgNVHSMEGDAWgBRWc1hk',
  'lfmSGrASKgRieaFAFYghSTAdBgNVHQ4EFgQUmC1eHo/rVPS5/1WVrUzHfqSYrnsw',
  'DgYDVR0PAQH/BAQDAgGGMBIGA1UdEwEB/wQIMAYBAf8CAQAwHQYDVR0lBBYwFAYI',
  'KwYBBQUHAwEGCCsGAQUFBwMCMBoGA1UdIAQTMBEwBgYEVR0gADAHBgVngQwBATBU',
  'BgNVHR8ETTBLMEmgR6BFhkNodHRwOi8vY3JsLnNlY3RpZ28uY29tL1NlY3RpZ29Q',
  'dWJsaWNTZXJ2ZXJBdXRoZW50aWNhdGlvblJvb3RSNDYuY3JsMIGEBggrBgEFBQcB',
  'AQR4MHYwTwYIKwYBBQUHMAKGQ2h0dHA6Ly9jcnQuc2VjdGlnby5jb20vU2VjdGln',
  'b1B1YmxpY1NlcnZlckF1dGhlbnRpY2F0aW9uUm9vdFI0Ni5wN2MwIwYIKwYBBQUH',
  'MAGGF2h0dHA6Ly9vY3NwLnNlY3RpZ28uY29tMA0GCSqGSIb3DQEBDAUAA4ICAQA2',
  'LRCehSXiyw56alKt2aqDwDLEDmyu74lUmDG4rI1Jw3+ivLz+OK3NpE466a8yXu7b',
  'f326wkrrOCF2SVu3ItNjXqsgwXdIM9tapVEKjsEwbjcPUcxNeqzSpLSgHZIVhjJJ',
  '+QtdEL2n1NhDxqewlN+ZKWWBLGB0LA/S7SvCl9s7rsppo97uv6J3h//q4b2SgzHu',
  'KUu80Hofpjp2bILGHy4CqzKzyg3wn9sKFcX6Ufkcea/tuiWhIMPkiQCv5tXsRj+H',
  'n3CZql+wRPbjhNqncCkzrwOBrt7Gov46EHhqMUP/Euf8gSw7X+CzWEUJ0Q+Vn8VL',
  'ZDkiKcMSYMJI+6Trc5tVn9LQLI6tTzwagLhgcVtFpom3PVtEJRPN/d05L0ck7S1b',
  'xPaXcQhKUqdzFd09pt6fLx2vMmylBKXjKosSxjB12KRzLvI2CUUVdpl7OTFA32Fk',
  '+zQC2gJPGmPPCzRMRYfVOEIZxbG0nI9lpYZidLkQ/EyTtJ3JVj7cb3KRe/e1s+Xj',
  'rnHqbUwoizicfogtcKm5giwj74f+Rpr0RRy4xum1bC662fNHRJaTt5ErVR6gHjHM',
  'Zhp+tOeOvohq5XxIMCKuetnwcPeBsOzUBzmUPoxQNRVXEYbwV2rS3t2jJ0Zh/Dnn',
  'O96biaAsEnxbQyu4fvMx6D4J4Zbkc7Zp75T3GE/UjQ==',
  '-----END CERTIFICATE-----',
].join('\n');

/** How many redirects one request follows before it gives up, as `fetch` does. */
const MAX_REDIRECTS = 5;

/**
 * A `fetch` over Node's own `https`, trusting Node's roots plus
 * {@link SECTIGO_EV_R36_PEM}.
 *
 * A built in module rather than an HTTP dependency, so the library stays
 * dependency free (plan 0169, section 6). It implements the part of `fetch` the
 * client uses and no more: a method, string headers, a string body, an abort
 * signal, redirects, and a `Response` whose `Set-Cookie` lines survive, because
 * the client keeps the session by hand.
 *
 * No `accept-encoding` is sent, so the body arrives as it is and nothing here
 * has to decompress it.
 */
export function createElJamonFetch(
  extraCertificates: readonly string[] = [SECTIGO_EV_R36_PEM]
): typeof fetch {
  const ca = [...rootCertificates, ...extraCertificates];

  const send = (
    url: URL,
    init: RequestInit,
    redirects: number
  ): Promise<Response> =>
    new Promise<Response>((resolve, reject) => {
      const signal = init.signal ?? undefined;
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      const secure = url.protocol === 'https:';
      const body = typeof init.body === 'string' ? init.body : null;
      const headers = headersOf(init.headers);
      if (body !== null) {
        // Stated rather than chunked: the locator's server waits for the end of
        // a chunked body that never comes, and `fetch` states it too.
        headers['content-length'] = String(Buffer.byteLength(body));
      }
      const request = (secure ? httpsRequest : httpRequest)(
        url,
        {
          method: init.method ?? 'GET',
          headers,
          ...(secure ? { ca } : {}),
          signal,
        },
        (incoming) => {
          const status = incoming.statusCode ?? 0;
          const location = incoming.headers.location;
          if (location && REDIRECTS.has(status) && redirects < MAX_REDIRECTS) {
            incoming.resume();
            const keepsMethod = status === 307 || status === 308;
            resolve(
              send(
                new URL(location, url),
                keepsMethod
                  ? init
                  : { ...init, method: 'GET', body: undefined },
                redirects + 1
              )
            );
            return;
          }
          const chunks: Buffer[] = [];
          incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
          incoming.on('error', reject);
          incoming.on('end', () => {
            const headers = new Headers();
            const raw = incoming.rawHeaders;
            for (let index = 0; index + 1 < raw.length; index += 2) {
              headers.append(raw[index], raw[index + 1]);
            }
            const empty = status === 204 || status === 304;
            resolve(
              new Response(empty ? null : Buffer.concat(chunks), {
                status,
                statusText: incoming.statusMessage,
                headers,
              })
            );
          });
        }
      );
      request.on('error', reject);
      if (body !== null) {
        request.write(body);
      }
      request.end();
    });

  return ((input: string | URL | Request, init?: RequestInit) =>
    send(
      new URL(
        typeof input === 'string' || input instanceof URL ? input : input.url
      ),
      init ?? {},
      0
    )) as typeof fetch;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

function headersOf(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) {
    return {};
  }
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return { ...(headers as Record<string, string>) };
}
