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
    '--item',
    'i1',
    '--final',
  ]);
  assert.equal(parsed.command, 'decide');
  assert.deepEqual(parsed.flags, {
    'run-dir': '/tmp/r',
    item: 'i1',
    final: true,
  });
});

test('parseArgs refuses a bare argument', () => {
  assert.throws(() => parseArgs(['next', 'oops']), /Unexpected argument oops/);
});

test('no command answers the usage rather than doing anything', async () => {
  const answer = await run([]);
  assert.match(answer.usage, /start\|next\|decide\|end\|apply/);
});

test('an unknown command names itself and prints the usage', async () => {
  await assert.rejects(() => run(['sort']), /Unknown command sort/);
});

test('a missing required flag says which one', async () => {
  await assert.rejects(() => run(['next']), /--run-dir is required/);
});

test('decide refuses stdin that is not JSON', async () => {
  await assert.rejects(
    () =>
      run(['decide', '--run-dir', '/tmp/r', '--item', 'i1'], {
        stdin: () => 'not json',
      }),
    /the decision on stdin is not JSON/
  );
});

test('--limit refuses anything that is not a whole number of products', async () => {
  for (const value of ['0', '-3', '2.5', 'many']) {
    await assert.rejects(
      () =>
        run([
          'start',
          '--main-url',
          'http://x',
          '--rehearsal-url',
          'http://y',
          '--run-dir',
          '/tmp/r',
          '--limit',
          value,
        ]),
      /--limit takes a whole number/
    );
  }
});

test('apply reaches the replay path with the file it was given', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'curation-groups-cli-'));
  const file = join(dir, 'decisions.jsonl');
  writeFileSync(
    file,
    `${JSON.stringify({ header: true, runId: 'r1', mainUrl: 'http://x' })}\n`
  );

  const answer = await run(['apply', '--main-url', 'http://x', '--file', file]);
  assert.equal(answer.operations, 0);
});
