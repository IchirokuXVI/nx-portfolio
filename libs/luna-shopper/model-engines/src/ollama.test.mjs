import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NUM_CTX_CEILING,
  OLLAMA_DEFAULT_BATCH,
  OLLAMA_DEFAULT_HOST,
  OLLAMA_MAX_BATCH,
  makeOllamaEngine,
  modelContextLength,
  ollamaBatchSize,
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

/** A writable that keeps what was written, so a test can read the notice. */
function sink() {
  const written = [];
  return { written, write: (text) => written.push(text) };
}

/**
 * A fake server that takes as long as the test says over each prompt, and
 * records how many requests were in flight at once.
 *
 * The whole of the pool is asserted against `peak` and `finished`: `peak` is
 * how many requests were ever in flight, and `finished` is the order the server
 * answered in, which is what the answers are compared against to prove they are
 * in input order rather than completion order.
 */
function pooledServer({
  delayFor = () => 0,
  replyFor = (prompt) => reply({ content: `answer to ${prompt}` }),
  show = THINKING_MODEL,
  onStart = () => undefined,
} = {}) {
  const seen = { show: [], chat: [], started: [], finished: [], peak: 0 };
  let inFlight = 0;
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith('/api/show')) {
      seen.show.push(body);
      return { ok: true, status: 200, json: async () => show };
    }
    const prompt = body.messages[body.messages.length - 1].content;
    seen.chat.push(body);
    seen.started.push(prompt);
    inFlight += 1;
    seen.peak = Math.max(seen.peak, inFlight);
    onStart(prompt, seen);
    await new Promise((resolve) => setTimeout(resolve, delayFor(prompt)));
    inFlight -= 1;
    seen.finished.push(prompt);
    const next = replyFor(prompt);
    if (next && typeof next.status === 'number') {
      return { ok: false, status: next.status, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => next };
  };
  return { fetchImpl, seen };
}

/** `p0` to `p<count - 1>`, which is what every pool test asks. */
function prompts(count) {
  return Array.from({ length: count }, (unused, index) => `p${index}`);
}

test('the pool holds four in flight, answers all ten, and answers in input order', async () => {
  // The earlier prompts are the slowest, so the server answers this list very
  // nearly backwards and an implementation that reported completion order would
  // be caught by it.
  const fake = pooledServer({
    delayFor: (prompt) => (10 - Number(prompt.slice(1))) * 10,
  });
  const engine = engineOn(fake);

  assert.equal(engine.batchSize, 4);
  const answers = await engine.askMany(prompts(10));

  assert.equal(fake.seen.peak, 4);
  assert.equal(fake.seen.chat.length, 10);
  assert.deepEqual(
    answers.map((entry) => entry.text),
    prompts(10).map((prompt) => `answer to ${prompt}`)
  );
  // The proof that the ordering was not free: the server did not answer in the
  // order it was asked.
  assert.notDeepEqual(fake.seen.finished, prompts(10));
});

test('a slow prompt in the middle does not hold back the ones behind it', async () => {
  // This is the whole difference between a pool and chunks of `batchSize` run
  // through `Promise.all`: a chunk waits for its slowest member before the next
  // chunk starts, so p1 would block p2 and everything after it.
  const fake = pooledServer({
    delayFor: (prompt) => (prompt === 'p1' ? 300 : 5),
  });

  const answers = await engineOn(fake, { env: { OLLAMA_BATCH: '2' } }).askMany(
    prompts(6)
  );

  assert.equal(answers.length, 6);
  assert.equal(fake.seen.peak, 2);
  // Everything behind the slow one was asked and answered while it was still
  // running, so it is the last thing the server finished.
  assert.equal(fake.seen.finished[fake.seen.finished.length - 1], 'p1');
  assert.deepEqual(fake.seen.finished.slice(0, 5), [
    'p0',
    'p2',
    'p3',
    'p4',
    'p5',
  ]);
});

test('one prompt that gave up is an entry, and every other entry answers', async () => {
  const fake = pooledServer({
    // A 500 is retried, so this prompt spends its whole backoff and gives up
    // while the others are answering.
    replyFor: (prompt) =>
      prompt === 'p2'
        ? { status: 500 }
        : reply({ content: `answer to ${prompt}` }),
  });

  const answers = await engineOn(fake).askMany(prompts(5));

  assert.equal(answers.length, 5);
  assert.match(String(answers[2].error), /The ollama engine gave up: HTTP 500/);
  assert.equal(answers[2].text, undefined);
  for (const index of [0, 1, 3, 4]) {
    assert.equal(answers[index].text, `answer to p${index}`);
    assert.equal(answers[index].error, undefined);
  }
});

test('a stop rejects with the signal reason and starts nothing after it', async () => {
  const controller = new AbortController();
  const fake = pooledServer({
    delayFor: () => 5,
    onStart: (prompt, seen) => {
      if (seen.started.length === 3) {
        controller.abort(new Error('the run was stopped with Ctrl+C'));
      }
    },
  });

  const engine = engineOn(fake, {
    env: { OLLAMA_BATCH: '2' },
    signal: controller.signal,
  });

  // A stopped run is not a run that failed eight times, so it is an answer
  // about the run rather than an array of entries.
  await assert.rejects(
    () => engine.askMany(prompts(8)),
    /stopped with Ctrl\+C/
  );
  // Two were in flight and one had just started when the stop arrived. Nothing
  // after them was asked.
  assert.deepEqual(fake.seen.started, ['p0', 'p1', 'p2']);
});

test('the model is asked what it is once even when four prompts start at once', async () => {
  // The promise rather than the value is what the engine holds, and a pool is
  // where that matters: four workers reach the probe before any of them has an
  // answer to it.
  const fake = pooledServer({ delayFor: () => 5 });
  await engineOn(fake).askMany(prompts(6));
  assert.equal(fake.seen.show.length, 1);
  assert.equal(fake.seen.chat.length, 6);
});

test('every request the pool sends is the request a single call sends', async () => {
  const schema = { type: 'object', required: ['decision'] };
  const fake = pooledServer({ delayFor: () => 2 });
  const engine = engineOn(fake);

  await engine.askMany(prompts(6), { system: 'THE RULES', schema });

  for (const [index, body] of fake.seen.chat.entries()) {
    assert.equal(body.model, 'gemma4:12b');
    assert.equal(body.stream, false);
    assert.equal(body.think, false);
    assert.deepEqual(body.format, schema);
    assert.equal(body.keep_alive, '30m');
    assert.equal(body.options.temperature, 0);
    // The one `num_ctx` for the whole engine, on every request the pool sends:
    // a changed value reloads the model, and a pool changing it would reload it
    // several times over.
    assert.equal(body.options.num_ctx, NUM_CTX_CEILING);
    // The two halves are still two messages, so the prefix Ollama caches by
    // itself is still the system prompt.
    assert.deepEqual(body.messages[0], {
      role: 'system',
      content: 'THE RULES',
    });
    assert.equal(body.messages[1].content, `p${index}`);
  }
});

test('the truncation floor is measured against each reply in a batch', async () => {
  const system = 'r'.repeat(600);
  const fake = pooledServer({
    replyFor: (prompt) =>
      prompt === 'p1'
        ? reply({ promptTokens: 40, cached: 0 })
        : reply({
            content: `answer to ${prompt}`,
            promptTokens: 200,
            cached: 0,
          }),
  });

  const answers = await engineOn(fake).askMany(prompts(4), { system });

  // 600 characters cannot honestly evaluate to fewer than 100 tokens, and the
  // check is per reply rather than per batch, so one truncated answer does not
  // take the other three with it.
  assert.match(String(answers[1].error), /truncated at num_ctx 16384/);
  assert.equal(answers[0].text, 'answer to p0');
  assert.equal(answers[2].text, 'answer to p2');
});

test('the counters add up across every reply in a batch', async () => {
  const usage = emptyUsage();
  const fake = pooledServer({
    replyFor: (prompt) =>
      reply({ content: prompt, promptTokens: 100, cached: 60, evalCount: 7 }),
  });

  await engineOn(fake, { usage }).askMany(prompts(5));

  assert.equal(usage.calls, 5);
  assert.equal(usage.inputTokens, 200);
  assert.equal(usage.cacheReadInputTokens, 300);
  assert.equal(usage.outputTokens, 35);
});

test('OLLAMA_BATCH=1 is plan 0002 back exactly, one request at a time', async () => {
  const fake = pooledServer({ delayFor: () => 5 });
  const engine = engineOn(fake, { env: { OLLAMA_BATCH: '1' } });

  assert.equal(engine.batchSize, 1);
  const answers = await engine.askMany(prompts(4));

  assert.equal(fake.seen.peak, 1);
  assert.deepEqual(fake.seen.finished, prompts(4));
  assert.equal(answers.length, 4);
});

test('a width above what was measured runs, and says so once', async () => {
  const stderr = sink();
  const fake = pooledServer();
  const engine = engineOn(fake, {
    env: { OLLAMA_BATCH: '16' },
    stderr,
  });

  assert.equal(engine.batchSize, 16);
  await engine.askMany(prompts(3));
  await engine.askMany(prompts(3));

  // The value is not clamped, because the operator's machine is theirs to
  // experiment on. It is questioned once, and the line names the server side
  // knob it should match.
  assert.equal(stderr.written.length, 1);
  assert.match(stderr.written[0], /OLLAMA_NUM_PARALLEL/);
  assert.equal(stderr.written[0].split('\n').filter(Boolean).length, 1);
  assert.equal(fake.seen.chat.length, 6);
});

test('a width at what was measured says nothing, and neither does a single ask', async () => {
  const stderr = sink();
  const fake = pooledServer();
  await engineOn(fake, { env: { OLLAMA_BATCH: '8' }, stderr }).askMany(
    prompts(2)
  );
  assert.deepEqual(stderr.written, []);

  // An engine that only ever answers `ask` has nothing to be warned about.
  const alone = sink();
  await engineOn(pooledServer(), {
    env: { OLLAMA_BATCH: '16' },
    stderr: alone,
  }).ask('x');
  assert.deepEqual(alone.written, []);
});

test('a width Ollama would answer 503 to is refused before anything runs', async () => {
  const fake = pooledServer();
  assert.throws(
    () => engineOn(fake, { env: { OLLAMA_BATCH: '257' } }),
    /OLLAMA_BATCH is 257, and 256 is the most this adapter holds in flight/
  );
  // Refused while the engine is being built, so nothing was asked of anything.
  assert.deepEqual(fake.seen.show, []);
});

test('a width that is not a positive whole number is refused', async () => {
  for (const value of ['0', '-1', '2.5', 'four', 'many']) {
    assert.throws(
      () => engineOn(pooledServer(), { env: { OLLAMA_BATCH: value } }),
      /it has to be a whole number of requests, one or more/
    );
  }
});

test('ollamaBatchSize reads the width and refuses what it cannot', () => {
  assert.equal(ollamaBatchSize({}), OLLAMA_DEFAULT_BATCH);
  assert.equal(ollamaBatchSize({ OLLAMA_BATCH: '' }), OLLAMA_DEFAULT_BATCH);
  assert.equal(ollamaBatchSize({ OLLAMA_BATCH: '  6 ' }), 6);
  assert.equal(ollamaBatchSize({ OLLAMA_BATCH: '256' }), OLLAMA_MAX_BATCH);
  assert.throws(() => ollamaBatchSize({ OLLAMA_BATCH: '257' }));
  assert.throws(() => ollamaBatchSize({ OLLAMA_BATCH: 'x' }));
});

test('an empty batch is an empty answer and asks nothing', async () => {
  const fake = pooledServer();
  assert.deepEqual(await engineOn(fake).askMany([]), []);
  assert.deepEqual(fake.seen.chat, []);
});
