import {
  HttpClient,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { RokuTranslatorService } from '@portfolio/localization/rokutranslator-angular';
import { APP_API_CONFIG, type SessionTokens } from '@portfolio/velista/models';
import { BrowserFacade, ConnectionState } from '@portfolio/velista/platform';
import { anonymous } from './auth/http-context';
import { TokenStore } from './auth/token-store';
import { GatewayError, NetworkError } from './errors';
import { gatewayInterceptor } from './gateway-interceptor';

const GATEWAY = 'https://gateway.example';

/**
 * Lets the refresh promise settle.
 *
 * Only the refresh path is asynchronous: a request holding a valid token is issued
 * synchronously, deliberately, so that nothing in the app is reordered by a token
 * lookup that had nothing to do.
 */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** A JWT whose exp is far in the future, so nothing refreshes proactively. */
function freshToken(): string {
  return jwt(Math.floor(Date.now() / 1000) + 3600);
}

/** A JWT that expired an hour ago. */
function staleToken(): string {
  return jwt(Math.floor(Date.now() / 1000) - 3600);
}

function jwt(exp: number): string {
  const encode = (value: object) =>
    btoa(JSON.stringify(value))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${encode({ alg: 'RS256' })}.${encode({ exp, sub: 'u1' })}.sig`;
}

function pair(
  accessToken: string,
  kind: 'TEMPORARY' | 'REGISTERED' = 'REGISTERED'
): SessionTokens {
  return { userId: 'u1', kind, accessToken, refreshToken: 'refresh-1' };
}

describe('gatewayInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let tokens: TokenStore;
  let storage: Map<string, string>;

  beforeEach(() => {
    storage = new Map();

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([gatewayInterceptor])),
        provideHttpClientTesting(),
        {
          provide: APP_API_CONFIG,
          useValue: {
            gatewayBaseUrl: GATEWAY,
            realtimeBaseUrl: 'https://realtime.example',
          },
        },
        {
          provide: RokuTranslatorService,
          useValue: { getLocale: () => 'es' },
        },
        {
          provide: BrowserFacade,
          useValue: {
            onLine: () => true,
            readStorage: (k: string) => storage.get(k) ?? null,
            writeStorage: (k: string, v: string) => void storage.set(k, v),
            removeStorage: (k: string) => void storage.delete(k),
          },
        },
      ],
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    tokens = TestBed.inject(TokenStore);
  });

  afterEach(() => httpMock.verify());

  describe('scope', () => {
    it('never attaches a bearer token to a non gateway origin', async () => {
      // The interceptor is global. This is the only thing standing between the app
      // and leaking its token to a third party.
      tokens.set(pair(freshToken()));

      const done = firstValue(http.get('https://evil.test/collect'));
      const req = httpMock.expectOne('https://evil.test/collect');

      expect(req.request.headers.has('Authorization')).toBe(false);
      expect(req.request.headers.has('x-correlation-id')).toBe(false);
      req.flush({});
      await done;
    });

    it('does not match an origin that is only a prefix of the host', async () => {
      tokens.set(pair(freshToken()));

      const done = firstValue(http.get(`${GATEWAY}.evil.test/collect`));
      const req = httpMock.expectOne(`${GATEWAY}.evil.test/collect`);

      expect(req.request.headers.has('Authorization')).toBe(false);
      req.flush({});
      await done;
    });
  });

  describe('headers', () => {
    it('sets authorization, accept-language and a correlation id', async () => {
      const token = freshToken();
      tokens.set(pair(token));

      const done = firstValue(http.get(`${GATEWAY}/v1/zones`));
      const req = httpMock.expectOne(`${GATEWAY}/v1/zones`);

      expect(req.request.headers.get('Authorization')).toBe(`Bearer ${token}`);
      expect(req.request.headers.get('Accept-Language')).toBe('es');
      expect(req.request.headers.get('x-correlation-id')).toBeTruthy();
      req.flush({});
      await done;
    });

    it('omits authorization when there is no session', async () => {
      const done = firstValue(http.get(`${GATEWAY}/v1/zones`));
      const req = httpMock.expectOne(`${GATEWAY}/v1/zones`);

      expect(req.request.headers.has('Authorization')).toBe(false);
      expect(req.request.headers.get('x-correlation-id')).toBeTruthy();
      req.flush({});
      await done;
    });

    it('omits authorization on a request marked anonymous', async () => {
      tokens.set(pair(freshToken()));

      const done = firstValue(
        http.post(
          `${GATEWAY}/v1/auth/login`,
          {},
          { context: anonymous('auth.login') }
        )
      );
      const req = httpMock.expectOne(`${GATEWAY}/v1/auth/login`);

      expect(req.request.headers.has('Authorization')).toBe(false);
      req.flush({});
      await done;
    });
  });

  describe('errors', () => {
    it('maps a problem document to a GatewayError', async () => {
      const failure = expectFailure(http.get(`${GATEWAY}/v1/zones`));
      httpMock.expectOne(`${GATEWAY}/v1/zones`).flush(
        {
          code: 'conflict',
          status: 409,
          message: 'That request conflicts with the current state.',
          detail: 'join code already in use',
          correlationId: 'server-id',
        },
        { status: 409, statusText: 'Conflict' }
      );

      const error = (await failure) as GatewayError;
      expect(error).toBeInstanceOf(GatewayError);
      expect(error.code).toBe('conflict');
      expect(error.correlationId).toBe('server-id');
      expect(error.detail).toBe('join code already in use');
    });

    it('derives a code from the status when the body is not a problem document', async () => {
      // A proxy's HTML 502 still has to become something a page can switch on.
      const failure = expectFailure(http.get(`${GATEWAY}/v1/zones`));
      httpMock
        .expectOne(`${GATEWAY}/v1/zones`)
        .flush('<html>502 Bad Gateway</html>', {
          status: 502,
          statusText: 'Bad Gateway',
        });

      const error = (await failure) as GatewayError;
      expect(error.code).toBe('internal');
      expect(error.correlationId).toBeTruthy();
    });

    it('turns a no-response failure into a NetworkError and reports it', async () => {
      const connection = TestBed.inject(ConnectionState);

      const failure = expectFailure(http.get(`${GATEWAY}/v1/zones`));
      httpMock
        .expectOne(`${GATEWAY}/v1/zones`)
        .error(new ProgressEvent('error'), { status: 0 });

      const error = (await failure) as NetworkError;
      expect(error).toBeInstanceOf(NetworkError);
      expect(connection.offline()).toBe(true);
    });

    it('treats a 503 as reachable, so a deploy does not strand the user offline', async () => {
      const connection = TestBed.inject(ConnectionState);
      connection.reportNetworkFailure();

      const failure = expectFailure(http.get(`${GATEWAY}/v1/zones`));
      httpMock
        .expectOne(`${GATEWAY}/v1/zones`)
        .flush({}, { status: 503, statusText: 'Service Unavailable' });

      await failure;
      expect(connection.offline()).toBe(false);
    });
  });

  describe('refresh', () => {
    it('refreshes proactively before sending an expired token', async () => {
      tokens.set(pair(staleToken()));
      const renewed = freshToken();

      const done = firstValue(http.get(`${GATEWAY}/v1/zones`));
      await tick();

      const refresh = httpMock.expectOne(`${GATEWAY}/v1/auth/refresh`);
      expect(refresh.request.body).toEqual({ refreshToken: 'refresh-1' });
      expect(refresh.request.headers.has('Authorization')).toBe(false);
      refresh.flush({
        userId: 'u1',
        kind: 'REGISTERED',
        accessToken: renewed,
        refreshToken: 'refresh-2',
      });
      await tick();

      const req = httpMock.expectOne(`${GATEWAY}/v1/zones`);
      expect(req.request.headers.get('Authorization')).toBe(
        `Bearer ${renewed}`
      );
      req.flush({});
      await done;
    });

    it('makes exactly one refresh call for two concurrent expired requests', async () => {
      // Refresh tokens rotate and are single use, so a second concurrent refresh
      // presents a token the first just revoked and signs the user out mid session.
      // `0003` loads zones and opens realtime on the same tick.
      tokens.set(pair(staleToken()));
      const renewed = freshToken();

      const first = firstValue(http.get(`${GATEWAY}/v1/zones`));
      const second = firstValue(http.get(`${GATEWAY}/v1/lists/l1/lines`));
      await tick();

      const refreshes = httpMock.match(`${GATEWAY}/v1/auth/refresh`);
      expect(refreshes).toHaveLength(1);

      refreshes[0].flush({
        userId: 'u1',
        kind: 'REGISTERED',
        accessToken: renewed,
        refreshToken: 'refresh-2',
      });
      await tick();

      httpMock.expectOne(`${GATEWAY}/v1/zones`).flush({});
      httpMock.expectOne(`${GATEWAY}/v1/lists/l1/lines`).flush({});
      await Promise.all([first, second]);
    });

    it('retries once after a 401 and then gives up', async () => {
      tokens.set(pair(freshToken()));
      const renewed = freshToken();

      const failure = expectFailure(http.get(`${GATEWAY}/v1/zones`));

      httpMock
        .expectOne(`${GATEWAY}/v1/zones`)
        .flush(
          { code: 'unauthorized' },
          { status: 401, statusText: 'Unauthorized' }
        );
      await tick();

      httpMock.expectOne(`${GATEWAY}/v1/auth/refresh`).flush({
        userId: 'u1',
        kind: 'REGISTERED',
        accessToken: renewed,
        refreshToken: 'refresh-2',
      });
      await tick();

      // Second 401 must end the request rather than start another refresh.
      httpMock
        .expectOne(`${GATEWAY}/v1/zones`)
        .flush(
          { code: 'unauthorized' },
          { status: 401, statusText: 'Unauthorized' }
        );

      const error = (await failure) as GatewayError;
      expect(error.code).toBe('unauthorized');
    });

    it('clears the session when the refresh itself is rejected', async () => {
      tokens.set(pair(staleToken()));

      const failure = expectFailure(http.get(`${GATEWAY}/v1/zones`));
      await tick();

      httpMock
        .expectOne(`${GATEWAY}/v1/auth/refresh`)
        .flush(
          { code: 'unauthorized' },
          { status: 401, statusText: 'Unauthorized' }
        );
      await tick();

      const req = httpMock.expectOne(`${GATEWAY}/v1/zones`);
      expect(req.request.headers.has('Authorization')).toBe(false);
      req.flush(
        { code: 'unauthorized' },
        { status: 401, statusText: 'Unauthorized' }
      );

      // The 401 retry path refreshes again; with no session that resolves to null
      // without another HTTP call, so the original 401 surfaces.
      await failure;
      expect(tokens.tokens()).toBeNull();
    });
  });
});

function firstValue<T>(source: {
  subscribe: (o: {
    next: (v: T) => void;
    error: (e: unknown) => void;
  }) => unknown;
}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    source.subscribe({ next: resolve, error: reject });
  });
}

function expectFailure(source: {
  subscribe: (o: {
    next: (v: unknown) => void;
    error: (e: unknown) => void;
  }) => unknown;
}): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    source.subscribe({
      next: () => reject(new Error('expected the request to fail')),
      error: resolve,
    });
  });
}
