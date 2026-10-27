import { TestBed } from '@angular/core/testing';
import { APP_API_CONFIG } from '@portfolio/velista/models';
import { BrowserFacade } from '@portfolio/velista/platform';
import { webcrypto } from 'node:crypto';
import { ApiUrl } from '../api-url';
import { AuthApi } from './auth-api';
import { base64url, GOOGLE_VERIFIER_KEY, GoogleSignIn } from './google-sign-in';

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

function setup(mint: (challenge: string) => Promise<string>) {
  const calls: string[] = [];
  const storage = new Map<string, string>();

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
      storage.set(key, value);
    },
    removeSessionStorage: (key: string) => {
      calls.push(`remove ${key}`);
      storage.delete(key);
    },
    assignDocument: jest.fn((url: string) => calls.push(`assign ${url}`)),
  };
  const api = {
    mintGoogleState: jest.fn(async (challenge: string) => {
      calls.push('mint');
      return mint(challenge);
    }),
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
      { provide: BrowserFacade, useValue: facade },
      { provide: AuthApi, useValue: api },
    ],
  });

  return { google: TestBed.inject(GoogleSignIn), calls, storage, facade, api };
}

describe('GoogleSignIn', () => {
  it('keeps the verifier, mints with its challenge, and leaves for the state', async () => {
    const { google, calls, storage, facade, api } = setup(
      async () => 'state/1+'
    );

    await google.start();

    expect(GOOGLE_VERIFIER_KEY).toBe('google-verifier:velista');
    expect(storage.get(GOOGLE_VERIFIER_KEY)).toBe(VECTOR_VERIFIER);
    expect(api.mintGoogleState).toHaveBeenCalledWith(VECTOR_CHALLENGE);
    // The verifier is written before the mint goes out, and the document leaves last.
    expect(calls).toEqual([
      'randomBytes 32',
      `write ${GOOGLE_VERIFIER_KEY}`,
      'mint',
      'assign https://gateway.example/v1/auth/google?state=state%2F1%2B',
    ]);
    expect(facade.assignDocument).toHaveBeenCalledTimes(1);
  });

  it('removes the verifier and rejects when the mint fails', async () => {
    const refusal = new Error('not_configured');
    const { google, storage, facade } = setup(async () => {
      throw refusal;
    });

    await expect(google.start()).rejects.toBe(refusal);

    expect(storage.has(GOOGLE_VERIFIER_KEY)).toBe(false);
    expect(facade.assignDocument).not.toHaveBeenCalled();
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
