import assert from 'node:assert/strict';
import test from 'node:test';
import {
  catalogDumpCommand,
  gatewayPort,
  lunaSlotCommand,
  makeSlots,
  parseTakenSlots,
  pickFreeSlot,
  rehearsalUrl,
  slotProject,
  waitForGateway,
} from './slots.mjs';

/**
 * A `--list` table with slots 0, 1 and 4 in it, printed the way `luna-slot.sh`
 * prints it, lock note and all. Slot 4 is locked by `--down --keep-data`, which
 * is a slot that looks free and is not, so the table keeps its row.
 */
const LIST_OUTPUT = `
Luna Shopper dev slots (slot 0 is the historic ports; 1 and up are a block at 43000 + (slot-1)*100)

  SLOT COMPOSE PROJECT      INFRA     SERVICES  OBSERV  TEST   CLAIMED BY
  0    luna-shopper-backend 9/9       7/7       0/5     0/4    D:/Projects/nx-portfolio  (this one)
  1    luna-slot1           9/9       3/7       0/5     0/4    D:/Projects/nx-portfolio/.claude/worktrees/a
  4    luna-slot4           0/9       0/7       0/5     0/4    (no worktree claims it)
                                                               LOCKED, databases kept: D:/Projects/nx-portfolio/.claude/worktrees/b

  INFRA     the four databases, NATS and its monitor, Redis, SMTP, Mailpit
  SERVICES  gateway, realtime, auth, core, catalog, harvester, assistant
  OBSERV    collector, Jaeger, Prometheus, Grafana: opt in, so 0/5 is normal
  TEST      the four test-profile databases: opt in too, so 0/4 is normal

A slot claimed with 0/9 infra is configured but not started: --up will take it.
LOCKED means somebody kept that slot's databases with --down --keep-data. --auto
skips it; --up <n> takes it and the databases with it; --unlock <n> frees the
number and leaves them.
Slots 0..9 with no claim, no lock and no listener are omitted.
`;

test('parseTakenSlots reads the table body and nothing else', () => {
  assert.deepEqual(parseTakenSlots(LIST_OUTPUT), [0, 1, 4]);
});

test('parseTakenSlots reads a continuation line without inventing a slot', () => {
  const table = `  2    luna-slot2           9/9       7/7       0/5     0/4    D:/a
                                                                    D:/b
`;
  assert.deepEqual(parseTakenSlots(table), [2]);
});

test('parseTakenSlots answers nothing for a table with no rows', () => {
  assert.deepEqual(parseTakenSlots('\nSLOT COMPOSE PROJECT\n\n'), []);
});

test('pickFreeSlot takes the lowest free slot and never slot 0', () => {
  assert.equal(pickFreeSlot([0, 1, 4]), 2);
  assert.equal(pickFreeSlot([]), 1);
  assert.equal(pickFreeSlot([1, 2, 3]), 4);
});

test('pickFreeSlot stops the run and names the taken slots', () => {
  assert.throws(
    () => pickFreeSlot([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
    (error) => {
      assert.match(error.message, /Every slot from 1 to 9 is taken/);
      assert.match(error.message, /1, 2, 3, 4, 5, 6, 7, 8, 9/);
      // Slot 0 is never taken, so it is never listed as being in the way.
      assert.ok(!/\(0, /.test(error.message));
      return true;
    }
  );
});

test('a slot names its ports and its compose project the way luna-slot does', () => {
  assert.equal(gatewayPort(0), 3000);
  assert.equal(gatewayPort(1), 43000);
  assert.equal(gatewayPort(5), 43400);
  assert.equal(slotProject(0), 'luna-shopper-backend');
  assert.equal(slotProject(3), 'luna-slot3');
  assert.equal(rehearsalUrl(2), 'http://localhost:43100');
});

test('luna-slot is asked ephemerally, with the services the rehearsal needs', () => {
  const { command, args } = lunaSlotCommand('up', {
    platform: 'linux',
    repoRoot: '/repo',
    slot: 3,
    services: ['gateway', 'auth', 'catalog'],
    timeoutSeconds: 600,
  });
  assert.equal(command, 'bash');
  assert.deepEqual(args, [
    '/repo/k8s/e2e/luna-shopper-backend/luna-slot.sh',
    '--ephemeral',
    '--up',
    '3',
    '--services',
    'gateway,auth,catalog',
    '--timeout',
    '600',
  ]);
});

test('Windows is asked in bash too, because the PowerShell twin is gone', () => {
  const { command, args } = lunaSlotCommand('up', {
    platform: 'win32',
    repoRoot: 'D:/repo',
    slot: 3,
    services: ['gateway'],
    timeoutSeconds: 600,
  });
  assert.equal(command, 'bash');
  assert.deepEqual(args, [
    'D:/repo/k8s/e2e/luna-shopper-backend/luna-slot.sh',
    '--ephemeral',
    '--up',
    '3',
    '--services',
    'gateway',
    '--timeout',
    '600',
  ]);
});

test('down names its slot, and refuses to run without one', () => {
  assert.deepEqual(
    lunaSlotCommand('down', {
      platform: 'linux',
      repoRoot: '/repo',
      slot: 7,
    }).args,
    [
      '/repo/k8s/e2e/luna-shopper-backend/luna-slot.sh',
      '--ephemeral',
      '--down',
      '7',
    ]
  );

  // Without a number an ephemeral --down has nothing to read back, and the
  // slot it would reach for instead is the one this checkout claims.
  assert.throws(
    () => lunaSlotCommand('down', { platform: 'linux', repoRoot: '/repo' }),
    /needs the slot number/
  );
});

test('--list is the one verb that is not ephemeral', () => {
  assert.deepEqual(
    lunaSlotCommand('list', { platform: 'linux', repoRoot: '/repo' }).args,
    ['/repo/k8s/e2e/luna-shopper-backend/luna-slot.sh', '--list']
  );
});

test('the dump names the compose container and the catalog role', () => {
  const { command, args } = catalogDumpCommand(4);
  assert.equal(command, 'docker');
  assert.deepEqual(args, [
    'exec',
    '-i',
    'luna-slot4-catalog-db-1',
    'pg_dump',
    '-U',
    'luna_catalog',
    'luna_catalog',
  ]);
});

test('makeSlots turns a failed luna-slot into an error carrying its stderr', async () => {
  const slots = makeSlots({
    run: async () => ({ code: 2, stdout: '', stderr: 'unknown service zzz' }),
    repoRoot: '/repo',
    platform: 'linux',
  });
  await assert.rejects(() => slots.up(2), /unknown service zzz/);
});

test('makeSlots lists through luna-slot and writes the dump it was given a path for', async () => {
  const calls = [];
  const written = [];
  const slots = makeSlots({
    run: async (command, args) => {
      calls.push([command, ...args]);
      if (args.includes('--list')) {
        return { code: 0, stdout: LIST_OUTPUT, stderr: '' };
      }
      return { code: 0, stdout: '-- a dump --', stderr: '' };
    },
    repoRoot: '/repo',
    platform: 'linux',
    readFile: () => 'LUNA_SLOT=8\n',
    writeFile: (path, text) => written.push([path, text]),
  });

  assert.deepEqual(await slots.list(), [0, 1, 4]);
  await slots.up(3);
  // The rehearsal waits longer than luna-slot's own 180 seconds, because a cold
  // worktree compiles each service before it listens.
  assert.deepEqual(calls[1], [
    'bash',
    '/repo/k8s/e2e/luna-shopper-backend/luna-slot.sh',
    '--ephemeral',
    '--up',
    '3',
    '--services',
    'gateway,auth,catalog',
    '--timeout',
    '600',
  ]);
  assert.equal(await slots.dumpCatalog(2, '/runs/x.sql'), '/runs/x.sql');
  assert.deepEqual(written, [['/runs/x.sql', '-- a dump --']]);
  assert.equal(calls[0][0], 'bash');
  assert.equal(calls[2][0], 'docker');
});

test('waitForGateway waits for readiness rather than for the socket', async () => {
  const answers = [
    () => {
      throw new Error('ECONNREFUSED');
    },
    () => ({ ok: false, status: 503 }),
    () => ({ ok: true, status: 200 }),
  ];
  let calls = 0;
  const ready = await waitForGateway({
    url: 'http://localhost:43000',
    fetchImpl: async (url) => {
      assert.equal(url, 'http://localhost:43000/health/ready');
      return answers[calls++]();
    },
    sleep: async () => undefined,
    now: () => 0,
    timeoutMs: 1000,
  });
  assert.equal(ready, true);
  assert.equal(calls, 3);
});

test('waitForGateway stops waiting when the run is stopped', async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    () =>
      waitForGateway({
        url: 'http://localhost:43000',
        fetchImpl: async () => {
          calls += 1;
          controller.abort(new Error('the run was stopped with Ctrl+C'));
          return { ok: false, status: 503 };
        },
        sleep: async () => undefined,
        now: () => 0,
        timeoutMs: 120000,
        signal: controller.signal,
      }),
    /stopped with Ctrl\+C/
  );
  assert.equal(calls, 1);
});

test('waitForGateway gives up with the last reason it saw', async () => {
  let clock = 0;
  await assert.rejects(
    () =>
      waitForGateway({
        url: 'http://localhost:43000',
        fetchImpl: async () => ({ ok: false, status: 503 }),
        sleep: async () => {
          clock += 1000;
        },
        now: () => clock,
        timeoutMs: 2000,
      }),
    /did not become ready within 2s: it answered 503/
  );
});
