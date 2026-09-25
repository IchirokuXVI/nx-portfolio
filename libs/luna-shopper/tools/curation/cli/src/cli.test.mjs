import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ENGINES } from '../../../../../shared/model-engines/src/index.mjs';
import {
  REPO_ROOT,
  STOP_SIGNALS,
  defaultRunDir,
  installInterrupt,
  loadResume,
  main,
  parseArgs,
  parseLimit,
  resolveImplementation,
  serverTimingsLine,
  spawnCapture,
  spawnChild,
  usageText,
} from './cli.mjs';
import { deciderPath, makeDecider } from './decider.mjs';
import { writeRunFile } from './run-files.mjs';
import { fakeChild } from './test-fakes.mjs';

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

/** The sums an 80 row walk against a local model leaves behind. */
const WALK_TIMINGS = {
  calls: 80,
  totalMs: 157_200,
  loadMs: 6_900,
  promptTokens: 239_440,
  promptEvalMs: 28_300,
  evalTokens: 4_900,
  evalMs: 156_000,
};

test('the run reports the decode rate, the prompt share and the load on one line', () => {
  const line = serverTimingsLine(
    { calls: 80, timings: WALK_TIMINGS },
    'ollama'
  );

  // One line, because two runs are compared by reading the same line twice.
  assert.equal(line.split('\n').filter(Boolean).length, 1);
  assert.equal(
    line,
    'ollama: 31.4 decode tok/s, prompt eval 18% of 157.2 s, load 6.9 s over 80 calls\n'
  );
});

test('a run whose provider reported no durations says nothing at all', () => {
  // Every engine but ollama, and an ollama run that never reached a row.
  assert.equal(serverTimingsLine({ calls: 12 }, 'claude'), null);
  assert.equal(serverTimingsLine(undefined, 'ollama'), null);
  assert.equal(
    serverTimingsLine({ timings: { ...WALK_TIMINGS, calls: 0 } }, 'ollama'),
    null
  );
});

test('a rate with nothing to divide by is left out rather than reported as zero', () => {
  const line = serverTimingsLine(
    {
      timings: {
        calls: 2,
        totalMs: 0,
        loadMs: 0,
        promptTokens: 0,
        promptEvalMs: 0,
        evalTokens: 0,
        evalMs: 0,
      },
    },
    'ollama'
  );

  assert.equal(line, 'ollama: load 0.0 s over 2 calls\n');
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

/** A decisions file with one LINK, which is one operation to send. */
function oneLinkFile() {
  const dir = mkdtempSync(join(tmpdir(), 'curation-apply-'));
  const file = join(dir, 'decisions.jsonl');
  writeFileSync(
    file,
    [
      { header: true, runId: 'r1', mainUrl: 'http://localhost:3000' },
      { entryId: 'e1', decision: 'LINK', itemId: 'i1', expect: {} },
    ]
      .map(
        (line) => `${JSON.stringify(line)}
`
      )
      .join('')
  );
  return file;
}

test('--apply takes no slot and makes no model call', async () => {
  const spawned = [];
  const started = [];
  const stdout = sink();
  const { requests, startChild } = fakeChild([{ results: [], priceSkips: [] }]);
  const code = await main(
    [
      '--implementation',
      'suggestions',
      '--apply',
      oneLinkFile(),
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
        return { code: 0, stdout: '{}', stderr: '' };
      },
      startChild: (command, args) => {
        started.push({ command, args });
        return startChild();
      },
      repoRoot: '/repo',
      platform: 'linux',
    }
  );

  assert.equal(code, 0);
  // One decider child, in serve mode, and one request over it.
  assert.equal(started.length, 1);
  assert.match(started[0].args[0], /curation\/suggestions\/src\/cli\.mjs$/);
  assert.equal(started[0].args[1], 'serve');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].command, 'apply');
  // No luna-slot, no docker, no claude.
  assert.deepEqual(spawned, []);
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
    // The names it lists belong to the registry, and `registry.test.mjs`
    // asserts the whole sentence. What this test is about is the line below:
    // an unknown engine is refused before anything was started.
    /Unknown engine sdk\./
  );
  assert.deepEqual(spawned, []);
});

test('an unknown effort is refused before anything is started', async () => {
  const spawned = [];
  await assert.rejects(
    () =>
      main(['--implementation', 'groups', '--effort', 'ultra'], {
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
    /Unknown effort ultra\. It is one of low, medium, high, xhigh, max\./
  );
  assert.deepEqual(spawned, []);
});

test('--chain with the groups decider is refused before a slot is taken', async () => {
  const spawned = [];
  await assert.rejects(
    () =>
      main(['--implementation', 'groups', '--chain', 'chain-1'], {
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
    /--chain works with the suggestions decider only/
  );
  assert.deepEqual(spawned, []);
});

test('parseLimit reads a row count and refuses everything else', () => {
  assert.equal(parseLimit(undefined), null);
  assert.equal(parseLimit('40'), 40);
  assert.equal(parseLimit(' 1 '), 1);
  for (const value of ['0', '-3', '2.5', 'lots', '']) {
    assert.throws(
      () => parseLimit(value),
      /it has to be a whole number of rows, one or more/,
      String(value)
    );
  }
  // `--limit` with no value is a flag with nothing to limit to, and reading it
  // as one row or as no limit would both be a run nobody asked for.
  assert.throws(() => parseLimit(true), /--limit is \(nothing\)/);
});

test('an unreadable --limit is refused before anything is started', async () => {
  const spawned = [];
  await assert.rejects(
    () =>
      main(['--implementation', 'groups', '--limit', 'lots'], {
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
    /--limit is lots/
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
  assert.match(stdout.text(), /--limit <n>/);
  // The one server side knob a batching run depends on and cannot read for
  // itself, named where an operator looks for flags.
  assert.match(stdout.text(), /OLLAMA_NUM_PARALLEL/);
});

test('the help text names every engine the registry holds', () => {
  const text = usageText();
  // One table drives the argument check and this text both, so an adapter
  // added to the registry cannot leave either stale.
  for (const entry of ENGINES) {
    assert.match(text, new RegExp(`--engine <[a-z|]*${entry.name}`));
    assert.match(
      text,
      new RegExp(`${entry.name}\\s+model ${entry.defaultModel}`)
    );
  }
});

test('an engine that takes no effort is not offered a level', () => {
  // Not an entry that exists yet; it is the shape plan 0002 arrives in, and
  // the help text is the first thing that would misdescribe it.
  const text = usageText([
    {
      name: 'ollama',
      defaultModel: 'llama3.1',
      defaultEffort: null,
      effortLevels: [],
    },
  ]);
  assert.match(text, /ollama\s+model llama3\.1, no effort levels/);
});

test('the repo root this file computes is the workspace root', () => {
  assert.ok(
    existsSync(`${REPO_ROOT}/nx.json`),
    `${REPO_ROOT} should hold nx.json`
  );
  assert.ok(
    existsSync(
      `${REPO_ROOT}/libs/luna-shopper/tools/curation/suggestions/src/cli.mjs`
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
      if (event === 'SIGINT') {
        handler = fn;
      }
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

// The one test that starts a real decider. Everything else fakes the child, so
// nothing else would notice that `serve` was never dispatched, that the line
// framing disagrees, or that the answer is nested under a different key.
// `apply` over an empty decisions file is the one command that reaches no
// gateway, so the round trip costs one process and no network.
test('a real decider answers a real serve request', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'curation-serve-'));
  const file = join(dir, 'decisions.jsonl');
  writeFileSync(
    file,
    `${JSON.stringify({ header: true, runId: 'r1', mainUrl: 'http://x' })}\n`
  );

  const decider = makeDecider({
    startChild: spawnChild,
    cliPath: deciderPath('suggestions', REPO_ROOT),
    runDir: null,
  });
  const answer = await decider.apply({ mainUrl: 'http://x', file });

  assert.equal(answer.runId, 'r1');
  assert.equal(answer.operations, 0);
  assert.equal(answer.applied, true);
  rmSync(dir, { recursive: true, force: true });
});

test('the manual smoke run is documented at the top of this CLI', () => {
  const source = readFileSync(new URL('./cli.mjs', import.meta.url), 'utf8');
  const header = source.slice(0, source.indexOf('*/'));
  assert.match(header, /THE MANUAL SMOKE RUN/);
  assert.match(header, /luna-slot\.sh --list/);
});

// ---------------------------------------------------------------------------
// Plan 0005
// ---------------------------------------------------------------------------

test('SIGTERM and SIGHUP stop the run the way the first Ctrl+C does', () => {
  const controller = new AbortController();
  const stderr = sink();
  const exits = [];
  const handlers = new Map();
  const release = installInterrupt({
    controller,
    stderr,
    on: (event, fn) => handlers.set(event, fn),
    off: (event) => handlers.delete(event),
    exit: (code) => exits.push(code),
    slotOf: () => 4,
  });

  assert.deepEqual([...handlers.keys()], STOP_SIGNALS);
  assert.deepEqual(STOP_SIGNALS, ['SIGINT', 'SIGTERM', 'SIGHUP']);

  handlers.get('SIGTERM')('SIGTERM');
  assert.equal(controller.signal.aborted, true);
  assert.match(stderr.text(), /SIGTERM: stopping\. .*the report is written/);
  assert.deepEqual(exits, []);

  // A second signal of any kind is the escape hatch, and it prints the exact
  // command that takes the abandoned slot down.
  handlers.get('SIGHUP')('SIGHUP');
  assert.deepEqual(exits, [129]);
  assert.ok(
    stderr
      .text()
      .includes(
        'take it down with: bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --down 4'
      )
  );

  release();
  assert.equal(handlers.size, 0);
});

test('--apply needs neither the implementation nor the main url', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'curation-apply-'));
  const file = join(dir, 'decisions.jsonl');
  writeFileSync(
    file,
    [
      { header: true, runId: 'r1', mainUrl: 'http://main:3000' },
      { itemId: 'i1', decision: 'ASSIGN', groupId: 'g1', expect: {} },
    ]
      .map((line) => `${JSON.stringify(line)}\n`)
      .join('')
  );
  writeRunFile(dir, { implementation: 'groups' });
  const started = [];
  const { requests, startChild } = fakeChild([
    { applied: true, operations: 1 },
  ]);

  const code = await main(['--apply', file], {
    env: {},
    stdout: sink(),
    stderr: sink(),
    isTty: false,
    startChild: (command, args) => {
      started.push(args[0]);
      return startChild();
    },
    repoRoot: '/repo',
  });

  assert.equal(code, 0);
  assert.match(started[0], /curation\/groups\/src\/cli\.mjs$/);
  assert.deepEqual(requests[0].args.slice(0, 4), [
    '--main-url',
    'http://main:3000',
    '--file',
    file,
  ]);
  rmSync(dir, { recursive: true, force: true });
});

test('--apply of a run with only reviews starts no decider and succeeds', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'curation-apply-'));
  const file = join(dir, 'decisions.jsonl');
  writeFileSync(
    file,
    [
      { header: true, runId: 'r1', mainUrl: 'http://main:3000' },
      { itemId: 'i1', decision: 'REVIEW', issues: [] },
    ]
      .map((line) => `${JSON.stringify(line)}\n`)
      .join('')
  );
  const stderr = sink();
  const code = await main(['--apply', file], {
    env: {},
    stdout: sink(),
    stderr,
    isTty: false,
    startChild: () => {
      throw new Error('no decider should start');
    },
    repoRoot: '/repo',
  });
  assert.equal(code, 0);
  assert.match(stderr.text(), /nothing to apply/);
  rmSync(dir, { recursive: true, force: true });
});

test('a directory this orchestrator never opened cannot be resumed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'curation-resume-'));
  assert.throws(() => loadResume(dir), /curation-run\.json does not exist/);
  writeRunFile(dir, { implementation: 'suggestions', opened: {} });
  assert.throws(() => loadResume(dir), /holds no state\.json/);
  writeFileSync(join(dir, 'state.json'), '{}');
  assert.equal(loadResume(dir).implementation, 'suggestions');
  assert.throws(() => loadResume(true), /--resume takes the run directory/);
  rmSync(dir, { recursive: true, force: true });
});

/** A run directory a resume accepts, started on the given engine and chain. */
function resumableRunDir(stored = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'curation-resume-'));
  writeFileSync(join(dir, 'state.json'), '{}');
  writeRunFile(dir, {
    implementation: 'groups',
    engine: 'claude',
    model: 'claude-sonnet-5',
    effort: null,
    chain: null,
    limit: null,
    mainUrl: 'http://main:3000',
    mainUser: null,
    opened: { runId: 'r1', remaining: 10, prompt: 'P' },
    ...stored,
  });
  return dir;
}

test('a resume keeps what the run was started with, and refuses to change it', async () => {
  const dir = resumableRunDir();
  const options = {
    env: {},
    stdout: sink(),
    stderr: sink(),
    isTty: false,
    spawn: async () => ({ code: 0, stdout: '', stderr: '' }),
    repoRoot: '/repo',
  };
  await assert.rejects(
    () => main(['--resume', dir, '--implementation', 'suggestions'], options),
    /was started with --implementation groups, and a resumed run keeps it/
  );
  await assert.rejects(
    () => main(['--resume', dir, '--main-url', 'http://elsewhere'], options),
    /was started with --main-url http:\/\/main:3000/
  );
  await assert.rejects(
    () => main(['--resume', dir, '--run-dir', dir], options),
    /Leave out --run-dir/
  );
  rmSync(dir, { recursive: true, force: true });
});

test('a resume takes a slot of its own and never asks which decider', async () => {
  const dir = resumableRunDir();
  const spawned = [];
  const code = await main(['--resume', dir], {
    env: {},
    stdout: sink(),
    stderr: sink(),
    // A terminal that would be asked, and must not be: the run says.
    isTty: true,
    ask: async () => {
      throw new Error('a resume asks nothing');
    },
    spawn: async (command, args) => {
      spawned.push([command, ...args].join(' '));
      return { code: 0, stdout: '', stderr: '' };
    },
    repoRoot: '/repo',
    interrupt: ({ controller }) => {
      controller.abort(new Error('the run was stopped with Ctrl+C'));
      return () => undefined;
    },
  });
  assert.equal(code, 130);
  assert.ok(spawned.some((call) => call.includes('--ephemeral --up 1')));
  assert.ok(spawned.some((call) => call.includes('--ephemeral --down 1')));
  rmSync(dir, { recursive: true, force: true });
});
