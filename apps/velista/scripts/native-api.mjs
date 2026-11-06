#!/usr/bin/env node
// The native compatibility key of the velista APK (plan 0180, D4).
//
//   node apps/velista/scripts/native-api.mjs --check | --bump | --accept
//
// `apps/velista/native-api.json` holds `nativeApi`, which every OTA bundle declares as the
// least it needs, and the fingerprint of the native surface it was last reviewed at. The
// fingerprint covers:
//   - every git tracked file under apps/velista/android, a binary file byte for byte and a
//     text file with its line endings read as LF
//   - the resolved version of every @capacitor/*, @capgo/* and @capawesome/* package in
//     package-lock.json
//   - libs/velista/native/src/lib/native-plugins.ts, every native method a bundle can call
//   - apps/velista/capacitor.config.ts
//
// --check   fails when the fingerprint moved, and names the two answers
// --bump    the change is visible to a bundle: nativeApi goes up by one, and no phone
//           applies a newer bundle until Play delivers the matching APK
// --accept  the change is not visible to a bundle: the fingerprint moves, the number stays
//
// The script never chooses between the last two. Plain Node and no dependency.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ANDROID_DIR = 'apps/velista/android';
export const SURFACE_FILES = [
  'libs/velista/native/src/lib/native-plugins.ts',
  'apps/velista/capacitor.config.ts',
];
export const LOCK_FILE = 'package-lock.json';
export const KEY_FILE = 'apps/velista/native-api.json';
const SCOPES = ['@capacitor/', '@capgo/', '@capawesome/'];

/**
 * The bytes the key hashes for one file. Nothing is decoded, so every byte counts. A file
 * with a NUL byte is binary by git's own rule and is hashed as it is. In any other file
 * each CRLF is read as LF, so a checkout's line endings never move the key.
 */
export function normalized(bytes) {
  if (bytes.includes(0)) {
    return bytes;
  }
  const out = Buffer.alloc(bytes.length);
  let length = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x0d && bytes[i + 1] === 0x0a) {
      continue;
    }
    out[length++] = bytes[i];
  }
  return out.subarray(0, length);
}

/** The resolved native package versions of a lock file, as sorted `name@version` lines. */
export function nativePackageVersions(lockText) {
  const lock = JSON.parse(lockText);
  const lines = [];
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    const at = path.lastIndexOf('node_modules/');
    if (at === -1) {
      continue;
    }
    const name = path.slice(at + 'node_modules/'.length);
    if (SCOPES.some((scope) => name.startsWith(scope))) {
      lines.push(`${path}@${entry.version}`);
    }
  }
  return lines.sort();
}

/** The tracked files under the Android directory, relative to the root, sorted. */
export function trackedAndroidFiles(root) {
  const result = spawnSync('git', ['ls-files', '-z', '--', ANDROID_DIR], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`git ls-files failed: ${result.stderr}`);
  }
  return result.stdout
    .split('\0')
    .filter((path) => path !== '')
    .sort();
}

/**
 * The SHA-256 of the native surface. Each part is named before its content, so moving
 * bytes from one file to another still changes the key.
 */
export function fingerprint(root, androidFiles = trackedAndroidFiles(root)) {
  const hash = createHash('sha256');
  const part = (name, text) => {
    hash.update(`${name}\n${Buffer.byteLength(text)}\n`);
    hash.update(text);
    hash.update('\n');
  };
  for (const path of androidFiles) {
    // A tracked file deleted from the working tree is a change like any other, and the
    // check reports it as a mismatch rather than dying on ENOENT.
    if (existsSync(join(root, path))) {
      part(`file ${path}`, normalized(readFileSync(join(root, path))));
    } else {
      part(`deleted ${path}`, '');
    }
  }
  part(
    'packages',
    nativePackageVersions(readFileSync(join(root, LOCK_FILE), 'utf8')).join(
      '\n'
    )
  );
  for (const path of SURFACE_FILES) {
    part(`file ${path}`, normalized(readFileSync(join(root, path))));
  }
  return hash.digest('hex');
}

function readKey(root) {
  const key = JSON.parse(readFileSync(join(root, KEY_FILE), 'utf8'));
  if (!Number.isInteger(key.nativeApi) || key.nativeApi < 1) {
    throw new Error(
      `${KEY_FILE}: nativeApi must be a positive integer, not ${key.nativeApi}`
    );
  }
  return key;
}

function writeKey(root, key) {
  writeFileSync(
    join(root, KEY_FILE),
    `${JSON.stringify({ nativeApi: key.nativeApi, fingerprint: key.fingerprint }, null, 2)}\n`
  );
}

/**
 * Runs one mode against a workspace root and answers `{ ok, message }`. Writes the key
 * file for --bump and --accept only.
 */
export function runMode(mode, root, androidFiles) {
  const key = readKey(root);
  const actual = fingerprint(root, androidFiles);
  if (mode === '--check') {
    if (key.fingerprint === actual) {
      return {
        ok: true,
        message: `native-api: nativeApi ${key.nativeApi}, the native surface matches`,
      };
    }
    return {
      ok: false,
      message: [
        `native-api: the native surface changed since ${KEY_FILE} was written.`,
        `  recorded ${key.fingerprint || '(none)'}`,
        `  now      ${actual}`,
        'Choose one, and say why in the pull request:',
        '  node apps/velista/scripts/native-api.mjs --bump    a bundle can see the change (a method in native-plugins.ts added, changed or removed, a new plugin, a Capacitor major, a plugin setting a bundle relies on)',
        '  node apps/velista/scripts/native-api.mjs --accept  no bundle can see it (a manifest flag, a resource, a Gradle or dependency bump that adds no method)',
      ].join('\n'),
    };
  }
  if (mode === '--bump') {
    const next = { nativeApi: key.nativeApi + 1, fingerprint: actual };
    writeKey(root, next);
    return {
      ok: true,
      message: `native-api: nativeApi ${key.nativeApi} -> ${next.nativeApi}. Bundles built from now on need an APK with ${next.nativeApi}, so upload that AAB before or with the release.`,
    };
  }
  if (mode === '--accept') {
    writeKey(root, { nativeApi: key.nativeApi, fingerprint: actual });
    return {
      ok: true,
      message: `native-api: fingerprint accepted, nativeApi stays ${key.nativeApi}`,
    };
  }
  return {
    ok: false,
    message: USAGE,
  };
}

const MODES = ['--check', '--bump', '--accept'];
const USAGE = 'native-api: pass exactly one of --check, --bump, --accept';

/** The command line: exactly one mode and nothing else, or a refusal that names the three. */
export function runCli(args, root, androidFiles) {
  const unknown = args.filter((arg) => !MODES.includes(arg));
  if (unknown.length > 0) {
    return {
      ok: false,
      message: `native-api: unknown argument ${unknown.join(' ')}. Pass exactly one of --check, --bump, --accept`,
    };
  }
  if (args.length !== 1) {
    return { ok: false, message: USAGE };
  }
  return runMode(args[0], root, androidFiles);
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const result = runCli(
    process.argv.slice(2),
    resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
  );
  (result.ok ? console.log : console.error)(result.message);
  process.exit(result.ok ? 0 : 1);
}
