import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AUDIT_ORIGIN, CHANGE_LIST_KIND } from './changes.mjs';
import {
  REPLAY_PASSWORD_ENV,
  collectFlag,
  installReplayInterrupt,
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
      '--confirm-host',
      'localhost',
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

test('a write through main that stops on batch 2 of 3 still writes the report, and fails', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'curation-replay-'));
  const file = join(dir, 'changes.jsonl');
  const ids = [1, 2, 3].map((n) => `00000000-0000-4000-8000-00000000000${n}`);
  writeFileSync(
    file,
    [
      {
        header: true,
        kind: CHANGE_LIST_KIND,
        origin: AUDIT_ORIGIN,
        otherEntities: {},
      },
      ...ids.map((itemId, index) => ({
        auditId: `a${index}`,
        action: 'UPDATE',
        itemId,
        before: { unitSize: 500 },
        after: { unitSize: 450 },
        current: { name: { es: 'Leche', en: 'Milk' }, brand: 'Marca' },
      })),
    ]
      .map((line) => `${JSON.stringify(line)}\n`)
      .join('')
  );
  let patches = 0;
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  const fetchImpl = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/v1/admin/auth/login') {
      return json({ accessToken: 'token' }, 201);
    }
    if (path === '/v1/admin/auth/me') {
      return json({ id: ACTOR });
    }
    if (path === '/v1/admin/catalog/items/lookup') {
      const asked = JSON.parse(init.body).ids;
      return json(
        {
          items: asked.map((id) => ({
            id,
            name: { es: 'Leche', en: 'Milk' },
            brand: 'Marca',
            unitSize: id === ids[0] && patches > 0 ? '450.0000' : '500.0000',
            defaultUnit: 'MILLILITER',
            packCount: null,
            categories: [],
          })),
        },
        201
      );
    }
    if (path === '/v1/admin/catalog/items/batch') {
      patches += 1;
      return patches === 2
        ? json({ code: 'internal', detail: 'catalog fell over' }, 500)
        : json({ items: [] });
    }
    return json({ code: 'not_found' }, 404);
  };
  const report = join(dir, 'report.json');
  const stderr = sink();
  await assert.rejects(
    () =>
      main(
        [
          '--replay',
          file,
          '--target-url',
          TARGET,
          '--write',
          '--confirm-host',
          'localhost',
          '--batch-size',
          '1',
          '--report',
          report,
        ],
        {
          stderr,
          env: { [REPLAY_PASSWORD_ENV]: 'p' },
          isTty: false,
          fetchImpl,
          spawn: async () => ({ code: 1, stdout: '', stderr: '' }),
          sleep: async () => undefined,
        }
      ),
    /the write stopped: the target answered 500 \(internal\)/
  );
  assert.equal(patches, 2);
  const written = JSON.parse(readFileSync(report, 'utf8'));
  assert.deepEqual(
    written.lines.map((line) => line.class),
    ['apply', 'not written', 'not sent']
  );
  assert.equal(written.lines[0].written, true);
  assert.deepEqual(written.lines[1].error, {
    status: 500,
    code: 'internal',
    message: 'catalog fell over',
  });
  assert.equal(written.header.error.code, 'internal');
  assert.match(stderr.text(), /1 written/);
  assert.match(stderr.text(), /report: /);
  assert.doesNotMatch(stderr.text(), /00000000-0000/);
});

test('a decisions part refused at a step other than VALIDATE fails the run, with the error in the header', async () => {
  const { dir, file } = changeFile();
  const decisionsFile = join(dir, 'decisions.jsonl');
  const expect = {
    status: 'CANDIDATE',
    observed: {
      name: 'Leche',
      brand: null,
      ean: null,
      sizeFormat: '1 l',
      unitSize: 1000,
      sizeUnit: 'MILLILITER',
      packCount: null,
      soldByWeight: false,
      approxWeight: null,
      packaging: null,
    },
  };
  writeFileSync(
    decisionsFile,
    [
      { header: true, runId: 'r', mainUrl: 'http://localhost:3000' },
      { entryId: 'e1', decision: 'LINK', itemId: ITEM, expect },
    ]
      .map((line) => `${JSON.stringify(line)}\n`)
      .join('')
  );
  const gateway = fakeGateway();
  let decided = 0;
  const fetchImpl = async (url, init = {}) => {
    if (new URL(url).pathname === '/v1/admin/harvest/entries/decisions') {
      decided += 1;
      return new Response(
        JSON.stringify({
          runId: 'r',
          applied: false,
          failedStep: 'APPLY',
          error: 'step three failed',
          results: [],
          orphanedItemIds: [],
        }),
        { status: 201, headers: { 'content-type': 'application/json' } }
      );
    }
    return gateway.fetchImpl(url, init);
  };
  const report = join(dir, 'report.json');
  await assert.rejects(
    () =>
      main(
        [
          '--replay',
          file,
          '--target-url',
          TARGET,
          '--write',
          '--confirm-host',
          'localhost',
          '--decisions',
          decisionsFile,
          '--report',
          report,
        ],
        {
          stderr: sink(),
          env: { [REPLAY_PASSWORD_ENV]: 'p' },
          isTty: false,
          fetchImpl,
          spawn: async () => ({ code: 1, stdout: '', stderr: '' }),
          sleep: async () => undefined,
        }
      ),
    /the decisions stopped: the target refused a part at APPLY/
  );
  assert.equal(decided, 1);
  const written = JSON.parse(readFileSync(report, 'utf8'));
  assert.match(written.header.stoppedBy, /refused a part at APPLY/);
  assert.equal(written.header.error.code, 'APPLY');
  assert.equal(written.decisions.lines[0].class, 'refused');
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

/** Runs `main` with a fake gateway, and answers its calls and its outcome. */
async function runMain(argv, { password = true } = {}) {
  const { calls, fetchImpl } = fakeGateway();
  let error = null;
  try {
    await main(argv, {
      stderr: sink(),
      env: password ? { [REPLAY_PASSWORD_ENV]: 'p' } : {},
      isTty: false,
      fetchImpl,
      spawn: async () => ({ code: 1, stdout: '', stderr: '' }),
      sleep: async () => undefined,
    });
  } catch (caught) {
    error = caught;
  }
  return { calls, error };
}

test('a write without --confirm-host is refused before login, naming the target host', async () => {
  const { dir, file } = changeFile();
  const { calls, error } = await runMain([
    '--replay',
    file,
    '--target-url',
    TARGET,
    '--write',
    '--report',
    join(dir, 'r.json'),
  ]);
  assert.match(error?.message ?? '', /--write needs --confirm-host localhost/);
  assert.match(error.message, /The target is localhost/);
  assert.equal(calls.length, 0);
});

test('a write whose --confirm-host names another host is refused before login, naming both', async () => {
  const { dir, file } = changeFile();
  const { calls, error } = await runMain([
    '--replay',
    file,
    '--target-url',
    TARGET,
    '--write',
    '--confirm-host',
    'staging.example.test',
    '--report',
    join(dir, 'r.json'),
  ]);
  assert.match(
    error?.message ?? '',
    /--confirm-host names staging\.example\.test, and --target-url names localhost/
  );
  assert.equal(calls.length, 0);
});

test('a write whose --confirm-host is the target host, in any case and with or without a port, is sent', async () => {
  for (const host of ['localhost', 'LocalHost', 'localhost:43700']) {
    const { dir, file } = changeFile();
    const { calls, error } = await runMain([
      '--replay',
      file,
      '--target-url',
      `${TARGET}/`,
      '--write',
      '--confirm-host',
      host,
      '--report',
      join(dir, 'r.json'),
    ]);
    assert.equal(error, null, host);
    assert.equal(
      calls.filter((call) => call.method === 'PATCH').length,
      1,
      host
    );
  }
});

test('a dry run needs no --confirm-host', async () => {
  const { dir, file } = changeFile();
  const { calls, error } = await runMain([
    '--replay',
    file,
    '--target-url',
    TARGET,
    '--report',
    join(dir, 'r.json'),
  ]);
  assert.equal(error, null);
  assert.equal(calls.filter((call) => call.method === 'PATCH').length, 0);
});

test('--replay-identity --write without --only is refused before login', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'curation-replay-'));
  const report = join(dir, 'report.json');
  writeFileSync(
    report,
    JSON.stringify({ header: { targetUrl: TARGET }, lines: [] })
  );
  const { calls, error } = await runMain([
    '--replay-identity',
    report,
    '--target-url',
    TARGET,
    '--write',
    '--confirm-host',
    'localhost',
  ]);
  assert.match(error?.message ?? '', /--replay-identity --write needs --only/);
  assert.equal(calls.length, 0);

  const missingHost = await runMain([
    '--replay-identity',
    report,
    '--target-url',
    TARGET,
    '--write',
  ]);
  assert.match(missingHost.error?.message ?? '', /needs --confirm-host/);
  assert.equal(missingHost.calls.length, 0);
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

/** A change list of three products beside a new report directory. */
function threeProducts() {
  const dir = mkdtempSync(join(tmpdir(), 'curation-replay-'));
  const file = join(dir, 'changes.jsonl');
  const ids = [1, 2, 3].map((n) => `00000000-0000-4000-8000-00000000000${n}`);
  writeFileSync(
    file,
    [
      {
        header: true,
        kind: CHANGE_LIST_KIND,
        origin: AUDIT_ORIGIN,
        otherEntities: {},
      },
      ...ids.map((itemId, index) => ({
        auditId: `a${index}`,
        action: 'UPDATE',
        itemId,
        before: { unitSize: 500 },
        after: { unitSize: 450 },
        current: { name: { es: 'Leche', en: 'Milk' }, brand: 'Marca' },
      })),
    ]
      .map((line) => `${JSON.stringify(line)}\n`)
      .join('')
  );
  return { dir, file, ids };
}

const writeArgs = (file, report) => [
  '--replay',
  file,
  '--target-url',
  TARGET,
  '--write',
  '--confirm-host',
  'localhost',
  '--batch-size',
  '1',
  '--report',
  report,
];

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** Login, `me`, and a lookup that answers each id at the size `sizeOf` says. */
function answerCommon(path, init, sizeOf) {
  if (path === '/v1/admin/auth/login') {
    return json({ accessToken: 'token' }, 201);
  }
  if (path === '/v1/admin/auth/me') {
    return json({ id: ACTOR });
  }
  if (path === '/v1/admin/catalog/items/lookup') {
    return json(
      {
        items: JSON.parse(init.body).ids.map((id) => ({
          id,
          name: { es: 'Leche', en: 'Milk' },
          brand: 'Marca',
          unitSize: sizeOf(id),
          defaultUnit: 'MILLILITER',
          packCount: null,
          categories: [],
        })),
      },
      201
    );
  }
  return null;
}

test('SIGINT while batch 2 hangs writes the report and exits 130', async () => {
  const { dir, file, ids } = threeProducts();
  let patches = 0;
  let entered;
  const inFlight = new Promise((resolve) => {
    entered = resolve;
  });
  const fetchImpl = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const common = answerCommon(path, init, () => '500.0000');
    if (common) {
      return common;
    }
    patches += 1;
    if (patches === 2) {
      entered();
      return new Promise(() => undefined);
    }
    return json({ items: [] });
  };
  const handlers = new Map();
  const exits = [];
  let removed = false;
  const report = join(dir, 'report.json');
  const stderr = sink();
  main(writeArgs(file, report), {
    stderr,
    env: { [REPLAY_PASSWORD_ENV]: 'p' },
    isTty: false,
    fetchImpl,
    spawn: async () => ({ code: 1, stdout: '', stderr: '' }),
    sleep: async () => undefined,
    replayInterrupt: ({ stop, stderr: err }) =>
      installReplayInterrupt({
        stop,
        stderr: err,
        on: (signal, handler) => handlers.set(signal, handler),
        off: () => {
          removed = true;
        },
        exit: (code) => exits.push(code),
      }),
  });
  await inFlight;
  assert.ok(handlers.has('SIGINT') && handlers.has('SIGTERM'));
  handlers.get('SIGINT')('SIGINT');
  assert.deepEqual(exits, [130]);
  assert.equal(removed, false);
  const written = JSON.parse(readFileSync(report, 'utf8'));
  assert.deepEqual(
    written.lines.map((line) => [line.itemId, line.class, line.checked]),
    [
      [ids[0], 'apply', undefined],
      [ids[1], 'not written', false],
      [ids[2], 'not sent', undefined],
    ]
  );
  assert.equal(written.lines[0].written, true);
  assert.match(written.header.stoppedBy, /SIGINT/);
  assert.match(stderr.text(), /SIGINT: stopping/);
  assert.match(stderr.text(), /report: /);
  // A second signal ends the process without writing again.
  handlers.get('SIGTERM')('SIGTERM');
  assert.deepEqual(exits, [130, 143]);
});

test('a 200 whose body is not JSON is read back, and the landed product is counted apart', async () => {
  const { dir, file, ids } = threeProducts();
  const landed = new Set();
  const fetchImpl = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const common = answerCommon(path, init, (id) =>
      landed.has(id) ? '450.0000' : '500.0000'
    );
    if (common) {
      return common;
    }
    const sent = JSON.parse(init.body).items;
    for (const entry of sent) {
      landed.add(entry.itemId);
    }
    // The first product lands and its answer is unreadable; the others
    // answer JSON.
    return sent[0].itemId === ids[0]
      ? new Response('<html>ok</html>', { status: 200 })
      : json({ items: [] });
  };
  const report = join(dir, 'report.json');
  const stderr = sink();
  const code = await main(writeArgs(file, report), {
    stderr,
    env: { [REPLAY_PASSWORD_ENV]: 'p' },
    isTty: false,
    fetchImpl,
    spawn: async () => ({ code: 1, stdout: '', stderr: '' }),
    sleep: async () => undefined,
    replayInterrupt: () => () => undefined,
  });
  assert.equal(code, 0);
  const written = JSON.parse(readFileSync(report, 'utf8'));
  assert.deepEqual(
    written.lines.map((line) => line.class),
    ['already there', 'apply', 'apply']
  );
  assert.equal(written.lines[0].afterLostAnswer, true);
  assert.equal(written.counts.written, 2);
  assert.equal(written.counts.landedAfterLostAnswer, 1);
  assert.match(stderr.text(), /2 written, 1 more landed after a lost answer/);
});
