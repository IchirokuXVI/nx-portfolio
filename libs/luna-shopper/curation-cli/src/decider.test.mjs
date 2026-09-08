import assert from 'node:assert/strict';
import test from 'node:test';
import {
  IMPLEMENTATION_NAMES,
  deciderPath,
  makeDecider,
  readAnswer,
} from './decider.mjs';

/** A decider that records how it was called and answers one object each time. */
function fakeDecider(answers) {
  const calls = [];
  const spawn = async (node, args, options) => {
    calls.push({ node, args, input: options?.input });
    const answer = answers.shift() ?? { done: true };
    if (answer.__fail) {
      return { code: 1, stdout: '', stderr: answer.__fail };
    }
    return { code: 0, stdout: `${JSON.stringify(answer)}\n`, stderr: '' };
  };
  return { calls, spawn };
}

test('an implementation names one CLI, and an unknown one is refused', () => {
  assert.deepEqual(IMPLEMENTATION_NAMES, ['suggestions', 'groups']);
  assert.equal(
    deciderPath('suggestions', '/repo'),
    '/repo/libs/luna-shopper/curation-suggestions/src/cli.mjs'
  );
  assert.equal(
    deciderPath('groups', '/repo'),
    '/repo/libs/luna-shopper/curation-groups/src/cli.mjs'
  );
  assert.throws(() => deciderPath('entries', '/repo'), /suggestions, groups/);
});

test('readAnswer takes the last line, so stderr-shaped noise cannot break it', () => {
  assert.deepEqual(readAnswer('{"a":1}\n'), { a: 1 });
  assert.deepEqual(readAnswer('\n\n {"a":2} \n\n'), { a: 2 });
  assert.throws(() => readAnswer(''), /answered nothing/);
  assert.throws(() => readAnswer('boom'), /not JSON/);
});

test('start passes both urls, the run directory and the model', async () => {
  const { calls, spawn } = fakeDecider([
    { runId: 'r1', remaining: 3, prompt: 'rules' },
  ]);
  const decider = makeDecider({
    spawn,
    cliPath: '/repo/cli.mjs',
    runDir: '/runs/x',
    node: '/usr/bin/node',
  });

  const answer = await decider.start({
    mainUrl: 'http://localhost:3000',
    rehearsalUrl: 'http://localhost:43000',
    mainUser: 'dev-admin',
    model: 'claude-sonnet-5',
    chain: null,
  });

  assert.equal(answer.prompt, 'rules');
  assert.deepEqual(calls[0].args, [
    '/repo/cli.mjs',
    'start',
    '--main-url',
    'http://localhost:3000',
    '--rehearsal-url',
    'http://localhost:43000',
    '--run-dir',
    '/runs/x',
    '--main-user',
    'dev-admin',
    '--model',
    'claude-sonnet-5',
  ]);
});

test('a password given once is repeated on every subcommand', async () => {
  const { calls, spawn } = fakeDecider([
    { done: true },
    { report: '/runs/x/report.json' },
  ]);
  const decider = makeDecider({
    spawn,
    cliPath: '/c.mjs',
    runDir: '/runs/x',
    mainPassword: 'secret',
  });
  await decider.next();
  await decider.end({ calls: 1 });
  assert.ok(calls[0].args.includes('--main-password'));
  assert.ok(calls[0].args.includes('secret'));
  // `end` writes the report and never talks to a gateway, so it carries no password.
  assert.ok(!calls[1].args.includes('--main-password'));
  assert.deepEqual(calls[1].args, [
    '/c.mjs',
    'end',
    '--run-dir',
    '/runs/x',
    '--usage',
    '{"calls":1}',
  ]);
});

test('decide puts the model JSON on stdin and adds --final only when asked', async () => {
  const { calls, spawn } = fakeDecider([
    { accepted: false, retryable: true },
    { accepted: true, retryable: false },
  ]);
  const decider = makeDecider({ spawn, cliPath: '/c.mjs', runDir: '/runs/x' });

  await decider.decide('e1', { decision: 'LINK' });
  await decider.decide('e1', { decision: 'LINK' }, { final: true });

  assert.equal(calls[0].input, '{"decision":"LINK"}');
  assert.ok(!calls[0].args.includes('--final'));
  assert.ok(calls[1].args.includes('--final'));
  assert.deepEqual(calls[1].args.slice(0, 6), [
    '/c.mjs',
    'decide',
    '--run-dir',
    '/runs/x',
    '--entry',
    'e1',
  ]);
});

test('apply is the replay, and it names no run directory', async () => {
  const { calls, spawn } = fakeDecider([{ results: [], priceSkips: [] }]);
  const decider = makeDecider({ spawn, cliPath: '/c.mjs', runDir: null });
  await decider.apply({
    mainUrl: 'http://localhost:3000',
    file: 'decisions.jsonl',
    mainUser: 'dev-admin',
  });
  assert.deepEqual(calls[0].args, [
    '/c.mjs',
    'apply',
    '--main-url',
    'http://localhost:3000',
    '--file',
    'decisions.jsonl',
    '--main-user',
    'dev-admin',
  ]);
});

test('a failed subcommand becomes an error carrying the decider stderr', async () => {
  const { spawn } = fakeDecider([{ __fail: 'main login failed: HTTP 401' }]);
  const decider = makeDecider({ spawn, cliPath: '/c.mjs', runDir: '/runs/x' });
  await assert.rejects(
    () =>
      decider.start({
        mainUrl: 'http://a',
        rehearsalUrl: 'http://b',
      }),
    /start failed: main login failed: HTTP 401/
  );
});
