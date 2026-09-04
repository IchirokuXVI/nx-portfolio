// The manifest check, checked.
//
// A gate that cannot fail is not a gate, and this one is easy to break into a
// permanent pass: widen the require pattern and it matches nothing, read the
// wrong key out of the lockfile and every package looks installed, glob the
// wrong extension and it reads no bundle at all. Each case below is one of those.
//
// The fixtures are synthetic dist directories rather than a real build, so this
// suite runs in milliseconds and needs no webpack. What it proves is the
// checker's own logic. That the logic is pointed at the right files is proved by
// the `manifest-check` target, which runs it against the actual build output.
//
//   node --test apps/luna-shopper-backend/tools/ci/assert-runtime-manifest.test.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const CHECKER = fileURLToPath(
  new URL('./assert-runtime-manifest.mjs', import.meta.url)
);

const roots = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/**
 * A throwaway dist directory.
 *
 * `bundles` maps a file name to its contents, `installed` is the list of
 * packages the pruned lockfile carries. Returns the directory path.
 */
function distDir(bundles, installed) {
  const root = mkdtempSync(join(tmpdir(), 'manifest-check-'));
  roots.push(root);
  for (const [name, source] of Object.entries(bundles)) {
    writeFileSync(join(root, name), source);
  }
  const packages = { '': { name: 'fixture' } };
  for (const name of installed) packages[`node_modules/${name}`] = {};
  writeFileSync(
    join(root, 'package-lock.json'),
    JSON.stringify({ lockfileVersion: 3, packages })
  );
  return root;
}

function run(...dirs) {
  const result = spawnSync(process.execPath, [CHECKER, ...dirs], {
    encoding: 'utf8',
  });
  return { ...result, output: `${result.stdout}${result.stderr}` };
}

test('passes when every required package is in the lockfile', () => {
  const dir = distDir({ 'main.js': 'require("typeorm"); require("pg");' }, [
    'typeorm',
    'pg',
  ]);
  const { status, output } = run(dir);
  assert.equal(status, 0, output);
  assert.match(output, /Every bundle can resolve every package it requires/);
});

test('fails, and names the package and the bundle', () => {
  const dir = distDir(
    {
      'main.js': 'require("typeorm");',
      'seed-reference.js': 'require("uuid");',
    },
    ['typeorm']
  );
  const { status, output } = run(dir);
  assert.equal(status, 1);
  assert.match(output, /uuid/);
  assert.match(output, /seed-reference\.js/);
});

// The 2026-09-03 outage exactly: the service's own bundle is complete, and a
// secondary entry point that only a Helm hook ever runs is not. A checker that
// reads main.js alone reports this as a pass.
test('reads every bundle, not only main.js', () => {
  const dir = distDir(
    { 'main.js': 'require("typeorm");', 'migrate.js': 'require("uuid");' },
    ['typeorm']
  );
  const { status, output } = run(dir);
  assert.equal(status, 1);
  assert.match(output, /uuid {2}required by migrate\.js/);
});

test('accepts a nested lockfile path', () => {
  // npm writes a transitive package under the dependent's own node_modules when
  // versions conflict. It is still installed, and the image still resolves it.
  const root = mkdtempSync(join(tmpdir(), 'manifest-check-'));
  roots.push(root);
  writeFileSync(join(root, 'main.js'), 'require("tslib");');
  writeFileSync(
    join(root, 'package-lock.json'),
    JSON.stringify({
      lockfileVersion: 3,
      packages: { '': {}, 'node_modules/typeorm/node_modules/tslib': {} },
    })
  );
  const { status, output } = run(root);
  assert.equal(status, 0, output);
});

test('ignores builtins, node: specifiers and relative paths', () => {
  const dir = distDir(
    {
      'main.js':
        'require("fs"); require("node:crypto"); require("./local"); require("../up");',
    },
    []
  );
  const { status, output } = run(dir);
  assert.equal(status, 0, output);
});

test('reads a scoped package as its two segment name', () => {
  const dir = distDir(
    { 'main.js': 'require("@nestjs/jwt"); require("@nestjs/common/dist/x");' },
    ['@nestjs/jwt', '@nestjs/common']
  );
  const { status, output } = run(dir);
  assert.equal(status, 0, output);
});

test('reads a deep import as its package', () => {
  const dir = distDir(
    { 'main.js': 'require("typeorm/browser/index.js");' },
    []
  );
  const { status, output } = run(dir);
  assert.equal(status, 1);
  assert.match(output, /typeorm/);
  assert.doesNotMatch(output, /browser/);
});

test('reads both quote styles', () => {
  const dir = distDir({ 'main.js': "require('uuid');" }, []);
  const { status, output } = run(dir);
  assert.equal(status, 1);
  assert.match(output, /uuid/);
});

// An empty dist directory must not read as a clean service. It means the build
// did not run, and a green tick there is the most expensive kind of false pass:
// it says the images are fine when nothing was inspected at all.
test('refuses a dist directory with no bundle', () => {
  const dir = distDir({}, ['typeorm']);
  const { status, output } = run(dir);
  assert.notEqual(status, 0);
  assert.match(output, /no \.js bundle/);
});

test('checks every directory it is given and sums the failures', () => {
  const clean = distDir({ 'main.js': 'require("pg");' }, ['pg']);
  const broken = distDir({ 'main.js': 'require("uuid"); require("joi");' }, []);
  const { status, output } = run(clean, broken);
  assert.equal(status, 1);
  assert.match(output, /2 package\(s\) are required/);
});

test('exits 2 with no argument, rather than passing vacuously', () => {
  const { status } = run();
  assert.equal(status, 2);
});
