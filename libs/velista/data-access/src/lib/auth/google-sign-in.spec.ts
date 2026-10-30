import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RokuLocaleStore } from '@portfolio/localization/rokutranslator-angular';
import {
  APP_API_CONFIG,
  APP_BASE_PATH,
  type SessionTokens,
} from '@portfolio/velista/models';
import {
  BrowserFacade,
  GOOGLE_CREDENTIAL,
  type GoogleCredentialI,
  StorageKeys,
} from '@portfolio/velista/platform';
import { webcrypto } from 'node:crypto';
import { ApiUrl } from '../api-url';
import { GatewayError } from '../errors';
import { AuthApi } from './auth-api';
import {
  base64url,
  GOOGLE_SILENT_DEADLINE_MS,
  GOOGLE_VERIFIER_KEY,
  GoogleSignIn,
} from './google-sign-in';
import { TokenStore } from './token-store';

/**
 * The fixed vector of RFC 7636, appendix B: these 32 bytes are the verifier below, and
 * its challenge is the SHA-256 of the verifier's ASCII, both as unpadded base64url.
 */
const VECTOR_BYTES = new Uint8Array([
  116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186,
  22, 212, 37, 77, 105, 214, 191, 240, 91, 88, 5, 88, 83, 132, 141, 121,
]);
const VECTOR_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const VECTOR_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

const PAIR: SessionTokens = {
  userId: 'u1',
  kind: 'REGISTERED',
  username: 'dani',
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
};

interface SetupOptions {
  /** The native picker, or null for the web (the token's default). */
  readonly credential?: GoogleCredentialI | null;
  /** Whether a pair is held when the service starts. */
  readonly session?: boolean;
  /** What local storage holds when the service starts. */
  readonly storage?: ReadonlyMap<string, string>;
}

function setup(
  mint: (challenge: string) => Promise<string> = async () => 'state',
  options: SetupOptions = {}
) {
  const calls: string[] = [];
  const session = new Map<string, string>();
  const storage = new Map<string, string>(options.storage ?? []);

  // The facade is the seam: fixed bytes, and a real SHA-256 from Node.
  const facade = {
    randomBytes: (length: number) => {
      calls.push(`randomBytes ${length}`);
      return VECTOR_BYTES;
    },
    sha256: async (bytes: Uint8Array) =>
      webcrypto.subtle.digest('SHA-256', bytes),
    writeSessionStorage: (key: string, value: string) => {
      calls.push(`write ${key}`);
      session.set(key, value);
    },
    removeSessionStorage: (key: string) => {
      calls.push(`remove ${key}`);
      session.delete(key);
    },
    readStorage: (key: string) => storage.get(key) ?? null,
    writeStorage: (key: string, value: string) => void storage.set(key, value),
    removeStorage: (key: string) => void storage.delete(key),
    assignDocument: jest.fn((url: string) => calls.push(`assign ${url}`)),
  };
  const api = {
    mintGoogleState: jest.fn(async (challenge: string) => {
      calls.push('mint');
      return mint(challenge);
    }),
    mintGoogleNonce: jest.fn(
      async (_options: {
        silent: boolean;
        acceptedTermsVersion: string | null;
      }) => ({ nonce: 'n1', clientId: 'web-client' })
    ),
    signInWithGoogleIdToken: jest.fn(async (_idToken: string) => PAIR),
  };
  // A double rather than the real store: what is asserted is whether the pair was
  // handed over, and the real one needs an HTTP stack for a refresh nobody makes.
  let held: SessionTokens | null = options.session === true ? PAIR : null;
  const tokens = {
    set: jest.fn((pair: SessionTokens) => {
      held = pair;
    }),
    hasSession: () => held !== null,
  };
  // Starts on the front door, which a late silent answer checks (velista 0177).
  const router = {
    url: '/velista/en',
    navigateByUrl: jest.fn().mockResolvedValue(true),
  };

  TestBed.configureTestingModule({
    providers: [
      GoogleSignIn,
      ApiUrl,
      {
        provide: APP_API_CONFIG,
        useValue: {
          gatewayBaseUrl: 'https://gateway.example',
          realtimeBaseUrl: 'https://realtime.example',
        },
      },
      { provide: APP_BASE_PATH, useValue: '/velista' },
      { provide: BrowserFacade, useValue: facade },
      { provide: AuthApi, useValue: api },
      { provide: TokenStore, useValue: tokens },
      { provide: Router, useValue: router },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
      ...(options.credential === undefined
        ? []
        : [{ provide: GOOGLE_CREDENTIAL, useValue: options.credential }]),
    ],
  });

  return {
    google: TestBed.inject(GoogleSignIn),
    calls,
    session,
    storage,
    facade,
    api,
    tokens,
    router,
  };
}

/** A picker double. `answer` is what Android hands back, or throws. */
function picker(answer: () => Promise<string | null> = async () => 'id-1') {
  return {
    getIdToken: jest.fn(answer),
    forget: jest.fn().mockResolvedValue(undefined),
  };
}

/** A native fixture that also hands back its picker double. */
type LateFixture = ReturnType<typeof setup> & {
  readonly credential: ReturnType<typeof picker>;
};

function needsConsent(): GatewayError {
  return new GatewayError({
    code: 'google_sign_in_needs_consent',
    status: 409,
    correlationId: 'c1',
  });
}

describe('GoogleSignIn', () => {
  describe('on the web (no picker)', () => {
    it('keeps the verifier, mints with its challenge, and leaves for the state', async () => {
      const { google, calls, session, facade, api } = setup(
        async () => 'state/1+'
      );

      await expect(
        google.start({ acceptedTermsVersion: '2026-10-29' })
      ).resolves.toBe('leaving');

      expect(GOOGLE_VERIFIER_KEY).toBe('google-verifier:velista');
      expect(session.get(GOOGLE_VERIFIER_KEY)).toBe(VECTOR_VERIFIER);
      // The version the line under the button names goes with the mint (velista 0173).
      expect(api.mintGoogleState).toHaveBeenCalledWith(
        VECTOR_CHALLENGE,
        '2026-10-29'
      );
      // The verifier is written before the mint goes out, and the document leaves last.
      expect(calls).toEqual([
        'randomBytes 32',
        `write ${GOOGLE_VERIFIER_KEY}`,
        'mint',
        'assign https://gateway.example/v1/auth/google?state=state%2F1%2B',
      ]);
      expect(facade.assignDocument).toHaveBeenCalledTimes(1);
      // The native routes are never asked on the web (velista 0177).
      expect(api.mintGoogleNonce).not.toHaveBeenCalled();
    });

    it('removes the verifier and rejects when the mint fails', async () => {
      const refusal = new Error('not_configured');
      const { google, session, facade } = setup(async () => {
        throw refusal;
      });

      await expect(google.start({ acceptedTermsVersion: null })).rejects.toBe(
        refusal
      );

      expect(session.has(GOOGLE_VERIFIER_KEY)).toBe(false);
      expect(facade.assignDocument).not.toHaveBeenCalled();
    });

    it('never tries a silent sign in and writes no flag at sign out', async () => {
      const { google, api, storage } = setup();

      expect(google.silentSignInAllowed()).toBe(false);
      await expect(google.trySilent()).resolves.toBe(false);
      await google.stopAutoSignIn();

      expect(api.mintGoogleNonce).not.toHaveBeenCalled();
      expect(storage.size).toBe(0);
    });
  });

  describe('in the Android app (velista 0177)', () => {
    it('mints a nonce, asks Android with it, stores the pair and goes home', async () => {
      const credential = picker();
      const { google, api, tokens, router, facade, calls } = setup(undefined, {
        credential,
        storage: new Map([[StorageKeys.googleAutoSignInOff, 'true']]),
      });

      await expect(
        google.start({ acceptedTermsVersion: '2026-10-29' })
      ).resolves.toBe('leaving');

      expect(api.mintGoogleNonce).toHaveBeenCalledWith({
        silent: false,
        acceptedTermsVersion: '2026-10-29',
      });
      // The client id of the answer is the audience Android asks for (backend 0238 D2).
      expect(credential.getIdToken).toHaveBeenCalledWith({
        serverClientId: 'web-client',
        nonce: 'n1',
        silent: false,
      });
      expect(api.signInWithGoogleIdToken).toHaveBeenCalledWith('id-1');
      expect(tokens.set).toHaveBeenCalledWith(PAIR);
      expect(router.navigateByUrl).toHaveBeenCalledWith('/velista/en/home');
      // No verifier, no state, no document leaving: the redirect flow is not run.
      expect(api.mintGoogleState).not.toHaveBeenCalled();
      expect(facade.assignDocument).not.toHaveBeenCalled();
      expect(calls).toEqual([]);
    });

    it('turns the automatic sign in back on after a sign in somebody pressed', async () => {
      const { google, storage } = setup(undefined, {
        credential: picker(),
        storage: new Map([[StorageKeys.googleAutoSignInOff, 'true']]),
      });

      await google.start({ acceptedTermsVersion: null });

      expect(storage.has(StorageKeys.googleAutoSignInOff)).toBe(false);
    });

    it('resolves quietly when the person closes the sheet', async () => {
      const { google, api, tokens, router, storage } = setup(undefined, {
        credential: picker(async () => null),
        storage: new Map([[StorageKeys.googleAutoSignInOff, 'true']]),
      });

      await expect(google.start({ acceptedTermsVersion: null })).resolves.toBe(
        'cancelled'
      );

      expect(api.signInWithGoogleIdToken).not.toHaveBeenCalled();
      expect(tokens.set).not.toHaveBeenCalled();
      expect(router.navigateByUrl).not.toHaveBeenCalled();
      // Nobody signed in, so the sign out's choice stands.
      expect(storage.get(StorageKeys.googleAutoSignInOff)).toBe('true');
    });

    it('rejects with the error as it arrived when the mint is refused', async () => {
      const credential = picker();
      const refusal = new GatewayError({
        code: 'terms_version_stale',
        status: 409,
        correlationId: 'c1',
      });
      const { google, api } = setup(undefined, { credential });
      api.mintGoogleNonce.mockRejectedValueOnce(refusal);

      await expect(google.start({ acceptedTermsVersion: 'old' })).rejects.toBe(
        refusal
      );
      expect(credential.getIdToken).not.toHaveBeenCalled();
    });

    it('rejects when Android fails, so the page shows its refusal', async () => {
      const unavailable = new Error('unavailable');
      const { google, api, tokens } = setup(undefined, {
        credential: picker(async () => {
          throw unavailable;
        }),
      });

      await expect(google.start({ acceptedTermsVersion: null })).rejects.toBe(
        unavailable
      );
      expect(api.signInWithGoogleIdToken).not.toHaveBeenCalled();
      expect(tokens.set).not.toHaveBeenCalled();
    });

    it('rejects and stores nothing when the gateway refuses the token', async () => {
      const refused = new GatewayError({
        code: 'invalid_google_token',
        status: 401,
        correlationId: 'c2',
      });
      const { google, api, tokens, router } = setup(undefined, {
        credential: picker(),
      });
      api.signInWithGoogleIdToken.mockRejectedValueOnce(refused);

      await expect(google.start({ acceptedTermsVersion: null })).rejects.toBe(
        refused
      );
      expect(tokens.set).not.toHaveBeenCalled();
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    describe('trySilent', () => {
      it('asks for a silent token with no terms version, stores the pair and goes home', async () => {
        const credential = picker();
        const { google, api, tokens, router } = setup(undefined, {
          credential,
        });

        await expect(google.trySilent()).resolves.toBe(true);

        expect(api.mintGoogleNonce).toHaveBeenCalledWith({
          silent: true,
          acceptedTermsVersion: null,
        });
        expect(credential.getIdToken).toHaveBeenCalledWith({
          serverClientId: 'web-client',
          nonce: 'n1',
          silent: true,
        });
        expect(tokens.set).toHaveBeenCalledWith(PAIR);
        expect(router.navigateByUrl).toHaveBeenCalledWith('/velista/en/home');
      });

      it.each<[string, (fixture: ReturnType<typeof setup>) => void]>([
        [
          'the mint is refused',
          ({ api }) =>
            api.mintGoogleNonce.mockRejectedValueOnce(new Error('offline')),
        ],
        [
          'the gateway needs consent first',
          ({ api }) =>
            api.signInWithGoogleIdToken.mockRejectedValueOnce(needsConsent()),
        ],
        [
          'the gateway answers something unreadable',
          ({ api }) =>
            api.signInWithGoogleIdToken.mockRejectedValueOnce(
              new Error('auth.googleIdToken returned an unusable token pair')
            ),
        ],
      ])(
        'answers false, and throws nothing, when %s',
        async (_name, arrange) => {
          const fixture = setup(undefined, { credential: picker() });
          arrange(fixture);

          await expect(fixture.google.trySilent()).resolves.toBe(false);
          expect(fixture.tokens.set).not.toHaveBeenCalled();
          expect(fixture.router.navigateByUrl).not.toHaveBeenCalled();
        }
      );

      it('answers false when no account on the phone can answer', async () => {
        const { google, api } = setup(undefined, {
          credential: picker(async () => null),
        });

        await expect(google.trySilent()).resolves.toBe(false);
        expect(api.signInWithGoogleIdToken).not.toHaveBeenCalled();
      });

      it('answers false when Android fails', async () => {
        const { google } = setup(undefined, {
          credential: picker(async () => {
            throw new Error('unavailable');
          }),
        });

        await expect(google.trySilent()).resolves.toBe(false);
      });

      it('tries once per document, whoever asks', async () => {
        const { google, api } = setup(undefined, {
          credential: picker(async () => null),
        });

        await google.trySilent();
        expect(google.silentSignInAllowed()).toBe(false);
        await expect(google.trySilent()).resolves.toBe(false);

        expect(api.mintGoogleNonce).toHaveBeenCalledTimes(1);
      });

      it('does not try after a sign out switched it off', async () => {
        const { google, api } = setup(undefined, {
          credential: picker(),
          storage: new Map([[StorageKeys.googleAutoSignInOff, 'true']]),
        });

        expect(google.silentSignInAllowed()).toBe(false);
        await expect(google.trySilent()).resolves.toBe(false);
        expect(api.mintGoogleNonce).not.toHaveBeenCalled();
      });

      it('does not try while a session is held, a guest included', async () => {
        const { google, api } = setup(undefined, {
          credential: picker(),
          session: true,
        });

        expect(google.silentSignInAllowed()).toBe(false);
        await expect(google.trySilent()).resolves.toBe(false);
        expect(api.mintGoogleNonce).not.toHaveBeenCalled();
      });

      describe('the deadline', () => {
        beforeEach(() => jest.useFakeTimers());
        afterEach(() => jest.useRealTimers());

        it('gives up after four seconds when Android does not answer', async () => {
          const { google } = setup(undefined, {
            credential: picker(
              () => new Promise<string | null>(() => undefined)
            ),
          });

          let answer: boolean | undefined;
          void google.trySilent().then((value) => (answer = value));

          await jest.advanceTimersByTimeAsync(GOOGLE_SILENT_DEADLINE_MS - 1);
          expect(answer).toBeUndefined();
          await jest.advanceTimersByTimeAsync(1);
          expect(answer).toBe(false);
        });

        /**
         * What can happen on the front door after it let go, each of which makes a
         * late answer unwanted: the person signed in some other way, pressed Google
         * themselves, or went somewhere else.
         */
        const unwanted: [string, (fixture: LateFixture) => Promise<void>][] = [
          [
            'a session appeared',
            async ({ tokens }) => {
              tokens.set(PAIR);
              tokens.set.mockClear();
            },
          ],
          [
            'the person pressed Google',
            async ({ google, credential }) => {
              // They closed the sheet, so this press stored nothing either.
              credential.getIdToken.mockImplementationOnce(async () => null);
              await expect(
                google.start({ acceptedTermsVersion: null })
              ).resolves.toBe('cancelled');
            },
          ],
          [
            'the person left the front door',
            async ({ router }) => {
              router.url = '/velista/en/auth/login?returnUrl=%2F';
            },
          ],
        ];

        /** A fixture whose silent token arrives when the spec releases it. */
        function lateToken() {
          let release: (token: string) => void = () => undefined;
          const credential = picker(
            () => new Promise<string | null>((resolve) => (release = resolve))
          );
          const fixture = setup(undefined, { credential });
          return {
            ...fixture,
            credential,
            release: (token: string) => release(token),
          };
        }

        /** A fixture whose pair arrives when the spec releases it. */
        function latePair() {
          let release: (pair: SessionTokens) => void = () => undefined;
          const credential = picker();
          const fixture = setup(undefined, { credential });
          fixture.api.signInWithGoogleIdToken.mockReturnValueOnce(
            new Promise<SessionTokens>((resolve) => (release = resolve))
          );
          return {
            ...fixture,
            credential,
            release: (pair: SessionTokens) => release(pair),
          };
        }

        it('still signs in with a token picked after it, while the front door waits', async () => {
          const { google, api, tokens, router, release } = lateToken();

          const answer = google.trySilent();
          await jest.advanceTimersByTimeAsync(GOOGLE_SILENT_DEADLINE_MS);
          // The front door lets go at the deadline, whatever comes later.
          await expect(answer).resolves.toBe(false);

          release('id-late');
          await jest.advanceTimersByTimeAsync(0);

          expect(api.signInWithGoogleIdToken).toHaveBeenCalledWith('id-late');
          expect(tokens.set).toHaveBeenCalledWith(PAIR);
          expect(router.navigateByUrl).toHaveBeenCalledWith('/velista/en/home');
        });

        it('still stores a pair that arrives after it, while the front door waits', async () => {
          const { google, tokens, router, release } = latePair();

          const answer = google.trySilent();
          await jest.advanceTimersByTimeAsync(GOOGLE_SILENT_DEADLINE_MS);
          await expect(answer).resolves.toBe(false);

          release(PAIR);
          await jest.advanceTimersByTimeAsync(0);

          expect(tokens.set).toHaveBeenCalledWith(PAIR);
          expect(router.navigateByUrl).toHaveBeenCalledWith('/velista/en/home');
        });

        it.each(unwanted)(
          'drops a late token and posts nothing when %s',
          async (_name, arrange) => {
            const fixture = lateToken();

            const answer = fixture.google.trySilent();
            await jest.advanceTimersByTimeAsync(GOOGLE_SILENT_DEADLINE_MS);
            await expect(answer).resolves.toBe(false);

            await arrange(fixture);
            fixture.release('id-late');
            await jest.advanceTimersByTimeAsync(0);

            expect(fixture.api.signInWithGoogleIdToken).not.toHaveBeenCalled();
            expect(fixture.tokens.set).not.toHaveBeenCalled();
            expect(fixture.router.navigateByUrl).not.toHaveBeenCalled();
          }
        );

        it.each(unwanted)(
          'drops a late pair, so nobody is moved, when %s',
          async (_name, arrange) => {
            const fixture = latePair();

            const answer = fixture.google.trySilent();
            await jest.advanceTimersByTimeAsync(GOOGLE_SILENT_DEADLINE_MS);
            await expect(answer).resolves.toBe(false);

            await arrange(fixture);
            fixture.release(PAIR);
            await jest.advanceTimersByTimeAsync(0);

            expect(fixture.tokens.set).not.toHaveBeenCalled();
            expect(fixture.router.navigateByUrl).not.toHaveBeenCalled();
          }
        );
      });
    });

    describe('stopAutoSignIn', () => {
      it('writes the flag and tells Android to forget the account', () => {
        const credential = picker();
        const { google, storage } = setup(undefined, { credential });

        google.stopAutoSignIn();

        expect(storage.get(StorageKeys.googleAutoSignInOff)).toBe('true');
        expect(credential.forget).toHaveBeenCalledTimes(1);
        expect(google.silentSignInAllowed()).toBe(false);
      });

      it('swallows a refusal from Android and keeps the flag', async () => {
        const credential = picker();
        credential.forget.mockRejectedValueOnce(new Error('failed'));
        const { google, storage } = setup(undefined, { credential });

        // Resolves rather than rejects: a caller that leaves it unawaited gets no
        // unhandled rejection, and sign out goes on.
        await expect(google.stopAutoSignIn()).resolves.toBeUndefined();

        expect(credential.forget).toHaveBeenCalledTimes(1);
        expect(storage.get(StorageKeys.googleAutoSignInOff)).toBe('true');
      });
    });
  });
});

describe('base64url', () => {
  it('writes the vector without padding', () => {
    expect(base64url(VECTOR_BYTES)).toBe(VECTOR_VERIFIER);
  });

  it('agrees with base64 on every tail length, with the url alphabet', () => {
    const cases = [[], [251], [251, 255], [251, 255, 191], [0, 0, 62, 63]];
    for (const bytes of cases) {
      const expected = Buffer.from(bytes)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
      expect(base64url(new Uint8Array(bytes))).toBe(expected);
    }
  });
});
