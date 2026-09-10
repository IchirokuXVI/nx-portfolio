import assert from 'node:assert/strict';
import test from 'node:test';
import {
  API_CONFIRMATION,
  confirmApiBilling,
  makeApiEngine,
  textOf,
} from './messages-api.mjs';
import { emptyUsage } from './usage.mjs';

/** A writable that keeps what was written, so a test can read the notice. */
function sink() {
  const written = [];
  return { written, write: (text) => written.push(text) };
}

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

test('the API engine does not retry a 401, and waits for nothing', async () => {
  let calls = 0;
  let waits = 0;
  const engine = makeApiEngine({
    fetchImpl: async () => {
      calls += 1;
      return { ok: false, status: 401, json: async () => ({}) };
    },
    apiKey: 'wrong',
    sleep: async () => {
      waits += 1;
    },
    retryDelays: [1, 1, 1],
  });

  // No wait makes a wrong key right, so a shared loop that could not say so
  // would spend thirty seconds proving it again.
  await assert.rejects(
    () => engine.ask('x'),
    /The api engine gave up: HTTP 401\./
  );
  assert.equal(calls, 1);
  assert.equal(waits, 0);
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

test('a reply with no text block is tried again', async () => {
  const replies = [
    { content: [{ type: 'thinking' }] },
    { content: [{ type: 'text', text: 'ok' }] },
  ];
  const engine = makeApiEngine({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => replies.shift(),
    }),
    apiKey: 'k',
    sleep: async () => undefined,
    retryDelays: [1],
  });

  assert.equal((await engine.ask('x')).text, 'ok');
});

test('textOf skips a thinking block and answers null when there is no text', () => {
  assert.equal(textOf({ content: [{ type: 'text', text: 'x' }] }), 'x');
  assert.equal(textOf({ content: [] }), null);
  assert.equal(textOf({}), null);
});
