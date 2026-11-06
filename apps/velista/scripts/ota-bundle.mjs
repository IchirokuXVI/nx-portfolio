#!/usr/bin/env node
// Turns the built web bundle into the OTA files of the Android app (velista plan 0180,
// target 3): one zip named by its SHA-256, `manifest.json`, and with a key
// `manifest.json.sig`. Plain Node 22 and no dependency, like build-android.mjs.
//
//   node apps/velista/scripts/ota-bundle.mjs [--dist <dir>] [--native-api <file>]
//   node apps/velista/scripts/ota-bundle.mjs --verify <public key pem file> [--dist <dir>]
//
// Writes into <dist>/ota/android/, default dist/apps/velista/ota/android/:
//   bundles/<sha256>.zip   the bundle, index.html at its root
//   manifest.json          section 3 of the plan
//   manifest.json.sig      the ECDSA P-256 signature over the exact bytes of
//                          manifest.json, in the IEEE P1363 form (r || s, 64 bytes),
//                          base64 encoded on one line with no newline. Text, so the
//                          app reads it with the same text fetch as the manifest.
//
// Environment it reads:
//   VELISTA_APP_VERSION      the version the bundle was built with, default
//                            DEFAULT_APP_VERSION of apps/velista/app-version.ts
//   GITHUB_SHA               the commit, default `git rev-parse HEAD`
//   VELISTA_OTA_SIGNING_KEY  the flavor's private key, PEM PKCS8. Without it the
//                            manifest is written unsigned, and the app ignores it.
//                            Never printed, and never passed on a command line.
//
// The zip is deterministic: sorted paths, fixed timestamps, fixed attributes, so the
// same build gives the same SHA-256 on every run.

import { spawnSync } from 'node:child_process';
import {
  createHash,
  createPrivateKey,
  sign as signBytes,
  webcrypto,
} from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = resolve(appRoot, '../..');

export const OTA_DIR = 'ota/android';
export const MANIFEST_FILE = 'manifest.json';
export const SIGNATURE_FILE = 'manifest.json.sig';

/**
 * Top level entries of the build that never enter the zip (section 3): the image's
 * nginx config, the runtime config the image or the APK writes (D2), and the OTA
 * output itself.
 */
export const EXCLUDED = new Set(['nginx.conf', 'config.json', 'ota']);

export class OtaError extends Error {}

// ---------------------------------------------------------------------------------
// The zip, by hand: local headers, deflated or stored data, a central directory.
// No zip64, no data descriptors, no directory entries, no extra fields.
// ---------------------------------------------------------------------------------

// 1980-01-01 00:00:00, the first moment a DOS timestamp can name.
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
// Bit 11: the names are UTF-8.
const FLAGS = 0x0800;
const VERSION = 20;

/** Every file under `root`, as sorted forward slash paths, minus the exclusions. */
export function bundleFiles(root) {
  const files = [];
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (prefix === '' && EXCLUDED.has(entry.name)) {
        continue;
      }
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), path);
      } else if (entry.isFile()) {
        files.push(path);
      }
    }
  };
  walk(root, '');
  // By code unit, not by locale, so the order is the same on every machine.
  return files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** A zip of `entries` (`{ name, data }`, in the order given) as one Buffer. */
export function zipEntries(entries) {
  if (entries.length > 0xffff) {
    throw new OtaError('too many files for a zip without zip64');
  }

  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const deflated = deflateRawSync(data, { level: 9 });
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const method = stored ? 0 : 8;
    const crc = crc32(data);

    if (offset + 30 + nameBytes.length + body.length > 0xffffffff) {
      throw new OtaError('the bundle is too large for a zip without zip64');
    }

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(VERSION, 4);
    local.writeUInt16LE(FLAGS, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(VERSION, 4);
    central.writeUInt16LE(VERSION, 6);
    central.writeUInt16LE(FLAGS, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    // Extra length, comment length, disk number, internal and external attributes
    // stay zero.
    central.writeUInt32LE(offset, 42);

    locals.push(local, nameBytes, body);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + body.length;
  }

  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, directory, end]);
}

/** The zip of a built bundle directory, deterministic over runs. */
export function zipBundle(root) {
  const files = bundleFiles(root);
  if (!files.includes('index.html')) {
    throw new OtaError(`${root} has no index.html at its root`);
  }
  return zipEntries(
    files.map((name) => ({ name, data: readFileSync(join(root, name)) }))
  );
}

// ---------------------------------------------------------------------------------
// The manifest
// ---------------------------------------------------------------------------------

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** `appData.critical` of the built `ngsw.json`. A missing file is a refusal. */
export function readCritical(distDir) {
  const path = join(distDir, 'ngsw.json');
  if (!existsSync(path)) {
    throw new OtaError(
      `${path} does not exist; build velista with the production configuration first`
    );
  }
  let ngsw;
  try {
    ngsw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new OtaError(`${path} is not JSON`);
  }
  return ngsw?.appData?.critical === true;
}

export function readNativeApi(file) {
  if (!existsSync(file)) {
    throw new OtaError(`${file} does not exist`);
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new OtaError(`${file} is not JSON`);
  }
  const nativeApi = parsed?.nativeApi;
  if (!Number.isInteger(nativeApi) || nativeApi < 1) {
    throw new OtaError(`${file} names no positive integer nativeApi`);
  }
  return nativeApi;
}

export function defaultAppVersion() {
  const source = readFileSync(join(appRoot, 'app-version.ts'), 'utf8');
  const match = /DEFAULT_APP_VERSION\s*=\s*'([^']+)'/.exec(source);
  if (match === null) {
    throw new OtaError(
      'DEFAULT_APP_VERSION not found in apps/velista/app-version.ts'
    );
  }
  return match[1];
}

export function resolveCommit(env = process.env) {
  let commit = env.GITHUB_SHA ?? '';
  if (commit === '') {
    const result = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: workspaceRoot,
      encoding: 'utf8',
    });
    commit = result.status === 0 ? result.stdout.trim() : '';
  }
  if (!/^[0-9a-f]{40}$/i.test(commit)) {
    throw new OtaError(
      'no commit: set GITHUB_SHA or run inside the git checkout'
    );
  }
  return commit.toLowerCase();
}

/** The manifest's `bundle` (D8): the version, a plus, 12 characters of the commit. */
export function bundleId(version, commit) {
  return `${version}+${commit.slice(0, 12)}`;
}

/** The P1363 signature over `bytes`, base64. Throws a message that names no key. */
export function signManifest(bytes, privateKeyPem) {
  let key;
  try {
    key = createPrivateKey(privateKeyPem);
  } catch {
    throw new OtaError(
      'VELISTA_OTA_SIGNING_KEY is not a private key in PEM form'
    );
  }
  if (
    key.asymmetricKeyType !== 'ec' ||
    key.asymmetricKeyDetails?.namedCurve !== 'prime256v1'
  ) {
    throw new OtaError('VELISTA_OTA_SIGNING_KEY is not a P-256 key');
  }
  return signBytes('sha256', bytes, {
    key,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64');
}

/**
 * Writes the three files (two without a key) into `<distDir>/ota/android/` and
 * answers what it wrote.
 */
export function writeOtaFiles({
  distDir,
  version,
  commit,
  nativeApi,
  signingKey,
  now = new Date(),
}) {
  const critical = readCritical(distDir);
  const zip = zipBundle(distDir);
  const sha256 = sha256Hex(zip);

  const outDir = join(distDir, OTA_DIR);
  rmSync(join(distDir, 'ota'), { recursive: true, force: true });
  mkdirSync(join(outDir, 'bundles'), { recursive: true });

  const url = `bundles/${sha256}.zip`;
  writeFileSync(join(outDir, url), zip);

  const manifest = {
    schema: 1,
    platform: 'android',
    bundle: bundleId(version, commit),
    version,
    nativeApi,
    critical,
    url,
    sha256,
    size: zip.length,
    builtAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
  const manifestBytes = Buffer.from(
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );
  writeFileSync(join(outDir, MANIFEST_FILE), manifestBytes);

  const signed = typeof signingKey === 'string' && signingKey.trim() !== '';
  if (signed) {
    writeFileSync(
      join(outDir, SIGNATURE_FILE),
      signManifest(manifestBytes, signingKey),
      'ascii'
    );
  }

  return { outDir, manifest, signed };
}

function spkiFromPem(pem) {
  const match =
    /-----BEGIN PUBLIC KEY-----([\s\S]+?)-----END PUBLIC KEY-----/.exec(pem);
  if (match === null) {
    throw new OtaError('the public key is not a PEM PUBLIC KEY block');
  }
  return Buffer.from(match[1].replace(/\s+/g, ''), 'base64');
}

/**
 * Checks the three files the way the app does: the signature over the exact bytes
 * with WebCrypto, then the zip against the manifest's SHA-256 and size.
 */
export async function verifyOtaFiles({ distDir, publicKeyPem }) {
  const outDir = join(distDir, OTA_DIR);
  const manifestPath = join(outDir, MANIFEST_FILE);
  const signaturePath = join(outDir, SIGNATURE_FILE);
  if (!existsSync(manifestPath)) {
    throw new OtaError(`${manifestPath} does not exist`);
  }
  if (!existsSync(signaturePath)) {
    throw new OtaError(
      `${signaturePath} does not exist: the manifest is unsigned`
    );
  }

  const manifestBytes = readFileSync(manifestPath);
  const signature = Buffer.from(
    readFileSync(signaturePath, 'ascii').trim(),
    'base64'
  );

  const key = await webcrypto.subtle.importKey(
    'spki',
    spkiFromPem(publicKeyPem),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  );
  const valid =
    signature.length === 64 &&
    (await webcrypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      signature,
      manifestBytes
    ));
  if (!valid) {
    throw new OtaError('the signature does not match manifest.json');
  }

  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (
    typeof manifest.url !== 'string' ||
    !/^bundles\/[0-9a-f]{64}\.zip$/.test(manifest.url)
  ) {
    throw new OtaError(`the manifest names an unexpected url ${manifest.url}`);
  }
  const zipPath = join(outDir, manifest.url);
  if (!existsSync(zipPath)) {
    throw new OtaError(`${zipPath} does not exist`);
  }
  const zip = readFileSync(zipPath);
  if (sha256Hex(zip) !== manifest.sha256 || zip.length !== manifest.size) {
    throw new OtaError('the zip does not match the manifest');
  }

  return manifest;
}

// ---------------------------------------------------------------------------------
// The command line
// ---------------------------------------------------------------------------------

function argValue(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) {
    return null;
  }
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new OtaError(`${name} needs a value`);
  }
  return value;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const distDir = resolve(
    argValue(argv, '--dist') ?? join(workspaceRoot, 'dist/apps/velista')
  );

  const verify = argValue(argv, '--verify');
  if (verify !== null) {
    const manifest = await verifyOtaFiles({
      distDir,
      publicKeyPem: readFileSync(resolve(verify), 'utf8'),
    });
    console.log(
      `ota-bundle: verified ${manifest.bundle} (${manifest.sha256}, ${manifest.size} bytes)`
    );
    return;
  }

  const nativeApi = readNativeApi(
    resolve(argValue(argv, '--native-api') ?? join(appRoot, 'native-api.json'))
  );
  const { outDir, manifest, signed } = writeOtaFiles({
    distDir,
    version: env.VELISTA_APP_VERSION || defaultAppVersion(),
    commit: resolveCommit(env),
    nativeApi,
    signingKey: env.VELISTA_OTA_SIGNING_KEY,
  });

  console.log(`ota-bundle: ${manifest.bundle} into ${outDir}`);
  console.log(`  ${manifest.url} (${manifest.size} bytes)`);
  console.log(
    `  nativeApi ${manifest.nativeApi}, critical ${manifest.critical}`
  );
  console.log(
    signed
      ? '  signed'
      : '  unsigned: VELISTA_OTA_SIGNING_KEY is not set, and the app ignores an unsigned manifest'
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(
      `ota-bundle: ${error instanceof OtaError ? error.message : error}`
    );
    process.exit(1);
  });
}
