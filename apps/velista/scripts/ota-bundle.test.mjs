// node --test apps/velista/scripts/ota-bundle.test.mjs
import assert from 'node:assert/strict';
import { createPublicKey, webcrypto } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { crc32, inflateRawSync } from 'node:zlib';
import {
  bundleId,
  MANIFEST_FILE,
  OTA_DIR,
  OtaError,
  readNativeApi,
  sha256Hex,
  SIGNATURE_FILE,
  verifyOtaFiles,
  writeOtaFiles,
  zipBundle,
} from './ota-bundle.mjs';
import { generateOtaKeyPair } from './ota-keygen.mjs';

const COMMIT = '0f7476f4e1a2b3c4d5e6f708192a3b4c5d6e7f80';

/** Every entry of a zip, read back through its central directory. */
function readZip(zip) {
  const end = zip.length - 22;
  assert.equal(zip.readUInt32LE(end), 0x06054b50);
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    assert.equal(zip.readUInt32LE(at), 0x02014b50);
    const method = zip.readUInt16LE(at + 10);
    const crc = zip.readUInt32LE(at + 16);
    const compressed = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const offset = zip.readUInt32LE(at + 42);
    const name = zip.toString('utf8', at + 46, at + 46 + nameLength);

    assert.equal(zip.readUInt32LE(offset), 0x04034b50);
    const localName = zip.readUInt16LE(offset + 26);
    const start = offset + 30 + localName;
    const body = zip.subarray(start, start + compressed);
    const data = method === 8 ? inflateRawSync(body) : Buffer.from(body);
    assert.equal(crc32(data), crc, `crc of ${name}`);
    entries.set(name, data);
    at += 46 + nameLength;
  }
  return entries;
}

describe('ota-bundle', () => {
  let dist;

  beforeEach(() => {
    dist = mkdtempSync(join(tmpdir(), 'ota-bundle-'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><base href="/">');
    writeFileSync(join(dist, 'main.0123456789abcdef.js'), 'x'.repeat(4000));
    writeFileSync(join(dist, 'ngsw.json'), '{"appData":{"critical":false}}');
    writeFileSync(join(dist, 'nginx.conf'), 'events {}');
    writeFileSync(join(dist, 'config.json'), '{"gateway":"x"}');
    mkdirSync(join(dist, 'landing'));
    writeFileSync(join(dist, 'landing', 'a.webp'), Buffer.from([1, 2, 3]));
    mkdirSync(join(dist, 'ota', 'android'), { recursive: true });
    writeFileSync(join(dist, 'ota', 'android', 'stale.zip'), 'old');
  });

  afterEach(() => rmSync(dist, { recursive: true, force: true }));

  it('gives the same SHA-256 over two runs, whatever the timestamps', () => {
    const first = sha256Hex(zipBundle(dist));
    utimesSync(join(dist, 'index.html'), new Date(2001, 1, 1), new Date());
    const second = sha256Hex(zipBundle(dist));

    assert.equal(first, second);
  });

  it('holds the bundle with index.html at its root, minus the exclusions', () => {
    const entries = readZip(zipBundle(dist));

    assert.deepEqual(
      [...entries.keys()],
      ['index.html', 'landing/a.webp', 'main.0123456789abcdef.js', 'ngsw.json']
    );
    assert.equal(entries.get('main.0123456789abcdef.js').length, 4000);
    assert.deepEqual([...entries.get('landing/a.webp')], [1, 2, 3]);
  });

  it('refuses a build with no ngsw.json', () => {
    rmSync(join(dist, 'ngsw.json'));

    assert.throws(
      () =>
        writeOtaFiles({
          distDir: dist,
          version: '0.20.0',
          commit: COMMIT,
          nativeApi: 1,
        }),
      (error) => error instanceof OtaError && /ngsw\.json/.test(error.message)
    );
  });

  it('writes the manifest of section 3 and no signature without a key', () => {
    writeFileSync(join(dist, 'ngsw.json'), '{"appData":{"critical":true}}');

    const { outDir, manifest, signed } = writeOtaFiles({
      distDir: dist,
      version: '0.20.0',
      commit: COMMIT,
      nativeApi: 2,
      now: new Date('2026-11-05T10:00:00.123Z'),
    });

    const onDisk = JSON.parse(
      readFileSync(join(outDir, MANIFEST_FILE), 'utf8')
    );
    assert.deepEqual(onDisk, manifest);
    assert.deepEqual(Object.keys(onDisk), [
      'schema',
      'platform',
      'bundle',
      'version',
      'nativeApi',
      'critical',
      'url',
      'sha256',
      'size',
      'builtAt',
    ]);
    assert.equal(manifest.bundle, '0.20.0+0f7476f4e1a2');
    assert.equal(manifest.critical, true);
    assert.equal(manifest.nativeApi, 2);
    assert.equal(manifest.builtAt, '2026-11-05T10:00:00Z');
    assert.equal(manifest.url, `bundles/${manifest.sha256}.zip`);

    const zip = readFileSync(join(outDir, manifest.url));
    assert.equal(sha256Hex(zip), manifest.sha256);
    assert.equal(zip.length, manifest.size);
    assert.equal(signed, false);
    assert.throws(() => readFileSync(join(outDir, SIGNATURE_FILE)));
    // The stale output was cleared, and the output never enters its own zip.
    assert.throws(() => readFileSync(join(dist, OTA_DIR, 'stale.zip')));
  });

  it('signs so that WebCrypto verifies the exact bytes with the public key', async () => {
    const { privateKey, publicKey } = generateOtaKeyPair();

    const { outDir } = writeOtaFiles({
      distDir: dist,
      version: 'staging',
      commit: COMMIT,
      nativeApi: 1,
      signingKey: privateKey,
    });

    const text = readFileSync(join(outDir, SIGNATURE_FILE), 'ascii');
    assert.match(text, /^[A-Za-z0-9+/]+=*$/);
    const signature = Buffer.from(text, 'base64');
    assert.equal(signature.length, 64);

    const key = await webcrypto.subtle.importKey(
      'spki',
      createPublicKey(publicKey).export({ type: 'spki', format: 'der' }),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );
    const bytes = readFileSync(join(outDir, MANIFEST_FILE));
    assert.equal(
      await webcrypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        key,
        signature,
        bytes
      ),
      true
    );

    const verified = await verifyOtaFiles({
      distDir: dist,
      publicKeyPem: publicKey,
    });
    assert.equal(verified.bundle, 'staging+0f7476f4e1a2');
  });

  it('--verify refuses a manifest changed after signing, or another key', async () => {
    const { privateKey, publicKey } = generateOtaKeyPair();
    const other = generateOtaKeyPair();
    const { outDir } = writeOtaFiles({
      distDir: dist,
      version: '0.20.0',
      commit: COMMIT,
      nativeApi: 1,
      signingKey: privateKey,
    });

    await assert.rejects(
      verifyOtaFiles({ distDir: dist, publicKeyPem: other.publicKey }),
      OtaError
    );

    const path = join(outDir, MANIFEST_FILE);
    writeFileSync(
      path,
      readFileSync(path, 'utf8').replace('"nativeApi": 1', '"nativeApi": 9')
    );
    await assert.rejects(
      verifyOtaFiles({ distDir: dist, publicKeyPem: publicKey }),
      /signature/
    );
  });

  it('refuses a signing key that is not a P-256 private key, naming no key', () => {
    assert.throws(
      () =>
        writeOtaFiles({
          distDir: dist,
          version: '0.20.0',
          commit: COMMIT,
          nativeApi: 1,
          signingKey: 'not a key',
        }),
      (error) =>
        error instanceof OtaError && !error.message.includes('not a key')
    );
  });

  it('reads nativeApi and refuses anything but a positive integer', () => {
    const file = join(dist, 'native-api.json');
    writeFileSync(file, '{"nativeApi":3,"fingerprint":"x"}');
    assert.equal(readNativeApi(file), 3);

    writeFileSync(file, '{"nativeApi":0}');
    assert.throws(() => readNativeApi(file), OtaError);
  });

  it('names the bundle by the version and 12 characters of the commit', () => {
    assert.equal(bundleId('0.20.0', COMMIT), '0.20.0+0f7476f4e1a2');
  });
});
