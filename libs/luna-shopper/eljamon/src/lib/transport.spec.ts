import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { ElJamonTimeoutError, createElJamonFetch } from './transport';

/**
 * The transport against a server on the loopback interface, started by the
 * test. Nothing here leaves the machine: the storefront itself is never asked.
 */

let server: Server;
let base: string;
let handler: (request: IncomingMessage, response: ServerResponse) => void;

beforeAll(async () => {
  server = createServer((request, response) => handler(request, response));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('createElJamonFetch', () => {
  it('fails a request whose server stays silent, with a timeout error', async () => {
    // Accepts the request and never answers.
    handler = () => undefined;
    const fetchImpl = createElJamonFetch([], { timeoutMs: 50 });

    await expect(fetchImpl(`${base}/silent`)).rejects.toBeInstanceOf(
      ElJamonTimeoutError
    );
  });

  it('answers the abort signal with its reason', async () => {
    handler = () => undefined;
    const controller = new AbortController();
    const reason = new Error('run cancelled');
    const fetchImpl = createElJamonFetch([], { timeoutMs: 5_000 });

    const pending = fetchImpl(`${base}/silent`, { signal: controller.signal });
    setTimeout(() => controller.abort(reason), 20);

    await expect(pending).rejects.toBe(reason);
  });

  it('keeps a cookie a redirect sets: sent on the next request and on the final response', async () => {
    const cookies: Array<string | undefined> = [];
    handler = (request, response) => {
      cookies.push(request.headers.cookie);
      if (request.url === '/start') {
        response.writeHead(302, {
          location: '/end',
          'set-cookie': ['JSESSIONID=s1; Path=/; HttpOnly'],
        });
        response.end();
        return;
      }
      response.writeHead(200, { 'set-cookie': ['GCLB=backend-a; Path=/'] });
      response.end('done');
    };
    const fetchImpl = createElJamonFetch([]);

    const response = await fetchImpl(`${base}/start`, {
      headers: { cookie: 'JSESSIONID=old; other=1' },
    });

    expect(await response.text()).toBe('done');
    expect(cookies).toEqual([
      'JSESSIONID=old; other=1',
      'JSESSIONID=s1; other=1',
    ]);
    expect(response.headers.getSetCookie()).toEqual([
      'JSESSIONID=s1; Path=/; HttpOnly',
      'GCLB=backend-a; Path=/',
    ]);
  });
});
