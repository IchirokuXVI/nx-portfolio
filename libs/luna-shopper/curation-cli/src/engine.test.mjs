import assert from 'node:assert/strict';
import test from 'node:test';
import {
  API_CONFIRMATION,
  addUsage,
  claudeChildEnv,
  confirmApiBilling,
  emptyUsage,
  makeApiEngine,
  makeClaudeEngine,
  readClaudeEnvelope,
  stripFence,
  textOf,
} from './engine.mjs';

/** A writable that keeps what was written, so a test can read the notice. */
function sink() {
  const written = [];
  return { written, write: (text) => written.push(text) };
}

/**
 * The envelope shape, read off one live `claude -p --output-format json` call
 * rather than assumed. Only the fields this library reads are kept.
 */
const ENVELOPE = JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: '{"decision":"REVIEW","confidence":0.4}',
  usage: {
    input_tokens: 2,
    output_tokens: 9,
    cache_read_input_tokens: 15497,
    cache_creation_input_tokens: 31888,
  },
});

test('the claude child environment has no API key in it', () => {
  const { env, hadKey } = claudeChildEnv({
    PATH: '/usr/bin',
    ANTHROPIC_API_KEY: 'sk-ant-secret',
  });
  assert.equal(hadKey, true);
  assert.equal(env.PATH, '/usr/bin');
  assert.ok(!('ANTHROPIC_API_KEY' in env));
});

test('an empty API key is not a key', () => {
  assert.equal(claudeChildEnv({ ANTHROPIC_API_KEY: '' }).hadKey, false);
  assert.equal(claudeChildEnv({}).hadKey, false);
});

test('the claude engine strips the key from the child it spawns and says so once', async () => {
  const seen = [];
  const stderr = sink();
  const usage = emptyUsage();
  const engine = makeClaudeEngine({
    spawn: async (command, args, options) => {
      seen.push({ command, args, options });
      return { code: 0, stdout: ENVELOPE, stderr: '' };
    },
    env: { PATH: '/usr/bin', ANTHROPIC_API_KEY: 'sk-ant-secret' },
    model: 'claude-sonnet-5',
    stderr,
    usage,
  });

  const first = await engine.ask('rules\n\npacket');
  const second = await engine.ask('rules\n\npacket');

  assert.equal(first.text, '{"decision":"REVIEW","confidence":0.4}');
  assert.equal(second.text, first.text);
  assert.equal(seen[0].command, 'claude');
  assert.deepEqual(seen[0].args, [
    '-p',
    '--output-format',
    'json',
    '--model',
    'claude-sonnet-5',
  ]);
  assert.equal(seen[0].options.input, 'rules\n\npacket');
  assert.ok(!('ANTHROPIC_API_KEY' in seen[0].options.env));
  assert.equal(seen[0].options.timeoutMs, 120000);

  // One notice for the whole run, not one per row.
  assert.equal(stderr.written.length, 1);
  assert.match(
    stderr.written[0],
    /ANTHROPIC_API_KEY is set and is being ignored/
  );

  assert.equal(usage.calls, 2);
  assert.equal(usage.inputTokens, 4);
  assert.equal(usage.cacheReadInputTokens, 15497 * 2);
});

test('the claude engine says nothing when there was no key to ignore', async () => {
  const stderr = sink();
  const engine = makeClaudeEngine({
    spawn: async () => ({ code: 0, stdout: ENVELOPE, stderr: '' }),
    env: { PATH: '/usr/bin' },
    stderr,
  });
  await engine.ask('anything');
  assert.deepEqual(stderr.written, []);
});

test('the claude engine retries a failed call and gives up with the reason', async () => {
  let calls = 0;
  const engine = makeClaudeEngine({
    spawn: async () => {
      calls += 1;
      return { code: 1, stdout: '', stderr: 'the CLI is not logged in' };
    },
    env: {},
    stderr: sink(),
    sleep: async () => undefined,
    retryDelays: [1, 1],
  });
  await assert.rejects(() => engine.ask('x'), /not logged in/);
  assert.equal(calls, 3);
});

test('the claude engine recovers on a later attempt', async () => {
  const answers = [
    { code: 1, stdout: '', stderr: 'transient' },
    { code: 0, stdout: ENVELOPE, stderr: '' },
  ];
  const engine = makeClaudeEngine({
    spawn: async () => answers.shift(),
    env: {},
    stderr: sink(),
    sleep: async () => undefined,
    retryDelays: [1],
  });
  assert.match((await engine.ask('x')).text, /REVIEW/);
});

test('readClaudeEnvelope reads the result field and refuses the rest', () => {
  assert.equal(
    readClaudeEnvelope(ENVELOPE).text,
    '{"decision":"REVIEW","confidence":0.4}'
  );
  assert.match(readClaudeEnvelope('').error, /answered nothing/);
  assert.match(readClaudeEnvelope('not json').error, /not JSON/);
  assert.match(
    readClaudeEnvelope(JSON.stringify({ is_error: true, result: 'over quota' }))
      .error,
    /over quota/
  );
  assert.match(
    readClaudeEnvelope(JSON.stringify({ type: 'result' })).error,
    /no result text/
  );
});

test('the API gate accepts the exact word and nothing else', async () => {
  const stdout = sink();
  const key = await confirmApiBilling({
    env: { ANTHROPIC_API_KEY: 'sk-ant-x' },
    isTty: true,
    askLine: async () => `  ${API_CONFIRMATION}  `,
    stdout,
  });
  assert.equal(key, 'sk-ant-x');
  assert.match(stdout.written.join(''), /bills the Anthropic API/);
});

test('the API gate refuses anything else that was typed', async () => {
  for (const typed of ['api_key', 'yes', 'y', '', 'API_KEYS', 'API KEY']) {
    await assert.rejects(
      () =>
        confirmApiBilling({
          env: { ANTHROPIC_API_KEY: 'sk-ant-x' },
          isTty: true,
          askLine: async () => typed,
          stdout: sink(),
        }),
      /Not confirmed/,
      `${typed} should not have been accepted`
    );
  }
});

test('the API gate refuses when there is no terminal to ask', async () => {
  let asked = false;
  await assert.rejects(
    () =>
      confirmApiBilling({
        env: { ANTHROPIC_API_KEY: 'sk-ant-x' },
        isTty: false,
        askLine: async () => {
          asked = true;
          return API_CONFIRMATION;
        },
        stdout: sink(),
      }),
    /no terminal to ask/
  );
  assert.equal(asked, false);
});

test('the API engine needs a key at all', async () => {
  await assert.rejects(
    () =>
      confirmApiBilling({
        env: {},
        isTty: true,
        askLine: async () => API_CONFIRMATION,
        stdout: sink(),
      }),
    /ANTHROPIC_API_KEY, and it is not set/
  );
});

test('the API engine sends the rules as a cached system block', async () => {
  const sent = [];
  const usage = emptyUsage();
  const engine = makeApiEngine({
    fetchImpl: async (url, options) => {
      sent.push({
        url,
        body: JSON.parse(options.body),
        headers: options.headers,
      });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          content: [{ type: 'thinking' }, { type: 'text', text: '{"a":1}' }],
          usage: { input_tokens: 10, output_tokens: 3 },
        }),
      };
    },
    apiKey: 'sk-ant-x',
    usage,
  });

  const answer = await engine.ask('the packet', { system: 'the rules' });
  assert.equal(answer.text, '{"a":1}');
  assert.equal(sent[0].headers['x-api-key'], 'sk-ant-x');
  assert.equal(sent[0].body.system[0].text, 'the rules');
  assert.deepEqual(sent[0].body.system[0].cache_control, { type: 'ephemeral' });
  assert.equal(sent[0].body.messages[0].content, 'the packet');
  assert.equal(usage.inputTokens, 10);
});

test('the API engine retries a 429 and a 5xx', async () => {
  const statuses = [429, 503, 200];
  let calls = 0;
  const engine = makeApiEngine({
    fetchImpl: async () => {
      const status = statuses[calls++];
      return {
        ok: status === 200,
        status,
        json: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
      };
    },
    apiKey: 'k',
    sleep: async () => undefined,
    retryDelays: [1, 1, 1],
  });
  assert.equal((await engine.ask('x')).text, 'ok');
  assert.equal(calls, 3);
});

test('the small helpers carried over from the plan 0098 tool still hold', () => {
  assert.equal(stripFence('```json\n{"a":1}\n```'), '{"a":1}');
  assert.equal(stripFence('  {"a":1} '), '{"a":1}');
  assert.equal(textOf({ content: [{ type: 'text', text: 'x' }] }), 'x');
  assert.equal(textOf({ content: [] }), null);
  assert.deepEqual(addUsage(emptyUsage(), undefined), {
    calls: 1,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  });
});
