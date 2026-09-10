import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  REPO_ROOT,
  defaultRunDir,
  installInterrupt,
  main,
  parseArgs,
  resolveImplementation,
  spawnCapture,
} from './cli.mjs';

function sink() {
  const written = [];
  return {
    written,
    write: (text) => written.push(text),
    text: () => written.join(''),
  };
}

test('parseArgs reads values and bare switches', () => {
  assert.deepEqual(parseArgs(['--implementation', 'groups', '--help']), {
    implementation: 'groups',
    help: true,
  });
  assert.deepEqual(parseArgs([]), {});
  assert.throws(() => parseArgs(['groups']), /Unexpected argument groups/);
});

test('a run directory nobody named is unique and under the run root', () => {
  const dir = defaultRunDir(new Date('2026-09-08T13:45:12.345Z'));
  assert.equal(dir, '.curation-runs/2026-09-08T13-45-12-345Z');
});

test('the implementation is taken from the flag when it is given', async () => {
  assert.equal(
    await resolveImplementation({
      flag: 'groups',
      isTty: false,
      stdout: sink(),
    }),
    'groups'
  );
  await assert.rejects(
    () =>
      resolveImplementation({ flag: 'entries', isTty: true, stdout: sink() }),
    /suggestions, groups/
  );
});

test('a terminal is asked, by name or by number', async () => {
  const stdout = sink();
  assert.equal(
    await resolveImplementation({
      flag: undefined,
      isTty: true,
      askLine: async () => '2',
      stdout,
    }),
    'groups'
  );
  assert.match(stdout.text(), /Which decider should this run drive/);
  assert.equal(
    await resolveImplementation({
      flag: undefined,
      isTty: true,
      askLine: async () => ' suggestions ',
      stdout: sink(),
    }),
    'suggestions'
  );
  await assert.rejects(
    () =>
      resolveImplementation({
        flag: undefined,
        isTty: true,
        askLine: async () => 'both',
        stdout: sink(),
      }),
    /both is not one of the implementations/
  );
});

test('a pipe is not asked, it is told', async () => {
  await assert.rejects(
    () =>
      resolveImplementation({ flag: undefined, isTty: false, stdout: sink() }),
    /--implementation is required/
  );
});

test('--apply takes no slot and makes no model call', async () => {
  const spawned = [];
  const stdout = sink();
  const code = await main(
    [
      '--implementation',
      'suggestions',
      '--apply',
      'decisions.jsonl',
      '--main-url',
      'http://localhost:3000',
    ],
    {
      env: {},
      stdout,
      stderr: sink(),
      isTty: false,
      spawn: async (command, args) => {
        spawned.push({ command, args });
        return {
          code: 0,
          stdout: '{"results":[],"priceSkips":[]}\n',
          stderr: '',
        };
      },
      repoRoot: '/repo',
      platform: 'linux',
    }
  );

  assert.equal(code, 0);
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].args[1], 'apply');
  assert.match(spawned[0].args[0], /curation-suggestions\/src\/cli\.mjs$/);
  // No luna-slot, no docker, no claude.
  assert.ok(
    !spawned.some((call) => /luna-slot|docker|claude/.test(String(call.args)))
  );
  assert.equal(stdout.text().trim(), '{"results":[],"priceSkips":[]}');
});

// The signal has to reach the run itself, and the exit code has to say the run
// did not finish. Both are wiring, and only `main` holds it.
test('a run stopped with Ctrl+C ends at 130 with the slot taken down', async () => {
  const spawned = [];
  const released = [];
  const runDir = mkdtempSync(join(tmpdir(), 'curation-stop-'));

  const code = await main(
    [
      '--implementation',
      'suggestions',
      '--run-dir',
      runDir,
      '--main-url',
      'http://localhost:3000',
    ],
    {
      env: {},
      stdout: sink(),
      stderr: sink(),
      isTty: false,
      spawn: async (command, args) => {
        spawned.push([command, ...args].join(' '));
        return { code: 0, stdout: '', stderr: '' };
      },
      repoRoot: '/repo',
      platform: 'linux',
      // The keystroke lands before the gateway answers, which is the earliest
      // a run can be stopped and the case with nothing to report.
      interrupt: ({ controller }) => {
        controller.abort(new Error('the run was stopped with Ctrl+C'));
        return () => released.push(true);
      },
    }
  );

  assert.equal(code, 130);
  // The listener is what would keep the process alive after the run.
  assert.deepEqual(released, [true]);
  assert.ok(spawned.some((call) => call.includes('--ephemeral --down 1')));
  assert.ok(!spawned.some((call) => call.startsWith('claude ')));
  rmSync(runDir, { recursive: true, force: true });
});

test('an unknown engine is refused before anything is started', async () => {
  const spawned = [];
  await assert.rejects(
    () =>
      main(['--implementation', 'suggestions', '--engine', 'sdk'], {
        env: {},
        stdout: sink(),
        stderr: sink(),
        isTty: false,
        spawn: async (...call) => {
          spawned.push(call);
          return { code: 0, stdout: '{}', stderr: '' };
        },
        repoRoot: '/repo',
        platform: 'linux',
      }),
    /Unknown engine sdk\. It is claude or api\./
  );
  assert.deepEqual(spawned, []);
});

test('--help answers the usage and does nothing else', async () => {
  const stdout = sink();
  const code = await main(['--help'], {
    env: {},
    stdout,
    stderr: sink(),
    isTty: false,
    spawn: async () => {
      throw new Error('nothing should have been spawned');
    },
  });
  assert.equal(code, 0);
  assert.match(stdout.text(), /--implementation <suggestions\|groups>/);
});

test('the repo root this file computes is the workspace root', () => {
  assert.ok(
    existsSync(`${REPO_ROOT}/nx.json`),
    `${REPO_ROOT} should hold nx.json`
  );
  assert.ok(
    existsSync(
      `${REPO_ROOT}/libs/luna-shopper/curation-suggestions/src/cli.mjs`
    )
  );
  assert.ok(
    existsSync(`${REPO_ROOT}/k8s/e2e/luna-shopper-backend/luna-slot.sh`)
  );
});

test('spawnCapture answers rather than throws on a non-zero exit', async () => {
  const answer = await spawnCapture(process.execPath, [
    '-e',
    'process.stderr.write("bad"); process.exit(3)',
  ]);
  assert.equal(answer.code, 3);
  assert.equal(answer.stderr, 'bad');
});

test('spawnCapture writes stdin and reads stdout back', async () => {
  const answer = await spawnCapture(
    process.execPath,
    [
      '-e',
      'process.stdin.on("data", (d) => process.stdout.write(d.toString().toUpperCase()))',
    ],
    { input: 'hello' }
  );
  assert.equal(answer.code, 0);
  assert.equal(answer.stdout, 'HELLO');
});

test('a stopped run kills the child it was waiting on', async () => {
  const controller = new AbortController();
  const pending = spawnCapture(
    process.execPath,
    ['-e', 'setTimeout(() => {}, 60000)'],
    { signal: controller.signal }
  );
  controller.abort(new Error('the run was stopped with Ctrl+C'));
  await assert.rejects(() => pending, /stopped with Ctrl\+C/);
});

test('a child is never started for a run that is already stopped', async () => {
  const controller = new AbortController();
  controller.abort(new Error('the run was stopped with Ctrl+C'));
  await assert.rejects(
    () =>
      spawnCapture(process.execPath, ['-e', 'process.exit(0)'], {
        signal: controller.signal,
      }),
    /stopped with Ctrl\+C/
  );
});

test('the first Ctrl+C stops the run and the second stops the process', () => {
  const controller = new AbortController();
  const stderr = sink();
  const exits = [];
  let handler = null;
  const release = installInterrupt({
    controller,
    stderr,
    on: (event, fn) => {
      assert.equal(event, 'SIGINT');
      handler = fn;
    },
    off: () => {
      handler = null;
    },
    exit: (code) => exits.push(code),
    slotOf: () => 3,
  });

  handler();
  assert.equal(controller.signal.aborted, true);
  assert.match(stderr.text(), /the report is written/);
  assert.match(stderr.text(), /again to stop now/);
  assert.deepEqual(exits, []);

  handler();
  assert.deepEqual(exits, [130]);
  // The slot was taken ephemerally, so nothing else can say which number the
  // abandoned one is.
  assert.match(stderr.text(), /--ephemeral --down 3/);

  release();
  assert.equal(handler, null);
});

// The handler is only useful if it is on the process that receives the signal,
// and the injection every other test uses cannot say that it is.
test('the handler goes on the process itself, and comes off again', () => {
  const controller = new AbortController();
  const before = process.listenerCount('SIGINT');
  const release = installInterrupt({ controller, stderr: sink() });
  assert.equal(process.listenerCount('SIGINT'), before + 1);

  // One only: a second would reach `process.exit` and take the test run with
  // it, which is exactly what the second Ctrl+C is for.
  process.emit('SIGINT');
  assert.equal(controller.signal.aborted, true);

  release();
  assert.equal(process.listenerCount('SIGINT'), before);
});

test('the second Ctrl+C names no slot when none was taken yet', () => {
  const stderr = sink();
  const exits = [];
  let handler = null;
  installInterrupt({
    controller: new AbortController(),
    stderr,
    on: (event, fn) => {
      handler = fn;
    },
    off: () => {
      handler = null;
    },
    exit: (code) => exits.push(code),
    slotOf: () => null,
  });

  handler();
  handler();
  assert.deepEqual(exits, [130]);
  assert.ok(!stderr.text().includes('--ephemeral --down'));
});

test('the manual smoke run is documented at the top of this CLI', () => {
  const source = readFileSync(new URL('./cli.mjs', import.meta.url), 'utf8');
  const header = source.slice(0, source.indexOf('*/'));
  assert.match(header, /THE MANUAL SMOKE RUN/);
  assert.match(header, /luna-slot\.sh --list/);
});
