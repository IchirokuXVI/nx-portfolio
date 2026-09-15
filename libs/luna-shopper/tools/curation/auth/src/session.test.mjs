import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createAdminSession,
  DEFAULT_ADMIN_PASSWORD,
  DEFAULT_ADMIN_USERNAME,
  GatewayError,
} from './session.mjs';

/**
 * A fake fetch. No test in this file touches a network.
 *
 * `handlers` is a list of functions taking `(url, init)` and answering either a
 * response description or `undefined` to pass the call to the next handler.
 * Every call is recorded in `calls`, which is what the assertions read.
 */
function fakeFetch(handler) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({
      url,
      init,
      body: init?.body ? JSON.parse(init.body) : undefined,
    });
    const answer = handler(url, init, calls.length) ?? {
      status: 500,
      body: {},
    };
    return {
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      async text() {
        if (answer.text !== undefined) {
          return answer.text;
        }
        return answer.body === undefined ? '' : JSON.stringify(answer.body);
      },
      async json() {
        return answer.body;
      },
    };
  };
  impl.calls = calls;
  return impl;
}

const OK_LOGIN = { status: 201, body: { accessToken: 'token-1' } };

function tokenOf(call) {
  return call.init.headers.authorization;
}

describe('createAdminSession', () => {
  it('refuses to be built without a base url', () => {
    assert.throws(
      () => createAdminSession({ fetchImpl: fakeFetch(() => OK_LOGIN) }),
      {
        message: /needs a baseUrl/,
      }
    );
  });

  it('logs in on the first request and carries the token', async () => {
    const fetchImpl = fakeFetch((url) =>
      url.endsWith('/v1/admin/auth/login')
        ? OK_LOGIN
        : { status: 200, body: { items: [{ id: 'i1' }] } }
    );
    const session = createAdminSession({
      baseUrl: 'http://localhost:3000/',
      username: 'someone',
      password: 'secret',
      fetchImpl,
    });

    const answer = await session.fetch('/v1/admin/catalog/items');

    assert.deepEqual(answer, { items: [{ id: 'i1' }] });
    assert.equal(fetchImpl.calls.length, 2);
    assert.equal(
      fetchImpl.calls[0].url,
      'http://localhost:3000/v1/admin/auth/login'
    );
    assert.equal(fetchImpl.calls[0].init.method, 'POST');
    assert.deepEqual(fetchImpl.calls[0].body, {
      username: 'someone',
      password: 'secret',
    });
    assert.equal(
      fetchImpl.calls[1].url,
      'http://localhost:3000/v1/admin/catalog/items'
    );
    assert.equal(tokenOf(fetchImpl.calls[1]), 'Bearer token-1');
  });

  // A gateway with ADMIN_DEV_AUTOLOGIN on ignores the body, but AdminLoginDto
  // validates before the handler reads it, so an empty password is a 400 rather
  // than a passwordless session. The default has to be the password stack.sh
  // seeds.
  it('sends the development admin and the password every slot seeds', async () => {
    const fetchImpl = fakeFetch(() => OK_LOGIN);
    const session = createAdminSession({
      baseUrl: 'http://localhost:3000',
      fetchImpl,
    });

    await session.fetch('/v1/admin/auth/login', { method: 'POST' });

    assert.deepEqual(fetchImpl.calls[0].body, {
      username: DEFAULT_ADMIN_USERNAME,
      password: DEFAULT_ADMIN_PASSWORD,
    });
    assert.equal(fetchImpl.calls[0].body.username, 'dev-admin');
    assert.equal(fetchImpl.calls[0].body.password, 'dev-admin-password');
  });

  it('reuses the token across requests and logs in once', async () => {
    const fetchImpl = fakeFetch((url) =>
      url.endsWith('/v1/admin/auth/login')
        ? OK_LOGIN
        : { status: 200, body: { ok: true } }
    );
    const session = createAdminSession({
      baseUrl: 'http://localhost:3000',
      fetchImpl,
    });

    await session.fetch('/a');
    await session.fetch('/b');

    const logins = fetchImpl.calls.filter((call) =>
      call.url.endsWith('/login')
    );
    assert.equal(logins.length, 1);
  });

  it('logs in once for two requests that start together', async () => {
    const fetchImpl = fakeFetch((url) =>
      url.endsWith('/v1/admin/auth/login')
        ? OK_LOGIN
        : { status: 200, body: { ok: true } }
    );
    const session = createAdminSession({
      baseUrl: 'http://localhost:3000',
      fetchImpl,
    });

    await Promise.all([session.fetch('/a'), session.fetch('/b')]);

    const logins = fetchImpl.calls.filter((call) =>
      call.url.endsWith('/login')
    );
    assert.equal(logins.length, 1);
  });

  it('refreshes once on a 401 and retries the request with the new token', async () => {
    let issued = 0;
    const fetchImpl = fakeFetch((url) => {
      if (url.endsWith('/v1/admin/auth/login')) {
        issued += 1;
        return { status: 201, body: { accessToken: `token-${issued}` } };
      }
      return issued === 1
        ? { status: 401, body: { message: 'expired' } }
        : { status: 200, body: { items: [] } };
    });
    const session = createAdminSession({
      baseUrl: 'http://localhost:3000',
      fetchImpl,
    });

    const answer = await session.fetch('/v1/admin/harvest/entries');

    assert.deepEqual(answer, { items: [] });
    const urls = fetchImpl.calls.map((call) =>
      call.url.replace('http://localhost:3000', '')
    );
    assert.deepEqual(urls, [
      '/v1/admin/auth/login',
      '/v1/admin/harvest/entries',
      '/v1/admin/auth/login',
      '/v1/admin/harvest/entries',
    ]);
    assert.equal(tokenOf(fetchImpl.calls[1]), 'Bearer token-1');
    assert.equal(tokenOf(fetchImpl.calls[3]), 'Bearer token-2');
  });

  it('fails on a second 401 rather than refreshing again', async () => {
    const fetchImpl = fakeFetch((url) =>
      url.endsWith('/v1/admin/auth/login')
        ? OK_LOGIN
        : { status: 401, text: 'Unauthorized' }
    );
    const session = createAdminSession({
      baseUrl: 'http://localhost:3000',
      fetchImpl,
    });

    const error = await session.fetch('/v1/admin/catalog/items').then(
      () => null,
      (thrown) => thrown
    );

    assert.ok(error instanceof GatewayError);
    assert.equal(error.status, 401);
    assert.match(error.message, /answered 401/);
    const logins = fetchImpl.calls.filter((call) =>
      call.url.endsWith('/login')
    );
    assert.equal(logins.length, 2);
    assert.equal(fetchImpl.calls.length, 4);
  });

  it('names the gateway and the username when verify meets a wrong password', async () => {
    const fetchImpl = fakeFetch(() => ({
      status: 401,
      text: 'Invalid credentials',
    }));
    const session = createAdminSession({
      baseUrl: 'http://localhost:43000',
      username: 'dev-admin',
      password: 'wrong',
      fetchImpl,
      label: 'rehearsal',
    });

    const error = await session.verify().then(
      () => null,
      (thrown) => thrown
    );

    assert.ok(error instanceof GatewayError);
    assert.match(error.message, /dev-admin/);
    assert.match(error.message, /rehearsal gateway http:\/\/localhost:43000/);
  });

  it('verify proves the token against the admin guard, not only the login', async () => {
    const fetchImpl = fakeFetch((url) =>
      url.endsWith('/v1/admin/auth/login')
        ? OK_LOGIN
        : { status: 403, text: 'Forbidden' }
    );
    const session = createAdminSession({
      baseUrl: 'http://localhost:3000',
      fetchImpl,
      label: 'main',
    });

    await assert.rejects(
      () => session.verify(),
      /could not sign in as dev-admin/
    );
    assert.ok(
      fetchImpl.calls.some((call) => call.url.endsWith('/v1/admin/auth/me'))
    );
  });

  it('verify answers the me view when the login works', async () => {
    const me = {
      admin: { id: 'a1', username: 'dev-admin' },
      environment: 'local',
    };
    const fetchImpl = fakeFetch((url) =>
      url.endsWith('/v1/admin/auth/login')
        ? OK_LOGIN
        : { status: 200, body: me }
    );
    const session = createAdminSession({
      baseUrl: 'http://localhost:3000',
      fetchImpl,
    });

    assert.deepEqual(await session.verify(), me);
  });

  it('fails when the login answers no access token', async () => {
    const fetchImpl = fakeFetch(() => ({
      status: 201,
      body: { refreshToken: 'nope' },
    }));
    const session = createAdminSession({
      baseUrl: 'http://localhost:3000',
      fetchImpl,
    });

    await assert.rejects(() => session.fetch('/a'), /answered no access token/);
  });

  it('builds a query string and drops empty values', async () => {
    const fetchImpl = fakeFetch((url) =>
      url.includes('/login') ? OK_LOGIN : { status: 200, body: { items: [] } }
    );
    const session = createAdminSession({
      baseUrl: 'http://localhost:3000',
      fetchImpl,
    });

    await session.fetch('/v1/admin/catalog/items', {
      query: { query: 'leche entera', limit: 10, cursor: undefined, order: '' },
    });

    assert.equal(
      fetchImpl.calls[1].url,
      'http://localhost:3000/v1/admin/catalog/items?query=leche+entera&limit=10'
    );
  });

  it('answers null for a 204 and for an empty body', async () => {
    const fetchImpl = fakeFetch((url, init, call) => {
      if (url.includes('/login')) {
        return OK_LOGIN;
      }
      return call === 2 ? { status: 204 } : { status: 200, text: '' };
    });
    const session = createAdminSession({
      baseUrl: 'http://localhost:3000',
      fetchImpl,
    });

    assert.equal(await session.fetch('/a', { method: 'DELETE' }), null);
    assert.equal(await session.fetch('/b'), null);
  });

  it('carries the status of a failure so a caller can branch on it', async () => {
    const fetchImpl = fakeFetch((url) =>
      url.includes('/login') ? OK_LOGIN : { status: 404, text: 'Not Found' }
    );
    const session = createAdminSession({
      baseUrl: 'http://localhost:3000',
      fetchImpl,
    });

    const error = await session.fetch('/v1/admin/catalog/items/missing').then(
      () => null,
      (thrown) => thrown
    );

    assert.equal(error.status, 404);
    assert.equal(error.body, 'Not Found');
    assert.match(
      error.message,
      /GET http:\/\/localhost:3000\/v1\/admin\/catalog\/items\/missing/
    );
  });

  it('reports a body that is not JSON rather than throwing a parse error', async () => {
    const fetchImpl = fakeFetch((url) =>
      url.includes('/login')
        ? OK_LOGIN
        : { status: 200, text: '<html>gateway</html>' }
    );
    const session = createAdminSession({
      baseUrl: 'http://localhost:3000',
      fetchImpl,
    });

    await assert.rejects(
      () => session.fetch('/a'),
      /answered a body that is not JSON/
    );
  });
});
