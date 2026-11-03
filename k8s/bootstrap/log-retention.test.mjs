// The tests of nx-log-retention (k8s plan 0018, section 5).
//
// Each test builds a /var/log/pods shaped tree in a temporary directory, runs
// the script on it with --root and --now, and reads the files back. Plain node
// and bash, so it runs in pr.yml with no Nx project.
//
//   node --test k8s/bootstrap/log-retention.test.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  'log-retention.sh'
);

// On Windows a bare `bash` can resolve to WSL, which cannot read these paths.
const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe';
const BASH =
  process.platform === 'win32' && existsSync(GIT_BASH) ? GIT_BASH : 'bash';

const NOW = Date.parse('2026-11-30T12:00:00Z');
const DAY = 86_400_000;

const RULES = '*/* 30\n*/luna-shopper-backend-assistant 7\n';

/** A CRI log line written `daysAgo` days before NOW. */
function line(daysAgo, text) {
  return `${new Date(NOW - daysAgo * DAY).toISOString()} stdout F ${text}\n`;
}

let root;
let config;

function containerDir(namespace, container) {
  const dir = join(root, `${namespace}_pod-1_0000-uid`, container);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Writes a file and sets its mtime to the time of its newest line. */
function write(file, lines, { gzip = false, newestDaysAgo } = {}) {
  const text = lines.join('');
  writeFileSync(file, gzip ? gzipSync(text) : text);
  if (newestDaysAgo !== undefined) {
    const at = new Date(NOW - newestDaysAgo * DAY);
    utimesSync(file, at, at);
  }
}

function read(file) {
  const raw = readFileSync(file);
  return (file.endsWith('.gz') ? gunzipSync(raw) : raw).toString();
}

function run(...args) {
  const result = spawnSync(
    BASH,
    [
      SCRIPT,
      '--root',
      root,
      '--config',
      config,
      '--now',
      new Date(NOW).toISOString(),
      ...args,
    ],
    { encoding: 'utf8' }
  );
  assert.equal(result.status, 0, result.stderr + result.stdout);
  return result.stdout;
}

/** Every file under the root with its bytes, to prove a run changed nothing. */
function snapshot() {
  const files = {};
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else files[path] = readFileSync(path).toString('base64');
    }
  };
  walk(root);
  return files;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'nx-log-retention-'));
  config = join(root, '..', `${root.split(/[\\/]/).pop()}.conf`);
  writeFileSync(config, RULES);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(config, { force: true });
});

describe('nx-log-retention', () => {
  it('deletes a rotated file whose newest line is past the rule', () => {
    const dir = containerDir('luna-shopper', 'luna-shopper-backend-core');
    const old = join(dir, '0.log.20261020-100000');
    write(old, [line(42, 'a'), line(40, 'b')], { newestDaysAgo: 40 });
    const oldGz = join(dir, '0.log.20261021-100000.gz');
    write(oldGz, [line(39, 'c'), line(35, 'd')], {
      gzip: true,
      newestDaysAgo: 35,
    });

    run();

    assert.equal(existsSync(old), false);
    assert.equal(existsSync(oldGz), false);
  });

  it('trims a rotated file, plain or gzipped, to its first kept line and keeps its mtime', () => {
    const dir = containerDir('luna-shopper', 'luna-shopper-backend-core');
    const plain = join(dir, '0.log.20261101-100000');
    write(plain, [line(31, 'old'), line(29, 'kept'), line(20, 'newest')], {
      newestDaysAgo: 20,
    });
    const gz = join(dir, '0.log.20261102-100000.gz');
    write(gz, [line(33, 'old'), line(32, 'old'), line(10, 'kept')], {
      gzip: true,
      newestDaysAgo: 10,
    });
    const mtime = statSync(plain).mtimeMs;

    run();

    assert.equal(read(plain), line(29, 'kept') + line(20, 'newest'));
    assert.equal(read(gz), line(10, 'kept'));
    assert.equal(statSync(plain).mtimeMs, mtime);
  });

  it('trims the live file in place and keeps it the same file', () => {
    const dir = containerDir('luna-shopper', 'postgres');
    const live = join(dir, '0.log');
    write(live, [line(90, 'months old'), line(31, 'old'), line(1, 'kept')]);
    const before = statSync(live);

    const out = run();

    assert.equal(read(live), line(1, 'kept'));
    assert.match(out, /trim .*0\.log in place: drop 2 lines/);
    // Truncated and refilled, never replaced: containerd keeps its descriptor.
    if (process.platform !== 'win32') {
      assert.equal(statSync(live).ino, before.ino);
    }
  });

  it('empties a live file whose every line is past the rule', () => {
    const dir = containerDir('luna-shopper', 'redis');
    const live = join(dir, '0.log');
    write(live, [line(45, 'a'), line(44, 'b')]);

    run();

    assert.equal(read(live), '');
  });

  it('cuts the assistant at 7 days and every other container at 30', () => {
    const assistant = join(
      containerDir('luna-shopper', 'luna-shopper-backend-assistant'),
      '0.log'
    );
    const gateway = join(
      containerDir('luna-shopper', 'luna-shopper-backend-gateway'),
      '0.log'
    );
    const lines = [line(20, 'twenty'), line(8, 'eight'), line(6, 'six')];
    write(assistant, lines);
    write(gateway, lines);

    run();

    assert.equal(read(assistant), line(6, 'six'));
    assert.equal(read(gateway), lines.join(''));
  });

  it('applies the assistant rule in any namespace', () => {
    const assistant = join(
      containerDir('self-hosted', 'luna-shopper-backend-assistant'),
      '0.log'
    );
    write(assistant, [line(8, 'eight'), line(6, 'six')]);

    run();

    assert.equal(read(assistant), line(6, 'six'));
  });

  it('drops a line two hours before its age, so an hourly run never lets one pass it', () => {
    const live = join(containerDir('velista', 'velista'), '0.log');
    const edge = (hours) =>
      `${new Date(NOW - 30 * DAY + hours * 3_600_000).toISOString()} stdout F ${hours}h\n`;
    write(live, [edge(1), edge(2.5)]);

    run();

    assert.equal(read(live), edge(2.5));
  });

  it('reads a timestamp with an offset as the instant it names', () => {
    const live = join(containerDir('velista', 'velista'), '0.log');
    // 29 days ago in UTC, written as local time two hours ahead.
    const at = new Date(NOW - 29 * DAY + 2 * 3_600_000)
      .toISOString()
      .replace('Z', '+02:00');
    const offsetLine = `${at} stdout F offset\n`;
    write(live, [line(31, 'old'), offsetLine]);

    run();

    assert.equal(read(live), offsetLine);
  });

  it('keeps a line it cannot date, and everything after it', () => {
    const live = join(containerDir('velista', 'velista'), '0.log');
    write(live, [line(40, 'old'), 'not a cri line\n', line(35, 'old too')]);

    run();

    assert.equal(read(live), 'not a cri line\n' + line(35, 'old too'));
  });

  it('changes nothing on a dry run, and says what it would do', () => {
    const dir = containerDir('luna-shopper', 'luna-shopper-backend-assistant');
    write(join(dir, '0.log.20261101-100000'), [line(20, 'a')], {
      newestDaysAgo: 20,
    });
    write(join(dir, '0.log'), [line(10, 'a'), line(1, 'b')]);
    const before = snapshot();

    const out = run('--dry-run');

    assert.deepEqual(snapshot(), before);
    assert.match(out, /delete .*0\.log\.20261101-100000/);
    assert.match(out, /trim .*0\.log in place/);
  });

  it('touches one container only with --only', () => {
    const v1 = join(containerDir('default', 'v1'), '0.log');
    const other = join(containerDir('default', 'v2'), '0.log');
    write(v1, [line(31, 'old'), line(1, 'new')]);
    write(other, [line(31, 'old'), line(1, 'new')]);

    run('--only', 'default/v1');

    assert.equal(read(v1), line(1, 'new'));
    assert.equal(read(other), line(31, 'old') + line(1, 'new'));
  });

  it('lets the most specific rule win, a container before a namespace', () => {
    writeFileSync(config, '*/* 30\nvelista/* 20\n*/web 10\nvelista/web 40\n');
    const web = join(containerDir('velista', 'web'), '0.log');
    const api = join(containerDir('velista', 'api'), '0.log');
    const elsewhere = join(containerDir('other', 'web'), '0.log');
    const lines = [
      line(35, '35'),
      line(25, '25'),
      line(15, '15'),
      line(5, '5'),
    ];
    for (const file of [web, api, elsewhere]) write(file, lines);

    run();

    assert.equal(read(web), lines.join(''));
    assert.equal(read(api), lines.slice(2).join(''));
    assert.equal(read(elsewhere), lines.slice(3).join(''));
  });

  it('refuses a config it cannot read rather than guessing', () => {
    writeFileSync(config, '*/* thirty\n');
    const result = spawnSync(
      BASH,
      [SCRIPT, '--root', root, '--config', config],
      { encoding: 'utf8' }
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /days must be a whole number/);
  });

  it('prints its version', () => {
    const result = spawnSync(BASH, [SCRIPT, 'version'], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /^\d+\n$/);
  });
});
