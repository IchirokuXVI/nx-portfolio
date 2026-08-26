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
import { APP_API_CONFIG } from '@portfolio/velista/models';
import { BrowserFacade } from '@portfolio/velista/platform';
import { TokenStore } from '../auth/token-store';
import { gatewayInterceptor } from '../gateway-interceptor';
import { ZoneApi } from './zone-api';

const GATEWAY = 'https://gateway.example';
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function jwt(exp: number): string {
  const encode = (value: object) =>
    btoa(JSON.stringify(value))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${encode({ alg: 'RS256' })}.${encode({ exp, sub: 'u1' })}.sig`;
}

const fresh = () => jwt(Math.floor(Date.now() / 1000) + 3600);
const stale = () => jwt(Math.floor(Date.now() / 1000) - 3600);

describe('ZoneApi', () => {
  let api: ZoneApi;
  let httpMock: HttpTestingController;
  let tokens: TokenStore;

  beforeEach(() => {
    const storage = new Map<string, string>();

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
        { provide: RokuTranslatorService, useValue: { getLocale: () => 'en' } },
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

    api = TestBed.inject(ZoneApi);
    httpMock = TestBed.inject(HttpTestingController);
    tokens = TestBed.inject(TokenStore);
    TestBed.inject(HttpClient);
  });

  afterEach(() => httpMock.verify());

  describe('rule D3: the optional auth routes', () => {
    it('refuses to create a zone when a guest session cannot be refreshed', async () => {
      // The gateway treats an expired token as anonymous and mints a NEW guest
      // account, orphaning the groups on the old one with no way back in. The request
      // must never leave the client.
      tokens.set({
        userId: 'u1',
        kind: 'TEMPORARY',
        accessToken: stale(),
        refreshToken: 'spent',
      });

      const result = api.createZone('Flat 3B');
      await tick();

      httpMock
        .expectOne(`${GATEWAY}/v1/auth/refresh`)
        .flush(
          { code: 'unauthorized' },
          { status: 401, statusText: 'Unauthorized' }
        );

      expect(await result).toEqual({ state: 'guest-account-lost' });
      // The important half: no zone was created.
      httpMock.expectNone(`${GATEWAY}/v1/zones`);
    });

    it('proceeds anonymously when there was no session to lose', async () => {
      const result = api.createZone('Flat 3B');
      await tick();

      const req = httpMock.expectOne(`${GATEWAY}/v1/zones`);
      expect(req.request.headers.has('Authorization')).toBe(false);
      req.flush({
        tokens: {
          userId: 'u9',
          kind: 'TEMPORARY',
          accessToken: fresh(),
          refreshToken: 'r9',
        },
        data: { id: 'z9', name: 'Flat 3B', status: 'ACTIVE' },
      });

      expect(await result).toMatchObject({ state: 'created' });
    });

    it('persists the tokens minted for a brand new guest', async () => {
      // Missing this is how a guest ends up holding no credential for the zone they
      // just created.
      const result = api.createZone('Flat 3B');
      await tick();

      httpMock.expectOne(`${GATEWAY}/v1/zones`).flush({
        tokens: {
          userId: 'u9',
          kind: 'TEMPORARY',
          accessToken: fresh(),
          refreshToken: 'r9',
        },
        data: { id: 'z9', name: 'Flat 3B', status: 'ACTIVE' },
      });
      await result;

      expect(tokens.tokens()?.userId).toBe('u9');
      expect(tokens.tokens()?.kind).toBe('TEMPORARY');
    });

    it('leaves an existing session alone when the response carries no tokens', async () => {
      // `tokens` is present only when a guest was just minted. Its absence is normal.
      tokens.set({
        userId: 'u1',
        kind: 'REGISTERED',
        accessToken: fresh(),
        refreshToken: 'r1',
      });

      const result = api.createZone('Flat 3B');
      await tick();

      httpMock
        .expectOne(`${GATEWAY}/v1/zones`)
        .flush({ data: { id: 'z9', name: 'Flat 3B', status: 'ACTIVE' } });
      await result;

      expect(tokens.tokens()?.userId).toBe('u1');
      expect(tokens.tokens()?.kind).toBe('REGISTERED');
    });

    it('applies the same gate to joining', async () => {
      tokens.set({
        userId: 'u1',
        kind: 'TEMPORARY',
        accessToken: stale(),
        refreshToken: 'spent',
      });

      const result = api.joinZone('FLAT3B');
      await tick();

      httpMock
        .expectOne(`${GATEWAY}/v1/auth/refresh`)
        .flush(
          { code: 'unauthorized' },
          { status: 401, statusText: 'Unauthorized' }
        );

      expect(await result).toEqual({ state: 'guest-account-lost' });
      httpMock.expectNone(`${GATEWAY}/v1/zones/join`);
    });
  });

  describe('listing', () => {
    it('maps the page through the model mappers', async () => {
      tokens.set({
        userId: 'u1',
        kind: 'REGISTERED',
        accessToken: fresh(),
        refreshToken: 'r1',
      });

      const result = api.listMyZones({ limit: 20, order: 'recent' });

      const req = httpMock.expectOne((r) => r.url === `${GATEWAY}/v1/zones`);
      expect(req.request.params.get('limit')).toBe('20');
      expect(req.request.params.get('order')).toBe('recent');
      req.flush({
        items: [
          { id: 'z1', name: 'Flat', myRole: 'OWNER', myStatus: 'APPROVED' },
          { name: 'no id, dropped' },
        ],
        nextCursor: null,
      });

      const page = await result;
      expect(page.items).toHaveLength(1);
      expect(page.items[0]).toMatchObject({ id: 'z1', myRole: 'OWNER' });
    });

    it('clamps a limit rather than letting the gateway 400 it', async () => {
      // The gateway validates limit to [1, 100] and rejects anything outside it.
      tokens.set({
        userId: 'u1',
        kind: 'REGISTERED',
        accessToken: fresh(),
        refreshToken: 'r1',
      });

      const result = api.listMyZones({ limit: 5000 });

      const req = httpMock.expectOne((r) => r.url === `${GATEWAY}/v1/zones`);
      expect(req.request.params.get('limit')).toBe('100');
      req.flush({ items: [], nextCursor: null });
      await result;
    });
  });
});
