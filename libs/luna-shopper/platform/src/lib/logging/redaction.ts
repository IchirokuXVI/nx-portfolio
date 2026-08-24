/**
 * Secrets never reach the log (plan 0004, section 1, Redaction).
 *
 * Reproducibility from the log must never mean logging a credential. These are
 * the pino `redact` paths applied to every service's logger: passwords, access
 * and refresh tokens, `authorization` headers, cookies, and OAuth secrets are
 * replaced with `[Redacted]` wherever they appear in the logged request, response
 * or bound object. Paths are matched case sensitively by pino, so common casings
 * of the HTTP headers are listed explicitly.
 */
export const REDACTION_PATHS: string[] = [
  // Bound object fields (request bodies, event payloads, assigned context).
  'password',
  '*.password',
  'currentPassword',
  'newPassword',
  'token',
  'accessToken',
  'refreshToken',
  '*.accessToken',
  '*.refreshToken',
  'clientSecret',
  '*.clientSecret',
  // HTTP headers as serialized by pino-http (req.headers / res.headers).
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',
];

/** The marker pino writes in place of a redacted value. */
export const REDACTION_CENSOR = '[Redacted]';
