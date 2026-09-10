import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NUM_CTX_CEILING,
  OLLAMA_DEFAULT_HOST,
  makeOllamaEngine,
  modelContextLength,
  ollamaHost,
  truncationFloor,
} from './ollama.mjs';
import { emptyUsage } from './usage.mjs';

/** What `/api/show` answered on the measured server, trimmed to what is read. */
const THINKING_MODEL = {
  capabilities: ['completion', 'vision', 'audio', 'tools', 'thinking'],
  model_info: { 'gemma3.context_length': 262144 },
};

/** The same reply for a model that declares no thinking. */
const PLAIN_MODEL = {
  capabilities: ['completion'],
  model_info: { 'llama.context_length': 8192 },
};

/** A `/api/chat` reply carrying an answer and the three counters. */
function reply({
  content = '{"decision":"LINK"}',
  promptTokens = 2993,
  cached = 2900,
  evalCount = 42,
} = {}) {
  return {
    message: { role: 'assistant', content },
    prompt_eval_count: promptTokens,
    prompt_eval_cached_count: cached,
    eval_count: evalCount,
    done_reason: 'stop',
  };
}

/**
 * A fake server that answers both endpoints and keeps what it was sent.
 *
 * `chats` is the queue of `/api/chat` answers, each either a payload or a
 * `{ status }` to fail with; the last one is repeated once the queue runs dry.
 */
function server({ show = THINKING_MODEL, showStatus = 200, chats = [] } = {}) {
  const seen = { show: [], chat: [] };
  const queue = [...chats];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith('/api/show')) {
      seen.show.push({ url, body });
      return {
        ok: showStatus === 200,
        status: showStatus,
        json: async () => show,
      };
    }
    seen.chat.push({ url, body, signal: options.signal });
    const next = queue.length > 1 ? queue.shift() : (queue[0] ?? reply());
    if (next && typeof next.status === 'number') {
      return { ok: false, status: next.status, json: async () => ({}) };
    }
    if (next && next.throws) {
      throw next.throws;
    }
    return { ok: true, status: 200, json: async () => next };
  };
  return { fetchImpl, seen };
}

/** An engine wired to a fake server, with the waits taken out. */
function engineOn(fake, extra = {}) {
  return makeOllamaEngine({
    fetchImpl: fake.fetchImpl,
    env: {},
    model: 'gemma4:12b',
    sleep: async () => undefined,
    retryDelays: [1, 1, 1],
    ...extra,
  });
}

test('the two halves arrive as two messages and are never joined', async () => {
  const fake = server();
  const engine = engineOn(fake);

  await engine.ask('the packet', { system: 'THE RULES' });

  const body = fake.seen.chat[0].body;
  assert.deepEqual(body.messages, [
    { role: 'system', content: 'THE RULES' },
    { role: 'user', content: 'the packet' },
  ]);
  // Joining them would put the packet inside the prefix Ollama caches by
  // itself, and lose the cached system prompt on every row.
  assert.equal(body.messages[0].content.includes('the packet'), false);
});

test('the schema arrives as format and nothing arrives as a tool hint', async () => {
  const fake = server();
  const engine = engineOn(fake);
  const schema = { type: 'object', required: ['decision'] };

  await engine.ask('the packet', { system: 'THE RULES', schema });

  const body = fake.seen.chat[0].body;
  assert.deepEqual(body.format, schema);
  // There is no synthetic tool here, so a hint about top level arguments of a
  // tool call would be describing a mechanism this model is not using.
  assert.equal(JSON.stringify(body).includes('StructuredOutput'), false);
  assert.equal(JSON.stringify(body).includes('top level'), false);
});

test('a call with no schema sends no format', async () => {
  const fake = server();
  await engineOn(fake).ask('the packet', { system: 'THE RULES' });
  assert.ok(!('format' in fake.seen.chat[0].body));
});

test('the request is not streamed, is not warm, and asks for one answer', async () => {
  const fake = server();
  await engineOn(fake).ask('the packet', { system: 'THE RULES' });

  const body = fake.seen.chat[0].body;
  assert.equal(body.stream, false);
  assert.equal(body.model, 'gemma4:12b');
  assert.equal(body.options.temperature, 0);
  assert.equal(body.keep_alive, '30m');
});

test('num_ctx is the same value on every call of one engine', async () => {
  const fake = server();
  const engine = engineOn(fake);

  await engine.ask('one', { system: 'THE RULES' });
  await engine.ask('two', { system: 'THE RULES' });
  await engine.ask('three', { system: 'THE RULES' });

  // A changed `num_ctx` reloads the model: 1 ms of load for a repeated value
  // against 4,495 ms the moment the value changed.
  const values = fake.seen.chat.map((call) => call.body.options.num_ctx);
  assert.deepEqual(values, [NUM_CTX_CEILING, NUM_CTX_CEILING, NUM_CTX_CEILING]);
});

test('the model is asked what it is once, and not once per call', async () => {
  const fake = server();
  const engine = engineOn(fake);

  await engine.ask('one');
  await engine.ask('two');
  await engine.ask('three');

  assert.equal(fake.seen.show.length, 1);
  assert.equal(fake.seen.show[0].url, `${OLLAMA_DEFAULT_HOST}/api/show`);
  assert.deepEqual(fake.seen.show[0].body, { model: 'gemma4:12b' });
  assert.equal(fake.seen.chat.length, 3);
});

test('nothing is asked of the server until the first ask', async () => {
  const fake = server();
  // `create` is synchronous for the two adapters that already exist, so the
  // probe cannot live there. Building an engine reaches nothing.
  engineOn(fake);
  assert.deepEqual(fake.seen.show, []);
  assert.deepEqual(fake.seen.chat, []);
});

test('think travels false for a model that can think', async () => {
  const fake = server({ show: THINKING_MODEL });
  await engineOn(fake).ask('the packet');
  // Reasoning is not polluting the answer, it is billed in time: 67 output
  // tokens to answer "Ok" against 3 with thinking off.
  assert.equal(fake.seen.chat[0].body.think, false);
});

test('think is absent for a model whose capabilities do not list it', async () => {
  const fake = server({ show: PLAIN_MODEL });
  await engineOn(fake).ask('the packet');
  // Ollama refuses `think` on a model that does not support it.
  assert.ok(!('think' in fake.seen.chat[0].body));
});

test("num_ctx is the model's own context length when it is under the ceiling", async () => {
  const fake = server({ show: PLAIN_MODEL });
  await engineOn(fake).ask('the packet');
  assert.equal(fake.seen.chat[0].body.options.num_ctx, 8192);
});

test('num_ctx is the ceiling when the model is wider than it', async () => {
  const fake = server({ show: THINKING_MODEL });
  await engineOn(fake).ask('the packet');
  // 262,144 tokens on a 12B model asks for more memory than the machine has.
  assert.equal(fake.seen.chat[0].body.options.num_ctx, 16384);
});

test('OLLAMA_NUM_CTX moves the ceiling in both directions', async () => {
  const wider = server({ show: THINKING_MODEL });
  await engineOn(wider, { env: { OLLAMA_NUM_CTX: '65536' } }).ask('x');
  assert.equal(wider.seen.chat[0].body.options.num_ctx, 65536);

  const smaller = server({ show: PLAIN_MODEL });
  await engineOn(smaller, { env: { OLLAMA_NUM_CTX: '4096' } }).ask('x');
  assert.equal(smaller.seen.chat[0].body.options.num_ctx, 4096);
});

test('a server that cannot be described is still asked at the ceiling', async () => {
  // The server default is the one thing this adapter never inherits, so a
  // probe that answered nothing falls back to the value chosen to be safe.
  const fake = server({ showStatus: 500 });
  await engineOn(fake).ask('the packet');
  assert.equal(fake.seen.chat[0].body.options.num_ctx, NUM_CTX_CEILING);
  assert.ok(!('think' in fake.seen.chat[0].body));
});

test('the default host, a URL and a bare host:port all reach the same address', async () => {
  const addresses = [];
  for (const env of [
    {},
    { OLLAMA_HOST: 'http://localhost:11434' },
    { OLLAMA_HOST: 'localhost:11434' },
    { OLLAMA_HOST: 'http://localhost:11434/' },
    { OLLAMA_HOST: '  localhost:11434  ' },
  ]) {
    const fake = server();
    await engineOn(fake, { env }).ask('x');
    addresses.push(fake.seen.chat[0].url);
  }
  assert.deepEqual(
    new Set(addresses),
    new Set([`${OLLAMA_DEFAULT_HOST}/api/chat`])
  );
});

test('ollamaHost adds the scheme the operator left out and keeps the one they wrote', () => {
  assert.equal(ollamaHost({}), OLLAMA_DEFAULT_HOST);
  assert.equal(ollamaHost({ OLLAMA_HOST: '' }), OLLAMA_DEFAULT_HOST);
  assert.equal(
    ollamaHost({ OLLAMA_HOST: '127.0.0.1:11434' }),
    'http://127.0.0.1:11434'
  );
  assert.equal(
    ollamaHost({ OLLAMA_HOST: 'https://box:443' }),
    'https://box:443'
  );
});

test('the counters subtract the cached tokens rather than counting them twice', async () => {
  const usage = emptyUsage();
  const fake = server({
    chats: [reply({ promptTokens: 2993, cached: 2900, evalCount: 42 })],
  });
  await engineOn(fake, { usage }).ask('the packet', { system: 'THE RULES' });

  // `prompt_eval_count` includes the cached tokens and Anthropic's
  // `input_tokens` excludes them, so adding the raw field would count the
  // system prompt twice on every row after the first.
  assert.equal(usage.inputTokens, 93);
  assert.equal(usage.cacheReadInputTokens, 2900);
  assert.equal(usage.outputTokens, 42);
  // Ollama neither charges for filling its cache nor reports a number for it,
  // and inventing one to fill the field would be a number nothing measured.
  assert.equal(usage.cacheCreationInputTokens, 0);
  assert.equal(usage.calls, 1);
});

test('a reply that reports no counts at all still counts as one call', async () => {
  const usage = emptyUsage();
  const fake = server({ chats: [{ message: { content: '{}' } }] });
  await engineOn(fake, { usage }).ask('x');

  assert.deepEqual(usage, {
    calls: 1,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  });
});

test('a truncated reply is refused, fatally, and the refusal names OLLAMA_NUM_CTX', async () => {
  const system = 'r'.repeat(600);
  let waits = 0;
  const fake = server({ chats: [reply({ promptTokens: 40, cached: 0 })] });
  const engine = engineOn(fake, {
    sleep: async () => {
      waits += 1;
    },
  });

  // 600 characters cannot honestly evaluate to fewer than 100 tokens, so a
  // reply that says 40 read the back of the prompt and dropped the rules.
  await assert.rejects(
    () => engine.ask('', { system }),
    /The ollama engine gave up: .*OLLAMA_NUM_CTX/
  );
  // The same request truncates the same way, so no wait is spent on it.
  assert.equal(fake.seen.chat.length, 1);
  assert.equal(waits, 0);
});

test('a reply just over the floor is an honest one', async () => {
  const system = 'r'.repeat(600);
  const fake = server({ chats: [reply({ promptTokens: 100, cached: 0 })] });
  const answer = await engineOn(fake).ask('', { system });
  assert.equal(answer.text, '{"decision":"LINK"}');
});

test('truncationFloor is the loosest honest reading of a length', () => {
  assert.equal(truncationFloor(127651), 21275);
  assert.equal(truncationFloor(0), 0);
});

test('modelContextLength reads the family named field and answers null otherwise', () => {
  assert.equal(modelContextLength(THINKING_MODEL), 262144);
  assert.equal(modelContextLength({ model_info: {} }), null);
  assert.equal(modelContextLength(null), null);
});

test('a 404 is fatal and names the pull that fixes it', async () => {
  let waits = 0;
  const fake = server({ chats: [{ status: 404 }] });
  const engine = engineOn(fake, {
    model: 'nope:1b',
    sleep: async () => {
      waits += 1;
    },
  });

  // A model that is not pulled is the same answer forty seconds later.
  await assert.rejects(
    () => engine.ask('x'),
    /The ollama engine gave up: HTTP 404, so the server does not have nope:1b\. Pull it with `ollama pull nope:1b`\./
  );
  assert.equal(fake.seen.chat.length, 1);
  assert.equal(waits, 0);
});

test('a refused connection is fatal and names the server that is not running', async () => {
  const refused = new TypeError('fetch failed');
  refused.cause = Object.assign(new Error('connect ECONNREFUSED'), {
    code: 'ECONNREFUSED',
  });
  let waits = 0;
  const fake = server({ chats: [{ throws: refused }] });
  const engine = engineOn(fake, {
    sleep: async () => {
      waits += 1;
    },
  });

  await assert.rejects(
    () => engine.ask('x'),
    /nothing is listening at http:\/\/localhost:11434, so the connection was refused\. Start the server with `ollama serve`/
  );
  assert.equal(waits, 0);
});

test('a 5xx is tried again', async () => {
  const fake = server({ chats: [{ status: 500 }, { status: 503 }, reply()] });
  const answer = await engineOn(fake).ask('x');
  assert.equal(answer.text, '{"decision":"LINK"}');
  assert.equal(fake.seen.chat.length, 3);
});

test('a reply with no message content is tried again', async () => {
  const fake = server({
    chats: [{ message: { role: 'assistant', thinking: 'hm' } }, reply()],
  });
  const answer = await engineOn(fake).ask('x');
  assert.equal(answer.text, '{"decision":"LINK"}');
  assert.equal(fake.seen.chat.length, 2);
});

test('an abort is reported as the signal reason and not as a connection failure', async () => {
  const controller = new AbortController();
  // An aborted fetch and a refused connection both arrive as a `TypeError`, so
  // an adapter that read the error would tell somebody who pressed Ctrl+C to
  // check whether Ollama is running.
  const aborted = new TypeError('fetch failed');
  aborted.cause = Object.assign(new Error('connect ECONNREFUSED'), {
    code: 'ECONNREFUSED',
  });

  const seen = [];
  const engine = makeOllamaEngine({
    env: {},
    fetchImpl: async (url, options) => {
      if (url.endsWith('/api/show')) {
        return { ok: true, status: 200, json: async () => THINKING_MODEL };
      }
      seen.push(options.signal);
      controller.abort(new Error('the run was stopped with Ctrl+C'));
      throw aborted;
    },
    sleep: async () => undefined,
    retryDelays: [1, 1],
    signal: controller.signal,
  });

  await assert.rejects(() => engine.ask('x'), /stopped with Ctrl\+C/);
  assert.equal(seen.length, 1);
  assert.equal(seen[0], controller.signal);
});

test('a fenced object is still an answer', async () => {
  const fake = server({
    chats: [reply({ content: '```json\n{"decision":"LINK"}\n```' })],
  });
  assert.equal((await engineOn(fake).ask('x')).text, '{"decision":"LINK"}');
});

test('the engine reports what answered, and no effort', async () => {
  const engine = engineOn(server(), { model: 'qwen3:8b' });
  assert.equal(engine.name, 'ollama');
  assert.equal(engine.model, 'qwen3:8b');
  // Nothing was asked of a knob this provider does not have.
  assert.equal(engine.effort, null);
});
