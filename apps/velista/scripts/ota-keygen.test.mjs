// node --test apps/velista/scripts/ota-keygen.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { KeygenError, writeKeyPair } from './ota-keygen.mjs';

describe('ota-keygen', () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ota-keygen-'));
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes a P-256 private key and answers its public key', () => {
    const out = join(dir, 'keys', 'staging.pem');

    const publicPem = writeKeyPair(out, dir);

    const privateKey = createPrivateKey(readFileSync(out, 'utf8'));
    assert.equal(privateKey.asymmetricKeyDetails.namedCurve, 'prime256v1');
    assert.match(publicPem, /^-----BEGIN PUBLIC KEY-----/);
    assert.equal(
      createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }),
      publicPem
    );
  });

  it('never overwrites a key', () => {
    const out = join(dir, 'staging.pem');
    writeFileSync(out, 'the owner key');

    assert.throws(() => writeKeyPair(out, dir), KeygenError);
    assert.equal(readFileSync(out, 'utf8'), 'the owner key');
  });

  it('refuses a path inside a checkout that git would track', () => {
    spawnSync('git', ['init', '-q'], { cwd: dir });
    writeFileSync(join(dir, '.gitignore'), 'tmp\n');

    assert.throws(
      () => writeKeyPair(join(dir, 'apps', 'key.pem'), dir),
      /not ignored by git/
    );
    assert.match(
      writeKeyPair(join(dir, 'tmp', 'key.pem'), dir),
      /BEGIN PUBLIC KEY/
    );
  });
});
