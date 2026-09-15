import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { run } from './cli.mjs';
import { SERVABLE, answerRequest, serve } from './serve.mjs';

/** Collects the answer lines the loop writes. */
function sink() {
  const lines = [];
  return {
    lines,
    write: (text) => lines.push(text),
    answers: () =>
      lines
        .join('')
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line)),
  };
}

/**
 * The loop, over a list of request lines.
 *
 * Everything is written and then stdin is closed, which is what ends a real
 * session too.
 */
async function session(lines, run) {
  const input = new PassThrough();
  const output = sink();
  const finished = serve({ input, output, run });
  for (const line of lines) {
    input.write(`${typeof line === 'string' ? line : JSON.stringify(line)}\n`);
  }
  input.end();
  await finished;
  return output.answers();
}

test('a request reaches the command it names with the flags it carries', async () => {
  const seen = [];
  const answers = await session(
    [
      {
        id: 1,
        command: 'next',
        args: ['--run-dir', '/runs/x', '--count', '4'],
      },
    ],
    async (argv) => {
      seen.push(argv);
      return { rows: [], remaining: 0 };
    }
  );

  assert.deepEqual(seen, [['next', '--run-dir', '/runs/x', '--count', '4']]);
  assert.deepEqual(answers, [{ id: 1, answer: { rows: [], remaining: 0 } }]);
});

test("decide's input arrives where stdin used to", async () => {
  let read = null;
  await session(
    [
      {
        id: 7,
        command: 'decide',
        args: ['--run-dir', '/runs/x', '--entry', 'e1'],
        input: '{"decision":"LINK","itemId":"i1"}',
      },
    ],
    async (argv, options) => {
      read = options.stdin();
      return { accepted: true };
    }
  );

  assert.equal(read, '{"decision":"LINK","itemId":"i1"}');
});

test('a request with no input reads an empty string rather than the real stdin', async () => {
  // The one shot path reads file descriptor 0 here, and inside a session that
  // descriptor is the request stream itself. Reading it would consume the next
  // request.
  let read = null;
  await session(
    [{ id: 1, command: 'end', args: ['--run-dir', '/runs/x'] }],
    async (argv, options) => {
      read = options.stdin();
      return { report: '/runs/x/report.json' };
    }
  );
  assert.equal(read, '');
});

test('the answers come back in the order the requests were written', async () => {
  // Each request takes longer than the one after it, so an answer out of order
  // would be the loop overlapping them rather than chaining them.
  const delays = { a: 30, b: 20, c: 1 };
  const answers = await session(
    [
      { id: 1, command: 'next', args: ['a'] },
      { id: 2, command: 'next', args: ['b'] },
      { id: 3, command: 'next', args: ['c'] },
    ],
    async (argv) => {
      const key = argv[1];
      await new Promise((resolve) => setTimeout(resolve, delays[key]));
      return { key };
    }
  );

  assert.deepEqual(
    answers.map((answer) => [answer.id, answer.answer.key]),
    [
      [1, 'a'],
      [2, 'b'],
      [3, 'c'],
    ]
  );
});

test('a command that throws answers an error and the loop keeps serving', async () => {
  const answers = await session(
    [
      { id: 1, command: 'next', args: [] },
      { id: 2, command: 'next', args: [] },
    ],
    async () => {
      throw new Error('--run-dir is required');
    }
  );

  assert.deepEqual(answers, [
    { id: 1, error: '--run-dir is required' },
    { id: 2, error: '--run-dir is required' },
  ]);
});

test('a request that cannot be read still answers a line', async () => {
  // A caller is waiting on an id, so an unanswered request would hang the walk
  // rather than fail it.
  const answers = await session(
    ['not json', { id: 2 }, { id: 3, command: 'serve' }],
    async () => ({})
  );

  assert.equal(answers.length, 3);
  assert.equal(answers[0].id, null);
  assert.match(answers[0].error, /the request is not JSON/);
  assert.equal(answers[1].id, 2);
  assert.match(answers[1].error, /\(no command\) is not one of/);
  // `serve` inside a session would be a session inside a session.
  assert.equal(answers[2].id, 3);
  assert.match(answers[2].error, /serve is not one of/);
});

test('the servable commands are the five the CLI has always had', () => {
  assert.deepEqual(SERVABLE, ['start', 'next', 'decide', 'end', 'apply']);
});

test('answerRequest is the whole of one request, and it never throws', async () => {
  const failed = await answerRequest(
    '{"id":4,"command":"end","args":[]}',
    () => {
      throw new Error('boom');
    }
  );
  assert.deepEqual(failed, { id: 4, error: 'boom' });

  const blank = await answerRequest('{}', async () => ({}));
  assert.equal(blank.id, null);
});

/**
 * A run directory as a walk would have left it, without a walk.
 *
 * `end` is the one command that reads the whole run directory and writes a file
 * out of it, and it talks to no gateway, so it is what an equivalence test can
 * drive for real.
 */
function makeRunDir() {
  const dir = mkdtempSync(join(tmpdir(), 'curation-serve-'));
  writeFileSync(
    join(dir, 'state.json'),
    JSON.stringify(
      {
        runId: 'r1',
        mainUrl: 'http://localhost:3000',
        rehearsalUrl: 'http://localhost:43000',
        model: 'gemma4:12b',
        startedAt: '2026-09-14T00:00:00.000Z',
        total: 2,
        decidedIds: ['e1', 'e2'],
        createdRefs: {},
        handouts: {},
        reasks: 1,
      },
      null,
      2
    )
  );
  writeFileSync(
    join(dir, 'decisions.jsonl'),
    [
      { header: true, runId: 'r1', startedAt: '2026-09-14T00:00:00.000Z' },
      { entryId: 'e1', entryName: 'Leche entera', decision: 'LINK' },
      { entryId: 'e2', entryName: 'Pan de molde', decision: 'CREATE' },
    ]
      .map((line) => JSON.stringify(line))
      .join('\n') + '\n'
  );
  return dir;
}

test('a command driven through serve writes what the command line writes', async () => {
  // The loop calls the same `run` the command line calls, and this is what
  // proves it rather than asserting it: the same request, one way and then the
  // other, over two run directories built the same way.
  const byHand = makeRunDir();
  const bySession = makeRunDir();

  const direct = await run([
    'end',
    '--run-dir',
    byHand,
    '--usage',
    '{"calls":2}',
  ]);
  const answers = await session(
    [
      {
        id: 1,
        command: 'end',
        args: ['--run-dir', bySession, '--usage', '{"calls":2}'],
      },
    ],
    run
  );

  assert.deepEqual(
    { ...answers[0].answer, report: null },
    { ...direct, report: null }
  );

  // `endedAt` is the clock and is the only field that can differ.
  const blank = (dir) => {
    const report = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8'));
    return { ...report, endedAt: null };
  };
  assert.deepEqual(blank(bySession), blank(byHand));

  // And nothing else in the directory moved.
  for (const file of ['state.json', 'decisions.jsonl']) {
    assert.equal(
      readFileSync(join(bySession, file), 'utf8'),
      readFileSync(join(byHand, file), 'utf8')
    );
  }

  rmSync(byHand, { recursive: true, force: true });
  rmSync(bySession, { recursive: true, force: true });
});

test('a blank line is not a request', async () => {
  const answers = await session(
    ['', { id: 1, command: 'end', args: [] }, ''],
    async () => ({ report: 'r' })
  );
  assert.deepEqual(answers, [{ id: 1, answer: { report: 'r' } }]);
});
