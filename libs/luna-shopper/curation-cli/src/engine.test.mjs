import assert from 'node:assert/strict';
import test from 'node:test';
import {
  API_CONFIRMATION,
  MINIMAL_ARGS,
  TOOL_SHAPE_HINT,
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

test('the claude engine carries the rules and the shape as flags, not as prose', async () => {
  const seen = [];
  const engine = makeClaudeEngine({
    spawn: async (command, args, options) => {
      seen.push({ args, options });
      return { code: 0, stdout: ENVELOPE, stderr: '' };
    },
    env: { PATH: '/usr/bin' },
    model: 'claude-sonnet-5',
    scratchDir: '/tmp/scratch',
  });

  const schema = { type: 'object', required: ['decision'] };
  await engine.ask('the packet', { system: 'THE RULES', schema });

  // `--system-prompt` replaces Claude Code's own; `--append-system-prompt`
  // would keep both, which is the whole overhead this engine removes.
  const at = seen[0].args.indexOf('--system-prompt');
  assert.ok(at > 0);
  assert.ok(seen[0].args[at + 1].startsWith('THE RULES'));
  assert.ok(!seen[0].args.includes('--append-system-prompt'));

  const schemaAt = seen[0].args.indexOf('--json-schema');
  assert.ok(schemaAt > 0);
  assert.deepEqual(JSON.parse(seen[0].args[schemaAt + 1]), schema);

  // The packet is the whole of stdin: the rules reach the model once.
  assert.equal(seen[0].options.input, 'the packet');
});

test('a schema brings the tool shape hint with it, and nothing else does', async () => {
  const seen = [];
  const spawn = async (command, args) => {
    seen.push(args);
    return { code: 0, stdout: ENVELOPE, stderr: '' };
  };
  const engine = makeClaudeEngine({
    spawn,
    env: { PATH: '/usr/bin' },
    scratchDir: '/tmp/scratch',
  });

  await engine.ask('the packet', {
    system: 'THE RULES',
    schema: { type: 'object' },
  });
  await engine.ask('the packet', { system: 'THE RULES' });

  const systemOf = (args) => args[args.indexOf('--system-prompt') + 1];

  // `--json-schema` is a synthetic `StructuredOutput` tool, and a call whose
  // arguments do not fit the schema costs a second request carrying the whole
  // prompt again. The hint is what stops that, so it travels with the schema.
  assert.equal(systemOf(seen[0]), `THE RULES\n${TOOL_SHAPE_HINT}`);
  assert.match(systemOf(seen[0]), /StructuredOutput/);

  // Without a schema there is no such tool, so naming one would only mislead.
  assert.equal(systemOf(seen[1]), 'THE RULES');
});

test('the api engine is never told about a tool it does not have', async () => {
  const sent = [];
  const engine = makeApiEngine({
    fetchImpl: async (url, options) => {
      sent.push(JSON.parse(options.body));
      return {
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: '{}' }],
          usage: {},
        }),
      };
    },
    apiKey: 'sk-test',
  });

  await engine.ask('the packet', {
    system: 'THE RULES',
    schema: { type: 'object' },
  });

  // It holds the schema through `output_config`, where the model answers in the
  // response and calls nothing. A hint about `StructuredOutput` would name a
  // tool that is not there.
  assert.equal(
    JSON.stringify(sent[0].system).includes('StructuredOutput'),
    false
  );
});

test('the claude engine omits both flags when it is given neither', async () => {
  const seen = [];
  const engine = makeClaudeEngine({
    spawn: async (command, args) => {
      seen.push(args);
      return { code: 0, stdout: ENVELOPE, stderr: '' };
    },
    env: { PATH: '/usr/bin' },
    scratchDir: '/tmp/scratch',
  });

  await engine.ask('the packet');

  assert.ok(!seen[0].includes('--system-prompt'));
  assert.ok(!seen[0].includes('--json-schema'));
});

test('the api engine holds the same schema through output_config', async () => {
  const sent = [];
  const engine = makeApiEngine({
    fetchImpl: async (url, options) => {
      sent.push(JSON.parse(options.body));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          content: [{ type: 'text', text: '{"a":1}' }],
          usage: { input_tokens: 10, output_tokens: 3 },
        }),
      };
    },
    apiKey: 'sk-ant-test',
  });

  const schema = { type: 'object', required: ['decision'] };
  await engine.ask('the packet', { system: 'THE RULES', schema });

  assert.deepEqual(sent[0].output_config.format, {
    type: 'json_schema',
    schema,
  });
  assert.equal(sent[0].output_config.effort, 'medium');
  // Both engines answer the same shape, so a run cannot depend on which drove it.
  assert.equal(sent[0].system[0].text, 'THE RULES');
  assert.equal(sent[0].messages[0].content, 'the packet');
});

test('the api engine sends no format when it is given no schema', async () => {
  const sent = [];
  const engine = makeApiEngine({
    fetchImpl: async (url, options) => {
      sent.push(JSON.parse(options.body));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          content: [{ type: 'text', text: '{"a":1}' }],
          usage: {},
        }),
      };
    },
    apiKey: 'sk-ant-test',
  });

  await engine.ask('the packet', { system: 'THE RULES' });

  assert.ok(!('format' in sent[0].output_config));
});

test('MINIMAL_ARGS empties the call and never reaches for --bare', () => {
  // `--bare` skips CLAUDE.md too, and also refuses OAuth and demands
  // ANTHROPIC_API_KEY, which is the billing this engine exists to avoid.
  assert.ok(!MINIMAL_ARGS.includes('--bare'));
  // An empty string is how the CLI is told to load no tools at all.
  assert.equal(MINIMAL_ARGS[MINIMAL_ARGS.indexOf('--tools') + 1], '');
  for (const flag of [
    '--disable-slash-commands',
    '--strict-mcp-config',
    '--no-session-persistence',
    // A SessionStart hook fires on every call and a plugin that injects text is
    // billed once a row. One installed here cost 1,980 input tokens a call.
    '--safe-mode',
  ]) {
    assert.ok(MINIMAL_ARGS.includes(flag), flag);
  }
});

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

test('the child environment turns the prompt cache off', () => {
  // `claude -p` breakpoints after the packet and takes no flag to move it, so
  // with a different packet every row the prefix never matches: measured, four
  // consecutive rows each wrote ~3,478 tokens and read zero. A write is $4 per
  // MTok against $2 for input, so an entry nothing reads costs double.
  const { env } = claudeChildEnv({ PATH: '/usr/bin' });
  assert.equal(env.DISABLE_PROMPT_CACHING, '1');
});

test('the cache stays off even when the operator set it on', () => {
  const { env } = claudeChildEnv({ DISABLE_PROMPT_CACHING: '0' });
  assert.equal(env.DISABLE_PROMPT_CACHING, '1');
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
    scratchDir: '/tmp/scratch',
  });

  const first = await engine.ask('packet');
  const second = await engine.ask('packet');

  assert.equal(first.text, '{"decision":"REVIEW","confidence":0.4}');
  assert.equal(second.text, first.text);
  assert.equal(seen[0].command, 'claude');
  assert.deepEqual(seen[0].args, [
    '-p',
    '--output-format',
    'json',
    '--model',
    'claude-sonnet-5',
    '--effort',
    'medium',
    ...MINIMAL_ARGS,
  ]);
  assert.equal(seen[0].options.input, 'packet');
  // The spawn runs where there is no CLAUDE.md to load.
  assert.equal(seen[0].options.cwd, '/tmp/scratch');
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

test('the claude engine sends the effort it was made with', async () => {
  const seen = [];
  const engine = makeClaudeEngine({
    spawn: async (command, args) => {
      seen.push(args);
      return { code: 0, stdout: ENVELOPE, stderr: '' };
    },
    env: { PATH: '/usr/bin' },
    effort: 'high',
    stderr: sink(),
    scratchDir: '/tmp/scratch',
  });

  await engine.ask('packet');

  assert.equal(engine.effort, 'high');
  assert.deepEqual(seen[0].slice(0, 7), [
    '-p',
    '--output-format',
    'json',
    '--model',
    'claude-sonnet-5',
    '--effort',
    'high',
  ]);
});

test('the claude engine says nothing when there was no key to ignore', async () => {
  const stderr = sink();
  const engine = makeClaudeEngine({
    spawn: async () => ({ code: 0, stdout: ENVELOPE, stderr: '' }),
    env: { PATH: '/usr/bin' },
    stderr,
    scratchDir: '/tmp/scratch',
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
    scratchDir: '/tmp/scratch',
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
    scratchDir: '/tmp/scratch',
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

test('a stopped run makes no further attempt at the model', async () => {
  const controller = new AbortController();
  let calls = 0;
  const engine = makeClaudeEngine({
    spawn: async () => {
      calls += 1;
      // The keystroke reaches the whole terminal, so this child dies of it and
      // reports a plain non-zero exit.
      controller.abort(new Error('the run was stopped with Ctrl+C'));
      return { code: 130, stdout: '', stderr: '' };
    },
    env: {},
    scratchDir: '/tmp/scratch',
    sleep: async () => undefined,
    retryDelays: [1, 1, 1],
    signal: controller.signal,
  });

  await assert.rejects(() => engine.ask('x'), /stopped with Ctrl\+C/);
  assert.equal(calls, 1);
});

test('the api engine hands the signal to the request and stops retrying', async () => {
  const controller = new AbortController();
  const seen = [];
  const engine = makeApiEngine({
    apiKey: 'k',
    fetchImpl: async (url, options) => {
      seen.push(options.signal);
      controller.abort(new Error('the run was stopped with Ctrl+C'));
      throw new Error('aborted');
    },
    sleep: async () => undefined,
    retryDelays: [1, 1],
    signal: controller.signal,
  });

  await assert.rejects(() => engine.ask('x'), /stopped with Ctrl\+C/);
  assert.equal(seen.length, 1);
  assert.equal(seen[0], controller.signal);
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
