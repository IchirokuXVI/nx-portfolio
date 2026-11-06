// node --test apps/velista/scripts/native-api.node-test.mjs
//
// Not `*.spec.mjs`: the Nx Jest preset matches .mjs specs, and velista:test would load this
// node:test file as a Jest suite.
//
// Every case runs against a fixture workspace in a temp directory, never the real tree. The
// Android file list is passed in, so the fixture needs no git repository.
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  fingerprint,
  KEY_FILE,
  nativePackageVersions,
  runMode,
} from './native-api.mjs';

const ANDROID_FILES = [
  'apps/velista/android/app/build.gradle',
  'apps/velista/android/app/src/main/java/app/velista/MainActivity.java',
];

function lock(capacitorCore) {
  return JSON.stringify(
    {
      name: 'fixture',
      lockfileVersion: 3,
      packages: {
        '': { dependencies: {} },
        'node_modules/@capacitor/core': { version: capacitorCore },
        'node_modules/@capacitor/android': { version: '8.5.3' },
        'node_modules/@capgo/capacitor-updater': { version: '8.54.2' },
        'node_modules/@capawesome/capacitor-app-update': { version: '8.1.1' },
        'node_modules/left-pad': { version: '1.3.0' },
      },
    },
    null,
    2
  );
}

let root;

function write(path, text) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

function key() {
  return JSON.parse(readFileSync(join(root, KEY_FILE), 'utf8'));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'native-api-'));
  write(ANDROID_FILES[0], 'android {\n  namespace = "app.velista"\n}\n');
  write(ANDROID_FILES[1], 'public class MainActivity {}\n');
  write('libs/velista/native/src/lib/native-plugins.ts', 'export {};\n');
  write('apps/velista/capacitor.config.ts', 'export default {};\n');
  write('package-lock.json', lock('8.5.3'));
  write(KEY_FILE, JSON.stringify({ nativeApi: 1, fingerprint: '' }));
  runMode('--accept', root, ANDROID_FILES);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('native-api', () => {
  it('passes on a clean tree', () => {
    const result = runMode('--check', root, ANDROID_FILES);
    assert.equal(result.ok, true);
    assert.match(result.message, /nativeApi 1/);
  });

  it('fails after a change to an Android file, and names both answers', () => {
    write(ANDROID_FILES[1], 'public class MainActivity { }\n');
    const result = runMode('--check', root, ANDROID_FILES);
    assert.equal(result.ok, false);
    assert.match(result.message, /--bump/);
    assert.match(result.message, /--accept/);
  });

  it('fails when an Android file is added to the tracked list', () => {
    write('apps/velista/android/app/src/main/res/xml/extra.xml', '<x/>\n');
    const result = runMode('--check', root, [
      ...ANDROID_FILES,
      'apps/velista/android/app/src/main/res/xml/extra.xml',
    ]);
    assert.equal(result.ok, false);
  });

  it('passes when only the line endings change', () => {
    write(
      ANDROID_FILES[0],
      'android {\r\n  namespace = "app.velista"\r\n}\r\n'
    );
    write('apps/velista/capacitor.config.ts', 'export default {};\r\n');
    assert.equal(runMode('--check', root, ANDROID_FILES).ok, true);
  });

  it('fails when a Capacitor version in the lock file changes', () => {
    write('package-lock.json', lock('8.5.4'));
    assert.equal(runMode('--check', root, ANDROID_FILES).ok, false);
  });

  it('ignores a package outside the native scopes', () => {
    write('package-lock.json', lock('8.5.3').replace('"1.3.0"', '"1.3.1"'));
    assert.equal(runMode('--check', root, ANDROID_FILES).ok, true);
  });

  it('fails when native-plugins.ts or capacitor.config.ts changes', () => {
    write(
      'libs/velista/native/src/lib/native-plugins.ts',
      'export const a = 1;\n'
    );
    assert.equal(runMode('--check', root, ANDROID_FILES).ok, false);
    runMode('--accept', root, ANDROID_FILES);
    write('apps/velista/capacitor.config.ts', 'export default { a: 1 };\n');
    assert.equal(runMode('--check', root, ANDROID_FILES).ok, false);
  });

  it('--bump raises nativeApi by one and records the new fingerprint', () => {
    write(ANDROID_FILES[1], 'public class MainActivity { void a() {} }\n');
    const result = runMode('--bump', root, ANDROID_FILES);
    assert.equal(result.ok, true);
    assert.deepEqual(key(), {
      nativeApi: 2,
      fingerprint: fingerprint(root, ANDROID_FILES),
    });
    assert.equal(runMode('--check', root, ANDROID_FILES).ok, true);
  });

  it('--accept records the new fingerprint and keeps nativeApi', () => {
    write(ANDROID_FILES[0], 'android {\n  namespace = "app.velista"\n  x\n}\n');
    const before = key().fingerprint;
    const result = runMode('--accept', root, ANDROID_FILES);
    assert.equal(result.ok, true);
    assert.equal(key().nativeApi, 1);
    assert.notEqual(key().fingerprint, before);
    assert.equal(runMode('--check', root, ANDROID_FILES).ok, true);
  });

  it('refuses a nativeApi that is not a positive integer', () => {
    write(KEY_FILE, JSON.stringify({ nativeApi: 0, fingerprint: '' }));
    assert.throws(
      () => runMode('--check', root, ANDROID_FILES),
      /positive integer/
    );
  });

  it('reads the native packages and nothing else from a lock file', () => {
    assert.deepEqual(nativePackageVersions(lock('8.5.3')), [
      'node_modules/@capacitor/android@8.5.3',
      'node_modules/@capacitor/core@8.5.3',
      'node_modules/@capawesome/capacitor-app-update@8.1.1',
      'node_modules/@capgo/capacitor-updater@8.54.2',
    ]);
  });
});
