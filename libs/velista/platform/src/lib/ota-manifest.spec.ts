import { generateKeyPairSync, sign, webcrypto } from 'node:crypto';
import { parseOtaManifest, verifyOtaManifest } from './ota-manifest';

const SHA = 'ab'.repeat(32);

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    schema: 1,
    platform: 'android',
    bundle: '0.20.0+0f7476f4e1a2',
    version: '0.20.0',
    nativeApi: 1,
    critical: false,
    url: `bundles/${SHA}.zip`,
    sha256: SHA,
    size: 3145728,
    builtAt: '2026-11-05T10:00:00Z',
    ...overrides,
  };
}

describe('parseOtaManifest', () => {
  it('maps the manifest of section 3', () => {
    expect(parseOtaManifest(manifest({ critical: true }))).toEqual(
      manifest({ critical: true })
    );
  });

  it('reads a missing critical as false, and lowercases the SHA-256', () => {
    const { critical, ...rest } = manifest();
    void critical;

    expect(
      parseOtaManifest({ ...rest, sha256: SHA.toUpperCase() })
    ).toMatchObject({ critical: false, sha256: SHA });
  });

  it.each([
    ['another schema', { schema: 2 }],
    ['a schema as text', { schema: '1' }],
    ['another platform', { platform: 'ios' }],
    ['an absolute url', { url: `https://evil.test/bundles/${SHA}.zip` }],
    ['a protocol relative url', { url: `//evil.test/${SHA}.zip` }],
    ['a url outside bundles/', { url: `${SHA}.zip` }],
    ['a url that climbs out', { url: `bundles/../index.html` }],
    ['a url with a backslash', { url: `bundles\\${SHA}.zip` }],
    ['a url with a query', { url: `bundles/${SHA}.zip?x=1` }],
    ['a short sha256', { sha256: 'ab'.repeat(31) }],
    ['a sha256 that is not hex', { sha256: 'zz'.repeat(32) }],
    ['a zero nativeApi', { nativeApi: 0 }],
    ['a fractional nativeApi', { nativeApi: 1.5 }],
    ['a nativeApi as text', { nativeApi: '1' }],
    ['an empty bundle', { bundle: '' }],
    ['the reserved id builtin', { bundle: 'builtin' }],
    ['an empty version', { version: '' }],
    ['a negative size', { size: -1 }],
    ['a critical that is not a boolean', { critical: 'true' }],
  ])('refuses %s', (_, overrides) => {
    expect(parseOtaManifest(manifest(overrides))).toBeNull();
  });

  it.each([null, undefined, 'text', 42, []])('refuses %p', (raw) => {
    expect(parseOtaManifest(raw)).toBeNull();
  });
});

describe('verifyOtaManifest', () => {
  const subtle = webcrypto.subtle as unknown as SubtleCrypto;

  // The pair and the signature `ota-bundle.mjs` makes: Node's `sign` with the P1363
  // encoding, the signature written as base64 text.
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const text = `${JSON.stringify(manifest(), null, 2)}\n`;
  const signature = sign('sha256', Buffer.from(text, 'utf8'), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  const base64 = signature.toString('base64');

  it('accepts the signature file over the exact text', async () => {
    await expect(
      verifyOtaManifest(text, base64, publicKey, subtle)
    ).resolves.toBe(true);
  });

  it('accepts the raw signature over the bytes', async () => {
    await expect(
      verifyOtaManifest(
        new Uint8Array(Buffer.from(text, 'utf8')),
        new Uint8Array(signature),
        publicKey,
        subtle
      )
    ).resolves.toBe(true);
  });

  it('refuses one changed byte', async () => {
    await expect(
      verifyOtaManifest(
        text.replace('"nativeApi": 1', '"nativeApi": 2'),
        base64,
        publicKey,
        subtle
      )
    ).resolves.toBe(false);
  });

  it('refuses another key', async () => {
    const other = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    await expect(
      verifyOtaManifest(text, base64, other.publicKey, subtle)
    ).resolves.toBe(false);
  });

  it.each([
    [
      'a DER signature',
      sign('sha256', Buffer.from(text), privateKey).toString('base64'),
    ],
    ['text that is not base64', '***'],
    ['an empty signature', ''],
  ])('answers false and never throws for %s', async (_, sig) => {
    await expect(verifyOtaManifest(text, sig, publicKey, subtle)).resolves.toBe(
      false
    );
  });

  it('answers false for a key that is not a PEM, or no WebCrypto at all', async () => {
    await expect(
      verifyOtaManifest(text, base64, 'not a key', subtle)
    ).resolves.toBe(false);
    await expect(
      verifyOtaManifest(text, base64, publicKey, null)
    ).resolves.toBe(false);
  });
});
