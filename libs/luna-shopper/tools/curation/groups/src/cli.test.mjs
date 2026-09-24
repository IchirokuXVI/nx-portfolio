import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseArgs, run } from './cli.mjs';
import { serve } from './serve.mjs';

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
  assert.match(answer.usage, /start\|next\|decide\|end\|apply\|serve/);
});

test('serve answers a start request out of the same run the command line calls', async () => {
  // `curation-cli` drives every decider in serve mode now, so a decider without
  // the loop answers nothing at all and a `--implementation groups` run hangs
  // on its first call. The request is one `start` missing a flag, because that
  // reaches the command and answers a line without touching a gateway.
  const input = new PassThrough();
  const lines = [];
  const finished = serve({
    input,
    output: { write: (text) => lines.push(text) },
    run,
  });
  input.write(
    `${JSON.stringify({
      id: 1,
      command: 'start',
      args: ['--main-url', 'http://x', '--run-dir', '/tmp/r'],
    })}\n`
  );
  input.end();
  await finished;

  assert.deepEqual(JSON.parse(lines[0]), {
    id: 1,
    error: '--rehearsal-url is required',
  });
});

test('the real CLI dispatches serve from the command line', async () => {
  // The loop existing is not the same as `node cli.mjs serve` reaching it, and
  // the second is what `curation-cli` depends on. One process, no gateway.
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL('./cli.mjs', import.meta.url)), 'serve'],
    { stdio: ['pipe', 'pipe', 'pipe'] }
  );
  let stdout = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stdin.end(
    `${JSON.stringify({
      id: 9,
      command: 'start',
      args: ['--main-url', 'http://x', '--run-dir', '/tmp/r'],
    })}\n`
  );
  const code = await new Promise((resolve) => child.on('close', resolve));

  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(stdout.trim()), {
    id: 9,
    error: '--rehearsal-url is required',
  });
});

test('serve is in the usage and not in the commands that answer one object', async () => {
  await assert.rejects(
    () => run(['serve']),
    /serve is not one of the commands/
  );
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
  assert.equal(answer.applied, true);
});

test('start refuses --chain by name from the command line', async () => {
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
        '--chain',
        'mercadona',
      ]),
    /--chain is not taken by the groups decider/
  );
});

test('the usage names --local and says --chain is refused', async () => {
  const { usage } = await run([]);
  assert.match(usage, /--local/);
  assert.match(usage, /--chain is refused/);
});

/**
 * A run directory whose state already holds `i1`, so a `decide` that reaches
 * the command says which row it was given, and says it before any gateway is
 * opened.
 */
function decidedRunDir() {
  const dir = mkdtempSync(join(tmpdir(), 'curation-groups-row-'));
  writeFileSync(
    join(dir, 'state.json'),
    JSON.stringify({ runId: 'r1', mainUrl: 'http://x', decidedIds: ['i1'] })
  );
  return dir;
}

test('decide takes the row as --row, which is what the orchestrator sends', async () => {
  await assert.rejects(
    () =>
      run(['decide', '--run-dir', decidedRunDir(), '--row', 'i1'], {
        stdin: () => '{}',
      }),
    /Product i1 is already in/
  );
});

test('--item is still the same flag under its older name', async () => {
  await assert.rejects(
    () =>
      run(['decide', '--run-dir', decidedRunDir(), '--item', 'i1'], {
        stdin: () => '{}',
      }),
    /Product i1 is already in/
  );
});

test('a decide with no row asks for --row', async () => {
  await assert.rejects(
    () => run(['decide', '--run-dir', '/tmp/r'], { stdin: () => '{}' }),
    /--row is required/
  );
});
