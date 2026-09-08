import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import {
  REPO_ROOT,
  defaultRunDir,
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

test('the manual smoke run is documented at the top of this CLI', () => {
  const source = readFileSync(new URL('./cli.mjs', import.meta.url), 'utf8');
  const header = source.slice(0, source.indexOf('*/'));
  assert.match(header, /THE MANUAL SMOKE RUN/);
  assert.match(header, /luna-slot\.sh --list/);
});
