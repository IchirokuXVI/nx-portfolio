/**
 * An admin session against a Luna gateway (plan 0001).
 *
 * A plain module, not a process. The two curation deciders import it, and it
 * owns everything about talking to a gateway as an admin: the base url, the
 * login, the bearer header, the one refresh a 401 is allowed, and the JSON
 * parsing. Nothing model shaped ever holds a token, because nothing model
 * shaped ever holds one of these.
 *
 * Zero npm dependencies, Node built ins only. Not browser reachable: this
 * library is never added to `tsconfig.base.json` paths and no app may import
 * it.
 */

/** The development convention: the admin `luna-slot` seeds, with no password. */
export const DEFAULT_ADMIN_USERNAME = 'dev-admin';
export const DEFAULT_ADMIN_PASSWORD = '';

const LOGIN_PATH = '/v1/admin/auth/login';
const ME_PATH = '/v1/admin/auth/me';

/**
 * An error a caller can branch on.
 *
 * `status` is the HTTP status the gateway answered, so a decider can tell a
 * 404 (this id does not exist) from a 500 (the run is over) without reading
 * the message.
 */
export class GatewayError extends Error {
  constructor(message, { status = null, url = null, body = null } = {}) {
    super(message);
    this.name = 'GatewayError';
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

/** Reads a failed response's body without letting the read itself throw. */
async function safeText(response) {
  try {
    const text = await response.text();
    return text.length > 500 ? `${text.slice(0, 500)}...` : text;
  } catch {
    return '';
  }
}

/**
 * Appends a query object to a path, dropping empty values.
 *
 * It lives here rather than in each decider because both of them page and
 * search, and two copies of this would drift on what counts as empty.
 */
function withQuery(path, query) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') {
      continue;
    }
    search.set(key, String(value));
  }
  return search.size
    ? `${path}${path.includes('?') ? '&' : '?'}${search}`
    : path;
}

/**
 * Creates an admin session against one gateway.
 *
 * @param {object} options
 * @param {string} options.baseUrl The gateway origin, with or without a trailing slash.
 * @param {string} [options.username] Defaults to `dev-admin`.
 * @param {string} [options.password] Defaults to the empty password.
 * @param {Function} [options.fetchImpl] Injected in every test; defaults to the global fetch.
 * @param {string} [options.label] What to call this gateway in an error, for example `main`.
 */
export function createAdminSession({
  baseUrl,
  username = DEFAULT_ADMIN_USERNAME,
  password = DEFAULT_ADMIN_PASSWORD,
  fetchImpl = globalThis.fetch,
  label = null,
} = {}) {
  if (!baseUrl) {
    throw new Error('createAdminSession needs a baseUrl');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('createAdminSession needs a fetch implementation');
  }

  const base = String(baseUrl).replace(/\/+$/, '');
  const who = label ? `${label} gateway ${base}` : `gateway ${base}`;

  let accessToken = null;
  let loginInFlight = null;

  /** One request, exactly as written, with whatever token is current. */
  async function send(path, { method = 'GET', body, headers, query } = {}) {
    const url = `${base}${withQuery(path, query)}`;
    const encoded =
      body === undefined || typeof body === 'string'
        ? body
        : JSON.stringify(body);

    return fetchImpl(url, {
      method,
      headers: {
        accept: 'application/json',
        ...(encoded === undefined
          ? {}
          : { 'content-type': 'application/json' }),
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        ...(headers ?? {}),
      },
      ...(encoded === undefined ? {} : { body: encoded }),
    });
  }

  /**
   * Signs in and keeps the token.
   *
   * Concurrent callers share one login rather than racing two, so a pair of
   * searches that both meet an expired token spend one round trip and not two.
   */
  function login() {
    if (loginInFlight) {
      return loginInFlight;
    }
    loginInFlight = (async () => {
      accessToken = null;
      const response = await send(LOGIN_PATH, {
        method: 'POST',
        body: { username, password },
      });
      if (!response.ok) {
        throw new GatewayError(
          `the login for ${username} on the ${who} answered ${response.status}: ${await safeText(response)}`,
          { status: response.status, url: `${base}${LOGIN_PATH}` }
        );
      }
      const tokens = await response.json();
      if (!tokens?.accessToken) {
        throw new GatewayError(
          `the login for ${username} on the ${who} answered no access token`,
          { status: response.status, url: `${base}${LOGIN_PATH}` }
        );
      }
      accessToken = tokens.accessToken;
      return tokens;
    })().finally(() => {
      loginInFlight = null;
    });
    return loginInFlight;
  }

  /** Parses an answer, or throws a `GatewayError` naming what failed. */
  async function read(response, method, url) {
    if (!response.ok) {
      const text = await safeText(response);
      throw new GatewayError(
        `${method} ${url} answered ${response.status}: ${text}`,
        {
          status: response.status,
          url,
          body: text,
        }
      );
    }
    if (response.status === 204) {
      return null;
    }
    const text = await response.text();
    if (text === '') {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new GatewayError(
        `${method} ${url} answered a body that is not JSON`,
        {
          status: response.status,
          url,
          body: text,
        }
      );
    }
  }

  return {
    baseUrl: base,
    username,
    label,

    /**
     * The one way through.
     *
     * A 401 buys exactly one login and one retry. A refresh loop that retries
     * forever turns a revoked admin into an infinite hammer on the login
     * route, so a second 401 is a real error and the caller sees it.
     */
    async fetch(path, init = {}) {
      const method = init.method ?? 'GET';
      const url = `${base}${withQuery(path, init.query)}`;

      if (!accessToken) {
        await login();
      }

      let response = await send(path, init);
      if (response.status === 401) {
        await login();
        response = await send(path, init);
      }
      return read(response, method, url);
    },

    /**
     * Proves the login works before anything else runs.
     *
     * It signs in and then reads `me`, because those are two different
     * questions: a gateway with development autologin on issues a token for
     * any password, and only presenting it to the admin guard proves the token
     * is accepted. The error names the gateway and the username, so an
     * operator can see which of the two logins failed and as whom.
     */
    async verify() {
      try {
        await login();
        const response = await send(ME_PATH);
        return await read(response, 'GET', `${base}${ME_PATH}`);
      } catch (error) {
        throw new GatewayError(
          `could not sign in as ${username} on the ${who}: ${error.message}`,
          { status: error.status ?? null, url: error.url ?? base }
        );
      }
    },
  };
}
