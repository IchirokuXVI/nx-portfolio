import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseArgs, run } from './cli.mjs';

test('parseArgs reads flags with and without a value', () => {
  const parsed = parseArgs([
    'decide',
    '--run-dir',
    '/tmp/r',
    '--entry',
    'e1',
    '--final',
  ]);
  assert.equal(parsed.command, 'decide');
  assert.deepEqual(parsed.flags, {
    'run-dir': '/tmp/r',
    entry: 'e1',
    final: true,
  });
});

test('start reads --local as a bare flag, whatever follows it', () => {
  // The orchestrator appends it between `--model` and the password, so the
  // token after it is another flag and never a value this one would swallow.
  const parsed = parseArgs([
    'start',
    '--model',
    'gemma4:12b',
    '--local',
    '--main-password',
    'secret',
  ]);
  assert.equal(parsed.flags.local, true);
  assert.equal(parsed.flags['main-password'], 'secret');
  // And a run that never names it is not a local run.
  assert.equal(parseArgs(['start', '--model', 'x']).flags.local, undefined);
});

test('parseArgs refuses a bare argument', () => {
  assert.throws(() => parseArgs(['next', 'oops']), /Unexpected argument oops/);
});

test('no command answers the usage rather than doing anything', async () => {
  const answer = await run([]);
  assert.match(
    answer.usage,
    /start\|next\|decide\|end\|apply\|propose-brands\|serve/
  );
});

test('serve is in the usage and not in the commands that answer one object', async () => {
  // It owns stdin and stdout for as long as it runs, so it cannot answer one
  // object the way the other five do. `serve.mjs` is the loop and `cli.mjs`
  // dispatches it from the command line only.
  await assert.rejects(
    () => run(['serve']),
    /serve is not one of the commands/
  );
});

test('an unknown command names itself and prints the usage', async () => {
  await assert.rejects(() => run(['walk']), /Unknown command walk/);
});

test('a missing required flag says which one', async () => {
  await assert.rejects(() => run(['next']), /--run-dir is required/);
});

test('next refuses a count that is not a whole number of rows', async () => {
  // `--count` with nothing after it parses as `true`, and `Number(true)` is 1,
  // so a typed flag would quietly become a batch of one row.
  for (const flags of [['--count'], ['--count', '0'], ['--count', 'four']]) {
    await assert.rejects(
      () => run(['next', '--run-dir', '/tmp/r', ...flags]),
      /--count takes a whole number of rows/
    );
  }
});

test('decide refuses stdin that is not JSON', async () => {
  await assert.rejects(
    () =>
      run(['decide', '--run-dir', '/tmp/r', '--entry', 'e1'], {
        stdin: () => 'not json',
      }),
    /the decision on stdin is not JSON/
  );
});

test('apply reaches the replay path with the file it was given', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'curation-cli-'));
  const file = join(dir, 'decisions.jsonl');
  writeFileSync(
    file,
    `${JSON.stringify({ header: true, runId: 'r1', mainUrl: 'http://x' })}\n`
  );

  const answer = await run(['apply', '--main-url', 'http://x', '--file', file]);
  assert.equal(answer.operations, 0);
});
