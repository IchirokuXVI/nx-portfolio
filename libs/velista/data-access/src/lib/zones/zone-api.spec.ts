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
import {
  provideFakeBrowserFacade,
  StorageKeys,
} from '@portfolio/velista/platform';
import { TokenStore } from '../auth/token-store';
import { VELISTA_DATA_ACCESS_PROVIDERS } from '../data-access-providers';
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
  let storage: Map<string, string>;

  beforeEach(() => {
    storage = new Map<string, string>();

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
        provideFakeBrowserFacade(storage),
        // Rule D5: these read `APP_API_CONFIG`, so the app injector owns them and a
        // spec has to install them the same way the app does.
        ...VELISTA_DATA_ACCESS_PROVIDERS,
        ZoneApi,
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

  /**
   * The gate above reads the only thing a client can read, which is whether the access
   * token has expired. A pair can be perfectly fresh and still name nobody, and the
   * case that produced these tests is the blunt one: the API's database was reset,
   * every user in it with it, under a phone still holding the pair it was given before.
   *
   * The stored pair then survives every attempt. It is not expired, so nothing
   * refreshes it and nothing questions it; it is sent, the server cannot find the user
   * it names, and before the gateway answered that with a 401 it was a 404 `not_found`
   * that the client had no way to read as being about the credential. Creating a group
   * failed, joining one failed, and trying again did the same thing forever.
   */
  describe('an account the server no longer has', () => {
    /** The pair on the phone: unexpired, well formed, and naming a deleted user. */
    const survivor = () => ({
      userId: 'u1',
      kind: 'TEMPORARY' as const,
      accessToken: fresh(),
      refreshToken: 'r1',
    });

    it('creating a group ends the session and reports the account lost', async () => {
      tokens.set(survivor());

      const result = api.createZone('Flat 3B');
      await tick();

      // Sent, because from here there was nothing wrong with it.
      const create = httpMock.expectOne(`${GATEWAY}/v1/zones`);
      expect(create.request.headers.get('Authorization')).toBe(
        `Bearer ${tokens.tokens()?.accessToken}`
      );
      create.flush(
        { code: 'unauthorized' },
        { status: 401, statusText: 'Unauthorized' }
      );
      await tick();

      // One attempt to save the session. The refresh token named the same deleted
      // user, so it is refused as well.
      httpMock
        .expectOne(`${GATEWAY}/v1/auth/refresh`)
        .flush(
          { code: 'unauthorized' },
          { status: 401, statusText: 'Unauthorized' }
        );

      expect(await result).toEqual({ state: 'guest-account-lost' });
      // The half this whole change is about: the dead credentials are gone from the
      // browser, so the next attempt goes out anonymously and mints a working guest
      // instead of presenting the same rejected identity again.
      expect(tokens.tokens()).toBeNull();
      expect(storage.has(StorageKeys.session)).toBe(false);
    });

    it('joining a group does the same', async () => {
      tokens.set(survivor());

      const result = api.joinZone('FLAT3B');
      await tick();

      httpMock
        .expectOne(`${GATEWAY}/v1/zones/join`)
        .flush(
          { code: 'unauthorized' },
          { status: 401, statusText: 'Unauthorized' }
        );
      await tick();

      httpMock
        .expectOne(`${GATEWAY}/v1/auth/refresh`)
        .flush(
          { code: 'unauthorized' },
          { status: 401, statusText: 'Unauthorized' }
        );

      expect(await result).toEqual({ state: 'guest-account-lost' });
      expect(storage.has(StorageKeys.session)).toBe(false);
    });

    it('the attempt after it is anonymous, and works', async () => {
      // Signing out is only half a fix. What makes the person unstuck is that the very
      // next tap succeeds, which it can only do once the pair is out of storage.
      tokens.set(survivor());

      const refused = api.createZone('Flat 3B');
      await tick();
      httpMock
        .expectOne(`${GATEWAY}/v1/zones`)
        .flush(
          { code: 'unauthorized' },
          { status: 401, statusText: 'Unauthorized' }
        );
      await tick();
      httpMock
        .expectOne(`${GATEWAY}/v1/auth/refresh`)
        .flush(
          { code: 'unauthorized' },
          { status: 401, statusText: 'Unauthorized' }
        );
      await refused;

      const retry = api.createZone('Flat 3B');
      await tick();

      const create = httpMock.expectOne(`${GATEWAY}/v1/zones`);
      expect(create.request.headers.has('Authorization')).toBe(false);
      create.flush({
        tokens: {
          userId: 'u9',
          kind: 'TEMPORARY',
          accessToken: fresh(),
          refreshToken: 'r9',
        },
        data: { id: 'z9', name: 'Flat 3B', status: 'ACTIVE' },
      });

      expect(await retry).toMatchObject({ state: 'created' });
      expect(tokens.tokens()?.userId).toBe('u9');
    });

    it('does not sign anybody out over a join code that matches no group', async () => {
      // The hazard this fix introduces, so it is pinned here. `not_found` on a join
      // is the ordinary case of a mistyped or expired code, and it is the reason the
      // client cannot treat a 404 as news about the credential: doing so would sign
      // a person out for a typo.
      tokens.set(survivor());

      const result = api.joinZone('WRONGCODE');
      await tick();

      httpMock
        .expectOne(`${GATEWAY}/v1/zones/join`)
        .flush(
          { code: 'not_found' },
          { status: 404, statusText: 'Not Found' }
        );

      await expect(result).rejects.toMatchObject({ code: 'not_found' });
      expect(tokens.tokens()?.userId).toBe('u1');
      expect(storage.has(StorageKeys.session)).toBe(true);
    });

    it('leaves a registered caller to sign back in rather than showing the guest screen', async () => {
      // Same failure, different person. `AccountLostPanel` says the account on this
      // phone is unreachable and offers a fresh start, which is true for a guest and
      // wrong for somebody who can simply sign in again, so this one surfaces as an
      // error the sheet keys its own copy from.
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
        .flush(
          { code: 'unauthorized' },
          { status: 401, statusText: 'Unauthorized' }
        );
      await tick();

      httpMock
        .expectOne(`${GATEWAY}/v1/auth/refresh`)
        .flush(
          { code: 'unauthorized' },
          { status: 401, statusText: 'Unauthorized' }
        );

      await expect(result).rejects.toMatchObject({ code: 'unauthorized' });
      // Signed out all the same. Whose screen comes next is the only difference.
      expect(storage.has(StorageKeys.session)).toBe(false);
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
