import { Logger } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { createSign, generateKeyPairSync } from 'node:crypto';
import {
  GOOGLE_ID_TOKEN_ISSUERS,
  GoogleIdTokenVerifier,
} from './google-id-token-verifier';

/**
 * The verifier against google-auth-library itself (plan 0238, target state 2).
 *
 * Every check here is the library's, run for real: the signature, the audience,
 * the issuer and the expiry. Only the fetch of Google's published keys is
 * replaced, by a key this spec makes, so the spec signs its own tokens and
 * reaches no network. A spec that asserted against a double of the library
 * would prove only that the double agrees with itself.
 */

const CLIENT_ID = 'web-client.apps.googleusercontent.com';
const KID = 'spec-key';

const signing = generateKeyPairSync('rsa', { modulusLength: 2048 });
const stranger = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicPem = signing.publicKey
  .export({ type: 'spki', format: 'pem' })
  .toString();

const encode = (value: object) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

/** A Google shaped ID token, signed with `key`, with any claim overridden. */
function idToken(
  claims: Record<string, unknown> = {},
  key = signing.privateKey
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: 'RS256', kid: KID, typ: 'JWT' });
  const payload = encode({
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    sub: 'g-person',
    email: 'person@example.com',
    email_verified: true,
    name: 'Example Person',
    nonce: 'the-nonce',
    iat: now,
    exp: now + 3600,
    ...claims,
  });
  const signature = createSign('RSA-SHA256')
    .update(`${header}.${payload}`)
    .sign(key)
    .toString('base64url');
  return `${header}.${payload}.${signature}`;
}

function verifier(clientId = CLIENT_ID): GoogleIdTokenVerifier {
  return new GoogleIdTokenVerifier({
    getOrThrow: () => ({ google: { clientId } }),
  } as never);
}

describe('GoogleIdTokenVerifier', () => {
  let certs: jest.SpyInstance;
  let warnings: string[];

  beforeEach(() => {
    certs = jest
      .spyOn(OAuth2Client.prototype, 'getFederatedSignonCertsAsync')
      .mockResolvedValue({
        certs: { [KID]: publicPem },
        format: 'PEM',
      } as never);
    warnings = [];
    jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation((message: unknown) => {
        warnings.push(String(message));
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('answers the claims of a good token', async () => {
    await expect(verifier().verify(idToken())).resolves.toEqual({
      sub: 'g-person',
      email: 'person@example.com',
      emailVerified: true,
      name: 'Example Person',
      nonce: 'the-nonce',
    });
  });

  it('accepts the bare issuer too', async () => {
    await expect(
      verifier().verify(idToken({ iss: 'accounts.google.com' }))
    ).resolves.toMatchObject({ sub: 'g-person' });
  });

  it('reads email_verified as true only when it is true', async () => {
    await expect(
      verifier().verify(idToken({ email_verified: false }))
    ).resolves.toMatchObject({ emailVerified: false });
    await expect(
      verifier().verify(idToken({ email_verified: 'true' }))
    ).resolves.toMatchObject({ emailVerified: false });
  });

  it('refuses a token for another audience', async () => {
    await expect(
      verifier().verify(idToken({ aud: 'other.apps.googleusercontent.com' }))
    ).resolves.toBeNull();
  });

  it('refuses an expired token, past the clock skew the library allows', async () => {
    const now = Math.floor(Date.now() / 1000);
    await expect(
      verifier().verify(idToken({ iat: now - 7200, exp: now - 3600 }))
    ).resolves.toBeNull();
  });

  it('refuses another issuer, the universe domain the library would accept included', async () => {
    expect(GOOGLE_ID_TOKEN_ISSUERS).not.toContain('googleapis.com');
    await expect(
      verifier().verify(idToken({ iss: 'googleapis.com' }))
    ).resolves.toBeNull();
    await expect(
      verifier().verify(idToken({ iss: 'https://evil.example' }))
    ).resolves.toBeNull();
  });

  it('refuses a token signed with another key', async () => {
    await expect(
      verifier().verify(idToken({}, stranger.privateKey))
    ).resolves.toBeNull();
  });

  it('refuses what is not a token at all', async () => {
    await expect(verifier().verify('not-a-token')).resolves.toBeNull();
    await expect(verifier().verify('')).resolves.toBeNull();
  });

  it('refuses everything while no client id is configured', async () => {
    await expect(verifier('').verify(idToken())).resolves.toBeNull();
    expect(certs).not.toHaveBeenCalled();
  });

  it('never logs the token, though the library writes it into its errors', async () => {
    const bad = idToken({}, stranger.privateKey);
    const expired = idToken({ iat: 1, exp: 2 });

    await verifier().verify(bad);
    await verifier().verify(expired);
    await verifier().verify('a.b');

    expect(warnings).toHaveLength(3);
    for (const line of warnings) {
      expect(line).not.toContain(bad);
      expect(line).not.toContain(expired);
      expect(line).not.toContain('a.b');
      expect(line).not.toContain('person@example.com');
    }
  });

  it('throws, without the token, when Google cannot be reached for its keys', async () => {
    certs.mockRejectedValue(
      new Error('getaddrinfo ENOTFOUND www.googleapis.com')
    );
    const token = idToken();

    const error = await verifier()
      .verify(token)
      .catch((caught: Error) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(token);
  });
});
