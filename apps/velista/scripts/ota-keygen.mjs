#!/usr/bin/env node
// Makes one OTA key pair for one flavor of the Android app (velista plan 0180, D5).
//
//   node apps/velista/scripts/ota-keygen.mjs --out <private key path>
//
// The private key (PEM PKCS8, P-256) goes to the path named, which must not exist yet.
// Inside this checkout the path must be one git ignores, for example the main
// checkout's tmp/velista-android/. The public key (PEM SPKI) is printed on stdout,
// for apps/velista/ota-keys/<flavor>.pub.pem. The private key is never printed.
//
// The owner then stores the private key as the secret VELISTA_OTA_SIGNING_KEY of the
// GitHub environment velista-staging or velista-production, reading the file on stdin
// so the value never appears in a command line:
//
//   gh secret set VELISTA_OTA_SIGNING_KEY --env velista-production < <private key path>

import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workspaceRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../..'
);

export class KeygenError extends Error {}

/** A fresh P-256 pair as PEM strings. */
export function generateOtaKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  return { privateKey, publicKey };
}

/** True when `path` is inside `root` and git would track it. */
export function trackableInside(root, path) {
  const rel = relative(root, path);
  if (rel === '' || rel.startsWith('..') || resolve(rel) === rel) {
    return false;
  }
  const result = spawnSync('git', ['check-ignore', '-q', rel], {
    cwd: root,
  });
  // 0: ignored. 1: not ignored. 128: `root` is not a git checkout, so nothing there
  // can be committed.
  return result.status === 1;
}

/** Writes the private key to `out` and answers the public key PEM. */
export function writeKeyPair(out, root = workspaceRoot) {
  const path = resolve(out);
  if (existsSync(path)) {
    throw new KeygenError(`${path} already exists; a key is never overwritten`);
  }
  if (trackableInside(root, path)) {
    throw new KeygenError(
      `${path} is inside the checkout and not ignored by git; a private key never goes where it could be committed`
    );
  }

  const { privateKey, publicKey } = generateOtaKeyPair();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, privateKey, { mode: 0o600, flag: 'wx' });
  return publicKey;
}

export function main(argv = process.argv.slice(2)) {
  const index = argv.indexOf('--out');
  const out = index === -1 ? undefined : argv[index + 1];
  if (out === undefined || out.startsWith('--')) {
    throw new KeygenError('--out <private key path> is required');
  }

  const publicKey = writeKeyPair(out);
  console.error(`ota-keygen: private key written to ${resolve(out)}`);
  console.error(
    'ota-keygen: the public key follows; save it as apps/velista/ota-keys/<flavor>.pub.pem'
  );
  process.stdout.write(publicKey);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    main();
  } catch (error) {
    console.error(
      `ota-keygen: ${error instanceof KeygenError ? error.message : error}`
    );
    process.exit(1);
  }
}
