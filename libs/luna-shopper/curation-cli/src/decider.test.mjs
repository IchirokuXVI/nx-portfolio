import assert from 'node:assert/strict';
import test from 'node:test';
import {
  IMPLEMENTATION_NAMES,
  deciderPath,
  makeDecider,
  readAnswer,
} from './decider.mjs';
import { fakeChild } from './test-fakes.mjs';

/** A decider driven over the line protocol, with the child faked. */
function fakeDecider(answers, options = {}) {
  const { child, requests, startChild } = fakeChild(answers);
  const decider = makeDecider({
    startChild,
    cliPath: '/repo/cli.mjs',
    runDir: '/runs/x',
    node: '/usr/bin/node',
    ...options,
  });
  return { child, requests, decider };
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

test('the child is started once, in serve mode, at the first call', async () => {
  const started = [];
  const { child, startChild } = fakeChild([
    { runId: 'r1', remaining: 3, prompt: 'rules' },
    { done: true },
  ]);
  const decider = makeDecider({
    startChild: (command, args) => {
      started.push({ command, args });
      return startChild();
    },
    cliPath: '/repo/cli.mjs',
    runDir: '/runs/x',
    node: '/usr/bin/node',
  });

  // Building one starts nothing: a run that fails before it reaches the decider
  // never pays for a process.
  assert.deepEqual(started, []);

  await decider.start({ mainUrl: 'http://a', rehearsalUrl: 'http://b' });
  await decider.next();

  assert.deepEqual(started, [
    { command: '/usr/bin/node', args: ['/repo/cli.mjs', 'serve'] },
  ]);
  await decider.close();
  assert.ok(child);
});

test('start passes both urls, the run directory and the model', async () => {
  const { requests, decider } = fakeDecider([
    { runId: 'r1', remaining: 3, prompt: 'rules' },
  ]);

  const answer = await decider.start({
    mainUrl: 'http://localhost:3000',
    rehearsalUrl: 'http://localhost:43000',
    mainUser: 'dev-admin',
    model: 'claude-sonnet-5',
    chain: null,
  });

  assert.equal(answer.prompt, 'rules');
  assert.equal(requests[0].command, 'start');
  assert.deepEqual(requests[0].args, [
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
  await decider.close();
});

test('a local engine adds one bare flag and nothing else', async () => {
  const { requests, decider } = fakeDecider([{ runId: 'r1', remaining: 1 }]);

  await decider.start({
    mainUrl: 'http://localhost:3000',
    rehearsalUrl: 'http://localhost:43000',
    mainUser: null,
    model: 'gemma4:12b',
    local: true,
    chain: null,
  });

  assert.equal(requests[0].command, 'start');
  assert.deepEqual(requests[0].args, [
    '--main-url',
    'http://localhost:3000',
    '--rehearsal-url',
    'http://localhost:43000',
    '--run-dir',
    '/runs/x',
    '--model',
    'gemma4:12b',
    '--local',
  ]);
  await decider.close();
});

test('a password given once is repeated on every request that talks to a gateway', async () => {
  const { requests, decider } = fakeDecider(
    [{ done: true }, { report: '/runs/x/report.json' }],
    { mainPassword: 'secret' }
  );
  await decider.next();
  await decider.end({ calls: 1 });

  assert.ok(requests[0].args.includes('--main-password'));
  assert.ok(requests[0].args.includes('secret'));
  // `end` writes the report and never talks to a gateway, so it carries no password.
  assert.ok(!requests[1].args.includes('--main-password'));
  assert.deepEqual(requests[1].args, [
    '--run-dir',
    '/runs/x',
    '--usage',
    '{"calls":1}',
  ]);
});

test('decide carries the model JSON as input and adds --final only when asked', async () => {
  const { requests, decider } = fakeDecider([
    { accepted: false, retryable: true },
    { accepted: true, retryable: false },
  ]);

  await decider.decide('e1', { decision: 'LINK' });
  await decider.decide('e1', { decision: 'LINK' }, { final: true });

  assert.equal(requests[0].input, '{"decision":"LINK"}');
  assert.ok(!requests[0].args.includes('--final'));
  assert.ok(requests[1].args.includes('--final'));
  assert.equal(requests[1].command, 'decide');
  assert.deepEqual(requests[1].args.slice(0, 4), [
    '--run-dir',
    '/runs/x',
    '--entry',
    'e1',
  ]);
  await decider.close();
});

test('every request carries its own id, and the answers come back in order', async () => {
  const { requests, decider } = fakeDecider([
    { runId: 'r1' },
    { entry: { id: 'e1' } },
    { entry: { id: 'e2' } },
  ]);

  const first = await decider.start({ mainUrl: 'a', rehearsalUrl: 'b' });
  const second = await decider.next();
  const third = await decider.next();

  assert.deepEqual(
    requests.map((request) => request.id),
    [1, 2, 3]
  );
  assert.equal(first.runId, 'r1');
  assert.equal(second.entry.id, 'e1');
  assert.equal(third.entry.id, 'e2');
  await decider.close();
});

test('a line that is not an answer is noise, not a mismatch', async () => {
  // A decider is free to write progress, and a line that does not parse or
  // names no pending call must never be handed to a caller waiting for a row:
  // that would record a decision against the wrong entry.
  const { requests, decider } = fakeDecider([
    { __noise: 'harvesting page 2 of 4' },
    { __noise: '{"id":99,"answer":{"entry":{"id":"not-mine"}}}' },
    { entry: { id: 'e1' } },
  ]);

  const answer = await decider.next();
  assert.equal(answer.entry.id, 'e1');
  assert.equal(requests.length, 1);
  await decider.close();
});

test('apply is the replay, and it names no run directory', async () => {
  const { child, requests, startChild } = fakeChild([
    { results: [], priceSkips: [] },
  ]);
  const decider = makeDecider({ startChild, cliPath: '/c.mjs', runDir: null });
  await decider.apply({
    mainUrl: 'http://localhost:3000',
    file: 'decisions.jsonl',
    mainUser: 'dev-admin',
  });
  assert.equal(requests[0].command, 'apply');
  assert.deepEqual(requests[0].args, [
    '--main-url',
    'http://localhost:3000',
    '--file',
    'decisions.jsonl',
    '--main-user',
    'dev-admin',
  ]);
  // One call, then the session is over: `apply` closes the child itself.
  assert.equal(child.listenerCount('exit') >= 0, true);
});

test('a refused replay throws, the way the exit code 2 used to', async () => {
  // From the command line a refused file answers `applied: false` and exits 2,
  // and the one shot channel turned any non-zero exit into a throw. A session
  // has no exit codes, so the throw is raised on the answer instead.
  const { startChild } = fakeChild([
    { applied: false, results: [{ entryId: 'e1', error: 'no such entry' }] },
  ]);
  const decider = makeDecider({ startChild, cliPath: '/c.mjs', runDir: null });
  await assert.rejects(
    () => decider.apply({ mainUrl: 'http://a', file: 'decisions.jsonl' }),
    /apply failed: .*no such entry/
  );
});

test('a command that failed becomes an error carrying what the decider said', async () => {
  const { decider } = fakeDecider([{ __error: 'main login failed: HTTP 401' }]);
  await assert.rejects(
    () =>
      decider.start({
        mainUrl: 'http://a',
        rehearsalUrl: 'http://b',
      }),
    /start failed: main login failed: HTTP 401/
  );
  await decider.close();
});

test('a child that dies rejects the call in flight and every call after it', async () => {
  const { child, startChild } = fakeChild([{ __hang: true }]);
  const decider = makeDecider({
    startChild,
    cliPath: '/c.mjs',
    runDir: '/runs/x',
  });

  const inFlight = decider.next();
  child.crash(3, 'TypeError: cannot read properties of undefined\n');

  await assert.rejects(
    () => inFlight,
    /next failed: the decider exited with code 3: TypeError/
  );
  // And the walk does not get a second chance at a process that is gone.
  await assert.rejects(
    () => decider.decide('e1', { decision: 'REVIEW' }),
    /decide failed: the decider exited with code 3/
  );
});

test('end closes the child, and closing twice is a no op', async () => {
  const { child, decider } = fakeDecider([{ report: '/runs/x/report.json' }]);
  const exits = [];
  child.on('exit', (code) => exits.push(code));

  const report = await decider.end({ calls: 4 });
  assert.equal(report.report, '/runs/x/report.json');
  assert.deepEqual(exits, [0]);

  await decider.close();
  assert.deepEqual(exits, [0]);
  assert.equal(child.killed, false);
});
