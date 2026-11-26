import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AUDIT_ORIGIN, CHANGE_LIST_KIND } from './changes.mjs';
import {
  REPLAY_PASSWORD_ENV,
  collectFlag,
  main,
  resolveReplayPassword,
} from './cli.mjs';

// Made up ids only.
const ITEM = '00000000-0000-4000-8000-000000000001';
const ACTOR = '00000000-0000-4000-8000-0000000000a1';
const TARGET = 'http://localhost:43700';

function sink() {
  const written = [];
  return { write: (text) => written.push(text), text: () => written.join('') };
}

function changeFile() {
  const dir = mkdtempSync(join(tmpdir(), 'curation-replay-'));
  const file = join(dir, 'changes.jsonl');
  writeFileSync(
    file,
    [
      {
        header: true,
        kind: CHANGE_LIST_KIND,
        origin: AUDIT_ORIGIN,
        otherEntities: {},
      },
      {
        auditId: 'a1',
        action: 'UPDATE',
        itemId: ITEM,
        before: { unitSize: 500 },
        after: { unitSize: 450 },
        current: { name: { es: 'Leche', en: 'Milk' }, brand: 'Marca' },
      },
    ]
      .map((line) => `${JSON.stringify(line)}\n`)
      .join('')
  );
  return { dir, file };
}

/** A gateway that answers the login, `me`, the lookup and the batch. */
function fakeGateway() {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const path = new URL(url).pathname;
    calls.push({
      path,
      method: init.method ?? 'GET',
      body: init.body ? JSON.parse(init.body) : null,
    });
    const json = (body, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    if (path === '/v1/admin/auth/login') {
      return json({ accessToken: 'token' }, 201);
    }
    if (path === '/v1/admin/auth/me') {
      return json({ id: ACTOR });
    }
    if (path === '/v1/admin/catalog/items/lookup') {
      return json(
        {
          items: [
            {
              id: ITEM,
              name: { es: 'Leche', en: 'Milk' },
              brand: 'Marca',
              unitSize: '500.0000',
              defaultUnit: 'MILLILITER',
              packCount: null,
              categories: [],
            },
          ],
        },
        201
      );
    }
    if (path === '/v1/admin/catalog/items/batch') {
      return json({ items: [] });
    }
    return json({ code: 'not_found' }, 404);
  };
  return { calls, fetchImpl };
}

test('collectFlag reads every value of a repeated flag', () => {
  assert.deepEqual(
    collectFlag(['--actor', 'a', '--slot', '7', '--actor', 'b'], 'actor'),
    ['a', 'b']
  );
});

test('the password is asked at a terminal, else read from the environment, never a flag', async () => {
  assert.equal(
    await resolveReplayPassword({
      isTty: true,
      env: {},
      askSecret: async () => 'typed',
      username: 'u',
      targetUrl: TARGET,
    }),
    'typed'
  );
  assert.equal(
    await resolveReplayPassword({
      isTty: false,
      env: { [REPLAY_PASSWORD_ENV]: 'from env' },
      username: 'u',
      targetUrl: TARGET,
    }),
    'from env'
  );
  await assert.rejects(
    () =>
      resolveReplayPassword({
        isTty: false,
        env: {},
        username: 'u',
        targetUrl: TARGET,
      }),
    new RegExp(`${REPLAY_PASSWORD_ENV}, and it is not set`)
  );
  const { file } = changeFile();
  await assert.rejects(
    () =>
      main(['--replay', file, '--target-url', TARGET, '--main-password', 'p'], {
        stderr: sink(),
      }),
    /no password on the command line/
  );
});

test('--replay needs a target url and has no default', async () => {
  const { file } = changeFile();
  await assert.rejects(
    () =>
      main(['--replay', file], {
        stderr: sink(),
        env: { [REPLAY_PASSWORD_ENV]: 'p' },
        isTty: false,
      }),
    /--target-url is required/
  );
});

test('a dry run through main signs in once, looks up, sends no PATCH and writes the report', async () => {
  const { dir, file } = changeFile();
  const { calls, fetchImpl } = fakeGateway();
  const stderr = sink();
  const report = join(dir, 'report.json');
  const code = await main(
    ['--replay', file, '--target-url', `${TARGET}/`, '--report', report],
    {
      stderr,
      env: { [REPLAY_PASSWORD_ENV]: 'p' },
      isTty: false,
      fetchImpl,
      spawn: async () => ({ code: 1, stdout: '', stderr: '' }),
      sleep: async () => undefined,
    }
  );
  assert.equal(code, 0);
  assert.equal(
    calls.filter((call) => call.path === '/v1/admin/auth/login').length,
    1
  );
  assert.equal(calls.filter((call) => call.method === 'PATCH').length, 0);
  const written = JSON.parse(readFileSync(report, 'utf8'));
  assert.equal(written.header.targetUrl, TARGET);
  assert.equal(written.lines[0].class, 'apply');
  assert.match(stderr.text(), /1 products: apply 1/);
  assert.doesNotMatch(stderr.text(), new RegExp(ITEM));
  assert.doesNotMatch(stderr.text(), /token/);
});

test('a write through main sends the batch under an expect', async () => {
  const { dir, file } = changeFile();
  const { calls, fetchImpl } = fakeGateway();
  await main(
    [
      '--replay',
      file,
      '--target-url',
      TARGET,
      '--write',
      '--report',
      join(dir, 'r.json'),
    ],
    {
      stderr: sink(),
      env: { [REPLAY_PASSWORD_ENV]: 'p' },
      isTty: false,
      fetchImpl,
      spawn: async () => ({ code: 1, stdout: '', stderr: '' }),
      sleep: async () => undefined,
    }
  );
  const [patch] = calls.filter((call) => call.method === 'PATCH');
  assert.deepEqual(patch.body, {
    items: [
      {
        itemId: ITEM,
        unitSize: 450,
        expect: {
          unitSize: 500,
          name: { es: 'Leche', en: 'Milk' },
          brand: 'Marca',
        },
      },
    ],
    requireRegisteredBrands: true,
  });
});

test('--replay-identity refuses a report of another url before it signs in', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'curation-replay-'));
  const report = join(dir, 'report.json');
  writeFileSync(
    report,
    JSON.stringify({
      header: { targetUrl: 'http://elsewhere:3000' },
      lines: [],
    })
  );
  const { calls, fetchImpl } = fakeGateway();
  await assert.rejects(
    () =>
      main(['--replay-identity', report, '--target-url', TARGET], {
        stderr: sink(),
        env: { [REPLAY_PASSWORD_ENV]: 'p' },
        isTty: false,
        fetchImpl,
      }),
    /Refusing/
  );
  assert.equal(calls.length, 0);
});

test('--export-changes refuses a run without --since before it reads anything', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'curation-export-'));
  await assert.rejects(
    () =>
      main(
        [
          '--export-changes',
          join(dir, 'c.jsonl'),
          '--slot',
          '7',
          '--actor',
          ACTOR,
        ],
        {
          stderr: sink(),
          spawn: () => assert.fail('ran'),
        }
      ),
    /--since is required/
  );
});
