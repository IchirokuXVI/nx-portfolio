import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { ApiUrl } from '../api-url';
import { AccountApi } from './account-api';

const GATEWAY = 'https://gateway.test';

const PROFILE = {
  userId: 'u1',
  kind: 'REGISTERED',
  username: 'Marta',
  email: 'marta@example.com',
  emailVerified: true,
  displayName: null,
};

describe('AccountApi', () => {
  let api: AccountApi;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideVelistaTesting(),
        provideHttpClient(),
        provideHttpClientTesting(),
        ApiUrl,
        AccountApi,
      ],
    });

    api = TestBed.inject(AccountApi);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  describe('reading the profile', () => {
    it('maps the body rather than passing it through (rule D4)', async () => {
      const result = api.getProfile();

      httpMock.expectOne(`${GATEWAY}/v1/account/me`).flush(PROFILE);

      await expect(result).resolves.toEqual({
        userId: 'u1',
        kind: 'REGISTERED',
        username: 'Marta',
        email: 'marta@example.com',
        emailVerified: true,
        displayName: null,
      });
    });

    it('reads a guest’s null email as a null, not as an empty string', async () => {
      // Which is the whole of the guest branch: `UserProfileView.email` is nullable
      // exactly for a temporary user.
      const result = api.getProfile();

      httpMock
        .expectOne(`${GATEWAY}/v1/account/me`)
        .flush({ ...PROFILE, kind: 'TEMPORARY', email: null, emailVerified: false });

      await expect(result).resolves.toMatchObject({ email: null });
    });

    it('fails rather than inventing a profile it cannot read', async () => {
      const result = api.getProfile();
      // Rule D4: no `userId` means nothing can be reconciled, so the record is not
      // renderable and `required` turns the mapper's null into a thrown failure.
      httpMock.expectOne(`${GATEWAY}/v1/account/me`).flush({ username: 'Marta' });

      await expect(result).rejects.toThrow();
    });
  });

  /**
   * **Rule A3**, at the boundary it lives at. This is the only place in the app that
   * knows both `UsernameScope` and `UsernamePropagation`.
   */
  describe('renaming', () => {
    it('maps the app’s question to the wire’s enum', async () => {
      const result = api.setUsername('Marta R.', 'MY_GROUPS_TOO');

      const request = httpMock.expectOne(`${GATEWAY}/v1/account/me`);
      expect(request.request.method).toBe('PATCH');
      expect(request.request.body).toEqual({
        username: 'Marta R.',
        propagation: 'MATCHING_ZONES',
      });
      request.flush({ ...PROFILE, username: 'Marta R.' });

      await result;
    });

    it('maps the deliberate choice to GLOBAL_ONLY', async () => {
      const result = api.setUsername('Marta R.', 'ONLY_HERE');

      const request = httpMock.expectOne(`${GATEWAY}/v1/account/me`);
      expect(request.request.body).toEqual({
        username: 'Marta R.',
        propagation: 'GLOBAL_ONLY',
      });
      request.flush({ ...PROFILE, username: 'Marta R.' });

      await result;
    });

    it('always sends the field, because omitting it means GLOBAL_ONLY', async () => {
      // The client's default differs from the wire's, so the "do what I mean"
      // behaviour only happens if it is asked for. This is that assertion.
      const result = api.setUsername('Marta R.', 'MY_GROUPS_TOO');

      const request = httpMock.expectOne(`${GATEWAY}/v1/account/me`);
      expect(Object.keys(request.request.body as object)).toContain(
        'propagation'
      );
      request.flush({ ...PROFILE, username: 'Marta R.' });

      await result;
    });

    it('sends nothing the gateway’s whitelist would reject', async () => {
      // `forbidNonWhitelisted: true`, so an extra property is a 400 rather than
      // something quietly stripped.
      const result = api.setUsername('Marta R.', 'ONLY_HERE');

      const request = httpMock.expectOne(`${GATEWAY}/v1/account/me`);
      expect(Object.keys(request.request.body as object).sort()).toEqual([
        'propagation',
        'username',
      ]);
      request.flush({ ...PROFILE, username: 'Marta R.' });

      await result;
    });
  });

  describe('deleting', () => {
    it('reads the flag off the result', async () => {
      const result = api.deleteAccount();

      const request = httpMock.expectOne(`${GATEWAY}/v1/account`);
      expect(request.request.method).toBe('DELETE');
      request.flush({ userId: 'u1', deleted: true });

      await expect(result).resolves.toEqual({ deleted: true });
    });

    it('reads an idempotent repeat as the no-op it is', async () => {
      const result = api.deleteAccount();

      httpMock
        .expectOne(`${GATEWAY}/v1/account`)
        .flush({ userId: 'u1', deleted: false });

      await expect(result).resolves.toEqual({ deleted: false });
    });

    it('reads a body it cannot understand as a repeat rather than throwing', async () => {
      // There is no record here to be unrenderable: the answer is one boolean, and an
      // unreadable body means the same thing as `deleted: false`.
      const result = api.deleteAccount();

      httpMock.expectOne(`${GATEWAY}/v1/account`).flush('not json at all');

      await expect(result).resolves.toEqual({ deleted: false });
    });
  });

  describe('what the account has been shown (velista 0098)', () => {
    it('reads the app state off me when the gateway composes it', async () => {
      const result = api.getProfile();

      httpMock.expectOne(`${GATEWAY}/v1/account/me`).flush({
        ...PROFILE,
        appState: {
          setupCompletedAt: null,
          tourSeenAt: '2026-09-01T10:00:00Z',
        },
      });

      await expect(result).resolves.toMatchObject({
        appState: {
          setupCompletedAt: null,
          tourSeenAt: '2026-09-01T10:00:00Z',
        },
      });
    });

    it('leaves the app state off a body that carries none', async () => {
      // The rename's answer has none, and two nulls there would read as a new account.
      const result = api.getProfile();

      httpMock.expectOne(`${GATEWAY}/v1/account/me`).flush(PROFILE);

      expect(await result).not.toHaveProperty('appState');
    });

    it('stamps the setup with the flag alone', async () => {
      const result = api.setAppState({ setupCompleted: true });

      const request = httpMock.expectOne(`${GATEWAY}/v1/account/app-state`);
      expect(request.request.method).toBe('PATCH');
      expect(request.request.body).toEqual({ setupCompleted: true });
      request.flush({
        setupCompletedAt: '2026-09-23T10:00:00.000Z',
        tourSeenAt: null,
      });

      await expect(result).resolves.toEqual({
        setupCompletedAt: '2026-09-23T10:00:00.000Z',
        tourSeenAt: null,
      });
    });

    it('asks for a name and writes nothing', async () => {
      const result = api.suggestUsername();

      const request = httpMock.expectOne(
        `${GATEWAY}/v1/account/username-suggestions`
      );
      expect(request.request.method).toBe('GET');
      request.flush({ username: 'Quiet Harbour' });

      await expect(result).resolves.toBe('Quiet Harbour');
    });

    it('fails rather than inventing a name it cannot read', async () => {
      const result = api.suggestUsername();

      httpMock
        .expectOne(`${GATEWAY}/v1/account/username-suggestions`)
        .flush({});

      await expect(result).rejects.toThrow();
    });
  });
});
