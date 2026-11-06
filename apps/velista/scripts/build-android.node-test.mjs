// node --test apps/velista/scripts/build-android.node-test.mjs
//
// The decisions of build-android.mjs that need no Gradle and no SDK (plan 0180, target 2).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  builtinBundleId,
  nativeApiOf,
  needsCleartextLocalhost,
  otaBaseUrl,
  parseArgs,
  refusal,
} from './build-android.mjs';

const COMMIT = '0f7476f4e1a2b3c4d5e6f708192a3b4c5d6e7f80';

describe('parseArgs', () => {
  it('defaults to staging with OTA on', () => {
    assert.deepEqual(parseArgs(['node', 'x']), {
      flavor: 'staging',
      bundle: false,
      noOta: false,
      error: null,
    });
  });

  it('reads the flavor, --bundle and --no-ota', () => {
    const args = parseArgs([
      'node',
      'x',
      '--flavor',
      'production',
      '--bundle',
      '--no-ota',
    ]);
    assert.equal(args.flavor, 'production');
    assert.equal(args.bundle, true);
    assert.equal(args.noOta, true);
  });

  it('names an unknown flavor', () => {
    assert.match(parseArgs(['node', 'x', '--flavor', 'dev']).error, /not dev/);
  });
});

describe('otaBaseUrl', () => {
  it("is the flavor's own host", () => {
    assert.equal(
      otaBaseUrl({ flavor: 'staging', env: {}, noOta: false }),
      'https://staging.velista.app/ota/android/'
    );
    assert.equal(
      otaBaseUrl({ flavor: 'production', env: {}, noOta: false }),
      'https://velista.app/ota/android/'
    );
  });

  it('is empty when any host override is exported, so a slot APK never pulls a cluster bundle', () => {
    for (const key of [
      'VELISTA_APP_URL',
      'LUNA_GATEWAY_URL',
      'LUNA_REALTIME_URL',
    ]) {
      assert.equal(
        otaBaseUrl({
          flavor: 'staging',
          env: { [key]: 'http://10.0.2.2:43000' },
          noOta: false,
        }),
        ''
      );
    }
  });

  it('ignores an override exported empty', () => {
    assert.equal(
      otaBaseUrl({
        flavor: 'staging',
        env: { VELISTA_APP_URL: '' },
        noOta: false,
      }),
      'https://staging.velista.app/ota/android/'
    );
  });

  it('takes VELISTA_OTA_URL over the flavor and over a host override', () => {
    const env = {
      VELISTA_APP_URL: 'http://10.0.2.2:42005',
      VELISTA_OTA_URL: 'http://localhost:8787/ota/android/',
    };
    assert.equal(
      otaBaseUrl({ flavor: 'staging', env, noOta: false }),
      'http://localhost:8787/ota/android/'
    );
  });

  it('is empty with --no-ota, whatever the environment says', () => {
    assert.equal(
      otaBaseUrl({
        flavor: 'production',
        env: { VELISTA_OTA_URL: 'https://velista.app/ota/android/' },
        noOta: true,
      }),
      ''
    );
  });
});

describe('refusal', () => {
  const ok = { bundle: false, noOta: false, otaUrl: '', otaDirExists: false };

  it('lets an ordinary build through', () => {
    assert.equal(refusal(ok), null);
    assert.equal(
      refusal({
        ...ok,
        bundle: true,
        otaUrl: 'https://velista.app/ota/android/',
      }),
      null
    );
  });

  it('refuses --bundle with --no-ota', () => {
    assert.match(refusal({ ...ok, bundle: true, noOta: true }), /--no-ota/);
  });

  it('refuses --bundle with an http OTA URL', () => {
    assert.match(
      refusal({
        ...ok,
        bundle: true,
        otaUrl: 'http://localhost:8787/ota/android/',
      }),
      /--bundle refuses an http/
    );
  });

  it('accepts an http OTA URL on localhost without --bundle', () => {
    assert.equal(
      refusal({ ...ok, otaUrl: 'http://localhost:8787/ota/android/' }),
      null
    );
    assert.equal(
      refusal({ ...ok, otaUrl: 'http://127.0.0.1:8787/ota/android/' }),
      null
    );
  });

  it('refuses an http OTA URL on any other host', () => {
    assert.match(
      refusal({ ...ok, otaUrl: 'http://10.0.2.2:8787/ota/android/' }),
      /only name localhost/
    );
  });

  it('refuses an OTA URL that is not a URL, not http or https, or has no trailing slash', () => {
    assert.match(refusal({ ...ok, otaUrl: 'velista.app/ota' }), /not a URL/);
    assert.match(
      refusal({ ...ok, otaUrl: 'ftp://velista.app/ota/' }),
      /https or http/
    );
    assert.match(
      refusal({ ...ok, otaUrl: 'https://velista.app/ota/android' }),
      /end with a slash/
    );
  });

  it('refuses --bundle when the flavor has no committed public key, and names the file', () => {
    const message = refusal({
      ...ok,
      bundle: true,
      otaUrl: 'https://velista.app/ota/android/',
      publicKeyFile: 'apps/velista/ota-keys/production.pub.pem',
      publicKeyExists: false,
    });
    assert.match(message, /apps\/velista\/ota-keys\/production\.pub\.pem/);
    assert.match(message, /key ceremony/);
  });

  it('refuses --bundle with VELISTA_OTA_PUBLIC_KEY', () => {
    assert.match(
      refusal({
        ...ok,
        bundle: true,
        otaUrl: 'https://velista.app/ota/android/',
        publicKeyOverride: true,
      }),
      /VELISTA_OTA_PUBLIC_KEY/
    );
  });

  it('lets an APK without --bundle through with a missing key or a test key', () => {
    assert.equal(refusal({ ...ok, publicKeyExists: false }), null);
    assert.equal(refusal({ ...ok, publicKeyOverride: true }), null);
  });

  it('refuses while dist/apps/velista/ota exists, so the APK never carries the OTA files', () => {
    assert.match(
      refusal({ ...ok, otaDirExists: true }),
      /dist\/apps\/velista\/ota/
    );
  });
});

describe('needsCleartextLocalhost', () => {
  it('is true for an http URL only', () => {
    assert.equal(
      needsCleartextLocalhost('http://localhost:8787/ota/android/'),
      true
    );
    assert.equal(
      needsCleartextLocalhost('https://velista.app/ota/android/'),
      false
    );
    assert.equal(needsCleartextLocalhost(''), false);
  });

  it('reads the protocol as the refusal does, whatever its case', () => {
    assert.equal(
      needsCleartextLocalhost('HTTP://localhost:8787/ota/android/'),
      true
    );
    assert.equal(needsCleartextLocalhost('http-not-a-url'), false);
  });
});

describe('builtinBundleId', () => {
  it('is the version, a plus and the first 12 characters of the commit', () => {
    assert.equal(builtinBundleId('0.20.0', COMMIT), '0.20.0+0f7476f4e1a2');
    assert.equal(builtinBundleId('staging', COMMIT), 'staging+0f7476f4e1a2');
  });

  it('refuses anything but a full commit hash', () => {
    assert.throws(() => builtinBundleId('0.20.0', '0f7476f4e'), /full commit/);
  });
});

describe('nativeApiOf', () => {
  it('reads a positive integer', () => {
    assert.equal(nativeApiOf('{ "nativeApi": 3, "fingerprint": "x" }'), 3);
  });

  it('refuses zero, a fraction and a string', () => {
    for (const value of ['0', '1.5', '"1"']) {
      assert.throws(
        () => nativeApiOf(`{ "nativeApi": ${value} }`),
        /positive integer/
      );
    }
  });
});
